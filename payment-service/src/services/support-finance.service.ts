import { randomUUID } from 'crypto';
import { Types } from 'mongoose';
import config from '../config';
import logger from '../utils/logger';
import TransactionModel, { ITransaction, TransactionStatus, TransactionType } from '../database/models/transaction.model';
import PaymentIntentModel from '../database/models/PaymentIntent';
import ManualRefClaimModel from '../database/models/manual-ref-claim.model';
import { IPaymentIntent, PaymentGateway, PaymentStatus } from '../database/interfaces/IPaymentIntent';
import paymentService from './payment.service';
import { userServiceClient } from './clients/user.service.client';
import { verifyPayinAtProvider, verifyPayoutAtProvider, ProviderAnswer } from './provider-verification.service';
import { completeWithdrawal, endWithdrawal, COMPLETABLE_STATUSES } from './withdrawal-lifecycle';
import { transactionStatusChecker } from '../jobs/transaction-status-checker.job';
import { AppError } from '../utils/errors';

const log = logger.getLogger('SupportFinance');
const HOUR = 3600 * 1000;

/** Contract §2.2 RecheckResult (+ what we did with it). */
export interface RecheckResult {
    result: ProviderAnswer['result'];
    provider: string;
    providerStatus: string;
    providerRef: string;
    amount?: number;
    currency?: string;
    checkedAt: string;
    requestId: string;
    /** Our record after the recheck (intent or withdrawal status). */
    internalStatus?: string;
    /** True when this recheck moved our record. */
    applied?: boolean;
}

export const AGE_BUCKETS = ['<24h', '24-48h', '48-72h', '>72h'] as const;

/** A withdrawal with no final provider answer after this is UNKNOWN (same threshold as the unknown_status case). */
const UNKNOWN_AFTER_MS = 24 * HOUR;

/**
 * Business status (CdC §5, contract §2.2) as a Mongo expression, so lists and
 * sums are computed in the database. REJECTED and EXPIRED are kept apart from
 * CANCELLED (they are not the member's decision). CANCEL_REQUESTED is never
 * produced: no flow lets a member cancel after approval.
 */
export function businessStatusExpr(now: Date) {
    const inFlightSince = { $ifNull: ['$approvedAt', '$createdAt'] };
    return {
        $switch: {
            branches: [
                { case: { $eq: ['$status', TransactionStatus.PENDING_OTP_VERIFICATION] }, then: 'REQUESTED' },
                { case: { $eq: ['$status', TransactionStatus.PENDING_ADMIN_APPROVAL] }, then: 'PENDING_APPROVAL' },
                {
                    case: {
                        $and: [
                            { $in: ['$status', [TransactionStatus.PENDING, TransactionStatus.PROCESSING]] },
                            {
                                $or: [
                                    { $lt: [inFlightSince, new Date(now.getTime() - UNKNOWN_AFTER_MS)] },
                                    { $ne: [{ $ifNull: ['$metadata.mfWebhookReview', null] }, null] },
                                    { $eq: ['$metadata.needsReview', true] },
                                ],
                            },
                        ],
                    },
                    then: 'UNKNOWN',
                },
                { case: { $eq: ['$status', TransactionStatus.PENDING] }, then: 'RESERVED' },
                {
                    case: { $and: [{ $eq: ['$status', TransactionStatus.PROCESSING] }, { $gt: [{ $strLenCP: { $ifNull: ['$externalTransactionId', ''] } }, 0] }] },
                    then: 'PENDING',
                },
                { case: { $eq: ['$status', TransactionStatus.PROCESSING] }, then: 'SUBMITTED' },
                { case: { $eq: ['$status', TransactionStatus.COMPLETED] }, then: 'SUCCEEDED' },
                { case: { $eq: ['$status', TransactionStatus.FAILED] }, then: 'FAILED' },
                { case: { $eq: ['$status', TransactionStatus.CANCELLED] }, then: 'CANCELLED' },
                { case: { $eq: ['$status', TransactionStatus.REJECTED_BY_ADMIN] }, then: 'REJECTED' },
                { case: { $eq: ['$status', TransactionStatus.EXPIRED] }, then: 'EXPIRED' },
            ],
            default: { $toUpper: '$status' },
        },
    };
}

