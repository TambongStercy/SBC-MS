import { Schema, Document, Types, model } from 'mongoose';

/**
 * One row per currency conversion (XAF ⇄ USD). Two ledger legs share its
 * reference: `<reference>:out` (guarded debit) and `<reference>:in` (credit).
 *   started → debited → credited      (abandoned: the debit never happened)
 * `open` is set until the conversion ends; the partial unique {userId} on it
 * means a member has at most one conversion in flight, so a retry of a pending
 * credit can never sit beside a second debit. The conversion retry job
 * (jobs/conversion-retry.job.ts) finishes rows left `started`/`debited`.
 */
export type ConversionState = 'started' | 'debited' | 'credited' | 'abandoned';

export interface IWalletConversion extends Document {
    reference: string;
    userId: Types.ObjectId;
    fromCurrency: 'XAF' | 'USD';
    fromAmount: number;
    toCurrency: 'XAF' | 'USD';
    toAmount: number;
    state: ConversionState;
    open?: boolean;
    attempts: number;
    lastError?: string;
    createdAt: Date;
    updatedAt: Date;
}

const WalletConversionSchema = new Schema<IWalletConversion>(
    {
        reference: { type: String, required: true, unique: true },
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        fromCurrency: { type: String, enum: ['XAF', 'USD'], required: true },
        fromAmount: { type: Number, required: true, min: 0 },
        toCurrency: { type: String, enum: ['XAF', 'USD'], required: true },
        toAmount: { type: Number, required: true, min: 0 },
        state: { type: String, enum: ['started', 'debited', 'credited', 'abandoned'], required: true },
        open: { type: Boolean },
        attempts: { type: Number, default: 0 },
        lastError: { type: String, maxlength: 500 },
    },
    { timestamps: true },
);
WalletConversionSchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { open: true }, name: 'one_open_conversion_per_user' });
WalletConversionSchema.index({ open: 1, updatedAt: 1 });

export const WalletConversionModel = model<IWalletConversion>('WalletConversion', WalletConversionSchema);
export default WalletConversionModel;
