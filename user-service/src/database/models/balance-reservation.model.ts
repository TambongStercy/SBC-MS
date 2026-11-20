import { Schema, Document, Types, model } from 'mongoose';

/**
 * One row per withdrawal that holds part of a member's balance
 * (payment-service transactionId). The unique transactionId makes reserve,
 * release and convert idempotent; every state change is a conditional update
 * on the expected state.
 *
 *   reserving ──► held ──► released     (failure, rejection, expiry, cancellation)
 *                   └────► converting ──► converted   (payout succeeded: balance debited)
 *
 * Writes are ordered so that a crash between two steps can only leave money
 * LOCKED (reservedBalance too high), never spendable twice:
 *   reserve: insert 'reserving' → $inc reservedBalance → 'held'
 *   release: 'held' → 'released' → $inc reservedBalance -amount
 *   convert: 'held' → 'converting' → ledger debit (balance & reservedBalance) → 'converted'
 * A row stuck in 'reserving', 'converting' or a reservedBalance that differs
 * from Σ held is reported by the nightly ledger check.
 */
export enum ReservationState {
    RESERVING = 'reserving',
    HELD = 'held',
    RELEASED = 'released',
    CONVERTING = 'converting',
    CONVERTED = 'converted',
}

export interface IBalanceReservation extends Document {
    transactionId: string;
    userId: Types.ObjectId;
    currency: 'XAF' | 'USD';
    amount: number;
    state: ReservationState;
    reason?: string;
    releasedAt?: Date;
    convertedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const BalanceReservationSchema = new Schema<IBalanceReservation>(
    {
        transactionId: { type: String, required: true, maxlength: 100 },
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        currency: { type: String, enum: ['XAF', 'USD'], required: true },
        amount: { type: Number, required: true, min: 0 },
        state: { type: String, enum: Object.values(ReservationState), required: true },
        reason: { type: String, maxlength: 500 },
        releasedAt: { type: Date },
        convertedAt: { type: Date },
    },
    { timestamps: true },
);

BalanceReservationSchema.index({ transactionId: 1 }, { unique: true });
BalanceReservationSchema.index({ userId: 1, state: 1 });
BalanceReservationSchema.index({ state: 1, updatedAt: 1 });

export const BalanceReservationModel = model<IBalanceReservation>('BalanceReservation', BalanceReservationSchema);
export default BalanceReservationModel;
