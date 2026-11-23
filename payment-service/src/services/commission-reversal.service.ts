import { Types } from 'mongoose';
import TransactionModel, { Currency, TransactionStatus, TransactionType } from '../database/models/transaction.model';
import transactionRepository from '../database/repositories/transaction.repository';
import { userServiceClient } from './clients/user.service.client';
import { AppError } from '../utils/errors';
import logger from '../utils/logger';

const log = logger.getLogger('CommissionReversal');

/**
 * Support takes back a commission paid by mistake (Security plan Phase 5 leftover, 2026-11-23).
 * An agent asks (support approval `commission_reversal`, citing the deposit), another finance
 * manager approves, support-service calls this once the approval is executed.
 *
 * Money rules (financial code, see CLAUDE.md):
 *   1. Claim: the commission deposit moves COMPLETED → RECONCILED in ONE conditional write,
 *      with `metadata.reversalRef = commission-reversal:<txId>`. Only a completed commission
 *      deposit of this member can be claimed, and only once.
 *   2. Debit the same amount from the balance it was credited to (XAF main or USD), under the
 *      ledger reference `commission-reversal:<txId>`: a retry moves it once at most. The debit
 *      only takes AVAILABLE money (balance − debt − reserved): never into a withdrawal in flight,
 *      never below zero.
 *   3. If the member no longer has the money, the reversal is REFUSED and the claim released
 *      (the commission goes back to COMPLETED). No debt is created: `users.debt` is invisible to
 *      the member and setting one is a business decision (Rufus), not a support action. The
 *      agent's other answer is the freeze.
 *   4. Transport errors leave the claim in place: the approval stays `approved` and « Exécuter
 *      à nouveau » resumes it (same approval id); the ledger reference prevents a double debit.
 * One `commission_reversal` transaction records the debit. The member is not notified
 * automatically (as with the other support actions): the agent answers in the ticket.
 */

export interface ReversalInput { transactionId: string; userId: string; reason: string; by: string; approvalId: string }
export interface ReversalOutcome { status: 'reversed' | 'already_reversed'; amount: number; currency: string; reversalTransactionId: string | null }

export const reversalReference = (transactionId: string) => `commission-reversal:${transactionId}`;

const isCommission = (tx: any) => tx?.type === TransactionType.DEPOSIT && tx?.paymentProvider?.metadata?.commissionLevel !== undefined;

async function releaseClaim(transactionId: string, reference: string, why: string) {
    await TransactionModel.updateOne(
        { transactionId, status: TransactionStatus.RECONCILED, 'metadata.reversalRef': reference },
        {
            $set: { status: TransactionStatus.COMPLETED },
            $unset: {
                'metadata.reversalRef': '', 'metadata.reversalApprovalId': '', 'metadata.reconciledAt': '',
                'metadata.reconciledBy': '', 'metadata.reconciliationReason': '', 'metadata.reversedAmount': '',
            },
            $push: { 'metadata.reversalAttempts': { at: new Date(), why: why.slice(0, 200) } },
        } as any,
    );
}

async function recordReversal(tx: any, input: ReversalInput, reference: string): Promise<string> {
    const existing: any = await TransactionModel.findOne({ type: TransactionType.COMMISSION_REVERSAL, 'metadata.reversalRef': reference }).lean();
    if (existing) return existing.transactionId;
    // idempotencyKey = the reference: the unique {userId, idempotencyKey} index keeps it to one
    // record even when several resumed calls arrive together.
    let created: any;
    try {
        created = await transactionRepository.create({
        userId: String(input.userId),
        type: TransactionType.COMMISSION_REVERSAL,
        amount: tx.amount,
        currency: tx.currency,
        status: TransactionStatus.COMPLETED,
        description: `Reprise de commission (${tx.transactionId}) : ${input.reason.slice(0, 300)}`,
        metadata: { reversalRef: reference, reversalOf: tx.transactionId, approvalId: input.approvalId, by: input.by, reason: input.reason.slice(0, 500) },
        idempotencyKey: reference,
    } as any);
    } catch (err: any) {
        if (err?.code !== 11000) throw err;
        const other: any = await TransactionModel.findOne({ type: TransactionType.COMMISSION_REVERSAL, 'metadata.reversalRef': reference }).lean();
        if (!other) throw err;
        return other.transactionId;
    }
    return created.transactionId;
}

