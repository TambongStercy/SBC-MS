import mongoose, { Document, Schema } from 'mongoose';

/**
 * Relance Campaign Model
 * Represents a filtered relance campaign created by users
 * Can be scheduled, paused, or queued to run after another campaign
 */

export enum CampaignType {
    DEFAULT = 'default',      // Automatic enrollment (1 hour after registration)
    FILTERED = 'filtered'     // Manual filtered campaign
}

export enum CampaignStatus {
    DRAFT = 'draft',          // Being configured, not started
    SCHEDULED = 'scheduled',  // Scheduled to start in future
    ACTIVE = 'active',        // Currently running
    PAUSED = 'paused',        // Temporarily paused by user
    COMPLETED = 'completed',  // Finished (all targets processed)
    CANCELLED = 'cancelled'   // Cancelled by user
}

export interface TargetFilter {
    // Primary filters
    countries?: string[];                    // Filter by country codes
    registrationDateFrom?: Date;             // Registration date range start (month/year)
    registrationDateTo?: Date;               // Registration date range end (month/year)
    subscriptionStatus?: 'subscribed' | 'non-subscribed' | 'all'; // Has paid inscription (CLASSIQUE/CIBLE) or not

    // Additional filters (optional)
    excludeCurrentTargets?: boolean;         // Exclude users already in a campaign
    gender?: 'male' | 'female' | 'other' | 'all';
    professions?: string[];
    minAge?: number;
    maxAge?: number;
}

export interface ICampaign extends Document {
    userId: mongoose.Types.ObjectId;    // Owner of the campaign
    name: string;                        // Campaign name (user-defined)
    type: CampaignType;
    status: CampaignStatus;

    // Filtering
    targetFilter?: TargetFilter;        // Filter criteria (null for default campaign)
    estimatedTargetCount?: number;      // Estimated users matching filter
    actualTargetCount?: number;         // Actual enrolled users

    // Scheduling
    scheduledStartDate?: Date;          // When campaign should start
    actualStartDate?: Date;             // When campaign actually started
    estimatedEndDate?: Date;            // Estimated completion (based on target count)
    actualEndDate?: Date;               // When campaign completed

    // Queuing
    runAfterCampaignId?: mongoose.Types.ObjectId;  // Run after this campaign completes
    priority?: number;                  // Priority (lower = higher priority)

    // Message customization (optional - otherwise uses default messages)
    customMessages?: {
        dayNumber: number;
        subject?: string;
        messageTemplate: {
            fr: string;
            en: string;
        };
        mediaUrls?: Array<{ url: string; type: 'image' | 'video' | 'pdf' }>;
        buttons?: Array<{ label: string; url: string; color?: string }>;
    }[];

    // Progress tracking
    targetsEnrolled: number;            // How many targets enrolled so far
    messagesSent: number;               // Total messages sent
    messagesDelivered: number;          // Successfully delivered
    messagesFailed: number;             // Failed to send
    targetsCompleted: number;           // Completed 7-day cycle without paying
    targetsConverted: number;           // Converted (paid) during the campaign
    targetsExited: number;              // Exited early (manual, referrer inactive, etc.)

    // Rate limiting (for filtered campaigns)
    maxMessagesPerDay?: number;         // Limit messages/day for this campaign

    // Metadata
    createdAt: Date;
    updatedAt: Date;
    createdBy: mongoose.Types.ObjectId; // User who created (for admin tracking)
    pausedAt?: Date;
    pausedBy?: mongoose.Types.ObjectId;
    cancelledAt?: Date;
    cancelledBy?: mongoose.Types.ObjectId;
    cancelReason?: string;

    // Methods
    canStart(userSubscriptionEndDate: Date): boolean;
    estimateEndDate(targetsCount: number): Date;
    pause(userId: mongoose.Types.ObjectId): void;
    resume(): void;
    cancel(userId: mongoose.Types.ObjectId, reason?: string): void;
    complete(): void;
}

