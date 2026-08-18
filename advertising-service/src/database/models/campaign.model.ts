import mongoose, { Schema, Document, Types } from 'mongoose';

export enum CampaignStatus {
    /** Created but not submitted for review. */
    DRAFT = 'draft',
    /** Submitted; an admin must approve the creative before it can go live. */
    PENDING_REVIEW = 'pending_review',
    /** Admin approved. Payment may now activate it. */
    APPROVED = 'approved',
    /** Admin rejected. The annonceur edits and resubmits. */
    REJECTED = 'rejected',
    /** Paid, accepting diffuseurs, accruing views. */
    ACTIVE = 'active',
    /** Unique-view target reached. */
    COMPLETED = 'completed',
    /** Advertiser chose to bank the remaining balance instead of waiting. */
    BANKED = 'banked',
    CANCELLED = 'cancelled',
}

/**
 * What the advertiser targets. Every field maps to one already on the user model,
 * so no user-service change is needed. All are optional; omitted means "any".
 */
export interface ITargeting {
    countries?: string[];
    cities?: string[];
    regions?: string[];
    /** 'male' | 'female' | 'other', matching UserSex. */
    sex?: string[];
    minAge?: number;
    maxAge?: number;
    interests?: string[];
    professions?: string[];
    languages?: string[];
}

export interface ICampaign extends Document {
    _id: Types.ObjectId;

    /** SBC user id of the advertiser. Any member can be one. */
    advertiserUserId: Types.ObjectId;

    title: string;
    description?: string;

    /** The creative diffuseurs post. Stored in settings-service. */
    mediaFileId: string;
    mediaType: 'image' | 'video';
    mediaMimeType?: string;
    /** sha256 of the original upload. Free exact-match fast path; usually misses. */
    mediaSha256?: string;
    /**
     * dHash of the creative, the real "did they post OUR flyer" check.
     *
     * Computed lazily on first verification and cached here, so campaign creation
     * does not block on fetching the file and a creative uploaded later is still
     * covered.
     */
    mediaPerceptualHash?: string;

    /** Caption text suggested to diffuseurs. Their tracking link is appended. */
    suggestedCaption?: string;

    /**
     * The test campaign: created by an admin, not bought by an annonceur.
     *
     * Its purpose is measuring a new diffuseur's real audience before they are
     * given work someone paid for. So it skips payment entirely, skips the
     * moderation queue (the admin who creates it is the reviewer), and pays the
     * diffuseur nothing — the reward is being ranked accurately afterwards.
     *
     * One at a time. Enforced by a partial unique index below.
     */
    isTestCampaign?: boolean;

    /**
     * Video shown on the test campaign's landing page, above « Je m'inscris ».
     * Stored in settings-service like every other upload.
     */
    landingVideoFileId?: string;

    // --- Landing page ---
    landingPageSlug: string;
    contactWhatsapp?: string;
    contactPhone?: string;
    websiteUrl?: string;

    targeting: ITargeting;

    // --- Commercials, frozen at purchase so later config changes can't restate history ---
    amountPaid: number;
    pricePerUniqueView: number;
    targetUniqueViews: number;

    // --- Live counters ---
    /** Day-1 views across all diffuseurs. These are what the advertiser paid for. */
    uniqueViewsDelivered: number;
    /** Day-2 and day-3 views. Free to the advertiser, still paid to diffuseurs. */
    repeatViewsDelivered: number;
    clicksTotal: number;

    status: CampaignStatus;
    /**
     * Set when the advertiser banks an unfilled campaign.
     *
     * Doubles as the remaining balance of that credit: spending it on a later
     * campaign decrements this, so a partly-used voucher stays usable. Never cash —
     * Rufus's rule is credit toward a future campaign only.
     */
    bankedAmount?: number;

    /**
     * Credit taken from banked campaigns to reduce what this one costs.
     *
     * Held as a reservation from the moment the payment session opens: the credit
     * is already decremented from the vouchers, so two campaigns cannot spend the
     * same credit while both sit on a payment page. Released by the scheduler if
     * the payment never lands.
     */
    creditApplied?: number;
    creditSources?: Array<{ campaignId: Types.ObjectId; amount: number }>;
    creditReservedAt?: Date;