export function ageBucketExpr(now: Date) {
    const age = { $subtract: [now, '$createdAt'] };
    return {
        $switch: {
            branches: [
                { case: { $lt: [age, 24 * HOUR] }, then: '<24h' },
                { case: { $lt: [age, 48 * HOUR] }, then: '24-48h' },
                { case: { $lt: [age, 72 * HOUR] }, then: '48-72h' },
            ],
            default: '>72h',
        },
    };
}

const gatewayExpr = { $toLower: { $ifNull: ['$metadata.selectedPayoutService', { $ifNull: ['$serviceProvider', { $ifNull: ['$metadata.serviceProvider', 'unknown'] }] }] } };
const countryExpr = { $ifNull: ['$metadata.accountInfo.countryCode', '$metadata.recipientCountryCode'] };

/** Same mapping in JS, for single documents. */
export async function businessStatusOf(transactionId: string, now = new Date()): Promise<string | null> {
    const rows = await TransactionModel.aggregate([
        { $match: { transactionId } },
        { $project: { businessStatus: businessStatusExpr(now) } },
    ]);
    return rows[0]?.businessStatus ?? null;
}

const payinView = (i: any) => ({
    sessionId: i.sessionId,
    gateway: i.gateway,
    amount: i.amount,
    currency: i.currency,
    status: i.status,
    purpose: i.metadata?.planId || i.metadata?.product || i.paymentType || null,
    createdAt: i.createdAt,
    gatewayRef: i.gatewayPaymentId ?? null,
});

class SupportFinanceService {
    async memberPayins(userId: string, limit = 20) {
        const intents = await PaymentIntentModel.find({ userId: String(userId) })
            .sort({ createdAt: -1 }).limit(Math.min(Math.max(limit, 1), 100)).lean();
        return intents.map(payinView);
    }

    async memberWithdrawals(userId: string, limit = 20) {
        if (!Types.ObjectId.isValid(userId)) return [];
        const now = new Date();
        return TransactionModel.aggregate([
            { $match: { userId: new Types.ObjectId(userId), type: TransactionType.WITHDRAWAL, deleted: { $ne: true } } },
            { $sort: { createdAt: -1 } },
            { $limit: Math.min(Math.max(limit, 1), 100) },
            {
                $project: {
                    _id: 0, transactionId: 1, amount: 1, currency: 1, status: 1, createdAt: 1, updatedAt: 1,
                    businessStatus: businessStatusExpr(now),
                    method: gatewayExpr,
                    fee: 1,
                    netAmount: '$metadata.netAmountRequested',
                    payoutCurrency: '$metadata.payoutCurrency',
                },
            },
        ]);
    }

    /** The intent if it exists (by session id or provider reference) and belongs to `userId` when given. */
    async lookupPayin(ref: string, userId?: string) {
        if (!ref) return null;
        const intent = await PaymentIntentModel.findOne({ $or: [{ sessionId: ref }, { gatewayPaymentId: ref }] }).lean();
        if (!intent) return null;
        if (userId && String(intent.userId) !== String(userId)) return null;
        return payinView(intent);
    }

