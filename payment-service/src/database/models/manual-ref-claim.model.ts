import mongoose, { Schema, Document } from 'mongoose';

/**
 * One row per external payment reference used by a manual activation or an
 * admin recovery (support manual activation, create-manual-intent,
 * recover-payment-intent). The unique {gateway, ref} is what makes reusing a
 * reference impossible — the 12 duplicate groups found in the payment intents
 * (2025-08 → 2026-02) were all manual admin recoveries of the same reference.
 * A claim is removed only when the provider did not confirm the payment.
 */
export interface IManualRefClaim extends Document {
    gateway: string;
    ref: string;
    sessionId?: string;
    userId?: string;
    by: string;
    approvalId?: string;
    createdAt: Date;
}

const ManualRefClaimSchema = new Schema<IManualRefClaim>(
    {
        gateway: { type: String, required: true, lowercase: true, trim: true },
        ref: { type: String, required: true, trim: true, maxlength: 200 },
        sessionId: { type: String },
        userId: { type: String },
        by: { type: String, required: true, maxlength: 200 },
        approvalId: { type: String, maxlength: 200 },
    },
    { timestamps: { createdAt: true, updatedAt: false } },
);
ManualRefClaimSchema.index({ gateway: 1, ref: 1 }, { unique: true });

export default mongoose.model<IManualRefClaim>('ManualRefClaim', ManualRefClaimSchema);
