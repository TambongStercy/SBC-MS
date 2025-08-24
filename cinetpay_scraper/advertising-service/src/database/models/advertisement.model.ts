import mongoose, { Schema, Document, Types } from 'mongoose';

// Enum for Advertisement Status
export enum AdStatus {
    PENDING_PAYMENT = 'pending_payment', // Initial state before payment confirmation
    PENDING_APPROVAL = 'pending_approval', // Optional: if admin approval is needed
    ACTIVE = 'active',               // Approved and currently running
    PAUSED = 'paused',               // Temporarily stopped by user or admin
    COMPLETED = 'completed',           // Finished its duration
    REJECTED = 'rejected',             // If admin approval step exists
    CANCELLED = 'cancelled',           // Cancelled by user before completion
    PAYMENT_FAILED = 'payment_failed'     // If payment failed
}

// Interface for Targeting Criteria (to be expanded in Phase 2)
interface ITargetCriteria {
    regions?: string[];
    minAge?: number;
    maxAge?: number;
    sex?: 'male' | 'female' | 'other'; // Based on UserSex enum potentially
    interests?: string[];
    professions?: string[];
    // Add other criteria as needed
}

// Interface defining the Advertisement document structure
export interface IAdvertisement extends Document {
    _id: Types.ObjectId;
    advertisementId: string; // Unique ID for this specific ad (e.g., nanoid)
    userId: Types.ObjectId;    // User who created the ad
    adPackId: Types.ObjectId;  // Reference to the purchased AdPack
    paymentIntentId?: string; // Link to the payment transaction
    status: AdStatus;        // Current status of the advertisement
    content: {
        title?: string;
        text: string;
        imageUrl?: string;
        callToActionUrl?: string;
    };
    targetCriteria?: ITargetCriteria; // Targeting info (initially optional)
    isFeatured: boolean;        // Based on the pack purchased
    hasVerifiedBadge: boolean;  // Granted based on pack and user/product status
    startDate?: Date;          // When the ad becomes active
    endDate?: Date;            // Calculated based on startDate and pack duration
    rejectionReason?: string;  // If status is REJECTED
    // Analytics (optional - could be separate collection)
    impressions?: number;
    clicks?: number;
    // Timestamps
    createdAt: Date;
    updatedAt: Date;
}

// Schema for Targeting Criteria
const TargetCriteriaSchema = new Schema<ITargetCriteria>(
    {
        regions: [{ type: String, trim: true, lowercase: true }],
        minAge: { type: Number, min: 13 },
        maxAge: { type: Number },
        sex: { type: String, enum: ['male', 'female', 'other'] },
        interests: [{ type: String, trim: true }],
        professions: [{ type: String, trim: true }],
    },
    { _id: false }
);

// Schema for Advertisement Content
const AdContentSchema = new Schema(
    {
        title: { type: String, trim: true },
        text: { type: String, required: true, trim: true },
        imageUrl: { type: String }, // Consider validation (URL format)
        callToActionUrl: { type: String }, // Consider validation
    },
    { _id: false }
);

// Schema for Advertisement
const AdvertisementSchema = new Schema<IAdvertisement>(
    {
        advertisementId: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        userId: {
            type: Schema.Types.ObjectId,
            required: true,
            index: true,
        },
        adPackId: {
            type: Schema.Types.ObjectId,
            ref: 'AdPack',
            required: true,
            index: true,
        },
        paymentIntentId: {
            type: String,
            index: true,
        },
        status: {
            type: String,
            enum: Object.values(AdStatus),
            required: true,
            default: AdStatus.PENDING_PAYMENT,
            index: true,
        },
        content: {
            type: AdContentSchema,
            required: true,
        },
        targetCriteria: {
            type: TargetCriteriaSchema,
        },
        isFeatured: {
            type: Boolean,
            required: true,
            default: false,
        },
        hasVerifiedBadge: {
            type: Boolean,
            required: true,
            default: false,
        },
        startDate: {
            type: Date,
        },
        endDate: {
            type: Date,
            index: true, // Index for finding completed/expired ads
        },
        rejectionReason: {
            type: String,
            trim: true,
        },
        impressions: { type: Number, default: 0 },
        clicks: { type: Number, default: 0 },
    },
    {
        timestamps: true,
    }
);

// Create and export the Mongoose model
const AdvertisementModel = mongoose.model<IAdvertisement>('Advertisement', AdvertisementSchema);

export default AdvertisementModel; 