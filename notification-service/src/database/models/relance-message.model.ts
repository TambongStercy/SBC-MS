import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * Media type for relance messages
 */
export enum MediaType {
    IMAGE = 'image',
    PDF = 'pdf',
    VIDEO = 'video'
}

/**
 * Language enum
 */
export enum Language {
    FR = 'fr',
    EN = 'en',
    BOTH = 'both'
}

/**
 * Media attachment interface
 */
export interface IMediaAttachment {
    url: string;                    // URL to the media file (Google Drive, S3, etc.)
    type: MediaType;                // image, pdf, or video
    language: Language;             // Which language this media is for
    filename?: string;              // Original filename
}

/**
 * CTA Button interface
 */
export interface IButton {
    label: string;                  // Button text
    url: string;                    // Button link URL
    color?: string;                 // Optional hex color (default: orange #F59E0B)
}

/**
 * Multi-language message template
 */
export interface IMessageTemplate {
    fr: string;                     // French message
    en: string;                     // English message
}

/**
 * RelanceMessage Interface
 * Admin-configurable messages for each day of the 7-day campaign
 */
export interface IRelanceMessage extends Document {
    _id: Types.ObjectId;
    dayNumber: number;              // 1-7 (which day of the campaign)
    subject?: string;               // Optional custom subject line (overrides auto-generated)
    messageTemplate: IMessageTemplate;  // Message with variables like {{name}}
    mediaUrls: IMediaAttachment[];  // Array of media files (images/PDFs/videos)
    buttons: IButton[];             // CTA buttons with label, url, and optional color
    variables: string[];            // List of available variables (e.g., ['{{name}}', '{{referrerName}}'])
    active: boolean;                // Can disable specific day messages
    createdAt: Date;
    updatedAt: Date;
}

/**
 * RelanceMessage Schema
 */
const RelanceMessageSchema = new Schema<IRelanceMessage>(
    {
        dayNumber: {
            type: Number,
            required: true,
            unique: true,           // Only one message per day
            min: 1,
            max: 7,
            index: true
        },
        subject: {
            type: String            // Optional custom subject line
        },
        messageTemplate: {
            fr: {
                type: String,
                required: true,
                default: 'Bonjour {{name}}, vous avez été référé par {{referrerName}}. Rejoignez SBC aujourd\'hui!'
            },
            en: {
                type: String,
                required: true,
                default: 'Hello {{name}}, you were referred by {{referrerName}}. Join SBC today!'
            }
        },
        mediaUrls: {
            type: [{
                url: { type: String, required: true },
                type: { type: String, enum: Object.values(MediaType), required: true },
                language: { type: String, enum: Object.values(Language), required: true },
                filename: { type: String }
            }],
            default: []
        },
        buttons: {
            type: [{
                label: { type: String, required: true },
                url: { type: String, required: true },
                color: { type: String }  // Optional hex color
            }],
            default: []
        },
        variables: {
            type: [String],
            default: ['{{name}}', '{{referrerName}}']
        },
        active: {
            type: Boolean,
            default: true,
            index: true
        }
    },
    {
        timestamps: true
    }
);

// Index for finding active messages by day
RelanceMessageSchema.index({ dayNumber: 1, active: 1 });

const RelanceMessageModel = mongoose.model<IRelanceMessage>('RelanceMessage', RelanceMessageSchema);

export default RelanceMessageModel;