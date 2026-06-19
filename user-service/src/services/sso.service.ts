import crypto from 'crypto';
import bcrypt from 'bcrypt';
import jwt, { SignOptions, Secret } from 'jsonwebtoken';
import { Types } from 'mongoose';
import { SsoClient, ISsoClient } from '../database/models/sso-client.model';
import { SsoAuthCode } from '../database/models/sso-auth-code.model';
import { userRepository } from '../database/repositories/user.repository';
import { subscriptionService } from './subscription.service';
import { referralRepository } from '../database/repositories/referral.repository';
import { AppError } from '../utils/errors';
import config from '../config';
import logger from '../utils/logger';

const log = logger.getLogger('SsoService');

const AUTH_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export interface SsoTokenPayload {
    sub: string;           // userId
    client_id: string;
    scopes: string[];
    type: 'access' | 'refresh';
}

export interface SsoUserInfo {
    id: string;
    name: string;
    email: string;
    phoneNumber: string | null;
    country: string | null;
    avatarUrl: string | null;
    /**
     * Active subscription types for the user. Includes both registration tiers
     * (CLASSIQUE, CIBLE) AND feature subscriptions (RELANCE, VISIBILITE_MAX) when
     * present. SBC Live's creation gate is satisfied by either
     * `directReferralCount >= 25` or `subscriptionTypes.includes('VISIBILITE_MAX')`.
     */
    subscriptionTypes: string[];
    /** Direct (level-1) paid referral count. Drives SBC Live's capacity tier + the 25-ref creation gate. */
    directReferralCount: number;
    /** Convenience flag — true if any active subscription. */
    isActivated: boolean;
    /**
     * Creator earnings from SBC Live (75% of paid-live revenue after 25% SBC
     * commission). Read-only here — payment-service writes via
     * POST /users/internal/:userId/sbc-live-balance.
     */
    sbcLiveBalance: number;
}

/**
 * SSO (Single Sign-On) service for third-party SBC integrations.
 *
 * Implements an OAuth 2.0–style authorization-code flow adapted for SBC's SPA
 * architecture (Bearer tokens in localStorage, no session cookies). The browser
 * redirect step is replaced with a backend POST that consumes the user's existing
 * SBC JWT and issues a short-lived auth code; the client app's backend then
 * exchanges that code for access + refresh tokens server-to-server.
 *
 * Tokens are signed JWTs with a SEPARATE secret from the main SBC JWT so the
 * two token types are not interchangeable — an SBC user JWT can't be used as an
 * SSO access token, and vice versa.
 *
 * Initial consumer: SBC Live (live.sniperbuisnesscenter.com).
 */
class SsoService {

    /**
     * Looks up a registered client by clientId, verifying secret + redirect_uri
     * are valid. Used by the token endpoint (server-to-server) to authenticate
     * the calling client app before exchanging an auth code for tokens.
     *
     * Throws 401 on bad secret / unknown client / disabled client.
     * Throws 400 on redirect_uri not in the client's whitelist.
     */
    async authenticateClient(
        clientId: string,
        clientSecret: string,
        redirectUri?: string,
    ): Promise<ISsoClient> {
        if (!clientId || !clientSecret) {
            throw new AppError('client_id and client_secret are required', 401);
        }
        const client = await SsoClient.findOne({ clientId, enabled: true }).select('+clientSecretHash').lean<ISsoClient>();
        if (!client) {
            log.warn(`SSO client authentication failed: unknown or disabled client ${clientId}`);
            throw new AppError('Invalid client credentials', 401);
        }
        const ok = await bcrypt.compare(clientSecret, client.clientSecretHash);
        if (!ok) {
            log.warn(`SSO client authentication failed: bad secret for ${clientId}`);
            throw new AppError('Invalid client credentials', 401);
        }
        if (redirectUri && !client.redirectUris.includes(redirectUri)) {
            throw new AppError(`redirect_uri "${redirectUri}" is not registered for this client`, 400);
        }
        return client;
    }

    /**
     * Step 1 — called by SBC's own frontend after the user clicks "Authorize" on
     * the consent screen. Validates client + redirect_uri + scopes, then mints a
     * one-shot auth code the user's browser will carry in the redirect URL.
     *
     * The user must already be authenticated to SBC (the route is behind the
     * normal `authenticate` middleware on the controller side). The clientSecret
     * is NOT required here — only the public client_id — because this endpoint
     * is called from the user's browser via the SBC SPA, not server-to-server.
     */
    async issueAuthorizationCode(
        userId: string,
        clientId: string,
        redirectUri: string,
        requestedScopes: string[],
    ): Promise<{ code: string; expiresAt: Date; scopes: string[] }> {
        const client = await SsoClient.findOne({ clientId, enabled: true }).lean<ISsoClient>();
        if (!client) {
            throw new AppError(`Unknown or disabled client: ${clientId}`, 400);
        }
        if (!client.redirectUris.includes(redirectUri)) {
            throw new AppError(`redirect_uri "${redirectUri}" is not registered for this client`, 400);
        }

        // Intersection: only grant scopes the client is allowed to request.
        const grantedScopes = requestedScopes.filter((s) => client.allowedScopes.includes(s));
        if (grantedScopes.length === 0) {
            throw new AppError('None of the requested scopes are allowed for this client', 400);
        }

        const code = this.randomToken(40);
        const expiresAt = new Date(Date.now() + AUTH_CODE_TTL_MS);

        await SsoAuthCode.create({
            code,
            userId: new Types.ObjectId(userId),
            clientId,
            redirectUri,
            scopes: grantedScopes,
            expiresAt,
            used: false,
        });

        log.info(`SSO auth code issued for user ${userId} → client ${clientId} (scopes: ${grantedScopes.join(',')})`);
        return { code, expiresAt, scopes: grantedScopes };
    }

