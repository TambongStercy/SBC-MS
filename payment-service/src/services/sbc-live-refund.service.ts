import { Types } from 'mongoose';
import SbcLiveRefund, { ISbcLiveRefund, RefundStatus } from '../database/models/sbc-live-refund.model';
import paymentIntentRepository from '../database/repositories/paymentIntent.repository';
import transactionRepository from '../database/repositories/transaction.repository';
import { TransactionType, TransactionStatus, Currency } from '../database/models/transaction.model';
import { userServiceClient } from './clients/user.service.client';
import { AppError } from '../utils/errors';
import logger from '../utils/logger';

const log = logger.getLogger('SbcLiveRefundService');

interface RequestRefundInput {
    sessionId: string;
    ssoClientId: string;
    clientReference?: string | null;
    refundAmount: number; // gross to refund — defaults to full grossAmount if equal
    reason: string;
    requestedBy: 'sso_client' | 'sbc_admin';
    requestedByUserId?: string | null;
}

interface DecideRefundInput {
    refundId: string;
    adminUserId: string;
    decision: 'approve' | 'reject';
    note?: string;
}

/**
 * SBC Live refund queue service.
 *
 * Policy (per Rufus, captured in docs/SBC_LIVE_PAYMENT_DESIGN_QUESTIONS.md):
 *   - All refunds are manual-approval; no automatic refund logic
 *   - On approval, debit creator's sbcLiveBalance for their portion (75% of
 *     the refunded amount), credit buyer's main balance for the full refund
 *   - Creator's portion is taken even if it makes their wallet negative —
 *     `updateSbcLiveBalance` is guarded against negatives, so attempted
 *     debits that would push below zero fail and the refund is marked
 *     FAILED_INSUFFICIENT_FUNDS for manual admin handling
 *   - SBC's 25% commission is "given back" on paper — we just track it in the
 *     refund record so reporting can subtract it from total commission revenue
 */
class SbcLiveRefundService {
    /**
     * Create a refund request — sets status to PENDING_REVIEW. No money moves.
     * Validates that the original PaymentIntent exists, is SUCCEEDED, was an
     * SSO payment, and that the requested amount doesn't exceed the original.
     */
    async requestRefund(input: RequestRefundInput): Promise<ISbcLiveRefund> {
        const intent = await paymentIntentRepository.findBySessionId(input.sessionId);
        if (!intent) {
            throw new AppError('PaymentIntent not found for given sessionId', 404);
        }
        if (intent.status !== 'SUCCEEDED') {
            throw new AppError(`Cannot refund a PaymentIntent in status ${intent.status} — must be SUCCEEDED`, 400);
        }
        const meta = intent.metadata || {};
        if (meta.paymentSource !== 'sso_third_party') {
            throw new AppError('Refunds via this endpoint are only for SSO third-party payments', 400);
        }
        if (meta.ssoClientId !== input.ssoClientId) {
            throw new AppError(`PaymentIntent was created by client ${meta.ssoClientId}, not ${input.ssoClientId}`, 403);
        }

        const gross = intent.paidAmount ?? intent.amount ?? 0;
        if (!gross || gross <= 0) {
            throw new AppError('Original PaymentIntent has no usable amount', 400);
        }
        if (input.refundAmount > gross) {
            throw new AppError(`Refund amount ${input.refundAmount} exceeds original ${gross}`, 400);
        }
        if (input.refundAmount <= 0) {
            throw new AppError('Refund amount must be positive', 400);
        }

        // Calculate the slices to roll back. For partial refunds we proportionally
        // claw back from creator + SBC commission (rounded so totals match).
        const fraction = input.refundAmount / gross;
        const creatorClawback = Math.round((meta.splitBeneficiaryCredit ?? 0) * fraction);
        const sbcCommissionReturned = input.refundAmount - creatorClawback;

        try {
            const refund = await SbcLiveRefund.create({
                originalPaymentIntentSessionId: input.sessionId,
                originalPaymentIntentId: intent._id,
                ssoClientId: input.ssoClientId,
                clientReference: input.clientReference ?? null,
                buyerUserId: new Types.ObjectId(intent.userId),
                creatorUserId: meta.beneficiaryUserId ? new Types.ObjectId(meta.beneficiaryUserId) : null,
                grossAmount: gross,
                currency: intent.currency ?? 'XAF',
                refundAmount: input.refundAmount,
                creatorClawbackAmount: creatorClawback,
                sbcCommissionReturnedAmount: sbcCommissionReturned,
                reason: input.reason,
                status: RefundStatus.PENDING_REVIEW,
                requestedBy: input.requestedBy,
                requestedByUserId: input.requestedByUserId ? new Types.ObjectId(input.requestedByUserId) : null,
            });
            log.info(`Refund requested: refundId=${refund._id} session=${input.sessionId} amount=${input.refundAmount} by=${input.requestedBy}`);
            return refund;
        } catch (error: any) {
            if (error.code === 11000) {
                throw new AppError('A refund request already exists for this client reference', 409);
            }
            throw error;
        }
    }

