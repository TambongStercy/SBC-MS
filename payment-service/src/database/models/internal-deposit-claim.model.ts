import { Schema, Document, Types, model } from 'mongoose';

/**
 * Exactly-once guard for /internal/deposit calls that carry a
 * `metadata.reference` (event-service refunds). Callers retry — refund
 * sweepers, reconcilers — and a refund must reach the wallet once.
 *
 * APPLIED: the deposit was recorded and the balance credited.
 * PENDING: a deposit with this reference is running, or crashed mid-way; a
 * replay that finds a stale PENDING row refuses rather than credit twice.
 */
export interface IInternalDepositClaim extends Document {
    reference: string;
    userId: Types.ObjectId;
    amount: number;
    status: 'PENDING' | 'APPLIED';
    transactionId?: string;
    createdAt: Date;
    updatedAt: Date;
}

const InternalDepositClaimSchema = new Schema<IInternalDepositClaim>({
    reference: { type: String, required: true, maxlength: 200 },
    userId: { type: Schema.Types.ObjectId, required: true },
    amount: { type: Number, required: true },
    status: { type: String, enum: ['PENDING', 'APPLIED'], required: true },
    transactionId: { type: String },
}, { timestamps: true });

InternalDepositClaimSchema.index({ reference: 1, userId: 1 }, { unique: true });

export default model<IInternalDepositClaim>('InternalDepositClaim', InternalDepositClaimSchema);
