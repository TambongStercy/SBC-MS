import { Schema, model, Document, Types } from 'mongoose';

/**
 * One row per payment that activates a subscription (CLASSIQUE, CIBLE, the
 * CLASSIQUE→CIBLE upgrade, RELANCE, VISIBILITE_MAX), keyed by the payment
 * sessionId. Written BEFORE the subscription is touched: the unique sessionId
 * means a replayed or concurrent payment callback activates, extends and pays
 * commissions once. Same mechanism as `productpayments` (products.service.ts).
 *
 * - `applying`: reserved, activation running. Released (deleted) if it fails,
 *   so the next delivery of the same payment can apply it.
 * - `applied`: done; any later delivery of this sessionId is acknowledged
 *   without doing anything.
 *
 * New collection, no backfill: payments activated before it existed have no
 * row, which only matters if their callback is replayed, and then the older
 * "already has an active subscription" guard still applies.
 */
export type SubscriptionActivationStatus = 'applying' | 'applied';

export interface ISubscriptionActivation extends Document {
    sessionId: string;
    userId: Types.ObjectId;
    planId: string;
    isUpgrade: boolean;
    status: SubscriptionActivationStatus;
    reservedAt: Date;
    appliedAt?: Date;
    subscriptionId?: Types.ObjectId;
    /** The user already had a subscription covering this payment: nothing was created, no commission paid. */
    alreadyActive?: boolean;
    attempts: number;
    createdAt: Date;
    updatedAt: Date;
}

const schema = new Schema<ISubscriptionActivation>({
    sessionId: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    planId: { type: String, required: true },
    isUpgrade: { type: Boolean, default: false },
    status: { type: String, enum: ['applying', 'applied'], required: true },
    reservedAt: { type: Date, required: true },
    appliedAt: Date,
    subscriptionId: Schema.Types.ObjectId,
    alreadyActive: Boolean,
    attempts: { type: Number, default: 1 },
}, { timestamps: true });

export default model<ISubscriptionActivation>('SubscriptionActivation', schema);
