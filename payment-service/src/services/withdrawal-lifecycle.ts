import { Types } from 'mongoose';
import TransactionModel, { ITransaction, TransactionStatus, TransactionType } from '../database/models/transaction.model';
import { userServiceClient } from './clients/user.service.client';
import { openSupportCase } from './clients/support.service.client';
import { AppError } from '../utils/errors';
import logger from '../utils/logger';

const log = logger.getLogger('WithdrawalLifecycle');

/**
 * Every status change of a withdrawal goes through here (support phase 2):
 *
 *  - one conditional write `{transactionId, status ∈ from} → to`, and the
 *    money side runs only when THIS call made the transition — so replayed,
 *    concurrent or out-of-order webhooks cannot debit twice or undo a final
 *    state;
 *  - success settles the wallet once (user-service converts the reservation:
 *    balance and reservedBalance drop together, ledger reference
 *    `withdrawal:<txId>`; a legacy withdrawal without reservation is debited
 *    plainly under the same reference);
 *  - every other terminal state (failed, cancelled, rejected, expired) releases
 *    the reservation. Nothing here releases on a timeout: callers only call
 *    `endWithdrawal` on a confirmed answer.
 *
 * Debit-on-success is unchanged: the balance only drops on a confirmed payout.
 */

export const OPEN_WITHDRAWAL_STATUSES = [
    TransactionStatus.PENDING_OTP_VERIFICATION,
    TransactionStatus.PENDING_ADMIN_APPROVAL,
    TransactionStatus.PENDING,
    TransactionStatus.PROCESSING,
];

/** Statuses from which a provider-confirmed success may still complete a withdrawal. */
export const COMPLETABLE_STATUSES = [TransactionStatus.PENDING, TransactionStatus.PROCESSING];

export type ReservationCurrency = 'XAF' | 'USD';

export function reservationOf(tx: Pick<ITransaction, 'amount' | 'fee' | 'currency' | 'metadata'>): { amount: number; currency: ReservationCurrency } {
    const isUsd = tx.currency === 'USD' || tx.metadata?.cryptoWithdrawal === true;
    // Crypto: amount is the net USD, the fee is charged on top (debited as amount + fee).
    const amount = isUsd ? Math.abs(tx.amount) + (tx.fee || 0) : Math.abs(tx.amount);
    return { amount: Math.round(amount * 100) / 100, currency: isUsd ? 'USD' : 'XAF' };
}

/**
 * Holds the withdrawal's gross amount in user-service. Returns false when the
 * available balance (balance - debt - already reserved) does not cover it.
 * Throws 503 when user-service cannot answer (fail closed).
 */
export async function reserveForWithdrawal(tx: Pick<ITransaction, 'transactionId' | 'userId' | 'amount' | 'fee' | 'currency' | 'metadata'>): Promise<boolean> {
    const { amount, currency } = reservationOf(tx);
    const outcome = await userServiceClient.reserveWithdrawalFunds({
        transactionId: tx.transactionId, userId: tx.userId.toString(), amount, currency,
    });
    if (outcome === 'reserved' || outcome === 'already_reserved') {
        await TransactionModel.updateOne(
            { transactionId: tx.transactionId },
            { $set: { 'metadata.reservation': { amount, currency, state: 'held', at: new Date() } } },
        );
        return true;
    }
    if (outcome === 'conflict') {
        log.error(`Reservation conflict for withdrawal ${tx.transactionId}`);
        throw new AppError('Ce retrait ne peut pas être réservé pour le moment. Contactez le support.', 409);
    }
    return false;
}

/** Single conditional status write. Returns the updated document, or null if the status was not in `from`. */
export async function transitionWithdrawal(
    transactionId: string,
    from: TransactionStatus[],
    to: TransactionStatus,
    set: Record<string, unknown> = {},
    unset: Record<string, ''> = {},
): Promise<ITransaction | null> {
    const update: Record<string, any> = { $set: { status: to, ...set } };
    if (Object.keys(unset).length) update.$unset = unset;
    return TransactionModel.findOneAndUpdate(
        { transactionId, type: TransactionType.WITHDRAWAL, status: { $in: from } },
        update,
        { new: true },
    ).lean<ITransaction>().exec();
}

/**
 * Provider-confirmed success. Returns the completed transaction when this call
 * completed it, null when it was not in `from` (already completed, or another
 * state): the caller then does nothing else.
 */
