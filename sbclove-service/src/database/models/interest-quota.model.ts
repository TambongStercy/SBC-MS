import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * Per-user, per-session counter backing the "max N interests per week" quota.
 * Keeping the count in its own document lets us reserve a slot atomically with a
 * conditional `$inc` (filter `count < max`), which is race-free under the weekly
 * spike — unlike count-then-insert on the Interest collection.
 */
export interface IInterestQuota extends Document {
    _id: Types.ObjectId;
    userId: Types.ObjectId;
    sessionDate: string;   // YYYY-MM-DD active-weekday key
    count: number;
    createdAt: Date;
    updatedAt: Date;
}

const InterestQuotaSchema = new Schema<IInterestQuota>(
    {
        userId: { type: Schema.Types.ObjectId, required: true },
        sessionDate: { type: String, required: true },
        count: { type: Number, required: true, default: 0 },
    },
    { timestamps: true }
);

InterestQuotaSchema.index({ userId: 1, sessionDate: 1 }, { unique: true });

const InterestQuotaModel = mongoose.model<IInterestQuota>('InterestQuota', InterestQuotaSchema);

export default InterestQuotaModel;
