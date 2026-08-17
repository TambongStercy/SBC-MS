import mongoose, { Schema, Document, Types } from 'mongoose';

export enum ReferralTier {
    /** Below the campaign threshold. */
    LOCKED = 'locked',
    UNLOCKED = 'unlocked',
    /** Was offered campaigns over the inactivity window and completed none. */
    SUSPENDED = 'suspended',
}

export interface IDiffuseurProfile extends Document {
    _id: Types.ObjectId;
    userId: Types.ObjectId;

    /**
     * WhatsApp identity, captured on the first successful link.
     *
     * LID is the anti-fraud key, NOT the phone number: phone numbers get recycled
     * and can change, LIDs are stable per WhatsApp account. Unique across all
     * profiles, so one WhatsApp account can never farm several SBC accounts.
     */
    whatsappLid?: string;
    whatsappPhone?: string;
    whatsappLinkedAt?: Date;

    /** Self-declared at signup, replaced by measured data after the test campaign. */
    declaredAverageViews?: number;
    /** Rolling average of verified day-1 views. Drives allocation. */
    measuredAverageViews?: number;
    /** Whether measuredAverageViews is trustworthy yet. */
    hasCompletedTestCampaign: boolean;

    campaignsCompleted: number;
    campaignsAbandoned: number;
    totalVerifiedViews: number;
    totalClicksGenerated: number;

    /**
     * 0-100. Falls on abandoned campaigns and failed verifications, rises on clean
     * completions. Third allocation filter after targeting and view count.
     */
    trustScore: number;

    referralTier: ReferralTier;
    referralUnlockedAt?: Date;
    referralSuspendedAt?: Date;
    /** Anchors the inactivity window: last time an offer was actually sent. */
    lastCampaignOfferedAt?: Date;
    lastCampaignCompletedAt?: Date;

    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const DiffuseurProfileSchema = new Schema<IDiffuseurProfile>({
    userId: { type: Schema.Types.ObjectId, required: true, unique: true, index: true },

    // sparse: profiles exist before WhatsApp is ever linked, and unique+null
    // collides on the second unlinked profile without it.
    whatsappLid: { type: String, unique: true, sparse: true, index: true },
    whatsappPhone: { type: String, sparse: true, index: true },
    whatsappLinkedAt: { type: Date },

    declaredAverageViews: { type: Number, min: 0 },
    measuredAverageViews: { type: Number, min: 0 },
    hasCompletedTestCampaign: { type: Boolean, default: false },

    campaignsCompleted: { type: Number, default: 0, min: 0 },
    campaignsAbandoned: { type: Number, default: 0, min: 0 },
    totalVerifiedViews: { type: Number, default: 0, min: 0 },
    totalClicksGenerated: { type: Number, default: 0, min: 0 },

    trustScore: { type: Number, default: 50, min: 0, max: 100 },

    referralTier: {
        type: String,
        enum: Object.values(ReferralTier),
        default: ReferralTier.LOCKED,
        index: true,
    },
    referralUnlockedAt: { type: Date },
    referralSuspendedAt: { type: Date },
    lastCampaignOfferedAt: { type: Date },
    lastCampaignCompletedAt: { type: Date },

    isActive: { type: Boolean, default: true, index: true },
}, { timestamps: true });

// Allocation ranks eligible diffuseurs by reach then reliability.
DiffuseurProfileSchema.index({ isActive: 1, measuredAverageViews: -1, trustScore: -1 });

/** Measured views once the test campaign has run, declared before that. */
DiffuseurProfileSchema.virtual('effectiveAverageViews').get(function (this: IDiffuseurProfile) {
    return this.hasCompletedTestCampaign && this.measuredAverageViews != null
        ? this.measuredAverageViews
        : (this.declaredAverageViews ?? 0);
});

const DiffuseurProfileModel = mongoose.model<IDiffuseurProfile>('DiffuseurProfile', DiffuseurProfileSchema);
export default DiffuseurProfileModel;
