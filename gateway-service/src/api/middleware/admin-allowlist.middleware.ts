import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import config from '../../config';
import logger from '../../utils/logger';

const log = logger.getLogger('AdminAllowlist');

/**
 * Every `/admin` API path, in every service, is open only to the user ids
 * listed in ADMIN_ALLOWLIST (comma-separated). An empty list admits nobody.
 *
 * Holding the `admin` role is not enough. In October 2026 accounts that had
 * given themselves the role through a sign-up bug used the admin to change
 * members' emails, approve their own withdrawals and send direct payouts; this
 * check makes any such account useless however it got the role.
 */
const ADMIN_PATH = /\/admin(\/|$)/i;

// Signing in happens before an admin token exists.
const SIGN_IN_PATHS = new Set(['/api/users/admin/login', '/api/users/admin/login/verify-otp']);

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

export const adminAllowlist = (req: Request, res: Response, next: NextFunction) => {
    const path = req.originalUrl.split('?')[0];
    if (req.method === 'OPTIONS' || !ADMIN_PATH.test(path) || SIGN_IN_PATHS.has(path)) {
        return next();
    }

    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (token && token === config.services.serviceSecret) {
        return next();
    }

    const claims = token ? verifyToken(token, config.jwt.secret) : null;
    const userId = claims ? String(claims.userId || claims.id || '') : '';
    if (!userId || !allowedIds().has(userId)) {
        log.warn(`Admin path refused: ${req.method} ${path} user=${userId || 'none'} ip=${req.ip}`);
        return res.status(403).json({ success: false, message: 'Admin access denied' });
    }
    return next();
};
