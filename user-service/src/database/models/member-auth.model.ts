import { Document, Schema, Types, model } from 'mongoose';

/**
 * A member's authenticator app (Security plan Phase 3). One document per member,
 * created when they start the setup. The secret is AES-256-GCM encrypted with
 * MEMBER_TOTP_ENC_KEY; backup codes are stored as HMACs and used once.
 */
export interface IMemberAuth extends Document {
    userId: Types.ObjectId;
    totpSecretEnc: string | null;
    totpEnrolledAt: Date | null;
    /** Last accepted 30-second step: a code is accepted once. */
    lastUsedStep: number | null;
    backupCodes: { hash: string; usedAt: Date | null }[];
    /** Setup in progress: the emailed code was right, the QR code is shown. */
    pendingSecretEnc: string | null;
    pendingExpiresAt: Date | null;
    /** Wrong codes in the current 24 h window; every 5th locks (15 min, 1 h, 24 h). */
    failures: number;
    failuresSince: Date | null;
    lockedUntil: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

const MemberAuthSchema = new Schema<IMemberAuth>({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    totpSecretEnc: { type: String, default: null },
    totpEnrolledAt: { type: Date, default: null },
    lastUsedStep: { type: Number, default: null },
    backupCodes: { type: [{ _id: false, hash: { type: String, required: true }, usedAt: { type: Date, default: null } }], default: [] },
    pendingSecretEnc: { type: String, default: null },
    pendingExpiresAt: { type: Date, default: null },
    failures: { type: Number, default: 0 },
    failuresSince: { type: Date, default: null },
    lockedUntil: { type: Date, default: null },
}, { timestamps: true });

export const MemberAuthModel = model<IMemberAuth>('MemberAuth', MemberAuthSchema);