    // --- Moderation ---
    // A creative goes onto thousands of people's personal WhatsApp statuses, so
    // nothing reaches ACTIVE without a human having looked at it.
    submittedForReviewAt?: Date;
    reviewedBy?: Types.ObjectId;
    reviewedAt?: Date;
    /** Required on rejection — without it the annonceur cannot fix anything. */
    rejectionReason?: string;

    /** payment-service session. The link between a campaign and the money for it. */
    paymentSessionId?: string;
    paidAt?: Date;

    activatedAt?: Date;
    completedAt?: Date;
    /** Set once the advertiser's referrer has been paid. Guards double payment. */
    referralCommissionPaidAt?: Date;
    referralCommissionAmount?: number;
    createdAt: Date;
    updatedAt: Date;
}

const TargetingSchema = new Schema<ITargeting>({
    countries: [{ type: String, uppercase: true, trim: true }],
    cities: [{ type: String, trim: true }],
    regions: [{ type: String, trim: true }],
    sex: [{ type: String, trim: true }],
    minAge: { type: Number, min: 0 },
    maxAge: { type: Number, min: 0 },
    interests: [{ type: String, trim: true }],
    professions: [{ type: String, trim: true }],
    languages: [{ type: String, trim: true }],
}, { _id: false });

const CampaignSchema = new Schema<ICampaign>({
    advertiserUserId: { type: Schema.Types.ObjectId, required: true, index: true },

    title: { type: String, required: true, trim: true, maxlength: 300 },
    description: { type: String, trim: true, maxlength: 2000 },

    mediaFileId: { type: String, required: true },
    mediaType: { type: String, enum: ['image', 'video'], required: true },
    mediaMimeType: { type: String },
    mediaSha256: { type: String, index: true },
    mediaPerceptualHash: { type: String },

    suggestedCaption: { type: String, trim: true, maxlength: 700 },

    isTestCampaign: { type: Boolean },
    landingVideoFileId: { type: String },

    landingPageSlug: { type: String, required: true, unique: true, index: true },
    contactWhatsapp: { type: String, trim: true },
    contactPhone: { type: String, trim: true },
    websiteUrl: { type: String, trim: true },

    targeting: { type: TargetingSchema, default: () => ({}) },

    amountPaid: { type: Number, required: true, min: 0 },
    pricePerUniqueView: { type: Number, required: true, min: 0 },
    targetUniqueViews: { type: Number, required: true, min: 1 },

    uniqueViewsDelivered: { type: Number, default: 0, min: 0 },
    repeatViewsDelivered: { type: Number, default: 0, min: 0 },
    clicksTotal: { type: Number, default: 0, min: 0 },

    status: {
        type: String,
        enum: Object.values(CampaignStatus),
        default: CampaignStatus.DRAFT,
        index: true,
    },
    bankedAmount: { type: Number, min: 0 },

    creditApplied: { type: Number, min: 0 },
    creditSources: [{
        _id: false,
        campaignId: { type: Schema.Types.ObjectId, required: true },
        amount: { type: Number, required: true, min: 0 },
    }],
    creditReservedAt: { type: Date },

    submittedForReviewAt: { type: Date },
    reviewedBy: { type: Schema.Types.ObjectId },
    reviewedAt: { type: Date },
    rejectionReason: { type: String, trim: true, maxlength: 1000 },

    paymentSessionId: { type: String, index: true, sparse: true },
    paidAt: { type: Date },

    activatedAt: { type: Date },
    completedAt: { type: Date },
    referralCommissionPaidAt: { type: Date },
    referralCommissionAmount: { type: Number, min: 0 },
}, { timestamps: true });

// The allocation engine's hot query: active campaigns still short of target.
CampaignSchema.index({ status: 1, createdAt: -1 });

// At most one live test campaign. Partial, so ordinary campaigns — which carry
// no isTestCampaign at all — are not forced into a single-document collection.
CampaignSchema.index(
    { isTestCampaign: 1 },
    { unique: true, partialFilterExpression: { isTestCampaign: true, status: CampaignStatus.ACTIVE } },
);

const CampaignModel = mongoose.model<ICampaign>('Campaign', CampaignSchema);
export default CampaignModel;
