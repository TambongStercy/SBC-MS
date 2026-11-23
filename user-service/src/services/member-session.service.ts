/**
 * Security plan Phase 9: member sessions in HttpOnly cookies, with refresh rotation.
 *
 * Off unless SESSION_COOKIES=on. Even then a client gets cookies only when it asks for
 * them (header `X-SBC-Session: cookie`, sent by the web app from this release): older
 * open apps, partners and SSO clients keep their Bearer token exactly as before.
 *
 * Cookies (host-only, Secure, SameSite=Strict):
 *   sbc_at    the access token: a normal member JWT (+ `sid`), MEMBER_ACCESS_TTL_MIN (15) long,
 *             HttpOnly, Path=/ (the chat socket at /socket.io/ needs it too). The gateway turns
 *             it into the Authorization header the services already read.
 *   sbc_rt    the refresh token: random, HttpOnly, Path=/api/users/session. Stored hashed.
 *   sbc_csrf  readable by the page; every cookie-authenticated mutation must echo it in
 *             X-CSRF-Token (the gateway checks), with an Origin of our own site.
 * The session lives as long as a token did before (JWT_EXPIRATION, `1d`): members sign in
 * as often as before; nothing about the sign-in itself changes.
 */
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import jwt, { SignOptions } from 'jsonwebtoken';
import { Request, Response } from 'express';
import { Types } from 'mongoose';
import config from '../config';
import { MemberSessionModel } from '../database/models/member-session.model';
import UserModel from '../database/models/user.model';
import { bindSessionKey, parsePublicKey, sessionKeyFor, tokenHashOf } from './session-keys.service';
import logger from '../utils/logger';

const log = logger.getLogger('MemberSession');

export const ACCESS_COOKIE = 'sbc_at';
export const REFRESH_COOKIE = 'sbc_rt';
export const CSRF_COOKIE = 'sbc_csrf';
export const REFRESH_PATH = '/api/users/session';
/** A just-replaced refresh token is still accepted this long (two tabs refreshing at once). */
const GRACE_MS = 60_000;

export const sessionCookiesOn = () => String(process.env.SESSION_COOKIES || 'off').toLowerCase() === 'on';
const secure = () => String(process.env.SESSION_COOKIE_SECURE || 'true').toLowerCase() !== 'false';
const accessTtlSeconds = () => {
    const m = Number(process.env.MEMBER_ACCESS_TTL_MIN || 15);
    return Math.max(60, Math.min(Number.isFinite(m) ? m : 15, 120) * 60);
};

/** jsonwebtoken-style duration ('1d', '12h', '30m', '45s', '3600') → seconds. */
export function durationSeconds(v: string | undefined, fallback = 86400): number {
    const s = String(v ?? '').trim();
    const m = /^(\d+)\s*([smhd]?)$/i.exec(s);
    if (!m) return fallback;
    const n = Number(m[1]);
    const unit = (m[2] || 's').toLowerCase();
    return n * ({ s: 1, m: 60, h: 3600, d: 86400 } as Record<string, number>)[unit];
}
const sessionMaxSeconds = () => durationSeconds(process.env.MEMBER_SESSION_MAX || config.jwt.expiresIn);

/** The client asked for a cookie session and the server gives them. */
export const wantsCookieSession = (req: Request) =>
    sessionCookiesOn() && String(req.header('x-sbc-session') || '').toLowerCase() === 'cookie';

const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const newSecret = () => randomBytes(32).toString('base64url');
const cleanDevice = (d: unknown) => (typeof d === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(d) ? d : null);

/** Cookie header → map (no dependency; values are url-safe here). */
export function readCookies(req: Request): Record<string, string> {
    const out: Record<string, string> = {};
    const raw = req.headers.cookie;
    if (!raw) return out;
    for (const part of raw.split(';')) {
        const i = part.indexOf('=');
        if (i < 0) continue;
        const k = part.slice(0, i).trim();
        if (!k || k in out) continue;
        try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { out[k] = part.slice(i + 1).trim(); }
    }
    return out;
}