    /**
     * Asks the provider, then — only if it gives a final answer and the intent is
     * not final yet — replays the provider's real handler, whose conditional
     * write completes the intent at most once (handlePaymentCompletion runs once).
     * An intent already SUCCEEDED is never replayed (the subscription callback
     * is not idempotent before phase 3).
     */
    async recheckPayin(sessionId: string, requestId: string): Promise<RecheckResult> {
        const intent = await PaymentIntentModel.findOne({ sessionId }).lean<IPaymentIntent>();
        if (!intent) throw new AppError('Payment intent not found', 404);
        const checkedAt = new Date().toISOString();
        if (!intent.gatewayPaymentId) {
            return { result: 'not_found', provider: intent.gateway, providerStatus: 'NO_PROVIDER_REFERENCE', providerRef: '', checkedAt, requestId, internalStatus: intent.status, applied: false };
        }
        const answer = await verifyPayinAtProvider(intent.gateway, intent.gatewayPaymentId, { countryCode: intent.countryCode });
        let applied = false;
        const final = intent.status === PaymentStatus.SUCCEEDED || intent.status === PaymentStatus.FAILED;
        const replayable = answer.result === 'confirmed' || (answer.result === 'failed' && intent.status !== PaymentStatus.SUCCEEDED);
        if (!final && replayable) {
            try {
                switch (intent.gateway) {
                    case PaymentGateway.FEEXPAY:
                        await paymentService.checkFeexpayTransactionStatus(intent.gatewayPaymentId);
                        break;
                    case PaymentGateway.MONEYFUSION: {
                        const raw = (answer.details?.raw as any) || {};
                        const event = answer.result === 'confirmed' ? 'payin.session.completed' : 'payin.session.cancelled';
                        await paymentService.handleMoneyFusionPayinWebhook({ ...raw, event, tokenPay: intent.gatewayPaymentId }, raw);
                        break;
                    }
                    case PaymentGateway.CINETPAY:
                        await paymentService.handleCinetPayWebhook({ merchant_transaction_id: intent.sessionId });
                        break;
                    case PaymentGateway.NOWPAYMENTS:
                        await paymentService.handleNowPaymentsWebhook({
                            payment_id: intent.gatewayPaymentId, order_id: intent.sessionId, payment_status: answer.providerStatus,
                        });
                        break;
                    default:
                        log.warn(`Recheck ${sessionId}: no handler for gateway ${intent.gateway}`);
                }
            } catch (err: any) {
                log.error(`Recheck ${sessionId}: replaying the ${intent.gateway} handler failed: ${err.message}`);
            }
        }
        const after = await PaymentIntentModel.findOne({ sessionId }).select('status').lean();
        applied = !!after && after.status !== intent.status;
        log.info(`[${requestId}] payin recheck ${sessionId}: provider ${answer.result} (${answer.providerStatus}), intent ${intent.status} → ${after?.status}`);
        return { ...this.publicAnswer(answer), checkedAt, requestId, internalStatus: after?.status, applied };
    }

    /**
     * Asks the provider about a withdrawal; when it gives a final answer for one
     * still in flight, the status checker's per-provider path applies it with
     * conditional transitions (success settles once, failure releases).
     */
    async recheckWithdrawal(transactionId: string, requestId: string): Promise<RecheckResult> {
        const tx = await TransactionModel.findOne({ transactionId, type: TransactionType.WITHDRAWAL }).lean<ITransaction>();
        if (!tx) throw new AppError('Withdrawal not found', 404);
        const checkedAt = new Date().toISOString();
        const answer = await verifyPayoutAtProvider(tx);
        if (COMPLETABLE_STATUSES.includes(tx.status) && (answer.result === 'confirmed' || answer.result === 'failed')) {
            try {
                await transactionStatusChecker.checkSpecificTransaction(transactionId);
            } catch (err: any) {
                log.error(`[${requestId}] withdrawal recheck ${transactionId}: applying failed: ${err.message}`);
            }
        }
        const after = await TransactionModel.findOne({ transactionId }).select('status').lean();
        log.info(`[${requestId}] withdrawal recheck ${transactionId}: provider ${answer.result} (${answer.providerStatus}), ${tx.status} → ${after?.status}`);
        return { ...this.publicAnswer(answer), checkedAt, requestId, internalStatus: after?.status, applied: after?.status !== tx.status };
    }

