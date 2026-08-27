import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IInterestQuota extends Document {
    _id: Types.ObjectId;
    userId: Types.ObjectId;
    sessionDate: string;
    count: number;
}

const InterestQuotaSchema = new Schema<IInterestQuota>({
    userId:      { type: Schema.Types.ObjectId, required: true },
    sessionDate: { type: String, required: true },
    count:       { type: Number, default: 0, min: 0 },
}, { timestamps: false });

InterestQuotaSchema.index({ userId: 1, sessionDate: 1 }, { unique: true });

const InterestQuotaModel = mongoose.model<IInterestQuota>('InterestQuota', InterestQuotaSchema);
export default InterestQuotaModel;