    /**
     * Admin decision: approve (which triggers processing) or reject (which
     * just records the decision). Both are idempotent — calling decide on a
     * refund that's already past PENDING_REVIEW returns the existing record
     * unchanged (no double-debit risk).
     */
    async decideRefund(input: DecideRefundInput): Promise<ISbcLiveRefund> {
        const refund = await SbcLiveRefund.findById(input.refundId);
        if (!refund) {
            throw new AppError('Refund not found', 404);
        }
        if (refund.status !== RefundStatus.PENDING_REVIEW) {
            log.info(`Refund ${input.refundId} is already in status ${refund.status}, decide is a no-op`);
            return refund;
        }

        refund.decidedAt = new Date();
        refund.decidedByAdminId = new Types.ObjectId(input.adminUserId);
        refund.decisionNote = input.note;

        if (input.decision === 'reject') {
            refund.status = RefundStatus.REJECTED;
            await refund.save();
            log.info(`Refund ${input.refundId} REJECTED by admin ${input.adminUserId}: ${input.note || '(no note)'}`);
            return refund;
        }

        refund.status = RefundStatus.APPROVED;
        await refund.save();
        log.info(`Refund ${input.refundId} APPROVED by admin ${input.adminUserId}, processing...`);

        // Process the refund: debit creator + credit buyer + create REFUND
        // transaction. Wrapped in its own try so the approval state survives
        // even if processing fails partway — admin can retry by re-approving
        // or move the refund to FAILED_OTHER manually.
        try {
            await this.processApprovedRefund(refund);
        } catch (error: any) {
            log.error(`Refund ${input.refundId} processing failed: ${error.message}`);
            refund.status = RefundStatus.FAILED_OTHER;
            refund.failureReason = error.message;
            await refund.save();
            throw error;
        }

        return refund;
    }

    /**
     * Move money for an APPROVED refund. Steps in order — if any throws, the
     * refund stays in FAILED_* and admin handles manually:
     *   1. Debit creator's sbcLiveBalance by creatorClawbackAmount (skipped if no creator)
     *   2. Credit buyer's main balance by refundAmount (the gross they paid)
     *   3. Create a REFUND transaction record linked to the original intent
     *   4. Mark the refund COMPLETED
     *
     * Step 1 is the most likely failure point: creator may have already
     * withdrawn their share. updateSbcLiveBalance returns false in that case
     * and we set FAILED_INSUFFICIENT_FUNDS without crediting the buyer (don't
     * want to credit the buyer twice if admin re-tries after manual fixup).
     */
    private async processApprovedRefund(refund: ISbcLiveRefund): Promise<void> {
        if (refund.creatorUserId && refund.creatorClawbackAmount > 0) {
            const ok = await userServiceClient.updateSbcLiveBalance(
                refund.creatorUserId.toString(),
                -refund.creatorClawbackAmount,
            );
            if (!ok) {
                refund.status = RefundStatus.FAILED_INSUFFICIENT_FUNDS;
                refund.failureReason = `Creator ${refund.creatorUserId} has insufficient SBC Live balance for clawback of ${refund.creatorClawbackAmount} ${refund.currency}`;
                await refund.save();
                log.warn(refund.failureReason);
                return;
            }
        }

        await userServiceClient.updateUserBalance(refund.buyerUserId.toString(), refund.refundAmount);

        const tx = await transactionRepository.create({
            userId: new Types.ObjectId(refund.buyerUserId),
            type: TransactionType.REFUND,
            amount: refund.refundAmount,
            currency: refund.currency as Currency,
            fee: 0,
            status: TransactionStatus.COMPLETED,
            description: `SBC Live refund for session ${refund.originalPaymentIntentSessionId}: ${refund.reason}`,
            metadata: {
                refundId: refund._id?.toString(),
                originalPaymentIntentSessionId: refund.originalPaymentIntentSessionId,
                ssoClientId: refund.ssoClientId,
                creatorClawbackAmount: refund.creatorClawbackAmount,
                sbcCommissionReturnedAmount: refund.sbcCommissionReturnedAmount,
            },
        });

        refund.refundTransactionId = tx._id;
        refund.status = RefundStatus.COMPLETED;
        refund.completedAt = new Date();
        await refund.save();
        log.info(`Refund ${refund._id} COMPLETED: buyer=${refund.buyerUserId} +${refund.refundAmount}, creator=${refund.creatorUserId} -${refund.creatorClawbackAmount}, txId=${tx._id}`);
    }

    async listRefunds(filters: { status?: RefundStatus; ssoClientId?: string; limit?: number; skip?: number }): Promise<ISbcLiveRefund[]> {
        const query: Record<string, any> = {};
        if (filters.status) query.status = filters.status;
        if (filters.ssoClientId) query.ssoClientId = filters.ssoClientId;
        return SbcLiveRefund.find(query)
            .sort({ createdAt: -1 })
            .skip(filters.skip ?? 0)
            .limit(Math.min(filters.limit ?? 50, 200))
            .exec();
    }

    async getRefund(id: string): Promise<ISbcLiveRefund | null> {
        return SbcLiveRefund.findById(id).exec();
    }
}

export const sbcLiveRefundService = new SbcLiveRefundService();
export default sbcLiveRefundService;
