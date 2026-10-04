import { Types } from 'mongoose';
import { UserRepository } from '../database/repositories/user.repository';
import { EventOrganizerLedgerDirection } from '../database/models/event-organizer-ledger.model';
import { paymentService } from './clients/payment.service.client';
import { AppError } from '../utils/errors';
import logger from '../utils/logger';

const log = logger.getLogger('EventOrganizerBalanceService');

/**
 * Organizer earnings from the SBC Event ticketing marketplace.
 *
 * Held separately from the main balance per product decision, and deliberately
 * NOT directly withdrawable. The only exit is a transfer into the main balance,
 * after which the existing payout path handles it unchanged — same shape as
 * advertisingBalance, for the same "keep the incident-prone payout code
 * untouched" reason.
 */
/**
 * A PENDING ledger row (sequential path only) is normal for the milliseconds a
 * concurrent retry overlaps the first attempt; one that outlives this window
 * is a crash between the ledger insert and the balance move.
 */
const PENDING_STUCK_MS = 2 * 60 * 1000;
const reportPending = (kind: string, reference: string, userId: string, since?: Date) => {
    if (since && Date.now() - since.getTime() < PENDING_STUCK_MS) {
        log.warn(`Event-organizer ${kind} ${reference} for ${userId} is in progress; the caller will retry.`);
    } else {
        log.error(`Event-organizer ${kind} ${reference} is stuck PENDING for ${userId} since ${since?.toISOString()} — check the balance by hand, then mark the row APPLIED or delete it.`);
    }
};

const MIN_TRANSFER_AMOUNT = Number(process.env.EVENT_ORGANIZER_MIN_TRANSFER || 2000);

export class EventOrganizerBalanceService {
    private userRepository = new UserRepository();

    async getBalance(userId: string): Promise<{ eventOrganizerBalance: number; minTransferAmount: number }> {
        const user = await this.userRepository.findById(new Types.ObjectId(userId));
        if (!user) throw new AppError('User not found', 404);

        return {
            eventOrganizerBalance: user.eventOrganizerBalance || 0,
            minTransferAmount: MIN_TRANSFER_AMOUNT,
        };
    }

    /**
     * Credits organizer earnings (primary sale, resale share, paid votes).
     * Service-to-service only; called from event-service.
     *
     * Idempotent on `reference`: event-service's webhooks, reconcilers and
     * sweepers all retry, and its own creditedAt stamp can be lost in a crash
     * between our response and its save. A replay returns the current balance
     * with `alreadyApplied: true` and moves nothing.
     */
    async credit(
        userId: string,
        amount: number,
        reference: string,
        description: string,
    ): Promise<{ newEventOrganizerBalance: number; transactionId: string; alreadyApplied?: boolean }> {
        if (!Number.isFinite(amount) || amount <= 0) {
            throw new AppError('Credit amount must be a positive number', 400);
        }
        if (!Types.ObjectId.isValid(userId)) throw new AppError('Invalid userId', 400);

        const outcome = await this.userRepository.applyEventOrganizerMovement({
            userId, amount, reference, description, direction: EventOrganizerLedgerDirection.CREDIT,
        });
        if (!outcome.user) throw new AppError('User not found', 404);
        if (outcome.pendingConflict) {
            reportPending('credit', reference, userId, outcome.pendingSince);
            throw new AppError(`Credit ${reference} is pending verification`, 409);
        }
        if (!outcome.applied) {
            log.info(`Event-organizer credit ${reference} already applied for ${userId}; nothing moved.`);
            return { newEventOrganizerBalance: outcome.user.eventOrganizerBalance, transactionId: '', alreadyApplied: true };
        }
        const updated = outcome.user;

        let transactionId = '';
        try {
            const tx = await paymentService.recordActivationTransaction({
                userId,
                type: 'event_organizer_earnings',
                amount,
                description,
                metadata: {
                    reference,
                    newEventOrganizerBalance: updated.eventOrganizerBalance,
                },
            });
            transactionId = tx.transactionId;
        } catch (error: any) {
            // The credit already landed. Losing the audit row is bad but reversing
            // an organizer's earnings because logging failed would be worse.
            log.error(`Failed to record event-organizer credit for ${userId}: ${error.message}`);
        }

        log.info(`Credited ${amount} XAF event-organizer earnings to ${userId} (ref: ${reference})`);
        return { newEventOrganizerBalance: updated.eventOrganizerBalance, transactionId };
    }

