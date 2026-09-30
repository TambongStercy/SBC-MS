import mongoose, { Schema, Document } from 'mongoose';

/**
 * One row per relance pack payment that has been credited.
 *
 * The unique sessionId is what makes crediting idempotent: payment-service can
 * deliver the same success callback more than once (a retry, a reconciler pass, a
 * manual replay), and a bare `$inc` on the balance would pay out each time. The
 * row is inserted before the balance moves, so a second delivery hits the unique
 * index and stops there.
 *
 * It is also the audit trail for "I paid and got nothing": until 2026-09-30 every
 * one of the 31 successful pack payments was rejected by the callback, so the
 * absence of a row here for a SUCCEEDED intent is the thing to look for.
 */
export interface IRelancePackCredit extends Document {
    sessionId: string;
    userId: mongoose.Types.ObjectId;
    packId: string;
    packType: 'email' | 'sms';
    credits: number;
    creditedAt: Date;
}

const RelancePackCreditSchema = new Schema<IRelancePackCredit>(
    {
        sessionId: { type: String, required: true, unique: true, index: true },
        userId: { type: Schema.Types.ObjectId, required: true, index: true },
        packId: { type: String, required: true },
        packType: { type: String, enum: ['email', 'sms'], required: true },
        credits: { type: Number, required: true, min: 1 },
        creditedAt: { type: Date, required: true, default: () => new Date() },
    },
    { timestamps: false },
);

const RelancePackCreditModel = mongoose.model<IRelancePackCredit>('RelancePackCredit', RelancePackCreditSchema);

export default RelancePackCreditModel;