type SessionUser = { _id: unknown; email?: string | null; role?: unknown };

function signAccess(user: SessionUser, sid: string): string {
    return jwt.sign(
        { userId: String(user._id), id: String(user._id), email: user.email, role: user.role, sid, typ: 'cookie', jti: randomBytes(9).toString('base64url') },
        config.jwt.secret,
        { expiresIn: accessTtlSeconds() } as SignOptions,
    );
}

function setCookies(res: Response, access: string, refresh: string | null, csrf: string | null, sessionEndsAt: Date) {
    const base = { httpOnly: true, secure: secure(), sameSite: 'strict' as const };
    const left = Math.max(1000, sessionEndsAt.getTime() - Date.now());
    res.cookie(ACCESS_COOKIE, access, { ...base, path: '/', maxAge: Math.min(accessTtlSeconds() * 1000, left) });
    if (refresh) res.cookie(REFRESH_COOKIE, refresh, { ...base, path: REFRESH_PATH, maxAge: left });
    if (csrf) res.cookie(CSRF_COOKIE, csrf, { httpOnly: false, secure: secure(), sameSite: 'strict', path: '/', maxAge: left });
}

export function clearSessionCookies(res: Response) {
    const base = { httpOnly: true, secure: secure(), sameSite: 'strict' as const };
    res.clearCookie(ACCESS_COOKIE, { ...base, path: '/' });
    res.clearCookie(REFRESH_COOKIE, { ...base, path: REFRESH_PATH });
    res.clearCookie(CSRF_COOKIE, { httpOnly: false, secure: secure(), sameSite: 'strict', path: '/' });
}

/** Binds the browser's key (if any) to an access token, so signed requests keep working. */
async function bindKey(access: string, userId: string, publicKey: string | null, deviceId: string | null) {
    if (!publicKey) return;
    try {
        await bindSessionKey({ token: access, userId, publicKey, deviceId, late: false });
    } catch (err: any) {
        log.warn(`Session key not bound for ${userId}: ${err?.message ?? err}`);
    }
}

/**
 * Opens a cookie session for a member who just signed in (or adopts a Bearer token).
 * Returns the access token (never sent in the body).
 */
export async function openCookieSession(
    req: Request, res: Response, user: SessionUser,
    opts: { publicKey?: unknown; origin?: 'sign_in' | 'adopted' } = {},
): Promise<string> {
    const refresh = newSecret();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + sessionMaxSeconds() * 1000);
    const publicKey = parsePublicKey(opts.publicKey);
    const deviceId = cleanDevice(req.header('x-sbc-device'));
    const doc = await MemberSessionModel.create({
        userId: new Types.ObjectId(String(user._id)), refreshHash: sha(refresh), publicKey, deviceId,
        userAgent: String(req.header('user-agent') || '').slice(0, 300) || null,
        country: String(req.header('x-sbc-geo') || '').slice(0, 2) || null,
        origin: opts.origin ?? 'sign_in', createdAt: now, lastUsedAt: now, expiresAt,
    });
    const access = signAccess(user, String(doc._id));
    await bindKey(access, String(user._id), publicKey, deviceId);
    setCookies(res, access, refresh, newSecret(), expiresAt);
    return access;
}

export type RefreshOutcome = 'refreshed' | 'grace' | 'missing' | 'unknown' | 'reused' | 'expired' | 'inactive';

/**
 * POST /users/session/refresh. A new access token and a new refresh token; the old
 * refresh token is accepted again only within the grace (it then gets an access token,
 * the cookie jar already holds the newer refresh token). Any other reuse revokes the session.
 */
