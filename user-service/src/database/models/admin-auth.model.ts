import { Schema, model, Types } from 'mongoose';

/**
 * The main admin's own sign-in, like the support desk (2026-11-19):
 * password, then an authenticator-app code (TOTP), backup codes, lockout,
 * and server-side sessions that can be revoked.
 *
 * Kept out of the `users` collection on purpose: no endpoint that returns a
 * user document can ever leak a secret or a backup-code hash.
 */

export interface IAdminAuth {
    userId: Types.ObjectId;
    /** AES-256-GCM of the TOTP secret (ADMIN_TOTP_ENC_KEY). null = not enrolled. */
    totpSecretEnc: string | null;
    totpEnrolledAt: Date | null;
    /** Last 30-second step accepted: a code is never accepted twice. */
    lastUsedStep: number | null;
    backupCodes: { hash: string; usedAt: Date | null }[];
    knownDevices: { hash: string; firstSeenAt: Date; lastSeenAt: Date }[];
    /** Failed attempts (password or code) in the current 24 h window. */
    failures: number;
    failuresSince: Date | null;
    lockedUntil: Date | null;
    lastLoginAt: Date | null;
    lastLoginIp: string | null;
}

const adminAuthSchema = new Schema<IAdminAuth>({
    userId: { type: Schema.Types.ObjectId, required: true, unique: true },
    totpSecretEnc: { type: String, default: null },
    totpEnrolledAt: { type: Date, default: null },
    lastUsedStep: { type: Number, default: null },
    backupCodes: { type: [{ hash: String, usedAt: { type: Date, default: null }, _id: false }], default: [] },
    knownDevices: { type: [{ hash: String, firstSeenAt: Date, lastSeenAt: Date, _id: false }], default: [] },
    failures: { type: Number, default: 0 },
    failuresSince: { type: Date, default: null },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    lastLoginIp: { type: String, default: null },
}, { timestamps: true });

export const AdminAuthModel = model<IAdminAuth>('AdminAuth', adminAuthSchema, 'adminauths');

/** One sign-in in progress (between the password and the code). Single use, 10 min. */
export interface IAdminLoginChallenge {
    /** sha256 of the id handed to the browser. */
    idHash: string;
    userId: Types.ObjectId;
    /** email = first sign-in, the emailed code proves the mailbox before enrolment. */
    stage: 'email' | 'enroll' | 'totp';
    attempts: number;
    /** The secret being enrolled, encrypted, until the first code confirms it. */
    secretEnc: string | null;
    ip: string | null;
    expiresAt: Date;
}

const challengeSchema = new Schema<IAdminLoginChallenge>({
    idHash: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    stage: { type: String, enum: ['email', 'enroll', 'totp'], required: true },
    attempts: { type: Number, default: 0 },
    secretEnc: { type: String, default: null },
    ip: { type: String, default: null },
    expiresAt: { type: Date, required: true },
});
challengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AdminLoginChallengeModel = model<IAdminLoginChallenge>('AdminLoginChallenge', challengeSchema, 'adminloginchallenges');

/**
 * An admin session. The admin token carries its id (`asid`); the gateway
 * refuses any admin call whose session is revoked, idle for 30 min or older
 * than 12 h. A member-app token (no `asid`) never opens the admin.
 */
export interface IAdminSession {
    userId: Types.ObjectId;
    createdAt: Date;
    lastActivityAt: Date;
    absoluteExpiresAt: Date;
    revokedAt: Date | null;
    revokeReason: string | null;
    ip: string | null;
    userAgent: string | null;
    method: string;
}

const sessionSchema = new Schema<IAdminSession>({
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    createdAt: { type: Date, required: true },
    lastActivityAt: { type: Date, required: true },
    absoluteExpiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokeReason: { type: String, default: null },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
    method: { type: String, default: 'totp' },
});
// Ended sessions are kept 30 days for investigations, then removed.
sessionSchema.index({ absoluteExpiresAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });

export const AdminSessionModel = model<IAdminSession>('AdminSession', sessionSchema, 'adminsessions');
