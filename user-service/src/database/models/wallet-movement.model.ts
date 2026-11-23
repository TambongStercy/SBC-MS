import { Schema, Document, Types, model } from 'mongoose';

/**
 * Append-only journal of every change of the six member balances (see
 * WALLET_FIELDS): `users.balance` (XAF), `usdBalance` (USD), and since
 * 2026-11-23 `activationBalance`, `advertisingBalance`, `eventOrganizerBalance`
 * and `sbcLiveBalance`. Written by services/wallet-ledger.service.ts only.
 *
 * `currency` names the balance (the four extra ones are XAF money). Their
 * references carry a prefix (`act:`, `adv:`, `evt:`, `live:`), so one business
 * event that moves two balances (main → activation) leaves two rows that can
 * never be mistaken for a movement and its undo.
 *
 * - The unique {reference, direction} makes a replayed credit or debit a no-op:
 *   `withdrawal:<txId>` can be debited once, whoever retries.
 * - PENDING exists between the claim (insert) and the balance update; APPLIED
 *   once the balance moved. Prod Mongo is a standalone server (no
 *   transactions), so a crash in that window leaves a PENDING row that the
 *   nightly ledger check reports — never a guess.
 * - Nothing updates a row after APPLIED and nothing deletes one, except the
 *   ledger service removing its own PENDING claim when the guarded update
 *   matched nothing (insufficient funds, unknown user): nothing moved.
 *
 * Invariant checked nightly (jobs/ledger-check.job.ts):
 *   opening balance (walletopeningbalances) + Σ signed APPLIED amounts since
 *   the snapshot = current balance.
 */
export enum WalletMovementDirection {
    CREDIT = 'CREDIT',
    DEBIT = 'DEBIT',
}

export enum WalletMovementStatus {
    PENDING = 'PENDING',
    APPLIED = 'APPLIED',
}

export type WalletCurrency = 'XAF' | 'USD' | 'ACTIVATION' | 'ADVERTISING' | 'EVENT_ORGANIZER' | 'SBC_LIVE';
export const WALLET_CURRENCIES: WalletCurrency[] = ['XAF', 'USD', 'ACTIVATION', 'ADVERTISING', 'EVENT_ORGANIZER', 'SBC_LIVE'];
export const isWalletCurrency = (v: unknown): v is WalletCurrency => WALLET_CURRENCIES.includes(v as WalletCurrency);

/** The users field each journalled balance lives in. */
export const WALLET_FIELDS: Record<WalletCurrency, string> = {
    XAF: 'balance',
    USD: 'usdBalance',
    ACTIVATION: 'activationBalance',
    ADVERTISING: 'advertisingBalance',
    EVENT_ORGANIZER: 'eventOrganizerBalance',
    SBC_LIVE: 'sbcLiveBalance',
};

/** Reference namespace of each balance (the main XAF/USD ones keep the bare reference). */
export const WALLET_REF_PREFIX: Record<WalletCurrency, string> = {
    XAF: '', USD: '', ACTIVATION: 'act:', ADVERTISING: 'adv:', EVENT_ORGANIZER: 'evt:', SBC_LIVE: 'live:',
};

/** The money's real currency (Blnk balances are opened in it). */
export const moneyCurrencyOf = (c: WalletCurrency): 'XAF' | 'USD' => (c === 'USD' ? 'USD' : 'XAF');

export interface IWalletMovement extends Document {
    reference: string;
    direction: WalletMovementDirection;
    userId: Types.ObjectId;
    currency: WalletCurrency;
    /** Absolute change of the balance field. 0 when a credit only paid debt. */
    amount: number;
    /** What the caller asked for (signed). Differs from the change when debt absorbed part of a credit. */
    requestedAmount: number;
    /** Change of users.debt made by the same update (signed, XAF). */
    debtDelta?: number;
    balanceBefore?: number;
    balanceAfter?: number;
    /** Who asked: 'payment-service:deposit', 'withdrawal', 'admin-adjust', 'activation-transfer'... */
    source: string;
    description?: string;
    status: WalletMovementStatus;
    appliedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const WalletMovementSchema = new Schema<IWalletMovement>(
    {
        reference: { type: String, required: true, maxlength: 200 },
        direction: { type: String, enum: Object.values(WalletMovementDirection), required: true },
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        currency: { type: String, enum: WALLET_CURRENCIES, required: true },
        amount: { type: Number, required: true, min: 0 },
        requestedAmount: { type: Number, required: true },
        debtDelta: { type: Number },
        balanceBefore: { type: Number },
        balanceAfter: { type: Number },
        source: { type: String, required: true, maxlength: 100 },
        description: { type: String, maxlength: 500 },
        status: { type: String, enum: Object.values(WalletMovementStatus), required: true },
        appliedAt: { type: Date },
    },
    { timestamps: true },
);

WalletMovementSchema.index({ reference: 1, direction: 1 }, { unique: true });
WalletMovementSchema.index({ userId: 1, currency: 1, appliedAt: 1 });
WalletMovementSchema.index({ status: 1, createdAt: 1 });

export const WalletMovementModel = model<IWalletMovement>('WalletMovement', WalletMovementSchema);
export default WalletMovementModel;
