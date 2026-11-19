import { Types } from 'mongoose';
import UserModel from '../database/models/user.model';
import BalanceReservationModel, { IBalanceReservation, ReservationState } from '../database/models/balance-reservation.model';
import { walletLedger } from './wallet-ledger.service';
import logger from '../utils/logger';

const log = logger.getLogger('BalanceReservation');

/**
 * Withdrawal reservations (contract §2.2, plan §3 « Réservation des fonds »).
 *
 * The member's balance is still debited only when the provider confirms the
 * payout (debit-on-success), but from the moment a withdrawal is requested its
 * gross amount is no longer available anywhere else: a second withdrawal, a
 * balance payment or a transfer sees balance - debt - reservedBalance.
 *
 * All operations are keyed by the payment-service transactionId and idempotent.
 * See balance-reservation.model.ts for the state machine and write ordering.
 */

export type Currency = 'XAF' | 'USD';

export type ReserveResult =
    | { status: 'reserved' | 'already_reserved'; reservation: IBalanceReservation }
    | { status: 'insufficient' | 'user_not_found' }
    | { status: 'conflict'; reason: string; reservation?: IBalanceReservation };

export type ReleaseResult =
    | { status: 'released' | 'already_released' | 'not_reserved'; reservation?: IBalanceReservation | null }
    | { status: 'conflict'; reason: string; reservation?: IBalanceReservation };

export type ConvertResult =
    | { status: 'converted' | 'already_converted' | 'debited_unreserved'; reservation?: IBalanceReservation | null; balanceAfter?: number; lateAfterRelease?: boolean; reservedDrift?: boolean }
    | { status: 'conflict'; reason: string; reservation?: IBalanceReservation | null };

const reservedField = (currency: Currency) => (currency === 'USD' ? 'reservedUsdBalance' : 'reservedBalance');

/** Available = balance - debt - reserved (XAF); usdBalance - reservedUsd (USD). */
const availableExpr = (currency: Currency) => currency === 'USD'
    ? { $subtract: [{ $ifNull: ['$usdBalance', 0] }, { $ifNull: ['$reservedUsdBalance', 0] }] }
    : { $subtract: [{ $subtract: [{ $ifNull: ['$balance', 0] }, { $ifNull: ['$debt', 0] }] }, { $ifNull: ['$reservedBalance', 0] }] };

class BalanceReservationService {
    async get(transactionId: string): Promise<IBalanceReservation | null> {
        return BalanceReservationModel.findOne({ transactionId }).exec();
    }

    async available(userId: string): Promise<{ balance: number; debt: number; reservedBalance: number; available: number; usdBalance: number; reservedUsdBalance: number; availableUsd: number } | null> {
        const u = await UserModel.findById(userId).select('balance debt reservedBalance usdBalance reservedUsdBalance').lean();
        if (!u) return null;
        const balance = u.balance ?? 0;
        const debt = Math.max(0, u.debt ?? 0);
        const reservedBalance = u.reservedBalance ?? 0;
        const usdBalance = u.usdBalance ?? 0;
        const reservedUsdBalance = u.reservedUsdBalance ?? 0;
        return {
            balance, debt, reservedBalance, available: balance - debt - reservedBalance,
            usdBalance, reservedUsdBalance, availableUsd: usdBalance - reservedUsdBalance,
        };
    }

    async reserve(input: { transactionId: string; userId: string; amount: number; currency: Currency }): Promise<ReserveResult> {
        const { transactionId, userId, currency } = input;
        const amount = Number(input.amount);
        if (!transactionId || !Types.ObjectId.isValid(userId) || !(amount > 0) || !['XAF', 'USD'].includes(currency)) {
            throw Object.assign(new Error('Invalid reservation request'), { statusCode: 400 });
        }

        try {
            await BalanceReservationModel.create({
                transactionId, userId: new Types.ObjectId(userId), currency, amount, state: ReservationState.RESERVING,
            });
        } catch (err: any) {
            if (err?.code !== 11000) throw err;
            const existing = await this.get(transactionId);
            if (!existing) return { status: 'conflict', reason: 'reservation vanished during claim' };
            const same = existing.userId.toString() === userId && existing.currency === currency && Math.abs(existing.amount - amount) < 0.005;
            if (!same) return { status: 'conflict', reason: 'another reservation exists for this transaction', reservation: existing };
            if ([ReservationState.HELD, ReservationState.CONVERTING, ReservationState.CONVERTED].includes(existing.state)) {
                return { status: 'already_reserved', reservation: existing };
            }
            return { status: 'conflict', reason: `reservation is ${existing.state}`, reservation: existing };
        }

        const field = reservedField(currency);
        const updated = await UserModel.findOneAndUpdate(
            { _id: userId, $expr: { $gte: [availableExpr(currency), amount] } },
            { $inc: { [field]: amount } },
            { new: true },
        ).exec();

        if (!updated) {
            await BalanceReservationModel.deleteOne({ transactionId, state: ReservationState.RESERVING });
            const exists = await UserModel.exists({ _id: userId });
            log.info(`Reservation refused for ${transactionId} (user ${userId}, ${amount} ${currency}): ${exists ? 'insufficient available balance' : 'user not found'}`);
            return { status: exists ? 'insufficient' : 'user_not_found' };
        }

        const held = await BalanceReservationModel.findOneAndUpdate(
            { transactionId, state: ReservationState.RESERVING },
            { $set: { state: ReservationState.HELD } },
            { new: true },
        ).exec();
        log.info(`Reserved ${amount} ${currency} for withdrawal ${transactionId} (user ${userId})`);
        return { status: 'reserved', reservation: held as IBalanceReservation };
    }