    /**
     * Finance regularization (double-approved in support-service): completes or
     * fails a withdrawal still in flight, in one conditional write. Anything else
     * is refused with STATE_CHANGED (409).
     */
    async regularizeWithdrawal(input: {
        transactionId: string; action: 'complete' | 'fail'; reason: string; evidence: string[]; approvalId: string; actor: string; requestId: string;
    }) {
        const record = {
            action: input.action, reason: input.reason, evidence: input.evidence, approvalId: input.approvalId,
            actor: input.actor, at: new Date().toISOString(), requestId: input.requestId,
        };
        const from = [TransactionStatus.PROCESSING, TransactionStatus.PENDING];
        // complete may also follow a failure (money really left: checked on the
        // provider's dashboard, double-approved); the debit then happens once and a
        // divergence case is opened.
        const tx = input.action === 'complete'
            ? await completeWithdrawal(input.transactionId, { from: [...from, TransactionStatus.FAILED], source: `support-regularize:${input.actor}`, set: { 'metadata.regularization': record } })
            : await endWithdrawal(input.transactionId, {
                from, to: TransactionStatus.FAILED,
                set: { 'metadata.regularization': record, 'metadata.failureReason': `Régularisation support : ${input.reason}` },
                reason: 'support_regularization',
            });
        if (!tx) {
            const current = await TransactionModel.findOne({ transactionId: input.transactionId }).select('status').lean();
            if (!current) throw new AppError('Withdrawal not found', 404);
            throw Object.assign(new AppError(`Le retrait n'est pas dans un état régularisable (statut actuel : ${current.status}).`, 409), { code: 'STATE_CHANGED' });
        }
        log.warn(`[${input.requestId}] withdrawal ${input.transactionId} regularized (${input.action}) by ${input.actor}, approval ${input.approvalId}`);
        return { transactionId: tx.transactionId, status: tx.status, businessStatus: await businessStatusOf(tx.transactionId) };
    }

    /** Claims an external reference for a manual path; throws REF_ALREADY_USED. */
    async claimExternalRef(gateway: string, ref: string, by: string, extra: { userId?: string; approvalId?: string } = {}) {
        const existing = await PaymentIntentModel.findOne({
            $or: [{ gateway: gateway.toLowerCase(), gatewayPaymentId: ref }, { 'metadata.cinetpayTransactionId': ref }],
        }).select('sessionId status').lean();
        if (existing) {
            throw Object.assign(new AppError(`Cette référence est déjà rattachée au paiement ${existing.sessionId} (${existing.status}). Utilisez la revérification de ce paiement.`, 409), { code: 'REF_ALREADY_USED', data: { sessionId: existing.sessionId, status: existing.status } });
        }
        try {
            await ManualRefClaimModel.create({ gateway: gateway.toLowerCase(), ref, by, ...extra });
        } catch (err: any) {
            if (err?.code === 11000) {
                throw Object.assign(new AppError('Cette référence a déjà servi à une activation manuelle.', 409), { code: 'REF_ALREADY_USED' });
            }
            throw err;
        }
    }

    async releaseExternalRef(gateway: string, ref: string) {
        await ManualRefClaimModel.deleteOne({ gateway: gateway.toLowerCase(), ref, sessionId: { $exists: false } });
    }

    async bindExternalRefs(gateway: string, refs: string[], sessionId: string) {
        await ManualRefClaimModel.updateMany({ gateway: gateway.toLowerCase(), ref: { $in: refs } }, { $set: { sessionId } });
    }