export async function refreshCookieSession(req: Request, res: Response): Promise<RefreshOutcome> {
    const presented = readCookies(req)[REFRESH_COOKIE];
    if (!presented || presented.length > 200) return 'missing';
    const hash = sha(presented);
    const now = new Date();
    const fresh = newSecret();

    let session = await MemberSessionModel.findOneAndUpdate(
        { refreshHash: hash, revokedAt: null, expiresAt: { $gt: now } },
        { $set: { refreshHash: sha(fresh), prevRefreshHash: hash, rotatedAt: now, lastUsedAt: now }, $inc: { refreshes: 1 } },
        { new: true },
    ).lean();
    let outcome: RefreshOutcome = 'refreshed';
    let refreshOut: string | null = fresh;

    if (!session) {
        const prev = await MemberSessionModel.findOne({ $or: [{ prevRefreshHash: hash }, { refreshHash: hash }] }).lean();
        if (!prev) return 'unknown';
        if (prev.revokedAt || prev.expiresAt <= now) { clearSessionCookies(res); return 'expired'; }
        if (prev.refreshHash === hash) return 'unknown'; // rotated by a concurrent call this instant
        if (prev.rotatedAt && now.getTime() - new Date(prev.rotatedAt).getTime() <= GRACE_MS) {
            session = prev;
            outcome = 'grace';
            refreshOut = null; // the other tab's answer already set the new one
        } else {
            await MemberSessionModel.updateOne({ _id: prev._id, revokedAt: null }, { $set: { revokedAt: now, revokedReason: 'reuse' } });
            log.warn(`Refresh token reuse: session ${prev._id} of user ${prev.userId} revoked`);
            clearSessionCookies(res);
            return 'reused';
        }
    }

    const user = await UserModel.findById(session.userId).select('email role blocked deleted').lean();
    if (!user || (user as any).blocked || (user as any).deleted) {
        await MemberSessionModel.updateOne({ _id: session._id }, { $set: { revokedAt: now, revokedReason: 'inactive' } });
        clearSessionCookies(res);
        return 'inactive';
    }
    const access = signAccess(user as SessionUser, String(session._id));
    await bindKey(access, String(session.userId), session.publicKey, session.deviceId);
    setCookies(res, access, refreshOut, null, new Date(session.expiresAt));
    return outcome;
}

/** Logout: revokes the session named by the refresh cookie or the access token's `sid`; clears cookies. */
export async function endCookieSession(req: Request, res: Response, sid?: string | null): Promise<boolean> {
    const presented = readCookies(req)[REFRESH_COOKIE];
    const or: Record<string, unknown>[] = [];
    if (presented && presented.length <= 200) or.push({ refreshHash: sha(presented) }, { prevRefreshHash: sha(presented) });
    if (sid && Types.ObjectId.isValid(sid)) or.push({ _id: new Types.ObjectId(sid) });
    clearSessionCookies(res);
    if (!or.length) return false;
    const r = await MemberSessionModel.updateOne({ $or: or, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: 'logout' } });
    return r.modifiedCount === 1;
}

/**
 * The browser's signing key, for an access token of a cookie session (late binding, when the
 * browser lost its key): kept on the session so every later access token gets it too.
 */
export async function setSessionPublicKey(sid: string, userId: string, publicKey: unknown): Promise<boolean> {
    const key = parsePublicKey(publicKey);
    if (!key || !Types.ObjectId.isValid(sid)) return false;
    const r = await MemberSessionModel.updateOne(
        { _id: new Types.ObjectId(sid), userId: new Types.ObjectId(userId), revokedAt: null, publicKey: null },
        { $set: { publicKey: key } },
    );
    return r.modifiedCount === 1;
}

/** The key already bound to a Bearer token (adoption keeps the browser's key). */
export async function publicKeyOfToken(token: string): Promise<string | null> {
    const k = await sessionKeyFor(tokenHashOf(token)).catch(() => null);
    return k?.publicKey ?? null;
}

/** Constant-time string compare (CSRF and tests). */
export function sameSecret(a: string | undefined, b: string | undefined): boolean {
    if (!a || !b) return false;
    const x = Buffer.from(sha(a)); const y = Buffer.from(sha(b));
    return timingSafeEqual(x, y);
}
