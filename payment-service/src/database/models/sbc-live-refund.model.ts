import { Schema, Document, Types, model } from 'mongoose';

/**
 * Refund queue for SBC Live charges. Per Rufus's confirmed policy this is
 * MANUAL-APPROVAL only — engineering provides the queue + UI; the human admin
 * (Jamelle by default) decides each case per the policy table in
 * docs/SBC_LIVE_PAYMENT_DESIGN_QUESTIONS.md.
 *
 * Lifecycle:
 *   1. Request created by SBC Live's admin (or programmatically by their app)
 *      via POST /api/payments/sso/refund-requests — status PENDING_REVIEW.
 *   2. SBC admin reviews → either APPROVED (will be processed) or REJECTED
 *      (decision logged with reason).
 *   3. On APPROVED, the refund is processed by debiting the creator's
 *      sbcLiveBalance (when they have the funds) and crediting the buyer's
 *      main balance via a REFUND transaction. Status → COMPLETED.
 *   4. If the creator has already withdrawn and lacks funds → FAILED_INSUFFICIENT_FUNDS.
 *      Admin must intervene manually (negotiate with creator, claw back from
 *      future earnings, or absorb the loss).
 *
 * Idempotency: clientReference (brother's internal id) is unique per
 * (ssoClientId, clientReference) to prevent double-submission.
 */
export enum RefundStatus {
    PENDING_REVIEW = 'PENDING_REVIEW',
    APPROVED = 'APPROVED',
    REJECTED = 'REJECTED',
    COMPLETED = 'COMPLETED',
    FAILED_INSUFFICIENT_FUNDS = 'FAILED_INSUFFICIENT_FUNDS',
    FAILED_OTHER = 'FAILED_OTHER',
}

export interface ISbcLiveRefund extends Document {
    originalPaymentIntentSessionId: string;
    originalPaymentIntentId: Types.ObjectId;
    ssoClientId: string;
    clientReference: string | null;
    buyerUserId: Types.ObjectId;
    creatorUserId: Types.ObjectId | null;
    grossAmount: number;
    currency: string;
    refundAmount: number;
    creatorClawbackAmount: number;
    sbcCommissionReturnedAmount: number;
    reason: string;
    status: RefundStatus;
    requestedBy: 'sso_client' | 'sbc_admin';
    requestedByUserId: Types.ObjectId | null;
    decidedAt?: Date;
    decidedByAdminId?: Types.ObjectId;
    decisionNote?: string;
    completedAt?: Date;
    failureReason?: string;
    refundTransactionId?: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const SbcLiveRefundSchema = new Schema<ISbcLiveRefund>(
    {
        originalPaymentIntentSessionId: { type: String, required: true, index: true },
        originalPaymentIntentId: { type: Schema.Types.ObjectId, required: true, index: true },
        ssoClientId: { type: String, required: true, index: true },
        clientReference: { type: String, default: null },
        buyerUserId: { type: Schema.Types.ObjectId, required: true, index: true },
        creatorUserId: { type: Schema.Types.ObjectId, default: null, index: true },
        grossAmount: { type: Number, required: true },
        currency: { type: String, required: true },
        refundAmount: { type: Number, required: true },
        creatorClawbackAmount: { type: Number, required: true },
        sbcCommissionReturnedAmount: { type: Number, required: true },
        reason: { type: String, required: true },
        status: {
            type: String,
            enum: Object.values(RefundStatus),
            default: RefundStatus.PENDING_REVIEW,
            required: true,
            index: true,
        },
        requestedBy: { type: String, enum: ['sso_client', 'sbc_admin'], required: true },
        requestedByUserId: { type: Schema.Types.ObjectId, default: null },
        decidedAt: { type: Date },
        decidedByAdminId: { type: Schema.Types.ObjectId },
        decisionNote: { type: String },
        completedAt: { type: Date },
        failureReason: { type: String },
        refundTransactionId: { type: Schema.Types.ObjectId },
    },
    { timestamps: true },
);

// Idempotency: same SSO client cannot file two refunds for the same client reference.
// When clientReference is null (admin-created from SBC side) the constraint doesn't apply.
SbcLiveRefundSchema.index(
    { ssoClientId: 1, clientReference: 1 },
    {
        unique: true,
        partialFilterExpression: { clientReference: { $type: 'string' } },
    },
);

export const SbcLiveRefund = model<ISbcLiveRefund>('SbcLiveRefund', SbcLiveRefundSchema);
export default SbcLiveRefund;
