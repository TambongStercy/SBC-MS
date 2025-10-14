import mongoose, { Schema, Document, Types, model } from 'mongoose';

// Enum for different subscription types
export enum SubscriptionType {
    CLASSIQUE = 'CLASSIQUE',
    CIBLE = 'CIBLE',
    RELANCE = 'RELANCE', // Monthly recurring WhatsApp follow-up feature
    // Add other subscription types here
}

// Enum for subscription categories
export enum SubscriptionCategory {
    REGISTRATION = 'registration',  // Main platform access (CLASSIQUE, CIBLE)
    FEATURE = 'feature'              // Add-on features (RELANCE, future features)
}

// Enum for subscription duration types
export enum SubscriptionDuration {
    LIFETIME = 'lifetime',
    MONTHLY = 'monthly',
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
    category: SubscriptionCategory; // NEW: registration or feature
    duration: SubscriptionDuration; // NEW: lifetime or monthly
    nextRenewalDate?: Date; // NEW: For monthly subscriptions
    autoRenew: boolean; // NEW: Auto-charge on renewal (monthly subs only)
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
        category: {
            type: String,
            enum: Object.values(SubscriptionCategory),
            default: SubscriptionCategory.REGISTRATION, // Default to registration for backward compat
            required: true,
            index: true,
        },
        duration: {
            type: String,
            enum: Object.values(SubscriptionDuration),
            default: SubscriptionDuration.LIFETIME, // Default to lifetime for backward compat
            required: true,
        },
        nextRenewalDate: {
            type: Date,
            // Only set for monthly subscriptions
        },
        autoRenew: {
            type: Boolean,
            default: false,
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

// Add compound index for user and category for filtering registration vs feature subscriptions
SubscriptionSchema.index({ user: 1, category: 1 });

// Add compound index for category and status for admin queries
SubscriptionSchema.index({ category: 1, status: 1 });

const SubscriptionModel = model<ISubscription>('Subscription', SubscriptionSchema);

export default SubscriptionModel; 