    /**
     * Everything a manual activation / admin recovery needs before crediting a
     * member with an external payment:
     *  - every id the provider knows the payment by (CinetPay token AND
     *    transaction id…) is unused by our intents and claimed once;
     *  - the provider confirms it;
     *  - it is not one of our own payments (then: recheck it) nor one made for
     *    another member (the provider echoes our session / user id);
     *  - the amount covers the pack price (plan prices from user-service) and,
     *    when given, `minAmount`.
     * Any refusal releases the claims. Returns the provider answer and the claimed ids.
     */
    async verifyExternalPayment(input: {
        gateway: string; ref: string; userId: string; plan: string; by: string; approvalId?: string;
        countryCode?: string; minAmount?: number; requestId: string;
    }): Promise<{ answer: ProviderAnswer; refs: string[]; price: number }> {
        const gateway = input.gateway.toLowerCase();
        if (input.minAmount !== undefined && (!Number.isFinite(input.minAmount) || input.minAmount <= 0)) {
            throw Object.assign(new AppError('Montant attendu invalide.', 400), { code: 'INVALID_AMOUNT' });
        }
        const claimed: string[] = [];
        const releaseAll = async () => { for (const r of claimed) await this.releaseExternalRef(gateway, r); };
        const refuse = (status: number, code: string, message: string, answer?: ProviderAnswer) => Object.assign(new AppError(message, status), {
            code, data: answer ? { ...this.publicAnswer(answer), checkedAt: new Date().toISOString(), requestId: input.requestId } : undefined,
        });

        await this.claimExternalRef(gateway, input.ref, input.by, { userId: input.userId, approvalId: input.approvalId });
        claimed.push(input.ref);
        try {
            const answer = await verifyPayinAtProvider(gateway, input.ref, { countryCode: input.countryCode });
            if (answer.result !== 'confirmed') {
                throw refuse(422, 'PROVIDER_NOT_CONFIRMED', `Le prestataire ne confirme pas ce paiement (${answer.result}).`, answer);
            }
            const details: any = answer.details || {};
            for (const id of (details.relatedIds as string[] | undefined) || []) {
                if (claimed.includes(id)) continue;
                await this.claimExternalRef(gateway, id, input.by, { userId: input.userId, approvalId: input.approvalId });
                claimed.push(id);
            }
            if (details.ourSessionId) {
                const ours = await PaymentIntentModel.findOne({ sessionId: String(details.ourSessionId) }).select('sessionId userId status').lean();
                if (ours) {
                    throw Object.assign(refuse(409, 'REF_ALREADY_USED', `Ce paiement correspond déjà au paiement ${ours.sessionId} (${ours.status}) : utilisez sa revérification.`, answer), {
                        data: { sessionId: ours.sessionId, status: ours.status },
                    });
                }
            }
            if (details.ownerUserId && String(details.ownerUserId) !== String(input.userId)) {
                throw refuse(422, 'PAID_FOR_ANOTHER_ACCOUNT', 'Ce paiement a été fait pour un autre compte.', answer);
            }

            const prices = await userServiceClient.getPlanPrices();
            const planKey = String(input.plan || '').toUpperCase() as 'CLASSIQUE' | 'CIBLE' | 'UPGRADE';
            const isUsd = gateway === 'nowpayments';
            const price = Number(prices?.[planKey]?.[isUsd ? 'USD' : 'XAF']);
            if (!Number.isFinite(price) || price <= 0) throw refuse(400, 'UNKNOWN_PLAN', 'Pack inconnu.');
            const currency = String(answer.currency || (isUsd ? 'USD' : 'XAF')).toUpperCase();
            const acceptable = isUsd ? ['USD'] : ['XAF', 'XOF']; // XAF/XOF are 1:1
            if (!acceptable.includes(currency)) {
                throw refuse(422, 'CURRENCY_MISMATCH', `Paiement en ${currency} : à traiter à la main par la finance.`, answer);
            }
            if (!(Number(answer.amount) > 0)) {
                throw refuse(422, 'AMOUNT_UNVERIFIED', 'Le prestataire ne donne pas le montant payé : activation manuelle impossible.', answer);
            }
            const needed = Math.max(price, input.minAmount ?? 0);
            const paid = Number(answer.amount);
            if (!Number.isFinite(paid) || paid < needed - 0.01) {
                throw refuse(422, 'AMOUNT_TOO_LOW', `Montant payé ${answer.amount} ${currency}, inférieur au prix du pack (${needed}).`, answer);
            }
            return { answer, refs: claimed, price };
        } catch (err) {
            await releaseAll();
            throw err;
        }
    }

