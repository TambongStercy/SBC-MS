import mongoose, { Schema, Document, Types } from 'mongoose';

export enum ParticipationStatus {
    /** Sent to the diffuseur, awaiting their answer. */
    OFFERED = 'offered',
    DECLINED = 'declined',
    /** Offer withdrawn because the campaign filled first. */
    EXPIRED = 'expired',
    /** Accepted, posting in progress. */
    IN_PROGRESS = 'in_progress',
    /** All required days posted and verified. Earnings credited. */
    COMPLETED = 'completed',
    /** Days missed and the grace period ran out. Nothing credited. */
    FORFEITED = 'forfeited',
}

export enum DayStatus {
    PENDING = 'pending',
    POSTED = 'posted',
    VERIFIED = 'verified',
    /** Verification ran and rejected it (wrong flyer, missing link, no status). */
    FAILED = 'failed',
    /** The 24h window closed with nothing posted. */
    MISSED = 'missed',
}

/**
 * One campaign day for one diffuseur.
 *
 * Day 1 views are "unique" and billed to the advertiser. Days 2-3 are "repeat":
 * free to the advertiser, still paid to the diffuseur at the declining rate.
 */
export interface IDayProof {
    day: number;
    status: DayStatus;

    /** WhatsApp status message id. Globally unique, so one post is claimed once. */
    statusMessageId?: string;
    postedAt?: Date;
    verifiedAt?: Date;

    captionCaptured?: string;
    /** Whether the caption contained this diffuseur's tracking link. */
    trackingLinkPresent?: boolean;
    /** Whether the posted media matched the campaign creative. */
    mediaSha256?: string;
    mediaMatches?: boolean;

    /** Read receipts. This is the number WhatsApp shows, and what we pay on. */
    viewCount: number;
    /** Recipients reached. Always >= viewCount. NOT what we pay on. */
    deliveredCount: number;
    /**
     * Salted hashes of viewer numbers, never plaintext. Enough for cross-account
     * overlap detection, and a leak exposes nothing about people who never
     * signed up for SBC.
     */
    viewerHashes: string[];

    ratePerView: number;
    earnedAmount: number;

    failureReason?: string;
}

export interface ICampaignParticipation extends Document {
    _id: Types.ObjectId;
    campaignId: Types.ObjectId;
    diffuseurUserId: Types.ObjectId;
    diffuseurProfileId: Types.ObjectId;

    status: ParticipationStatus;

    /** Unique per (campaign, diffuseur). Doubles as their SBC affiliate link. */
    trackingCode: string;

    offeredAt: Date;
    acceptedAt?: Date;
    /** Day-1 post time. All day deadlines derive from this. */
    startedAt?: Date;
    /** After this, missed days can no longer be made up. startedAt + duration + grace. */
    graceDeadline?: Date;
    completedAt?: Date;

    days: IDayProof[];

    /** Denormalised for allocation and payout without re-summing days. */
    totalViews: number;
    uniqueViews: number;
    repeatViews: number;
    totalEarned: number;
    clicksGenerated: number;

    /** Set only once earnings actually move. Nothing is paid before completion. */
    creditedAt?: Date;

    createdAt: Date;
    updatedAt: Date;
}

const DayProofSchema = new Schema<IDayProof>({
    day: { type: Number, required: true, min: 1 },
    status: { type: String, enum: Object.values(DayStatus), default: DayStatus.PENDING },

    statusMessageId: { type: String },
    postedAt: { type: Date },
    verifiedAt: { type: Date },

    captionCaptured: { type: String },
    trackingLinkPresent: { type: Boolean },
    mediaSha256: { type: String },
    mediaMatches: { type: Boolean },

    viewCount: { type: Number, default: 0, min: 0 },
    deliveredCount: { type: Number, default: 0, min: 0 },
    viewerHashes: [{ type: String }],

    ratePerView: { type: Number, required: true, min: 0 },
    earnedAmount: { type: Number, default: 0, min: 0 },

    failureReason: { type: String },
}, { _id: false });

const CampaignParticipationSchema = new Schema<ICampaignParticipation>({
    campaignId: { type: Schema.Types.ObjectId, required: true, index: true },
    diffuseurUserId: { type: Schema.Types.ObjectId, required: true, index: true },
    diffuseurProfileId: { type: Schema.Types.ObjectId, required: true, index: true },

    status: {
        type: String,
        enum: Object.values(ParticipationStatus),
        default: ParticipationStatus.OFFERED,
        index: true,
    },

    trackingCode: { type: String, required: true, unique: true, index: true },

    offeredAt: { type: Date, default: Date.now },
    acceptedAt: { type: Date },
    startedAt: { type: Date },
    graceDeadline: { type: Date },
    completedAt: { type: Date },

    days: { type: [DayProofSchema], default: [] },

    totalViews: { type: Number, default: 0, min: 0 },
    uniqueViews: { type: Number, default: 0, min: 0 },
    repeatViews: { type: Number, default: 0, min: 0 },
    totalEarned: { type: Number, default: 0, min: 0 },
    clicksGenerated: { type: Number, default: 0, min: 0 },

    creditedAt: { type: Date },
}, { timestamps: true });

// A diffuseur may only be offered a given campaign once.
CampaignParticipationSchema.index({ campaignId: 1, diffuseurUserId: 1 }, { unique: true });

// Enforces the one-campaign-per-diffuseur-per-day rule and drives their dashboard.
CampaignParticipationSchema.index({ diffuseurUserId: 1, status: 1, startedAt: -1 });

// A WhatsApp status post can only ever back one participation-day. Sparse because
// most day entries have no id until they are posted.
CampaignParticipationSchema.index({ 'days.statusMessageId': 1 }, { unique: true, sparse: true });

// Sweeps for participations whose grace window has run out.
CampaignParticipationSchema.index({ status: 1, graceDeadline: 1 });

const CampaignParticipationModel = mongoose.model<ICampaignParticipation>(
    'CampaignParticipation',
    CampaignParticipationSchema,
);
export default CampaignParticipationModel;
