import { Schema, model } from 'mongoose';

/**
 * Security plan Phase 9 (browser-only access): the public key a browser made at
 * sign-in (WebCrypto ECDSA P-256, private key non-extractable in IndexedDB),
 * bound to one member token. A request signed with that key proves it comes
 * from the browser that signed in, not from a token copied into Postman.
 *
 * `tokenHash` = SHA-256 of the token (the token itself is never stored here).
 * `late` = bound after sign-in (tokens issued before this release): weaker, as
 * whoever held the token first could bind it. Rows expire with the token.
 */
const SessionKeySchema = new Schema({
    tokenHash: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    publicKey: { type: String, required: true }, // SPKI DER, base64
    deviceId: { type: String, default: null },
    late: { type: Boolean, default: false },
    revokedAt: { type: Date, default: null },
    createdAt: { type: Date, default: () => new Date() },
    expiresAt: { type: Date, required: true },
}, { collection: 'session_keys', versionKey: false });
SessionKeySchema.index({ tokenHash: 1 }, { unique: true });
SessionKeySchema.index({ userId: 1, createdAt: -1 });
SessionKeySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const SessionKeyModel = model('SessionKey', SessionKeySchema);

/**
 * One document per Douala day × outcome bucket, written by the gateway's
 * browser checks in log-only mode (counts only, no member id): how many
 * requests would pass or fail, per route group, client, browser family and
 * Android version. TTL 180 days.
 */
const BrowserCheckDaySchema = new Schema({
    day: { type: String, required: true },
    key: { type: String, required: true }, // all the dimensions below, joined
    group: String, client: String, role: String, browser: String, android: String,
    signature: String, origin: String, fetchSite: String, tool: Boolean,
    /** Phase 9 part 2: signed body hash vs the bytes received (match / mismatch / unsigned / too_large / unknown / none; `na` = older gateway). */
    body: String,
    count: { type: Number, default: 0 },
    updatedAt: { type: Date, default: () => new Date() },
}, { collection: 'browser_check_days', versionKey: false });
BrowserCheckDaySchema.index({ day: 1, key: 1 }, { unique: true });
BrowserCheckDaySchema.index({ updatedAt: 1 }, { expireAfterSeconds: 180 * 86400 });
export const BrowserCheckDayModel = model('BrowserCheckDay', BrowserCheckDaySchema);
