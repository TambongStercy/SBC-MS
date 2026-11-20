import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import config from '../../config';
import { AgentSession } from '../../database/models/agent-session.model';
import { randomToken, sha256Hex } from '../../utils/crypto';

/**
 * Agent sessions (CONTRACT §3.1): 15-min access JWT (aud=sbc-support) plus a
 * server-side session whose refresh token rotates on every use. Presenting a
 * refresh token that was already rotated away = theft: every session of the
 * agent is revoked. Idle 30 min, absolute 12 h.
 */

export interface AccessClaims { sub: string; sid: string; roles: string[] }

export function signAccess(agentId: string, sid: string, roles: string[]): string {
    return jwt.sign({ sid, roles }, config.secrets.supportJwt, {
        subject: agentId, audience: config.auth.audience, issuer: config.auth.issuer,
        expiresIn: config.auth.accessTtlSec, algorithm: 'HS256',
    });
}

export function verifyAccess(token: string | undefined): AccessClaims | null {
    if (!token) return null;
    try {
        const c = jwt.verify(token, config.secrets.supportJwt, {
            algorithms: ['HS256'], audience: config.auth.audience, issuer: config.auth.issuer,
        }) as jwt.JwtPayload;
        if (!c.sub || typeof c.sid !== 'string') return null;
        return { sub: String(c.sub), sid: c.sid, roles: Array.isArray(c.roles) ? c.roles : [] };
    } catch {
        return null;
    }
}

const makeRefresh = (sid: string) => `${sid}.${randomToken(32)}`;

export interface IssuedSession { sessionId: string; refreshToken: string; accessToken: string; csrfToken: string }

export async function createSession(agentId: string, roles: string[], ctx: { ip: string; userAgent: string; deviceHash: string }): Promise<IssuedSession> {
    const sid = new Types.ObjectId();
    const refreshToken = makeRefresh(sid.toHexString());
    const now = new Date();
    await AgentSession.create({
        _id: sid, agentId, refreshHash: sha256Hex(refreshToken), createdAt: now, lastActivityAt: now,
        absoluteExpiresAt: new Date(now.getTime() + config.auth.absoluteTimeoutMs),
        ip: ctx.ip, userAgent: ctx.userAgent, deviceHash: ctx.deviceHash,
    });
    return { sessionId: sid.toHexString(), refreshToken, accessToken: signAccess(agentId, sid.toHexString(), roles), csrfToken: randomToken(24) };
}

const expired = (s: { lastActivityAt: Date; absoluteExpiresAt: Date }, now = Date.now()) =>
    s.absoluteExpiresAt.getTime() <= now || s.lastActivityAt.getTime() + config.auth.idleTimeoutMs <= now;

/** The live session, touched; null (and revoked if timed out) otherwise. */
export async function loadActiveSession(sid: string, agentId: string) {
    if (!Types.ObjectId.isValid(sid)) return null;
    const s = await AgentSession.findById(sid).lean();
    if (!s || s.revokedAt || String(s.agentId) !== agentId) return null;
    if (expired(s)) {
        await revokeSession(sid, 'timeout');
        return null;
    }
    if (Date.now() - s.lastActivityAt.getTime() > 60_000) {
        await AgentSession.updateOne({ _id: sid, revokedAt: null }, { $set: { lastActivityAt: new Date() } });
    }
    return s;
}

export type RotateResult =
    | { kind: 'ok'; agentId: string; sessionId: string; refreshToken: string }
    | { kind: 'reuse'; agentId: string; sessionId: string }
    | { kind: 'invalid' };

export async function rotateRefresh(presented: string | undefined): Promise<RotateResult> {
    if (!presented) return { kind: 'invalid' };
    const sid = presented.split('.')[0];
    if (!Types.ObjectId.isValid(sid)) return { kind: 'invalid' };
    const hash = sha256Hex(presented);
    const s = await AgentSession.findById(sid).lean();
    if (!s) return { kind: 'invalid' };
    if (s.refreshHash !== hash) {
        if (s.usedRefreshHashes.includes(hash)) return { kind: 'reuse', agentId: String(s.agentId), sessionId: sid };
        return { kind: 'invalid' };
    }
    if (s.revokedAt) return { kind: 'invalid' };
    if (expired(s)) {
        await revokeSession(sid, 'timeout');
        return { kind: 'invalid' };
    }
    const next = makeRefresh(sid);
    const updated = await AgentSession.findOneAndUpdate(
        { _id: sid, refreshHash: hash, revokedAt: null },
        { $set: { refreshHash: sha256Hex(next), lastActivityAt: new Date() }, $push: { usedRefreshHashes: { $each: [hash], $slice: -100 } } },
        { new: true },
    ).lean();
    if (!updated) {
        // Someone rotated this exact token a moment ago: that is a reuse.
        return { kind: 'reuse', agentId: String(s.agentId), sessionId: sid };
    }
    return { kind: 'ok', agentId: String(s.agentId), sessionId: sid, refreshToken: next };
}

export async function revokeSession(sid: string, reason: string): Promise<void> {
    if (!Types.ObjectId.isValid(sid)) return;
    await AgentSession.updateOne({ _id: sid, revokedAt: null }, { $set: { revokedAt: new Date(), revokeReason: reason } });
}

export async function revokeAllSessions(agentId: string, reason: string): Promise<number> {
    const r = await AgentSession.updateMany({ agentId, revokedAt: null }, { $set: { revokedAt: new Date(), revokeReason: reason } });
    return r.modifiedCount;
}