export async function reverseCommission(input: ReversalInput): Promise<ReversalOutcome> {
    const { transactionId, userId } = input;
    if (!Types.ObjectId.isValid(userId) || !input.approvalId || !input.reason) {
        throw new AppError('userId, reason and approvalId are required', 400);
    }
    const reference = reversalReference(transactionId);
    const owner = { $in: [new Types.ObjectId(userId), userId] } as any;

    // 1. Claim (or resume our own claim).
    let tx: any = await TransactionModel.findOneAndUpdate(
        {
            transactionId, userId: owner, type: TransactionType.DEPOSIT, status: TransactionStatus.COMPLETED,
            'paymentProvider.metadata.commissionLevel': { $exists: true },
        },
        { $set: {
            status: TransactionStatus.RECONCILED,
            'metadata.reversalRef': reference,
            'metadata.reversalApprovalId': input.approvalId,
            'metadata.reconciledAt': new Date(),
            'metadata.reconciledBy': input.by.slice(0, 64),
            'metadata.reconciliationReason': input.reason.slice(0, 500),
        } },
        { new: true },
    ).lean();
    if (!tx) {
        const cur: any = await TransactionModel.findOne({ transactionId }).lean();
        if (!cur) throw Object.assign(new AppError('Transaction introuvable.', 404), { code: 'NOT_FOUND' });
        const ours = cur.status === TransactionStatus.RECONCILED && cur.metadata?.reversalRef === reference;
        if (ours && cur.metadata?.reversalDoneAt) {
            const rt: any = await TransactionModel.findOne({ type: TransactionType.COMMISSION_REVERSAL, 'metadata.reversalRef': reference }).lean();
            return { status: 'already_reversed', amount: cur.amount, currency: cur.currency, reversalTransactionId: rt?.transactionId ?? null };
        }
        if (ours && cur.metadata?.reversalApprovalId === input.approvalId) {
            tx = cur; // our earlier attempt stopped after the claim: resume (the debit is idempotent)
        } else {
            const why = String(cur.userId) !== String(userId) ? 'elle appartient à un autre membre'
                : !isCommission(cur) ? 'ce n’est pas une commission'
                : cur.status === TransactionStatus.RECONCILED ? 'elle a déjà été reprise ou annulée'
                : `son statut est « ${cur.status} »`;
            throw Object.assign(new AppError(`Cette commission ne peut pas être reprise : ${why}.`, 409), { code: 'NOT_REVERSIBLE' });
        }
    }

    // 2. Debit under the reversal's ledger reference.
    const amount = Number(tx.amount);
    const usd = tx.currency === Currency.USD;
    const movement = { reference, source: 'commission-reversal', description: `Reprise de commission ${transactionId}` };
    try {
        if (usd) await userServiceClient.updateUserUsdBalance(userId, -amount, movement);
        else await userServiceClient.updateUserBalance(userId, -amount, movement);
    } catch (err: any) {
        const status = err?.statusCode ?? err?.status;
        if (status === 409 || status === 400 || status === 404) {
            // Refused by user-service. Make sure nothing moved under this reference before letting go.
            const applied = await userServiceClient.lookupWalletMovements([reference]).catch(() => null);
            if (applied === null) throw new AppError('Le service des soldes ne répond pas : réessayez plus tard.', 503);
            if (!applied.some((m) => m.direction === 'DEBIT')) {
                await releaseClaim(transactionId, reference, String(err?.message || 'refused'));
                const avail = await userServiceClient.getAvailableBalance(userId).catch(() => null);
                const left = avail ? (usd ? avail.availableUsd : avail.available) : null;
                log.warn(`Commission reversal ${transactionId} refused for ${userId}: ${err?.message}`);
                throw Object.assign(new AppError(
                    `Le membre n’a plus assez d’argent disponible pour reprendre cette commission (${amount} ${tx.currency}`
                    + `${left !== null ? `, disponible : ${left} ${usd ? 'USD' : 'F'}` : ''}). Rien n’a été débité. Gelez le compte si nécessaire.`, 409,
                ), { code: 'INSUFFICIENT_AVAILABLE_BALANCE' });
            }
            // The debit did land (an earlier attempt): carry on and finish.
        } else {
            log.error(`Commission reversal ${transactionId}: debit outcome unknown (${err?.message}); claim kept for a retry`);
            throw new AppError('Le service des soldes ne répond pas : réessayez plus tard.', 503);
        }
    }

    // 3. Done: one record of the debit, the commission marked reversed.
    const reversalTransactionId = await recordReversal(tx, input, reference);
    await TransactionModel.updateOne(
        { transactionId, 'metadata.reversalRef': reference },
        { $set: { 'metadata.reversalDoneAt': new Date(), 'metadata.reversedAmount': amount, 'metadata.reversalTransactionId': reversalTransactionId } },
    );
    log.info(`AUDIT: commission ${transactionId} reversed for ${userId} (${amount} ${tx.currency}), approval ${input.approvalId}`);
    return { status: 'reversed', amount, currency: tx.currency, reversalTransactionId };
}

/** What support shows before asking: the commission, if it can be reversed. */
export async function describeCommission(transactionId: string, userId: string) {
    const tx: any = await TransactionModel.findOne({ transactionId }).lean();
    if (!tx || String(tx.userId) !== String(userId)) return null;
    return {
        transactionId: tx.transactionId, amount: tx.amount, currency: tx.currency, status: tx.status, createdAt: tx.createdAt,
        description: tx.description, isCommission: isCommission(tx), level: tx.paymentProvider?.metadata?.commissionLevel ?? null,
        sourceUserId: tx.paymentProvider?.metadata?.sourceUserId ?? null,
        reversible: isCommission(tx) && tx.status === TransactionStatus.COMPLETED,
        reversed: tx.status === TransactionStatus.RECONCILED && !!tx.metadata?.reversalDoneAt,
    };
}