    /**
     * Manual activation by an agent (contract §2.2): see verifyExternalPayment.
     * Creates a SUCCEEDED intent bound to that reference and runs the normal
     * completion (callback to user-service with fixed callbackPath/originatingService).
     */
    async manualActivation(input: {
        userId: string; gateway: string; externalRef: string; plan: string; approvalId: string; actor: string; requestId: string; countryCode?: string;
    }) {
        const gateway = input.gateway.toLowerCase();
        const plans: Record<string, { planId: string; planName: string; isUpgrade: boolean }> = {
            CLASSIQUE: { planId: 'CLASSIQUE', planName: 'Abonnement Classique', isUpgrade: false },
            CIBLE: { planId: 'CIBLE', planName: 'Abonnement Ciblé', isUpgrade: false },
            UPGRADE: { planId: 'CIBLE', planName: 'Upgrade to Ciblé', isUpgrade: true },
        };
        const planKey = String(input.plan || '').toUpperCase();
        const plan = plans[planKey];
        if (!plan) throw new AppError('plan must be CLASSIQUE, CIBLE or UPGRADE', 400);
        if (!['feexpay', 'cinetpay', 'moneyfusion', 'nowpayments'].includes(gateway)) throw new AppError('Unsupported gateway', 400);

        const { answer, refs } = await this.verifyExternalPayment({
            gateway, ref: input.externalRef, userId: input.userId, plan: planKey, by: input.actor,
            approvalId: input.approvalId, countryCode: input.countryCode, requestId: input.requestId,
        });

        const currency = gateway === 'nowpayments' ? 'USD' : (answer.currency || 'XAF');
        let intent: any;
        try {
            intent = await PaymentIntentModel.create({
                userId: String(input.userId),
                paymentType: 'SUBSCRIPTION',
                amount: answer.amount ?? 0,
                currency,
                gateway,
                gatewayPaymentId: input.externalRef,
                status: PaymentStatus.SUCCEEDED,
                paidAmount: answer.amount ?? 0,
                paidCurrency: currency,
                webhookHistory: [{ timestamp: new Date(), status: PaymentStatus.SUCCEEDED, providerData: { manualActivation: true, verified: this.publicAnswer(answer) } }],
                metadata: {
                    userId: String(input.userId),
                    planId: plan.planId, planName: plan.planName, planType: plan.planId, isUpgrade: plan.isUpgrade,
                    // Fixed here, never taken from input: they decide where the result (and our service secret) goes.
                    originatingService: 'user-service',
                    callbackPath: `${config.services.userServiceUrl || 'http://localhost:3001/api'}/subscriptions/webhooks/payment-confirmation`,
                    isManualAdmin: true,
                    createdBy: 'support',
                    externalReference: input.externalRef,
                    providerRelatedIds: refs,
                    manualActivation: {
                        approvalId: input.approvalId, actor: input.actor, requestId: input.requestId, verifiedAt: new Date(),
                        providerStatus: answer.providerStatus, providerAmount: answer.amount ?? null,
                    },
                },
            });
        } catch (err: any) {
            for (const r of refs) await this.releaseExternalRef(gateway, r);
            if (err?.code === 11000) throw Object.assign(new AppError('Cette référence est déjà utilisée.', 409), { code: 'REF_ALREADY_USED' });
            throw err;
        }
        await this.bindExternalRefs(gateway, refs, intent.sessionId);
        await paymentService.handlePaymentCompletion(intent.toObject());
        log.warn(`[${input.requestId}] manual activation ${intent.sessionId} for user ${input.userId} (${plan.planId}) by ${input.actor}, approval ${input.approvalId}, ${gateway} ref verified`);
        return { sessionId: intent.sessionId, status: intent.status, amount: intent.amount, currency, verified: this.publicAnswer(answer) };
    }

    private matchFinance(q: { from?: Date; to?: Date; country?: string }) {
        const match: Record<string, any> = { type: TransactionType.WITHDRAWAL, deleted: { $ne: true }, 'metadata.adminDirectPayout': { $ne: true } };
        if (q.from || q.to) match.createdAt = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
        if (q.country) match['metadata.accountInfo.countryCode'] = q.country.toUpperCase();
        return match;
    }

