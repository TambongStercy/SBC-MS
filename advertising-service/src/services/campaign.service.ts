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

    // Created as DRAFT. It must pass moderation, then payment, before it is ever
    // offered to diffuseurs.
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

/** Statuses an annonceur may still edit: nothing has been reviewed or paid yet. */
const EDITABLE_STATUSES = [CampaignStatus.DRAFT, CampaignStatus.REJECTED];

type UpdateArgs = Partial<Omit<CreateArgs, 'advertiserUserId'>>;

/**
 * Edits a campaign that has not gone live.
 *
 * Exists because rejection is only useful if the annonceur can act on the reason
 * and resubmit. Refuses anything past review so an approved creative cannot be
 * swapped for a different one after an admin has looked at it.
 */
export const updateCampaign = async (campaign: ICampaign, args: UpdateArgs): Promise<ICampaign> => {
    if (!EDITABLE_STATUSES.includes(campaign.status)) {
        throw new AppError(
            'Cette campagne ne peut plus être modifiée. Seul un brouillon ou une campagne refusée est modifiable.',
            400,
        );
    }

    const scalarFields = [
        'title', 'description', 'mediaFileId', 'mediaType', 'mediaMimeType', 'mediaSha256',
        'suggestedCaption', 'contactWhatsapp', 'contactPhone', 'websiteUrl',
    ] as const;
    for (const field of scalarFields) {
        if (args[field] !== undefined) (campaign as any)[field] = args[field];
    }
    if (args.targeting !== undefined) campaign.targeting = args.targeting;

    if (args.mediaFileId !== undefined) {
        // The cached hash describes the old creative. Left in place it would make
        // verification match the previous flyer and pay for the wrong post.
        campaign.mediaPerceptualHash = undefined;
    }

    if (args.amount !== undefined) {
        const quote = quoteCampaign(Number(args.amount));
        campaign.amountPaid = quote.amount;
        campaign.pricePerUniqueView = quote.pricePerUniqueView;
        campaign.targetUniqueViews = quote.uniqueViews;
    }

    if (!campaign.contactWhatsapp && !campaign.contactPhone && !campaign.websiteUrl) {
        throw new AppError(
            'Une annonce doit avoir au moins un moyen de contact (WhatsApp, téléphone ou site web).',
            400,
        );
    }

    return campaign.save();
};

/**
 * Hands a campaign to the moderation queue.
 *
 * Also the resubmit path after a rejection, which is why the previous reason and
 * reviewer are cleared: a stale rejection shown next to a pending campaign reads
 * as though it had already been refused again.
 */
export const submitForReview = async (campaign: ICampaign): Promise<ICampaign> => {
    if (campaign.status === CampaignStatus.PENDING_REVIEW) {
        throw new AppError('Cette campagne est déjà en attente de validation.', 400);
    }
    if (!EDITABLE_STATUSES.includes(campaign.status)) {
        throw new AppError(
            `Une campagne au statut « ${campaign.status} » ne peut pas être soumise à validation.`,
            400,
        );
    }

    campaign.status = CampaignStatus.PENDING_REVIEW;
    campaign.submittedForReviewAt = new Date();
    campaign.rejectionReason = undefined;
    campaign.reviewedBy = undefined;
    campaign.reviewedAt = undefined;
    return campaign.save();
};

/** Admin verdict: the creative may now be paid for and go live. */
export const approveCampaign = async (campaign: ICampaign, adminUserId: Types.ObjectId): Promise<ICampaign> => {
    if (campaign.status !== CampaignStatus.PENDING_REVIEW) {
        throw new AppError(
            `Seule une campagne en attente de validation peut être approuvée (statut actuel : ${campaign.status}).`,
            400,
        );
    }

    campaign.status = CampaignStatus.APPROVED;
    campaign.reviewedBy = adminUserId;
    campaign.reviewedAt = new Date();
    campaign.rejectionReason = undefined;
    return campaign.save();
};

/** Admin verdict: refused. The reason is mandatory — without it nothing can be fixed. */
export const rejectCampaign = async (
    campaign: ICampaign,
    adminUserId: Types.ObjectId,
    reason: string,
): Promise<ICampaign> => {
    if (campaign.status !== CampaignStatus.PENDING_REVIEW) {
        throw new AppError(
            `Seule une campagne en attente de validation peut être refusée (statut actuel : ${campaign.status}).`,
            400,
        );
    }
    const trimmed = (reason ?? '').trim();
    if (!trimmed) {
        throw new AppError('Un motif de refus est obligatoire.', 400);
    }

    campaign.status = CampaignStatus.REJECTED;
    campaign.reviewedBy = adminUserId;
    campaign.reviewedAt = new Date();
    campaign.rejectionReason = trimmed;
    return campaign.save();
};

/**
 * How many campaigns this annonceur has already had approved.
 *
 * Surfaced in the review queue so a first-time annonceur can be looked at harder
 * than one with a clean history — Rufus's open question on review depth.
 */
export const approvedCampaignCounts = async (
    advertiserUserIds: Types.ObjectId[],
): Promise<Map<string, number>> => {
    if (!advertiserUserIds.length) return new Map();

    const rows = await CampaignModel.aggregate<{ _id: Types.ObjectId; count: number }>([
        {
            $match: {
                advertiserUserId: { $in: advertiserUserIds },
                status: {
                    $in: [
                        CampaignStatus.APPROVED, CampaignStatus.ACTIVE,
                        CampaignStatus.COMPLETED, CampaignStatus.BANKED,
                    ],
                },
            },
        },
        { $group: { _id: '$advertiserUserId', count: { $sum: 1 } } },
    ]);

    return new Map(rows.map(r => [String(r._id), r.count]));
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
