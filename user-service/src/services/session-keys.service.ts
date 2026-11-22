import { createHash, createPublicKey } from 'crypto';
import { Types } from 'mongoose';
import { BrowserCheckDayModel, SessionKeyModel } from '../database/models/session-key.model';
import logger from '../utils/logger';

const log = logger.getLogger('SessionKeys');

/** Security plan Phase 9: see database/models/session-key.model.ts. */
export const tokenHashOf = (token: string) => createHash('sha256').update(token).digest('hex');

/** A base64 SPKI P-256 public key, or null. */
export function parsePublicKey(raw: unknown): string | null {
    if (typeof raw !== 'string' || raw.length < 80 || raw.length > 400 || !/^[A-Za-z0-9+/=]+$/.test(raw)) return null;
    try {
        const k = createPublicKey({ key: Buffer.from(raw, 'base64'), format: 'der', type: 'spki' });
        if (k.asymmetricKeyType !== 'ec' || k.asymmetricKeyDetails?.namedCurve !== 'prime256v1') return null;
        return raw;
    } catch {
        return null;
    }
}

const tokenExpiry = (token: string): Date => {
    try {
        const exp = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).exp;
        if (typeof exp === 'number') return new Date(exp * 1000);
    } catch { /* fall through */ }
    return new Date(Date.now() + 86400_000);
};

const cleanDevice = (d: unknown) => (typeof d === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(d) ? d : null);

/**
 * Binds `publicKey` to `token`. At sign-in (`late: false`) or later for a
 * token issued before this release (`late: true`). The first binding wins:
 * a second one for the same token answers 'exists' and changes nothing.
 */
export async function bindSessionKey(input: { token: string; userId: string; publicKey: unknown; deviceId?: unknown; late: boolean }): Promise<'bound' | 'exists' | 'invalid'> {
    const publicKey = parsePublicKey(input.publicKey);
    if (!publicKey || !Types.ObjectId.isValid(input.userId) || !input.token) return 'invalid';
    try {
        await SessionKeyModel.create({
            tokenHash: tokenHashOf(input.token), userId: new Types.ObjectId(input.userId), publicKey,
            deviceId: cleanDevice(input.deviceId), late: input.late, expiresAt: tokenExpiry(input.token),
        });
        return 'bound';
    } catch (err: any) {
        if (err?.code === 11000) return 'exists';
        throw err;
    }
}

/** Sign-in path: awaited (one insert) so the first signed request finds it, but never fails the sign-in. */
export async function bindAtSignIn(token: string, userId: string, publicKey: unknown, deviceId: unknown): Promise<void> {
    if (!publicKey) return;
    try {
        const r = await bindSessionKey({ token, userId, publicKey, deviceId, late: false });
        if (r === 'invalid') log.warn(`Sign-in for ${userId}: unusable session key ignored`);
    } catch (err: any) {
        log.warn(`Sign-in for ${userId}: session key not stored (${err?.message ?? err})`);
    }
}

/** For the gateway: the key bound to a token hash, or null. */
export async function sessionKeyFor(tokenHash: string): Promise<{ publicKey: string; userId: string; late: boolean } | null> {
    if (!/^[a-f0-9]{64}$/.test(tokenHash)) return null;
    const row = await SessionKeyModel.findOne({ tokenHash, revokedAt: null }, { publicKey: 1, userId: 1, late: 1 }).lean();
    return row ? { publicKey: row.publicKey, userId: String(row.userId), late: !!row.late } : null;
}

/** Logout: the key stops working (kept until it expires, never deleted by hand). */
export async function revokeSessionKey(token: string): Promise<void> {
    await SessionKeyModel.updateOne({ tokenHash: tokenHashOf(token), revokedAt: null }, { $set: { revokedAt: new Date() } }).catch(() => undefined);
}

const DIMS = ['group', 'client', 'role', 'browser', 'android', 'signature', 'origin', 'fetchSite'] as const;
const word = (v: unknown, max = 40) => (typeof v === 'string' && /^[A-Za-z0-9_./:-]{1,80}$/.test(v) ? v.slice(0, max) : 'other');

/** Gateway batches (log-only browser checks): counts merged with $inc. */
export async function ingestBrowserChecks(rows: unknown): Promise<{ stored: number }> {
    if (!Array.isArray(rows)) return { stored: 0 };
    const ops = [];
    for (const r of rows.slice(0, 5000) as any[]) {
        if (!r || typeof r.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.day)) continue;
        const count = Math.min(Math.max(Math.floor(Number(r.count) || 0), 0), 1e7);
        if (!count) continue;
        const fields: Record<string, unknown> = { tool: r.tool === true };
        for (const d of DIMS) fields[d] = word(r[d]);
        fields.body = r.body === undefined ? 'na' : word(r.body); // gateways before Phase 9 part 2 send none
        const key = [...DIMS.map(d => fields[d]), fields.body, fields.tool ? 'tool' : '-'].join('|');
        ops.push({ updateOne: { filter: { day: r.day, key }, update: { $inc: { count }, $set: { ...fields, updatedAt: new Date() } }, upsert: true } });
    }
    if (ops.length) await BrowserCheckDayModel.bulkWrite(ops as any, { ordered: false });
    return { stored: ops.length };
}