    /** Counts and sums per business status; ages of what is still open. */
    async financeSummary(q: { from?: Date; to?: Date; country?: string; gateway?: string }) {
        const now = new Date();
        const rows = await TransactionModel.aggregate([
            { $match: this.matchFinance(q) },
            { $project: { amount: 1, businessStatus: businessStatusExpr(now), ageBucket: ageBucketExpr(now), status: 1, gateway: gatewayExpr } },
            // Same provider filter as the withdrawal list.
            ...(q.gateway ? [{ $match: { gateway: q.gateway.toLowerCase() } }] : []),
            {
                $facet: {
                    byStatus: [{ $group: { _id: '$businessStatus', count: { $sum: 1 }, amount: { $sum: '$amount' } } }],
                    openByAge: [
                        { $match: { status: { $in: [TransactionStatus.PENDING_OTP_VERIFICATION, TransactionStatus.PENDING_ADMIN_APPROVAL, TransactionStatus.PENDING, TransactionStatus.PROCESSING] } } },
                        { $group: { _id: '$ageBucket', count: { $sum: 1 }, amount: { $sum: '$amount' } } },
                    ],
                },
            },
        ]);
        const byBusinessStatus: Record<string, { count: number; amount: number }> = {};
        for (const r of rows[0]?.byStatus || []) byBusinessStatus[r._id] = { count: r.count, amount: Math.round(r.amount * 100) / 100 };
        const openByAge: Record<string, { count: number; amount: number }> = {};
        for (const b of AGE_BUCKETS) openByAge[b] = { count: 0, amount: 0 };
        for (const r of rows[0]?.openByAge || []) openByAge[r._id] = { count: r.count, amount: Math.round(r.amount * 100) / 100 };
        return { currency: 'XAF', from: q.from ?? null, to: q.to ?? null, country: q.country ?? null, byBusinessStatus, openByAge, generatedAt: now };
    }

    /** Paginated withdrawals for the finance board. */
    async financeWithdrawals(q: { status?: string; ageBucket?: string; gateway?: string; country?: string; from?: Date; to?: Date; page: number; limit: number }) {
        const now = new Date();
        const post: Record<string, any> = {};
        if (q.status) post.businessStatus = q.status.toUpperCase();
        if (q.ageBucket) post.ageBucket = q.ageBucket;
        if (q.gateway) post.gateway = q.gateway.toLowerCase();
        const page = Math.max(1, q.page);
        const limit = Math.min(Math.max(1, q.limit), 100);
        const rows = await TransactionModel.aggregate([
            { $match: this.matchFinance({ country: q.country, from: q.from, to: q.to }) },
            {
                $project: {
                    _id: 0, transactionId: 1, userId: 1, amount: 1, fee: 1, currency: 1, status: 1, createdAt: 1, updatedAt: 1,
                    externalTransactionId: 1,
                    netAmount: '$metadata.netAmountRequested', payoutCurrency: '$metadata.payoutCurrency',
                    businessStatus: businessStatusExpr(now), ageBucket: ageBucketExpr(now), gateway: gatewayExpr, country: countryExpr,
                    reservation: '$metadata.reservation.state',
                },
            },
            { $match: post },
            { $sort: { createdAt: 1 } },
            { $facet: { items: [{ $skip: (page - 1) * limit }, { $limit: limit }], total: [{ $count: 'n' }] } },
        ]);
        const total = rows[0]?.total?.[0]?.n ?? 0;
        return { items: rows[0]?.items ?? [], page, limit, total, totalPages: Math.ceil(total / limit) };
    }

    private publicAnswer(a: ProviderAnswer) {
        return { result: a.result, provider: a.provider, providerStatus: a.providerStatus, providerRef: a.providerRef, amount: a.amount, currency: a.currency };
    }
}

export const supportFinanceService = new SupportFinanceService();
export const newRequestId = () => randomUUID();