    /**
     * Step 2 — server-to-server: the client app's backend exchanges the auth code
     * for an access token + refresh token + the user payload.
     *
     * Idempotency / replay protection: codes are one-shot. On successful exchange
     * we mark `used: true`; a second exchange with the same code is rejected.
     */
    async exchangeCodeForTokens(
        code: string,
        clientId: string,
        clientSecret: string,
        redirectUri: string,
    ): Promise<{ accessToken: string; refreshToken: string; expiresIn: number; user: SsoUserInfo; scopes: string[] }> {
        await this.authenticateClient(clientId, clientSecret, redirectUri);

        // Atomic find-and-mark-used so two parallel exchanges can't both succeed.
        const authCode = await SsoAuthCode.findOneAndUpdate(
            { code, clientId, used: false, expiresAt: { $gt: new Date() } },
            { $set: { used: true } },
            { new: true },
        );
        if (!authCode) {
            throw new AppError('Invalid, expired, or already-used authorization code', 400);
        }
        if (authCode.redirectUri !== redirectUri) {
            // redirect_uri mismatch is a real attack indicator — log loud.
            log.warn(`SSO code redeem: redirect_uri mismatch for code ${code}: stored=${authCode.redirectUri}, presented=${redirectUri}`);
            throw new AppError('redirect_uri mismatch', 400);
        }

        const userId = authCode.userId.toString();
        const user = await this.buildUserInfo(userId);
        const accessToken = this.signToken({
            sub: userId,
            client_id: clientId,
            scopes: authCode.scopes,
            type: 'access',
        }, config.sso.accessTokenTtl);
        const refreshToken = this.signToken({
            sub: userId,
            client_id: clientId,
            scopes: authCode.scopes,
            type: 'refresh',
        }, config.sso.refreshTokenTtl);

        log.info(`SSO tokens issued: user ${userId} → client ${clientId} (scopes: ${authCode.scopes.join(',')})`);
        return {
            accessToken,
            refreshToken,
            expiresIn: this.ttlToSeconds(config.sso.accessTokenTtl),
            user,
            scopes: authCode.scopes,
        };
    }

    /**
     * Step 3 — server-to-server: the client refreshes an expired access token.
     * Requires the refresh token + client credentials. Returns a fresh access
     * token (and a new refresh token to support rolling refresh in future).
     */
    async refreshAccessToken(
        refreshToken: string,
        clientId: string,
        clientSecret: string,
    ): Promise<{ accessToken: string; refreshToken: string; expiresIn: number; scopes: string[] }> {
        await this.authenticateClient(clientId, clientSecret);

        const decoded = this.verifyToken(refreshToken);
        if (decoded.type !== 'refresh') {
            throw new AppError('Token is not a refresh token', 400);
        }
        if (decoded.client_id !== clientId) {
            throw new AppError('Refresh token does not belong to this client', 400);
        }

        const accessToken = this.signToken({
            sub: decoded.sub,
            client_id: clientId,
            scopes: decoded.scopes,
            type: 'access',
        }, config.sso.accessTokenTtl);
        const newRefreshToken = this.signToken({
            sub: decoded.sub,
            client_id: clientId,
            scopes: decoded.scopes,
            type: 'refresh',
        }, config.sso.refreshTokenTtl);

        return {
            accessToken,
            refreshToken: newRefreshToken,
            expiresIn: this.ttlToSeconds(config.sso.accessTokenTtl),
            scopes: decoded.scopes,
        };
    }

    /**
     * Step 4 — called by the client's backend with a Bearer access token. Returns
     * the up-to-date user profile (subscription, referral count, etc.). Clients
     * SHOULD call this on session creation rather than caching the snapshot they
     * got at token exchange — subscription state can change.
     */
    async getUserInfoFromAccessToken(accessToken: string): Promise<SsoUserInfo> {
        const decoded = this.verifyToken(accessToken);
        if (decoded.type !== 'access') {
            throw new AppError('Token is not an access token', 400);
        }
        if (!decoded.scopes.includes('profile.read')) {
            throw new AppError('Token does not have profile.read scope', 403);
        }
        return this.buildUserInfo(decoded.sub);
    }

