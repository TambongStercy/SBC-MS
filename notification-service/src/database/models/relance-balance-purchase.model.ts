import mongoose, { Schema, Document } from 'mongoose';

/**
 * A relance pack bought with the SBC balance, from before the debit to the end.
 *
 * Written before payment-service takes the money, with a unique reference, so:
 * - two taps on "Payer avec mon solde" (same requestId) make one purchase: the
 *   second insert hits the unique index and waits for the first's outcome;
 * - a restart between the debit and the crediting leaves a `pending` row that
 *   the sweep settles (credited if the credit row exists, otherwise refunded).
 *
 * The reference is also the payment's `balanceSpendRef` in payment-service and
 * the RelancePackCredit `sessionId`, so the three records join on it.
 */
export type RelanceBalancePurchaseStatus =
    | 'pending'       // claimed; the debit and/or the crediting are under way
    | 'credited'      // paid and credited
    | 'insufficient'  // the balance did not cover the pack; nothing was taken
    | 'refunded';     // not credited; the payment was refunded (or nothing was taken)

export interface IRelanceBalancePurchase extends Document {
    reference: string;
    userId: mongoose.Types.ObjectId;
    packId: string;
    amount: number;
    status: RelanceBalancePurchaseStatus;
    createdAt: Date;
    updatedAt: Date;
}

const RelanceBalancePurchaseSchema = new Schema<IRelanceBalancePurchase>(
    {
        reference: { type: String, required: true, unique: true },
        userId: { type: Schema.Types.ObjectId, required: true, index: true },
        packId: { type: String, required: true },
        amount: { type: Number, required: true, min: 1 },
        status: {
            type: String,
            enum: ['pending', 'credited', 'insufficient', 'refunded'],
            required: true,
            default: 'pending',
        },
    },
    { timestamps: true },
);

RelanceBalancePurchaseSchema.index({ status: 1, createdAt: 1 });

const RelanceBalancePurchaseModel = mongoose.model<IRelanceBalancePurchase>(
    'RelanceBalancePurchase',
    RelanceBalancePurchaseSchema,
);

export default RelanceBalancePurchaseModel;
