import mongoose, { Schema, Document, Types, model } from 'mongoose';

// Enum for different subscription types
export enum SubscriptionType {
    CLASSIQUE = 'CLASSIQUE',
    CIBLE = 'CIBLE',
    // Add other subscription types here
}

// Enum for subscription status
export enum SubscriptionStatus {
    ACTIVE = 'active',
    EXPIRED = 'expired',
    CANCELLED = 'cancelled',
}

// Interface defining the Subscription document structure
export interface ISubscription extends Document {
    _id: Types.ObjectId;
    user: Types.ObjectId; // Ref to 'User'
    subscriptionType: SubscriptionType;
    // planIdentifier: string; // Remove this field
    startDate: Date;
    endDate: Date;
    status: SubscriptionStatus;
    metadata?: Record<string, any>; // Keep for potential future use
    createdAt: Date;
    updatedAt: Date;
}

const SubscriptionSchema = new Schema<ISubscription>(
    {
        user: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true, // Index for querying by user
        },
        subscriptionType: {
            type: String,
            required: true,
            enum: Object.values(SubscriptionType), // Use updated enum values
            index: true,
        },
        // planIdentifier: { // Remove this field from schema
        //     type: String,
        //     required: true,
        //     trim: true,
        // },
        startDate: {
            type: Date,
            required: true,
            default: Date.now,
        },
        endDate: {
            type: Date,
            required: true,
            index: true, // Index for finding expired subscriptions
        },
        status: {
            type: String,
            enum: Object.values(SubscriptionStatus),
            default: SubscriptionStatus.ACTIVE,
            index: true,
        },
        metadata: {
            type: Schema.Types.Mixed, // Allows storing arbitrary object data
        },
    },
    {
        timestamps: true, // Adds createdAt and updatedAt
    }
);

// Add compound index for status and endDate for querying active subscriptions
SubscriptionSchema.index({ status: 1, endDate: 1 });

// Add index for user and subscriptionType for faster lookups of specific user subscriptions
SubscriptionSchema.index({ user: 1, subscriptionType: 1 });

// Add compound index for user, status, and endDate for countActiveSubs in ReferralRepository
SubscriptionSchema.index({ user: 1, status: 1, endDate: 1 });

const SubscriptionModel = model<ISubscription>('Subscription', SubscriptionSchema);

export default SubscriptionModel; 