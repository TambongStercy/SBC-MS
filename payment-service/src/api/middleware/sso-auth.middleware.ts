import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../../config';
import logger from '../../utils/logger';

const log = logger.getLogger('SsoAuthMiddleware');

interface SsoTokenPayload {
    sub: string;
    client_id: string;
    scopes: string[];
    type: 'access' | 'refresh';
    iss?: string;
    iat?: number;
    exp?: number;
}

declare global {
    namespace Express {
        interface Request {
            ssoToken?: SsoTokenPayload;
        }
    }
}

/**
 * Verifies a Bearer SSO access token issued by user-service and confirms it carries
 * all `requiredScopes`. On success attaches the decoded payload to `req.ssoToken`.
 *
 * Tokens are signed with `SSO_JWT_SECRET` — the same secret user-service uses to
 * sign them. We verify locally (no extra HTTP hop to user-service per request)
 * because the cost of a per-request HTTP call would dominate latency on hot
 * payment endpoints. Trade-off: if the secret leaks, attacker can mint tokens
 * impersonating any user — same exposure as user-service itself.
 *
 * Response contract distinguishes:
 *   - 401 if no Bearer, bad token, expired, or wrong type (refresh used as access)
 *   - 403 if the token is valid but missing one or more required scopes
 *
 * This mirrors the response shape used by the paywall middleware so the frontend
 * can react identically across services.
 */
export function requireSsoScope(requiredScopes: string[]) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            res.status(401).json({ success: false, message: 'Bearer SSO access token required' });
            return;
        }
        const token = authHeader.slice('Bearer '.length).trim();

        let decoded: SsoTokenPayload;
        try {
            decoded = jwt.verify(token, config.sso.jwtSecret) as SsoTokenPayload;
        } catch (error: any) {
            log.warn(`SSO token verification failed: ${error.message}`);
            res.status(401).json({ success: false, message: `Invalid or expired SSO token: ${error.message}` });
            return;
        }

        if (decoded.iss !== 'sbc') {
            res.status(401).json({ success: false, message: 'Invalid token issuer' });
            return;
        }
        if (decoded.type !== 'access') {
            res.status(401).json({ success: false, message: 'Token is not an SSO access token' });
            return;
        }

        const missing = requiredScopes.filter((s) => !decoded.scopes?.includes(s));
        if (missing.length > 0) {
            res.status(403).json({
                success: false,
                code: 'INSUFFICIENT_SCOPE',
                message: `Token missing required scope(s): ${missing.join(', ')}`,
                requiredScopes,
                grantedScopes: decoded.scopes || [],
            });
            return;
        }

        req.ssoToken = decoded;
        next();
    };
}
