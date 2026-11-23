import { Schema, model, Types } from 'mongoose';

/**
 * Security plan Phase 9: member sessions held in HttpOnly cookies (SESSION_COOKIES=on).
 *
 * One document per signed-in browser. The browser holds a short access token
 * (`sbc_at`, a normal member JWT carrying `sid`) and a refresh token (`sbc_rt`,
 * random, only its SHA-256 is stored here). Each refresh replaces the refresh
 * token; the one it replaced stays in `prevRefreshHash` for a short grace (two tabs
 * refreshing at once). A replaced token presented after the grace means it was
 * copied: the whole session is revoked (`revokedReason: 'reuse'`).
 *
 * `publicKey` is the browser's signing key (Phase 9 part 1): every new access token
 * is bound to it in `session_keys`, so signed requests keep working across refreshes.
 * Rows expire with the session (`expiresAt`, TTL).
 */
export interface IMemberSession {
    _id: Types.ObjectId;
    userId: Types.ObjectId;
    refreshHash: string;
    prevRefreshHash: string | null;
    rotatedAt: Date | null;
    publicKey: string | null;
    deviceId: string | null;
    userAgent: string | null;
    country: string | null;
    origin: 'sign_in' | 'adopted';
    refreshes: number;
    createdAt: Date;
    lastUsedAt: Date;
    expiresAt: Date;
    revokedAt: Date | null;
    revokedReason: string | null;
}

const MemberSessionSchema = new Schema<IMemberSession>({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    refreshHash: { type: String, required: true },
    prevRefreshHash: { type: String, default: null },
    rotatedAt: { type: Date, default: null },
    publicKey: { type: String, default: null },
    deviceId: { type: String, default: null },
    userAgent: { type: String, default: null },
    country: { type: String, default: null },
    origin: { type: String, enum: ['sign_in', 'adopted'], default: 'sign_in' },
    refreshes: { type: Number, default: 0 },
    createdAt: { type: Date, default: () => new Date() },
    lastUsedAt: { type: Date, default: () => new Date() },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: null },
}, { collection: 'member_sessions', versionKey: false });

MemberSessionSchema.index({ refreshHash: 1 }, { unique: true });
MemberSessionSchema.index({ prevRefreshHash: 1 }, { sparse: true });
MemberSessionSchema.index({ userId: 1, createdAt: -1 });
MemberSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const MemberSessionModel = model<IMemberSession>('MemberSession', MemberSessionSchema);
