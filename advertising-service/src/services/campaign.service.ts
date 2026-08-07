import { customAlphabet } from 'nanoid';
import { Types } from 'mongoose';
import CampaignModel, { CampaignStatus, ICampaign, ITargeting } from '../database/models/campaign.model';
import config from '../config';
import { AppError } from '../utils/errors';

/**
 * Slug/code alphabet: no vowels (can't accidentally spell anything), no 0/O/1/l/I
 * (misread when someone types a link off a phone screen).
 */
const CODE_ALPHABET = '23456789BCDFGHJKMNPQRSTVWXYZ';
const generateSlug = customAlphabet(CODE_ALPHABET.toLowerCase(), 8);
const generateTrackingCode = customAlphabet(CODE_ALPHABET.toLowerCase(), 10);

export const newLandingPageSlug = () => generateSlug();
export const newTrackingCode = () => generateTrackingCode();

/**
 * How many unique (day-1) views an advertiser's money buys.
 *
 * Only day 1 is billed. Days 2 and 3 are free extra reach for the advertiser but
 * are still paid to diffuseurs out of SBC's margin, which is why the margin below
 * is what it is.
 */
export const quoteCampaign = (amount: number) => {
    if (amount < config.pricing.minCampaignAmount) {
        throw new AppError(
            `Le montant minimum pour lancer une campagne est de ${config.pricing.minCampaignAmount} FCFA.`,
            400,
        );
    }

    const uniqueViews = Math.floor(amount / config.pricing.advertiserPricePerUniqueView);
    const days = config.campaign.durationDays;

    // Each day-1 poster reposts on the remaining days, so total reach is roughly
    // uniqueViews x days. Presented to the advertiser as the headline number.
    const repeatViews = uniqueViews * (days - 1);

    const diffuseurCostPerView = config.pricing.diffuseurRatePerDay.reduce((a, b) => a + b, 0);
    const diffuseurCost = uniqueViews * diffuseurCostPerView;

    return {
        amount,
        uniqueViews,
        repeatViews,
        totalViews: uniqueViews + repeatViews,
        pricePerUniqueView: config.pricing.advertiserPricePerUniqueView,
        /** Not exposed to advertisers; used for reporting and the referral split. */
        estimatedDiffuseurCost: diffuseurCost,
        estimatedSbcMargin: amount - diffuseurCost,
    };
};

type CreateArgs = {
    advertiserUserId: Types.ObjectId;
    title: string;
    description?: string;
    mediaFileId: string;
    mediaType: 'image' | 'video';
    mediaMimeType?: string;
    mediaSha256?: string;
    suggestedCaption?: string;
    contactWhatsapp?: string;
    contactPhone?: string;
    websiteUrl?: string;
    targeting?: ITargeting;
    amount: number;
};

export const createCampaign = async (args: CreateArgs): Promise<ICampaign> => {
    const quote = quoteCampaign(args.amount);

    if (!args.contactWhatsapp && !args.contactPhone && !args.websiteUrl) {
        throw new AppError(
            'Une annonce doit avoir au moins un moyen de contact (WhatsApp, téléphone ou site web).',
            400,
        );
    }

    // Created as DRAFT. Payment flips it to ACTIVE, so an unpaid campaign can never
    // be offered to diffuseurs.
    return CampaignModel.create({
        advertiserUserId: args.advertiserUserId,
        title: args.title,
        description: args.description,
        mediaFileId: args.mediaFileId,
        mediaType: args.mediaType,
        mediaMimeType: args.mediaMimeType,
        mediaSha256: args.mediaSha256,
        suggestedCaption: args.suggestedCaption,
        landingPageSlug: newLandingPageSlug(),
        contactWhatsapp: args.contactWhatsapp,
        contactPhone: args.contactPhone,
        websiteUrl: args.websiteUrl,
        targeting: args.targeting ?? {},
        // Frozen at creation so later config changes cannot restate what was sold.
        amountPaid: args.amount,
        pricePerUniqueView: quote.pricePerUniqueView,
        targetUniqueViews: quote.uniqueViews,
        status: CampaignStatus.DRAFT,
    });
};

/** Shape returned to the advertiser's dashboard. */
export const campaignProgress = (c: ICampaign) => {
    const pct = c.targetUniqueViews > 0
        ? Math.min(100, Math.round((c.uniqueViewsDelivered / c.targetUniqueViews) * 100))
        : 0;
    return {
        uniqueViewsDelivered: c.uniqueViewsDelivered,
        targetUniqueViews: c.targetUniqueViews,
        repeatViewsDelivered: c.repeatViewsDelivered,
        totalViewsDelivered: c.uniqueViewsDelivered + c.repeatViewsDelivered,
        clicksTotal: c.clicksTotal,
        percentComplete: pct,
    };
};
