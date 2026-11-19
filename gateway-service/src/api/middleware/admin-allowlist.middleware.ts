import { createHash, timingSafeEqual } from 'crypto';
import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import config from '../../config';
import path from 'path';
import logger from '../../utils/logger';
import { AccessLevel, AdminModule, allows, resolveAdminRoute } from './admin-routes';

/** Constant-time comparison of a presented secret with the expected one. */
function secretEquals(presented: string | undefined, expected: string | undefined): boolean {
    if (!presented || !expected) return false;
    const a = createHash('sha256').update(presented).digest();
    const b = createHash('sha256').update(expected).digest();
    return timingSafeEqual(a, b);
}


const log = logger.getLogger('AdminAllowlist');

/**
 * Every `/admin` API path, in every service, is open only to the user ids
 * listed in ADMIN_ALLOWLIST (comma-separated). An empty list admits nobody.
 *
 * Holding the `admin` role is not enough. In October 2026 accounts that had
 * given themselves the role through a sign-up bug used the admin to change
 * members' emails, approve their own withdrawals and send direct payouts; this
 * check makes any such account useless however it got the role.
 *
 * Since 2026-11-16 the allowlisted account must also hold the module the call
 * belongs to, in read (GET) or write (anything else): see admin-routes.ts for
 * the path → module table and user-service config/admin-modules.ts for who
 * holds what. Super admins (`admin`) hold every module.
 */

// Signing in happens before an admin token exists (password, then the authenticator).
const SIGN_IN_PATHS = new Set([
    '/api/users/admin/login',
    '/api/users/admin/login/email-code',
    '/api/users/admin/login/enroll/start',
    '/api/users/admin/login/enroll/confirm',
    '/api/users/admin/login/totp',
]);
const LOGOUT_PATH = '/api/users/admin/logout';

const allowedIds = (): Set<string> =>
    new Set((process.env.ADMIN_ALLOWLIST || '').split(',').map(id => id.trim()).filter(Boolean));

const base64UrlDecode = (part: string): Buffer =>
    Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** Verifies an HS256 JWT signed by user-service; returns its payload or null. */
const verifyToken = (token: string, secret: string): Record<string, unknown> | null => {
    const parts = token.split('.');
    if (parts.length !== 3 || !secret) return null;
    const [header, payload, signature] = parts;
    try {
        if (JSON.parse(base64UrlDecode(header).toString('utf8')).alg !== 'HS256') return null;
        const expected = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest();
        const given = base64UrlDecode(signature);
        if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
        const claims = JSON.parse(base64UrlDecode(payload).toString('utf8'));
        if (typeof claims.exp === 'number' && claims.exp * 1000 < Date.now()) return null;
        return claims;
    } catch {
        return null;
    }
};

/**
 * The path the services will route: decoded, lowercased (Express matches
 * routes case-insensitively), duplicate slashes and dot segments resolved.
 * Matching the raw URL would let `/api/WhatsApp` or `/api/users//admin/…`
 * through.
 */
export const normalizePath = (originalUrl: string): string => {
    let p = originalUrl.split('?')[0].split('#')[0];
    try { p = decodeURIComponent(p); } catch { /* keep as is: still matched below */ }
    p = path.posix.normalize(p.replace(/\\/g, '/')).toLowerCase();
    return p.length > 1 ? p.replace(/\/+$/, '') : p;
};

type Access = {
    role: string; blocked: boolean; permissions: Partial<Record<AdminModule, AccessLevel>>;
    /** The admin session the token carries (user-service admin-auth.service): only 'active' passes. */
    session?: string;
};
const ACCESS_TTL_MS = 60 * 1000;
const accessCache = new Map<string, { value: Access; expiresAt: number }>();

/** The account's admin rights, from user-service (cached a minute; null when unknown). */
async function getAccess(userId: string, sid: string): Promise<Access | null> {
    const cacheKey = `${userId}:${sid}`;
    const hit = accessCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
    try {
        const r = await fetch(`${config.services.userServiceUrl}/api/users/internal/${encodeURIComponent(userId)}/admin-access?sid=${encodeURIComponent(sid)}`, {
            headers: { Authorization: `Bearer ${config.services.serviceSecret}`, 'X-Service-Name': 'gateway-service' },
            signal: AbortSignal.timeout(4000),
        });
        if (r.status === 404) return null;
        if (!r.ok) throw new Error(`user-service answered ${r.status}`);
        const value = (await r.json())?.data as Access;
        if (!value || typeof value.permissions !== 'object') throw new Error('malformed admin access');
        accessCache.set(cacheKey, { value, expiresAt: Date.now() + ACCESS_TTL_MS });
        return value;
    } catch (err: any) {
        log.error(`Admin access lookup failed for ${userId}: ${err?.message}`);
        throw err;
    }
}

/** Tests only. */
export const clearAccessCache = () => accessCache.clear();

const refuse = (res: Response, status: number, message: string) =>
    res.status(status).json({ success: false, message });

/** 401 so the admin app signs out and asks for the password and the authenticator again. */
const sessionEnded = (res: Response) =>
    res.status(401).json({ success: false, code: 'ADMIN_SESSION_ENDED', message: 'Votre session d’administration est terminée. Reconnectez-vous.' });

export const adminAllowlist = async (req: Request, res: Response, next: NextFunction) => {
    const p = normalizePath(req.originalUrl);
    if (SIGN_IN_PATHS.has(p)) return next();
    const route = resolveAdminRoute(req.method, p);
    if (!route) return next();

    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (token && secretEquals(token, config.services.serviceSecret)) {
        return next();
    }

    const claims = token ? verifyToken(token, config.jwt.secret) : null;
    const userId = claims ? String(claims.userId || claims.id || '') : '';
    if (!userId || !allowedIds().has(userId)) {
        log.warn(`Admin path refused: ${req.method} ${p} user=${userId || 'none'} ip=${req.ip}`);
        return refuse(res, 403, 'Admin access denied');
    }

    // Only a token from the admin sign-in (password + authenticator) opens the
    // admin: a member-app token of the same account carries no admin session.
    const sid = typeof claims?.asid === 'string' ? claims.asid : '';
    if (!sid) {
        log.warn(`Admin path refused (no admin session in the token): ${req.method} ${p} user=${userId} ip=${req.ip}`);
        return sessionEnded(res);
    }

    let access: Access | null;
    try {
        access = await getAccess(userId, sid);
    } catch {
        return refuse(res, 503, 'Vérification des droits impossible pour le moment. Réessayez.');
    }
    if (access && access.session !== 'active') {
        log.warn(`Admin path refused (session ${access.session ?? 'unknown'}): ${req.method} ${p} user=${userId}`);
        return sessionEnded(res);
    }
    // Signing out must take effect at once, not when the cached answer expires.
    if (p === LOGOUT_PATH) accessCache.delete(`${userId}:${sid}`);
    if (!access || access.blocked || !allows(access.permissions, route)) {
        log.warn(`Admin module refused: ${req.method} ${p} module=${route.module} level=${route.level} user=${userId} role=${access?.role ?? 'unknown'}`);
        return refuse(res, 403, route.level === 'write'
            ? 'Vous avez cet espace en lecture seule, ou pas du tout.'
            : 'Vous n’avez pas accès à cet espace.');
    }
    return next();
};
