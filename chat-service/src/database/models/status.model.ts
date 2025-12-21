import { Schema, Document, Types, model } from 'mongoose';
import { StatusCategory } from '../../config/status-categories';

export enum StatusMediaType {
    TEXT = 'text',
    IMAGE = 'image',
    VIDEO = 'video',
    FLYER = 'flyer'
}

export interface IStatus extends Document {
    _id: Types.ObjectId;
    authorId: Types.ObjectId;
    category: StatusCategory;
    content: string;
    mediaType: StatusMediaType;
    mediaUrl?: string;
    mediaThumbnailUrl?: string;
    videoDuration?: number;
    // Location info
    country?: string;
    city?: string;
    region?: string;
    // Engagement metrics
    likesCount: number;
    repostsCount: number;
    repliesCount: number;
    viewsCount: number;
    // Moderation
    isApproved: boolean;
    flagged: boolean;
    flagReason?: string;
    flaggedBy?: Types.ObjectId[];
    contentModerationChecked: boolean;
    contentModerationResult?: {
        action: 'allow' | 'warn' | 'block';
        reason?: string;
        checkedAt: Date;
        scores?: {
            nudity?: number;
            suggestive?: number;
            violence?: number;
            drugs?: number;
            alcohol?: number;
            gore?: number;
        };
    };
    contentWarned: boolean;
    contentWarnedAt?: Date;
    // Status lifecycle
    expiresAt: Date;
    deleted: boolean;
    deletedAt?: Date;
    // Repost tracking
    originalStatusId?: Types.ObjectId;
    isRepost: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const StatusSchema = new Schema<IStatus>(
    {
        authorId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        category: {
            type: String,
            enum: Object.values(StatusCategory),
            required: true,
            index: true
        },
        content: {
            type: String,
            required: true,
            maxlength: 2000
        },
        mediaType: {
            type: String,
            enum: Object.values(StatusMediaType),
            default: StatusMediaType.TEXT
        },
        mediaUrl: { type: String },
        mediaThumbnailUrl: { type: String },
        videoDuration: {
            type: Number,
            max: 30,
            validate: {
                validator: function (v: number) {
                    return v <= 30;
                },
                message: 'Video duration cannot exceed 30 seconds'
            }
        },
        // Location
        country: { type: String, index: true },
        city: { type: String, index: true },
        region: { type: String },
        // Metrics
        likesCount: { type: Number, default: 0 },
        repostsCount: { type: Number, default: 0 },
        repliesCount: { type: Number, default: 0 },
        viewsCount: { type: Number, default: 0 },
        // Moderation
        isApproved: { type: Boolean, default: true },
        flagged: { type: Boolean, default: false },
        flagReason: { type: String },
        flaggedBy: [{
            type: Schema.Types.ObjectId,
            ref: 'User'
        }],
        contentModerationChecked: { type: Boolean, default: false },
        contentModerationResult: {
            action: {
                type: String,
                enum: ['allow', 'warn', 'block']
            },
            reason: String,
            checkedAt: Date,
            scores: {
                nudity: Number,
                suggestive: Number,
                violence: Number,
                drugs: Number,
                alcohol: Number,
                gore: Number
            }
        },
        contentWarned: { type: Boolean, default: false },
        contentWarnedAt: Date,
        // Lifecycle
        expiresAt: {
            type: Date,
            required: true,
            index: true,
            default: () => new Date(Date.now() + 24 * 60 * 60 * 1000) // 24h
        },
        deleted: { type: Boolean, default: false },
        deletedAt: { type: Date },
        // Repost tracking
        originalStatusId: {
            type: Schema.Types.ObjectId,
            ref: 'Status'
        },
        isRepost: { type: Boolean, default: false }
    },
    { timestamps: true }
);

// Compound indexes for efficient queries
StatusSchema.index({ category: 1, expiresAt: -1, deleted: 1 });
StatusSchema.index({ authorId: 1, createdAt: -1 });
StatusSchema.index({ country: 1, category: 1, expiresAt: -1 });
StatusSchema.index({ expiresAt: 1, deleted: 1, isApproved: 1 });
// Text index for keyword search
StatusSchema.index({ content: 'text' });

export default model<IStatus>('Status', StatusSchema);
