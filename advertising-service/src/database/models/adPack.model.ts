import mongoose, { Schema, Document, Types } from 'mongoose';

// Interface defining the structure of features within an AdPack
interface IAdPackFeatures {
    reachEstimate?: number;      // Estimated number of users reached (e.g., 1000 for Basic)
    targetingOptions: boolean;  // Can the user select target criteria (region, age, etc.)?
    featuredPlacement: boolean; // Does the ad get priority/featured display?
    verifiedBadgeEligible: boolean; // Can the ad display a verified badge (if user/product is verified)?
    durationDays: number;       // How long the ad runs in days.
    notificationType: 'basic' | 'all' | 'targeted'; // Corresponds to notification logic
    // Add other specific features as needed
}

// Interface defining the AdPack document structure
export interface IAdPack extends Document {
    _id: Types.ObjectId;
    packId: string; // Unique identifier string (e.g., 'basic', 'starter', 'gold')
    name: string;         // User-friendly name (e.g., 'Basic Boost', 'Starter Campaign', 'Gold Targeted Ad')
    description: string;
    price: number;        // Price in XAF
    features: IAdPackFeatures; // Nested object for pack features
    isActive: boolean;    // Is this pack currently available for purchase?
    createdAt: Date;
    updatedAt: Date;
}

// Schema for AdPackFeatures
const AdPackFeaturesSchema = new Schema<IAdPackFeatures>(
    {
        reachEstimate: { type: Number },
        targetingOptions: { type: Boolean, required: true, default: false },
        featuredPlacement: { type: Boolean, required: true, default: false },
        verifiedBadgeEligible: { type: Boolean, required: true, default: false },
        durationDays: { type: Number, required: true, min: 1 },
        notificationType: {
            type: String,
            required: true,
            enum: ['basic', 'all', 'targeted'],
        },
    },
    { _id: false } // No separate ID for the features subdocument
);

// Schema for AdPack
const AdPackSchema = new Schema<IAdPack>(
    {
        packId: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            index: true,
        },
        name: {
            type: String,
            required: true,
            trim: true,
        },
        description: {
            type: String,
            required: true,
        },
        price: {
            type: Number,
            required: true,
            min: 0,
        },
        features: {
            type: AdPackFeaturesSchema,
            required: true,
        },
        isActive: {
            type: Boolean,
            required: true,
            default: true,
            index: true,
        },
    },
    {
        timestamps: true, // Adds createdAt and updatedAt
    }
);

// Create and export the Mongoose model
const AdPackModel = mongoose.model<IAdPack>('AdPack', AdPackSchema);

export default AdPackModel; 