    /**
     * Debit the seller's event-organizer balance during a resale refund.
     * Allowed to go negative — the seller may have already transferred out;
     * the negative balance will be reconciled by future earnings or by admin
     * action, and it naturally blocks further transfers (guarded by $gte).
     */
    async debit(
        userId: string,
        amount: number,
        reference: string,
        description: string,
    ): Promise<{ newEventOrganizerBalance: number; wentNegative: boolean; transactionId: string; alreadyApplied?: boolean }> {
        if (!Number.isFinite(amount) || amount <= 0) {
            throw new AppError('Debit amount must be a positive number', 400);
        }
        if (!Types.ObjectId.isValid(userId)) throw new AppError('Invalid userId', 400);

        // Idempotent on `reference`, like credit().
        const outcome = await this.userRepository.applyEventOrganizerMovement({
            userId, amount, reference, description, direction: EventOrganizerLedgerDirection.DEBIT,
        });
        if (!outcome.user) throw new AppError('User not found', 404);
        if (outcome.pendingConflict) {
            reportPending('debit', reference, userId, outcome.pendingSince);
            throw new AppError(`Debit ${reference} is pending verification`, 409);
        }
        if (!outcome.applied) {
            log.info(`Event-organizer debit ${reference} already applied for ${userId}; nothing moved.`);
            const balance = outcome.user.eventOrganizerBalance;
            return { newEventOrganizerBalance: balance, wentNegative: balance < 0, transactionId: '', alreadyApplied: true };
        }
        const updated = outcome.user;

        const wentNegative = updated.eventOrganizerBalance < 0;

        let transactionId = '';
        try {
            const tx = await paymentService.recordActivationTransaction({
                userId,
                type: 'event_organizer_transfer_out',
                amount,
                description,
                metadata: {
                    reference,
                    kind: 'resale_refund_debit',
                    newEventOrganizerBalance: updated.eventOrganizerBalance,
                    wentNegative,
                },
            });
            transactionId = tx.transactionId;
        } catch (error: any) {
            log.error(`Failed to record event-organizer debit for ${userId}: ${error.message}`);
        }

        log.info(`Debited ${amount} XAF from event-organizer balance of ${userId} (ref: ${reference}); newBalance=${updated.eventOrganizerBalance}`);
        return { newEventOrganizerBalance: updated.eventOrganizerBalance, wentNegative, transactionId };
    }

    /** Moves event-organizer earnings into the main balance, where they can be withdrawn. */
    async transferToMain(
        userId: string,
        amount: number,
        ipAddress?: string,
    ): Promise<{ newBalance: number; newEventOrganizerBalance: number; transactionId: string }> {
        if (!Number.isFinite(amount) || amount <= 0) {
            throw new AppError('Transfer amount must be a positive number', 400);
        }
        if (amount < MIN_TRANSFER_AMOUNT) {
            throw new AppError(
                `Le montant minimum de transfert est de ${MIN_TRANSFER_AMOUNT} XAF.`,
                400,
            );
        }

        const user = await this.userRepository.findById(new Types.ObjectId(userId));
        if (!user) throw new AppError('User not found', 404);

        if ((user.eventOrganizerBalance || 0) < amount) {
            throw new AppError(
                `Solde organisateur insuffisant. Disponible: ${user.eventOrganizerBalance || 0} XAF, Requis: ${amount} XAF`,
                400,
            );
        }

        // Same guard as advertisingBalance and activationBalance: SBC debits on
        // success, so a pending withdrawal already reserves funds in `balance`.
        // Topping up under that figure would cascade the wallet negative when the
        // withdrawal reconciles.
        const hasPendingWithdrawal = await paymentService.hasUserPendingWithdrawal(userId);
        if (hasPendingWithdrawal) {
            throw new AppError(
                "Un retrait est en cours de traitement sur votre compte. Veuillez attendre qu'il soit complété avant de transférer vos gains organisateur.",
                409,
            );
        }

        const updated = await this.userRepository.transferEventOrganizerToMain(userId, amount);
        // null means the atomic precondition failed — a concurrent transfer won.
        if (!updated) {
            throw new AppError('Solde organisateur insuffisant. Veuillez réessayer.', 400);
        }

        let transactionId = '';
        try {
            const tx = await paymentService.recordActivationTransaction({
                userId,
                type: 'event_organizer_transfer_out',
                amount,
                description: `Transfert de ${amount} XAF des gains organisateur vers le solde principal`,
                metadata: {
                    previousBalance: user.balance,
                    newBalance: updated.balance,
                    previousEventOrganizerBalance: user.eventOrganizerBalance || 0,
                    newEventOrganizerBalance: updated.eventOrganizerBalance,
                },
                ipAddress,
            });
            transactionId = tx.transactionId;
        } catch (error: any) {
            log.error(`Failed to record event-organizer transfer for ${userId}: ${error.message}`);
        }

        log.info(
            `Transferred ${amount} XAF from event-organizer to main for ${userId}. ` +
            `Event: ${updated.eventOrganizerBalance}, Main: ${updated.balance}`,
        );

        return {
            newBalance: updated.balance,
            newEventOrganizerBalance: updated.eventOrganizerBalance,
            transactionId,
        };
    }
}

export const eventOrganizerBalanceService = new EventOrganizerBalanceService();