    /**
     * Asymmetric referral check used by SBC Live's filleul-gated lives:
     * "Is the holder of this access token a direct (Niveau 1) referral of sponsorId?"
     *
     * Only checks the relationship in ONE direction (caller → sponsor) — unlike the
     * symmetric `userService.checkDirectReferralRelationship` which returns true if
     * either user is the other's direct referrer. The asymmetric semantic is what
     * the SBC Live access rules actually need ("I'm watching X's live → am I one of
     * X's filleuls?"), and it removes the risk of a Y-creator being treated as their
     * own filleul because they're someone else's referrer.
     *
     * Depth is currently always 1 (direct). Indirect (Niveaux 2 & 3) referrals are
     * NOT considered filleuls per SBC product semantics — they're trackable for
     * commission purposes but the customer-facing word "filleul" means direct only.
     * If a future use case needs the downline, add a separate referrals.downline
     * scope and a `?depth=2` query param rather than relaxing this default.
     */
    async getReferralRelationship(
        accessToken: string,
        sponsorId: string,
    ): Promise<{ isDirectFilleul: boolean; depth: 1 | null; callerId: string; sponsorId: string }> {
        const decoded = this.verifyToken(accessToken);
        if (decoded.type !== 'access') {
            throw new AppError('Token is not an access token', 400);
        }
        if (!decoded.scopes.includes('referrals.read')) {
            throw new AppError('Token does not have referrals.read scope', 403);
        }
        if (!sponsorId || sponsorId.length !== 24) {
            throw new AppError('sponsorId is required and must be a 24-character ObjectId', 400);
        }

        const callerId = decoded.sub;
        if (callerId === sponsorId) {
            // A user can't be their own filleul. Don't even hit the DB.
            return { isDirectFilleul: false, depth: null, callerId, sponsorId };
        }

        const directReferrer = await referralRepository.findDirectReferrerPopulated(
            new Types.ObjectId(callerId),
        );
        const isDirectFilleul = directReferrer?._id?.toString() === sponsorId;

        log.info(
            `SSO referral check: caller=${callerId} sponsor=${sponsorId} isDirectFilleul=${isDirectFilleul} (client=${decoded.client_id})`,
        );

        return {
            isDirectFilleul,
            depth: isDirectFilleul ? 1 : null,
            callerId,
            sponsorId,
        };
    }

    /** Verifies a token and returns its decoded payload. Used by middleware and refresh. */
    verifyToken(token: string): SsoTokenPayload {
        try {
            const decoded = jwt.verify(token, config.sso.jwtSecret) as SsoTokenPayload & { iss?: string; aud?: string };
            if (decoded.iss !== 'sbc') {
                throw new Error('Invalid issuer');
            }
            return decoded;
        } catch (error: any) {
            throw new AppError(`Invalid or expired SSO token: ${error.message}`, 401);
        }
    }

    // === Private helpers ===

    private signToken(payload: SsoTokenPayload, expiresIn: string): string {
        return jwt.sign(
            { ...payload, iss: 'sbc' },
            config.sso.jwtSecret as Secret,
            { expiresIn } as SignOptions,
        );
    }

    /** Hex string of `bytes` bytes — used for both auth codes and (one-off seeding) client secrets. */
    private randomToken(bytes: number): string {
        return crypto.randomBytes(bytes).toString('hex');
    }

    private ttlToSeconds(ttl: string): number {
        const m = ttl.match(/^(\d+)([smhdw])$/);
        if (!m) return 3600;
        const n = parseInt(m[1], 10);
        const mul: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };
        return n * (mul[m[2]] || 60);
    }

    private async buildUserInfo(userId: string): Promise<SsoUserInfo> {
        const user = await userRepository.findById(new Types.ObjectId(userId));
        if (!user) {
            throw new AppError('User not found', 404);
        }
        const activeSubs = await subscriptionService.getActiveSubscriptionTypes(userId);
        const referralStats = await referralRepository.getReferralStats(userId).catch((err: any) => {
            log.warn(`SSO userinfo: referral stats failed for ${userId}: ${err.message}`);
            return { directReferrals: 0, indirectReferrals: 0, totalReferrals: 0 } as any;
        });

        return {
            id: user._id.toString(),
            name: (user as any).name || '',
            email: (user as any).email || '',
            phoneNumber: (user as any).phoneNumber ? String((user as any).phoneNumber) : null,
            country: (user as any).country || null,
            avatarUrl: (user as any).avatar ? `${config.selfBaseUrl}/api/users/avatar/${(user as any).avatar}` : null,
            subscriptionTypes: Array.isArray(activeSubs) ? activeSubs.map(String) : [],
            directReferralCount: referralStats?.directReferrals ?? 0,
            isActivated: Array.isArray(activeSubs) && activeSubs.length > 0,
            sbcLiveBalance: (user as any).sbcLiveBalance ?? 0,
        };
    }
}

export const ssoService = new SsoService();
export default ssoService;
