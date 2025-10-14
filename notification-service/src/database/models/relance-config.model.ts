import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * WhatsApp connection status for relance feature
 */
export enum WhatsAppStatus {
    CONNECTED = 'connected',
    DISCONNECTED = 'disconnected',
    EXPIRED = 'expired'
}

/**
 * RelanceConfig Interface
 * Stores WhatsApp connection details for each user
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

    whatsappAuthData: string;                 // Encrypted session credentials
    whatsappStatus: WhatsAppStatus;           // Connection status
    lastQrScanDate?: Date;                    // When user last scanned QR
    lastConnectionCheck?: Date;               // Last time we verified connection
    connectionFailureCount: number;           // Track consecutive connection failures
    lastConnectionFailure?: Date;             // When last failure occurred
    failureNotificationSent: boolean;         // Track if we've notified about failures
    lastFailureNotifiedAt?: Date;             // When we last sent failure notification
    messagesSentToday: number;                // Rate limiting counter
    lastResetDate: Date;                      // When counter was last reset

    // Safety limits
    maxMessagesPerDay: number;                // User-configurable daily limit (default 50)
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

        whatsappAuthData: {
            type: String,
            default: ''  // Empty until user connects
        },
        whatsappStatus: {
            type: String,
            enum: Object.values(WhatsAppStatus),
            default: WhatsAppStatus.DISCONNECTED,
            index: true
        },
        lastQrScanDate: {
            type: Date
        },
        lastConnectionCheck: {
            type: Date
        },
        connectionFailureCount: {
            type: Number,
            default: 0
        },
        lastConnectionFailure: {
            type: Date
        },
        failureNotificationSent: {
            type: Boolean,
            default: false
        },
        lastFailureNotifiedAt: {
            type: Date
        },
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
            default: 50  // Conservative limit to avoid spam
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

// Index for finding users with connected WhatsApp
RelanceConfigSchema.index({ whatsappStatus: 1, enabled: 1 });

// Index for daily counter reset queries
RelanceConfigSchema.index({ lastResetDate: 1 });

const RelanceConfigModel = mongoose.model<IRelanceConfig>('RelanceConfig', RelanceConfigSchema);

export default RelanceConfigModel;