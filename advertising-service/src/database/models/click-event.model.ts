import mongoose, { Schema, Document, Types } from 'mongoose';

export enum ClickAction {
    /** Landing page opened via a tracking link. */
    VIEW = 'view',
    CONTACT_WHATSAPP = 'contact_whatsapp',
    CALL = 'call',
    VISIT_SITE = 'visit_site',
    /** Test-campaign landing page signup button. */
    SIGNUP = 'signup',
}

/**
 * One interaction with a campaign landing page, attributed to the diffuseur whose
 * tracking link produced it.
 *
 * Click-through rate is what separates diffuseurs who deliver results from those
 * who only deliver eyeballs, so this drives ranking as much as view counts do.
 */
export interface IClickEvent extends Document {
    _id: Types.ObjectId;
    campaignId: Types.ObjectId;
    /** Null for direct landing-page hits with no tracking code. */
    participationId?: Types.ObjectId;
    diffuseurUserId?: Types.ObjectId;
    trackingCode?: string;

    action: ClickAction;

    /**
     * Coarse visitor fingerprint, hashed. Enough to collapse a refresh-spamming
     * visitor into one click without storing anything identifying.
     */
    visitorHash?: string;
    userAgent?: string;
    referer?: string;
    countryCode?: string;

    createdAt: Date;
}

const ClickEventSchema = new Schema<IClickEvent>({
    campaignId: { type: Schema.Types.ObjectId, required: true, index: true },
    participationId: { type: Schema.Types.ObjectId, index: true },
    diffuseurUserId: { type: Schema.Types.ObjectId, index: true },
    trackingCode: { type: String, index: true },

    action: { type: String, enum: Object.values(ClickAction), required: true, index: true },

    visitorHash: { type: String, index: true },
    userAgent: { type: String },
    referer: { type: String },
    countryCode: { type: String, uppercase: true },
}, { timestamps: { createdAt: true, updatedAt: false } });

// Per-diffuseur breakdown on the advertiser's dashboard.
ClickEventSchema.index({ campaignId: 1, diffuseurUserId: 1, action: 1 });

// Dedupe window: same visitor, same link, same action.
ClickEventSchema.index({ trackingCode: 1, visitorHash: 1, action: 1, createdAt: -1 });

const ClickEventModel = mongoose.model<IClickEvent>('ClickEvent', ClickEventSchema);
export default ClickEventModel;
