import { Schema, Document, Types, model } from 'mongoose';
import { SubscriptionType } from './subscription.model';

/**
 * Interface for Sponsored Activation document
 * Tracks when a user sponsors (pays for) another user's account activation
 * using their activation balance
 */
export interface ISponsoredActivation extends Document {
    _id: Types.ObjectId;
    sponsor: Types.ObjectId;            // User who paid for the activation
    beneficiary: Types.ObjectId;        // User whose account was activated
    subscriptionType: SubscriptionType; // CLASSIQUE, CIBLE, or UPGRADE (treated as CIBLE)
    amount: number;                     // Amount deducted from sponsor's activation balance (XAF)
    subscription: Types.ObjectId;       // Reference to the created subscription
    transactionId: string;              // Reference to payment-service transaction for audit
    createdAt: Date;
    updatedAt: Date;
}

const SponsoredActivationSchema = new Schema<ISponsoredActivation>(
    {
        sponsor: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        beneficiary: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        subscriptionType: {
            type: String,
            enum: Object.values(SubscriptionType),
            required: true
        },
        amount: {
            type: Number,
            required: true,
            min: 0
        },
        subscription: {
            type: Schema.Types.ObjectId,
            ref: 'Subscription',
            required: true
        },
        transactionId: {
            type: String,
            required: true,
            index: true
        }
    },
    {
        timestamps: true, // Automatically manage createdAt and updatedAt
        collection: 'sponsoredactivations'
    }
);

// Compound indexes for common queries
SponsoredActivationSchema.index({ sponsor: 1, createdAt: -1 }); // Sponsor's activation history
SponsoredActivationSchema.index({ beneficiary: 1, createdAt: -1 }); // Beneficiary lookup

export const SponsoredActivationModel = model<ISponsoredActivation>('SponsoredActivation', SponsoredActivationSchema);