export async function completeWithdrawal(
    transactionId: string,
    opts: { from?: TransactionStatus[]; set?: Record<string, unknown>; source: string },
): Promise<ITransaction | null> {
    const from = opts.from ?? COMPLETABLE_STATUSES;
    const wasFailed = from.includes(TransactionStatus.FAILED)
        ? await TransactionModel.exists({ transactionId, status: TransactionStatus.FAILED })
        : null;
    const tx = await transitionWithdrawal(transactionId, from, TransactionStatus.COMPLETED, {
        'metadata.payoutCompletedAt': new Date().toISOString(),
        'metadata.completedBy': opts.source,
        ...(opts.set || {}),
    });
    if (!tx) {
        const current = await TransactionModel.findOne({ transactionId }).select('status userId metadata').lean<ITransaction>();
        if (current?.status === TransactionStatus.COMPLETED) {
            // A success callback for a completed withdrawal: nothing moves, but it is worth a look.
            await TransactionModel.updateOne({ transactionId }, { $inc: { 'metadata.duplicateSuccessCallbacks': 1 } });
            void openSupportCase({
                type: 'duplicate_callback', dedupKey: `withdrawal:${transactionId}:duplicate`, severity: 'info',
                subject: { userId: current.userId?.toString(), transactionId },
                summary: 'Confirmation de succès reçue plusieurs fois pour un retrait déjà terminé (aucun double débit).',
                details: { source: opts.source },
            });
        }
        log.info(`Withdrawal ${transactionId}: completion by ${opts.source} skipped (status ${current?.status ?? 'unknown'})`);
        return null;
    }
    await settleCompletedWithdrawal(tx, opts.source, !!wasFailed);
    return tx;
}

/** Debits the wallet for a completed withdrawal (idempotent in user-service). */
export async function settleCompletedWithdrawal(tx: ITransaction, source: string, lateAfterFailure = false): Promise<void> {
    const { amount, currency } = reservationOf(tx);
    try {
        const out = await userServiceClient.settleWithdrawal({
            transactionId: tx.transactionId, userId: tx.userId.toString(), amount, currency,
            description: `Retrait ${tx.transactionId}`,
        });
        await TransactionModel.updateOne(
            { transactionId: tx.transactionId },
            { $set: { 'metadata.reservation.state': 'converted', 'metadata.walletDebitedAt': new Date(), 'metadata.walletDebit': out.status } },
        );
        log.info(`Withdrawal ${tx.transactionId} completed by ${source}: wallet ${out.status} (${amount} ${currency})`);
        if (out.lateAfterRelease || lateAfterFailure || out.reservedDrift) {
            void openSupportCase({
                type: 'withdrawal_divergence', dedupKey: `withdrawal:${tx.transactionId}:divergence`, severity: 'critical',
                subject: { userId: tx.userId.toString(), transactionId: tx.transactionId },
                summary: 'Retrait confirmé par le prestataire après un échec ou une libération des fonds : débit appliqué, vérifier le solde du membre.',
                details: { source, settlement: out.status, reservedDrift: !!out.reservedDrift },
            });
        }
    } catch (error: any) {
        // The payout happened; the transaction stays COMPLETED. Flag it and open a case.
        log.error(`CRITICAL: withdrawal ${tx.transactionId} completed by ${source} but the wallet could not be debited: ${error.message}`);
        await TransactionModel.updateOne(
            { transactionId: tx.transactionId },
            { $set: { 'metadata.balanceUpdateFailed': true, 'metadata.internalFailureReason': `Wallet debit failed after provider success: ${error.message}` } },
        );
        void openSupportCase({
            type: 'debit_missing', dedupKey: `withdrawal:${tx.transactionId}:debit-missing`, severity: 'critical',
            subject: { userId: tx.userId.toString(), transactionId: tx.transactionId },
            summary: 'Retrait réussi chez le prestataire mais solde non débité (erreur interne).',
            details: { source, error: error.message },
        });
    }
}

/**
 * A confirmed end other than success: failed, cancelled, rejected, expired.
 * Releases the reservation when this call made the transition.
 */
export async function endWithdrawal(
    transactionId: string,
    opts: { from: TransactionStatus[]; to: TransactionStatus; set?: Record<string, unknown>; unset?: Record<string, ''>; reason: string },
): Promise<ITransaction | null> {
    const tx = await transitionWithdrawal(transactionId, opts.from, opts.to, opts.set || {}, opts.unset || {});
    if (!tx) {
        log.info(`Withdrawal ${transactionId}: ${opts.to} skipped (status not in ${opts.from.join('/')})`);
        return null;
    }
    await releaseWithdrawalReservation(tx, opts.reason);
    return tx;
}

/** Releases the reservation of an ended withdrawal. Never throws (the nightly reconciliation retries). */
export async function releaseWithdrawalReservation(tx: Pick<ITransaction, 'transactionId' | 'metadata'>, reason: string): Promise<void> {
    try {
        const out = await userServiceClient.releaseWithdrawalFunds(tx.transactionId, reason);
        if (out === 'conflict') {
            log.error(`Reservation of ${tx.transactionId} could not be released (conflict): left for review`);
            return;
        }
        await TransactionModel.updateOne({ transactionId: tx.transactionId }, { $set: out === 'not_reserved'
            ? { 'metadata.reservation.state': 'none' }
            : { 'metadata.reservation.state': 'released', 'metadata.reservation.releasedAt': new Date() } });
    } catch (error: any) {
        log.error(`Reservation of ${tx.transactionId} not released yet (${error.message}); the daily reconciliation retries`);
    }
}

export const isObjectId = (v: unknown): v is string => typeof v === 'string' && Types.ObjectId.isValid(v);
