import { Schema, Document, Types, model } from 'mongoose';

/**
 * Opening balances for the wallet ledger, one per {user, currency}, written
 * once by scripts/snapshot-opening-balances.ts --apply. Movements applied after
 * `snapshotAt` are added to it by the nightly ledger check.
 */
export interface IWalletOpeningBalance extends Document {
    userId: Types.ObjectId;
    currency: 'XAF' | 'USD';
    amount: number;
    debt?: number;
    snapshotAt: Date;
    createdAt: Date;
}

const WalletOpeningBalanceSchema = new Schema<IWalletOpeningBalance>(
    {
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        currency: { type: String, enum: ['XAF', 'USD'], required: true },
        amount: { type: Number, required: true },
        debt: { type: Number },
        snapshotAt: { type: Date, required: true },
    },
    { timestamps: { createdAt: true, updatedAt: false } },
);

WalletOpeningBalanceSchema.index({ userId: 1, currency: 1 }, { unique: true });

export const WalletOpeningBalanceModel = model<IWalletOpeningBalance>('WalletOpeningBalance', WalletOpeningBalanceSchema);
export default WalletOpeningBalanceModel;
