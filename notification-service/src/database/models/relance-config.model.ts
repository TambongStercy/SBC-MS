import mongoose, { Schema, Document, Types } from 'mongoose';

export enum RelanceChannel {
    EMAIL = 'email',
    SMS = 'sms',
    BOTH = 'both'
}

/**
 * Custom message template structure (same as campaign customMessages)
 */
export interface IMessageTemplate {
    dayNumber: number;
    subject?: string;
    messageTemplate: {
        fr: string;
        en: string;
    };
    mediaUrls?: Array<{ url: string; type: 'image' | 'video' | 'pdf' }>;
    buttons?: Array<{ label: string; url: string; color?: string }>;
}

export interface ISmsLink {
    type: 'auto' | 'manual';
    dayNumber: number;  // 1–7 (auto and manual)
    link: string;
}

export interface IRelanceConfig extends Document {
    _id: Types.ObjectId;
    userId: Types.ObjectId;

    // Master switches
    enabled: boolean;
    enrollmentPaused: boolean;
    sendingPaused: boolean;

    // Campaign control
    defaultCampaignPaused: boolean;
    allowSimultaneousCampaigns: boolean;

    // Channel
    channel: RelanceChannel;

    // Credit balances (deducted per successful send)
    emailBalance: number;
    smsBalance: number;

    // SMS access (admin-controlled toggle)
    smsEnabled: boolean;

    // Per-day links for predefined SMS templates (user fills in their link)
    smsLinks: ISmsLink[];

    // Daily pacing (user-controlled, credits are the hard stop)
    messagesSentToday: number;
    lastResetDate: Date;
    maxMessagesPerDay: number;      // default 500, user can adjust
    maxTargetsPerCampaign: number;

    // User's saved email message templates (for pre-filling campaign forms)
    savedMessageTemplates?: IMessageTemplate[];

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

        // Channel
        channel: {
            type: String,
            enum: Object.values(RelanceChannel),
            default: RelanceChannel.EMAIL
        },

        // Credit balances
        emailBalance: { type: Number, default: 0, min: 0 },
        smsBalance: { type: Number, default: 0, min: 0 },

        // SMS access (admin-controlled)
        smsEnabled: { type: Boolean, default: false },

        // Per-day SMS links
        smsLinks: [{
            type: { type: String, enum: ['auto', 'manual'], required: true },
            dayNumber: { type: Number, required: true, min: 1, max: 7 },
            link: { type: String, required: true }
        }],

        // Daily pacing (user-controlled rate; credits are the hard stop)
        messagesSentToday: { type: Number, default: 0 },
        lastResetDate: { type: Date, default: Date.now },
        maxMessagesPerDay: { type: Number, default: 500 },
        maxTargetsPerCampaign: { type: Number, default: 500 },

        // User's saved message templates (pre-fills campaign forms)
        savedMessageTemplates: [{
            dayNumber: { type: Number, required: true, min: 1, max: 7 },
            subject: { type: String },
            messageTemplate: {
                fr: { type: String, required: true },
                en: { type: String }
            },
            mediaUrls: [{
                url: { type: String },
                type: { type: String, enum: ['image', 'video', 'pdf'] }
            }],
            buttons: [{
                label: { type: String },
                url: { type: String },
                color: { type: String }
            }]
        }]
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