const CampaignSchema = new Schema<ICampaign>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 100
        },
        type: {
            type: String,
            enum: Object.values(CampaignType),
            required: true,
            default: CampaignType.DEFAULT
        },
        status: {
            type: String,
            enum: Object.values(CampaignStatus),
            required: true,
            default: CampaignStatus.DRAFT,
            index: true
        },

        // Filtering
        targetFilter: {
            // Primary filters
            countries: [String],
            registrationDateFrom: Date,
            registrationDateTo: Date,
            subscriptionStatus: {
                type: String,
                enum: ['subscribed', 'non-subscribed', 'all']
            },

            // Additional filters
            excludeCurrentTargets: Boolean,
            gender: {
                type: String,
                enum: ['male', 'female', 'other', 'all']
            },
            professions: [String],
            minAge: Number,
            maxAge: Number
        },
        estimatedTargetCount: Number,
        actualTargetCount: Number,

        // Scheduling
        scheduledStartDate: Date,
        actualStartDate: Date,
        estimatedEndDate: Date,
        actualEndDate: Date,

        // Queuing
        runAfterCampaignId: {
            type: Schema.Types.ObjectId,
            ref: 'Campaign',
            index: true
        },
        priority: {
            type: Number,
            default: 0
        },

        // Custom messages
        customMessages: [{
            dayNumber: {
                type: Number,
                required: true,
                min: 1,
                max: 7
            },
            subject: { type: String },
            messageTemplate: {
                fr: { type: String, required: true },
                en: { type: String, required: true }
            },
            mediaUrls: [{
                url: String,
                type: {
                    type: String,
                    enum: ['image', 'video', 'pdf']
                }
            }],
            buttons: [{
                label: { type: String, required: true },
                url: { type: String, required: true },
                color: { type: String }
            }]
        }],

        // Progress
        targetsEnrolled: {
            type: Number,
            default: 0
        },
        messagesSent: {
            type: Number,
            default: 0
        },
        messagesDelivered: {
            type: Number,
            default: 0
        },
        messagesFailed: {
            type: Number,
            default: 0
        },
        targetsCompleted: {
            type: Number,
            default: 0
        },
        targetsConverted: {
            type: Number,
            default: 0
        },
        targetsExited: {
            type: Number,
            default: 0
        },

        // Rate limiting
        maxMessagesPerDay: Number,

        // Metadata
        createdBy: {
            type: Schema.Types.ObjectId,
            ref: 'User'
        },
        pausedAt: Date,
        pausedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User'
        },
        cancelledAt: Date,
        cancelledBy: {
            type: Schema.Types.ObjectId,
            ref: 'User'
        },
        cancelReason: String
    },
    {
        timestamps: true
    }
);

// Indexes for efficient queries
CampaignSchema.index({ userId: 1, status: 1 });
CampaignSchema.index({ status: 1, scheduledStartDate: 1 });
CampaignSchema.index({ userId: 1, type: 1, status: 1 });
CampaignSchema.index({ runAfterCampaignId: 1 });

// Compound index for finding next campaign to start
CampaignSchema.index({ status: 1, priority: 1, scheduledStartDate: 1 });

// Methods
CampaignSchema.methods.canStart = function(userSubscriptionEndDate: Date): boolean {
    // Check if campaign can start based on subscription
    if (!this.estimatedEndDate) {
        return true; // No end date estimate, allow to start
    }

    return this.estimatedEndDate <= userSubscriptionEndDate;
};

CampaignSchema.methods.estimateEndDate = function(targetsCount: number): Date {
    // Estimate completion date based on target count
    // Assuming 7 days per target, with some targets running in parallel
    const estimatedDays = Math.ceil(targetsCount / 10); // Assume 10 targets processed per day
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + estimatedDays);
    return endDate;
};

CampaignSchema.methods.pause = function(userId: mongoose.Types.ObjectId): void {
    this.status = CampaignStatus.PAUSED;
    this.pausedAt = new Date();
    this.pausedBy = userId;
};

CampaignSchema.methods.resume = function(): void {
    this.status = CampaignStatus.ACTIVE;
    this.pausedAt = undefined;
    this.pausedBy = undefined;
};

CampaignSchema.methods.cancel = function(userId: mongoose.Types.ObjectId, reason?: string): void {
    this.status = CampaignStatus.CANCELLED;
    this.cancelledAt = new Date();
    this.cancelledBy = userId;
    if (reason) {
        this.cancelReason = reason;
    }
};

CampaignSchema.methods.complete = function(): void {
    this.status = CampaignStatus.COMPLETED;
    this.actualEndDate = new Date();
};

const CampaignModel = mongoose.model<ICampaign>('Campaign', CampaignSchema);

export default CampaignModel;
