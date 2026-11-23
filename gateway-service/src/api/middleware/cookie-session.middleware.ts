/**
 * Security plan Phase 9: member sessions in HttpOnly cookies (user-service member-session.service.ts).
 *
 * The web app (from this release, when user-service has SESSION_COOKIES=on) holds no token:
 * the browser sends the `sbc_at` cookie. Here, before anything reads the Authorization header
 * (admin allow-list, signals, browser checks, robot check, every service):
 *   - a request with no Authorization header and an `sbc_at` cookie gets `Authorization:
 *     Bearer <cookie>`, so every service keeps reading the header it always read;
 *   - a cookie-authenticated mutation (anything but GET/HEAD/OPTIONS that carries one of our
 *     session cookies and no Authorization header) must echo the `sbc_csrf` cookie in
 *     X-CSRF-Token, and its Origin (when sent) must be our own site: 403 CSRF_FAILED otherwise.
 *     The cookies are SameSite=Strict too; this is the second lock.
 *   - a request with an Authorization header is left alone: Bearer tokens keep working (open
 *     apps of the previous release, partners, SSO clients).
 * WEB_BEARER=allow|refuse (default allow): `refuse` answers 401 SESSION_UPGRADE_REQUIRED to a
 * member Bearer token sent by our own web app (same-origin fetch with X-SBC-Client), once every
 * open app has moved to cookies. `/api/users/session/adopt` (the move itself) always passes.
 * Bearer vs cookie use by the web app is counted and logged every 10 minutes.
 *
 * The support desk (/api/support/desk) has its own cookies and CSRF: untouched here.
 */
import { createHash, timingSafeEqual } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import logger from '../../utils/logger';

const log = logger.getLogger('CookieSession');

export const ACCESS_COOKIE = 'sbc_at';
export const REFRESH_COOKIE = 'sbc_rt';
export const CSRF_COOKIE = 'sbc_csrf';
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

const header = (req: Request, name: string): string => {
    const v = req.headers[name];
    return typeof v === 'string' ? v : Array.isArray(v) ? v[0] ?? '' : '';
};

export function parseCookies(raw: string | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    if (!raw) return out;
    for (const part of raw.split(';')) {
        const i = part.indexOf('=');
        if (i < 0) continue;
        const k = part.slice(0, i).trim();
        if (!k || k in out) continue;
        const v = part.slice(i + 1).trim();
        try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
    }
    return out;
}

const sameSecret = (a: string, b: string) => {
    if (!a || !b) return false;
    const x = createHash('sha256').update(a).digest();
    const y = createHash('sha256').update(b).digest();
    return timingSafeEqual(x, y);
};

/** Origins allowed for cookie mutations: our own host, plus SESSION_ALLOWED_ORIGINS (comma list). */
export function originAllowed(req: Request): boolean {
    const origin = header(req, 'origin') || '';
    if (!origin) return true; // same-origin GETs omit it; mutations from our app always send it
    if (origin === 'null') return false;
    let host: string;
    try { host = new URL(origin).host.toLowerCase(); } catch { return false; }
    const own = header(req, 'x-forwarded-host') || header(req, 'host');
    if (own && host === own.toLowerCase()) return true;
    const extra = String(process.env.SESSION_ALLOWED_ORIGINS || '').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);
    return extra.some(o => { try { return new URL(o).host.toLowerCase() === host; } catch { return false; } });
}

const exempt = (path: string) => path.startsWith('/api/support/desk');
/**
 * Before sign-in nothing is acted on with the session, so a stale cookie left in the browser
 * must never block signing in again (these answer the same with or without it).
 */
const PRE_SIGN_IN = ['/api/users/login', '/api/users/register', '/api/users/verify-otp', '/api/users/resend-otp',
    '/api/users/request-password-reset', '/api/users/verify-password-reset-otp', '/api/users/reset-password',
    '/api/users/check-existence', '/api/users/session/logout'];
const preSignIn = (path: string) => { const p = path.toLowerCase().replace(/\/+$/, ''); return PRE_SIGN_IN.some(x => p === x || p.startsWith(`${x}-`)); };
const isAdopt = (path: string) => path.toLowerCase().startsWith('/api/users/session/adopt');

/** Payload of a JWT without verifying it (only to tell a member token from a service secret here). */
function claimsOf(token: string): Record<string, unknown> | null {
    const p = token.split('.');
    if (p.length !== 3) return null;
    try { return JSON.parse(Buffer.from(p[1], 'base64url').toString('utf8')); } catch { return null; }
}

/** From our own web app (same-origin fetch from the page), as opposed to partners and servers. */
const fromOwnWebApp = (req: Request) =>
    header(req, 'sec-fetch-site') === 'same-origin' && !!header(req, 'x-sbc-client');

const counts = { cookie: 0, webBearer: 0, csrfRefused: 0, bearerRefused: 0 };
export const cookieSessionCounts = counts;
let timer: NodeJS.Timeout | null = null;
export function startCookieSessionLog() {
    if (timer) return;
    timer = setInterval(() => {
        if (counts.cookie || counts.webBearer || counts.csrfRefused || counts.bearerRefused) {
            log.info(`Sessions (10 min): cookie=${counts.cookie} webBearer=${counts.webBearer} csrfRefused=${counts.csrfRefused} bearerRefused=${counts.bearerRefused}`);
        }
        counts.cookie = 0; counts.webBearer = 0; counts.csrfRefused = 0; counts.bearerRefused = 0;
    }, 10 * 60_000);
    timer.unref?.();
}

export function cookieSession(req: Request, res: Response, next: NextFunction) {
    delete req.headers['x-sbc-auth']; // only this middleware may say a request came with the cookie
    const path = req.originalUrl.split('?')[0];
    if (!path.startsWith('/api/') || exempt(path)) return next();
    const auth = header(req, 'authorization');

    if (auth) {
        if (auth.startsWith('Bearer ') && fromOwnWebApp(req)) {
            const c = claimsOf(auth.slice(7));
            if (c && c.userId && !c.asid && ['user', 'tester'].includes(String(c.role || 'user'))) {
                counts.webBearer++;
                if (String(process.env.WEB_BEARER || 'allow').toLowerCase() === 'refuse' && !isAdopt(path)) {
                    counts.bearerRefused++;
                    res.status(401).json({ success: false, code: 'SESSION_UPGRADE_REQUIRED', message: 'Session expirée. Reconnectez-vous.' });
                    return;
                }
            }
        }
        return next();
    }

    const cookies = parseCookies(header(req, 'cookie'));
    const access = cookies[ACCESS_COOKIE];
    if (!access && !cookies[REFRESH_COOKIE]) return next();

    if (!SAFE.has(req.method.toUpperCase()) && !preSignIn(path)) {
        const ok = originAllowed(req) && sameSecret(header(req, 'x-csrf-token'), cookies[CSRF_COOKIE] || '');
        if (!ok) {
            counts.csrfRefused++;
            res.status(403).json({ success: false, code: 'CSRF_FAILED', message: 'Requête refusée. Rechargez la page.' });
            return;
        }
    }
    if (access && access.length < 4096) {
        req.headers.authorization = `Bearer ${access}`;
        req.headers['x-sbc-auth'] = 'cookie';
        counts.cookie++;
    }
    return next();
}
