import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * Relance delivery channel - now email-only
 * Kept as enum for potential future expansion
 */
export enum RelanceChannel {
    EMAIL = 'email'
}

/**
 * RelanceConfig Interface
 * Stores relance configuration for each user (email-based)
 */
export interface IRelanceConfig extends Document {
    _id: Types.ObjectId;
    userId: Types.ObjectId;                  // SBC member who owns this config
    enabled: boolean;                         // Master switch (pauses everything)
    enrollmentPaused: boolean;                // Only pause new enrollments
    sendingPaused: boolean;                   // Only pause message sending

    // Campaign control
    defaultCampaignPaused: boolean;          // Pause default auto-enrollment campaign
    allowSimultaneousCampaigns: boolean;      // Allow default + filtered to run together

    // Delivery channel (email)
    channel: RelanceChannel;                  // Currently only EMAIL

    // Rate limiting
    messagesSentToday: number;                // Rate limiting counter
    lastResetDate: Date;                      // When counter was last reset

    // Safety limits
    maxMessagesPerDay: number;                // User-configurable daily limit (default 60 for email)
    maxTargetsPerCampaign: number;            // Max targets per filtered campaign (default 500)

    createdAt: Date;
    updatedAt: Date;
}

/**
 * RelanceConfig Schema
 */
const RelanceConfigSchema = new Schema<IRelanceConfig>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            required: true,
            unique: true,  // One config per user
            index: true
        },
        enabled: {
            type: Boolean,
            default: true
        },
        enrollmentPaused: {
            type: Boolean,
            default: false
        },
        sendingPaused: {
            type: Boolean,
            default: false
        },

        // Campaign control
        defaultCampaignPaused: {
            type: Boolean,
            default: false
        },
        allowSimultaneousCampaigns: {
            type: Boolean,
            default: false  // By default, filtered campaigns pause default
        },

        // Delivery channel
        channel: {
            type: String,
            enum: Object.values(RelanceChannel),
            default: RelanceChannel.EMAIL
        },

        // Rate limiting
        messagesSentToday: {
            type: Number,
            default: 0
        },
        lastResetDate: {
            type: Date,
            default: Date.now
        },

        // Safety limits
        maxMessagesPerDay: {
            type: Number,
            default: 500  // Email via SendGrid - reasonable daily limit
        },
        maxTargetsPerCampaign: {
            type: Number,
            default: 500  // Max targets per filtered campaign
        }
    },
    {
        timestamps: true
    }
);

// Index for finding enabled configs
RelanceConfigSchema.index({ enabled: 1 });

// Index for daily counter reset queries
RelanceConfigSchema.index({ lastResetDate: 1 });

const RelanceConfigModel = mongoose.model<IRelanceConfig>('RelanceConfig', RelanceConfigSchema);

export default RelanceConfigModel;