    async release(transactionId: string, reason: string): Promise<ReleaseResult> {
        const row = await BalanceReservationModel.findOneAndUpdate(
            { transactionId, state: ReservationState.HELD },
            { $set: { state: ReservationState.RELEASED, releasedAt: new Date(), reason: (reason || '').slice(0, 500) } },
            { new: true },
        ).exec();

        if (!row) {
            const existing = await this.get(transactionId);
            if (!existing) return { status: 'not_reserved', reservation: null };
            if (existing.state === ReservationState.RELEASED) return { status: 'already_released', reservation: existing };
            return { status: 'conflict', reason: `cannot release a reservation that is ${existing.state}`, reservation: existing };
        }

        const field = reservedField(row.currency);
        const res = await UserModel.updateOne(
            { _id: row.userId, [field]: { $gte: row.amount - 0.005 } },
            { $inc: { [field]: -row.amount } },
        ).exec();
        if (res.modifiedCount !== 1) {
            // Funds stay locked rather than becoming spendable twice; the nightly check reports it.
            log.error(`CRITICAL: reservation ${transactionId} released but ${field} of user ${row.userId} is below ${row.amount}; left unchanged for review`);
        } else {
            log.info(`Released ${row.amount} ${row.currency} for withdrawal ${transactionId} (${reason})`);
        }
        return { status: 'released', reservation: row };
    }

    /**
     * Payout confirmed: debit the balance and drop the reservation in one write
     * (ledger reference `withdrawal:<txId>`). A withdrawal without reservation
     * (created before this change) — or one whose reservation was released
     * before a late provider success — is debited plainly under the same
     * reference, so the debit can still happen only once.
     */
    async convert(input: { transactionId: string; userId: string; amount: number; currency: Currency; description?: string }): Promise<ConvertResult> {
        const { transactionId } = input;
        const reference = `withdrawal:${transactionId}`;

        const claimed: IBalanceReservation | null = await BalanceReservationModel.findOneAndUpdate(
            { transactionId, state: ReservationState.HELD },
            { $set: { state: ReservationState.CONVERTING } },
            { new: true },
        ).exec();
        let row: IBalanceReservation;

        if (claimed) {
            row = claimed;
        } else {
            const existing = await this.get(transactionId);
            if (existing?.state === ReservationState.CONVERTED) return { status: 'already_converted', reservation: existing };
            if (existing?.state === ReservationState.RESERVING) {
                return { status: 'conflict', reason: 'reservation is still being created', reservation: existing };
            }
            if (existing?.state === ReservationState.CONVERTING) {
                row = existing; // resume an interrupted conversion; the ledger reference keeps it single
            } else {
                // No reservation, or released before a late success.
                const amount = Number(existing?.amount ?? input.amount);
                const currency = (existing?.currency ?? input.currency) as Currency;
                const userId = existing?.userId?.toString() ?? input.userId;
                if (!(amount > 0) || !Types.ObjectId.isValid(userId)) {
                    return { status: 'conflict', reason: 'no reservation and no valid amount/user to debit', reservation: existing };
                }
                const out = await walletLedger.applyInc({
                    userId, currency, delta: -amount, reference,
                    source: existing ? 'withdrawal-after-release' : 'withdrawal-unreserved',
                    description: input.description || `Retrait ${transactionId}`,
                });
                if (out.pendingConflict) return { status: 'conflict', reason: 'ledger movement pending review', reservation: existing };
                if (out.userNotFound) return { status: 'conflict', reason: 'user not found', reservation: existing };
                log.warn(`Withdrawal ${transactionId} debited without a held reservation (${existing ? 'reservation was released' : 'none'})`);
                return { status: out.alreadyApplied ? 'already_converted' : 'debited_unreserved', reservation: existing, balanceAfter: out.balanceAfter, lateAfterRelease: !!existing };
            }
        }

        const field = reservedField(row.currency);
        let out = await walletLedger.applyInc({
            userId: row.userId, currency: row.currency, delta: -row.amount, reference,
            guard: { [field]: { $gte: row.amount - 0.005 } },
            extraInc: { [field]: -row.amount },
            source: 'withdrawal',
            description: input.description || `Retrait ${transactionId}`,
        });
        let reservedDrift = false;
        if (out.guardFailed) {
            // reservedBalance lower than the reservation (data drift): debit anyway,
            // leave reservedBalance alone (locks, never frees) and report.
            reservedDrift = true;
            log.error(`CRITICAL: converting ${transactionId}: ${field} below ${row.amount}; debiting balance without touching ${field}`);
            out = await walletLedger.applyInc({
                userId: row.userId, currency: row.currency, delta: -row.amount, reference,
                source: 'withdrawal', description: input.description || `Retrait ${transactionId}`,
            });
        }
        if (out.pendingConflict || out.userNotFound) {
            return { status: 'conflict', reason: out.pendingConflict ? 'ledger movement pending review' : 'user not found', reservation: row };
        }
        const done = await BalanceReservationModel.findOneAndUpdate(
            { transactionId, state: ReservationState.CONVERTING },
            { $set: { state: ReservationState.CONVERTED, convertedAt: new Date() } },
            { new: true },
        ).exec();
        log.info(`Converted reservation ${transactionId}: ${row.amount} ${row.currency} debited (${out.alreadyApplied ? 'replay' : 'applied'})`);
        return { status: out.alreadyApplied ? 'already_converted' : 'converted', reservation: done ?? row, balanceAfter: out.balanceAfter, reservedDrift };
    }
}

export const balanceReservationService = new BalanceReservationService();
export default balanceReservationService;
