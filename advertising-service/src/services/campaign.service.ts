import { customAlphabet } from 'nanoid';
import { Types } from 'mongoose';
import CampaignModel, { CampaignStatus, ICampaign, ITargeting } from '../database/models/campaign.model';
import config from '../config';
import { AppError } from '../utils/errors';
import { downloadFile } from './clients/settings.service.client';
import { perceptualHash } from './media-hash.service';

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

/**
 * Statuses an annonceur may still edit.
 *
 * PAID is here deliberately. Under pay-first the money arrives BEFORE anyone —
 * annonceur or admin — has seen whether the campaign can actually run, and a
 * campaign waiting for validation has not been shown to a single diffuseur yet,
 * so there is nothing to protect by freezing it. Leaving it locked meant an
 * annonceur who targeted an audience we do not have (Georgi, 2026-09-05: Gabon +
 * RDC, femmes 25-50, which matches 2 of 223 diffuseurs) had paid for a campaign
 * he could neither fix nor run.
 */
const EDITABLE_STATUSES = [CampaignStatus.DRAFT, CampaignStatus.REJECTED, CampaignStatus.PAID];

/**
 * Statuses where ONLY the targeting may be changed.
 *
 * A live or paused campaign has already been posted by diffuseurs, so its
 * creative is frozen — verification matches posts against the campaign's media
 * hash, and swapping it would refuse every day already published. The audience is
 * different: allocation re-reads targeting on every pass, so widening it simply
 * lets the next round of offers go to people who match. Rufus asked for this
 * explicitly, for when a campaign was validated without anyone noticing its
 * targeting could never deliver the views.
 */
const RETARGETABLE_STATUSES = [CampaignStatus.ACTIVE, CampaignStatus.PAUSED];

/** Fields that are not the audience — refused once a campaign is live. */
const isTargetingOnly = (args: UpdateArgs): boolean =>
    Object.keys(args).every(k => k === 'targeting');

type UpdateArgs = Partial<Omit<CreateArgs, 'advertiserUserId'>>;

/**
 * Edits a campaign that has not gone live.
 *
 * Exists because rejection is only useful if the annonceur can act on the reason
 * and resubmit. Refuses anything past review so an approved creative cannot be
 * swapped for a different one after an admin has looked at it.
 */
export const updateCampaign = async (campaign: ICampaign, args: UpdateArgs): Promise<ICampaign> => {
    const live = RETARGETABLE_STATUSES.includes(campaign.status);

    if (!EDITABLE_STATUSES.includes(campaign.status) && !live) {
        throw new AppError(
            'Cette campagne ne peut plus être modifiée.',
            400,
        );
    }

    if (live && !isTargetingOnly(args)) {
        throw new AppError(
            'Une campagne en diffusion ne peut plus changer de budget, et son visuel ne change '
            + 'que par « Remplacer le visuel » (validé par notre équipe). Vous pouvez élargir le ciblage.',
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
        // The budget is what was actually charged, so it cannot be re-quoted after
        // the fact — that would silently change how many views they own without
        // any money moving. Everything else about a paid campaign stays editable.
        if (campaign.paidAt) {
            throw new AppError(
                'Le budget d\'une campagne déjà payée ne peut pas être modifié. '
                + 'Vous pouvez ajuster le ciblage et le visuel, ou créer une nouvelle campagne.',
                400,
            );
        }
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
 * Statuses where the creative changes only through an admin-reviewed request.
 * Before going live a campaign is edited directly (and reviewed as a whole).
 */
const MEDIA_CHANGE_STATUSES = [CampaignStatus.ACTIVE, CampaignStatus.PAUSED];

interface MediaArgs {
    mediaFileId?: string;
    mediaType?: string;
    mediaMimeType?: string;
    mediaSha256?: string;
}

/**
 * The annonceur proposes a new creative for a live or paused campaign.
 *
 * It waits as `pendingMedia` while the current creative keeps running: a
 * creative goes onto strangers' WhatsApp statuses, so nothing reaches them
 * without an admin looking at it first. A second submission replaces the first.
 */
export const submitMediaChange = async (campaign: ICampaign, args: MediaArgs): Promise<ICampaign> => {
    if (!MEDIA_CHANGE_STATUSES.includes(campaign.status)) {
        throw new AppError(
            'Seule une campagne en diffusion ou en pause passe par cette demande. '
            + 'Avant la diffusion, modifiez directement votre campagne.',
            400,
        );
    }
    if (!args.mediaFileId) throw new AppError('Le nouveau visuel est requis.', 400);
    if (args.mediaType !== 'image' && args.mediaType !== 'video') {
        throw new AppError('Le visuel doit être une image ou une vidéo.', 400);
    }

    campaign.pendingMedia = {
        fileId: args.mediaFileId,
        type: args.mediaType,
        mimeType: args.mediaMimeType,
        sha256: args.mediaSha256,
        submittedAt: new Date(),
    };
    campaign.mediaChangeRejection = undefined;
    return campaign.save();
};

/** The annonceur withdraws a replacement nobody has reviewed yet. */
export const cancelMediaChange = async (campaign: ICampaign): Promise<ICampaign> => {
    if (!campaign.pendingMedia) throw new AppError('Aucun changement de visuel en attente.', 400);
    campaign.pendingMedia = undefined;
    return campaign.save();
};

/**
 * Fingerprint of the creative being replaced, so posts of it still match.
 * Usually already cached by verification; computed here when it is not.
 * Best-effort: a video, or a file that cannot be fetched, has none.
 */
const currentCreativeHash = async (campaign: ICampaign): Promise<string | undefined> => {
    if (campaign.mediaPerceptualHash) return campaign.mediaPerceptualHash;
    if (campaign.mediaType !== 'image') return undefined;
    const bytes = await downloadFile(campaign.mediaFileId).catch(() => null);
    return bytes ? (await perceptualHash(bytes)) ?? undefined : undefined;
};

/**
 * The admin accepts the replacement: it becomes the campaign's creative.
 *
 * The old fingerprint moves to `previousMediaPerceptualHashes`, so a diffuseur
 * who already posted the old creative is still recognised as posting ours.
 * The new fingerprint is computed lazily by the next verification.
 */
export const approveMediaChange = async (campaign: ICampaign, adminId: Types.ObjectId): Promise<ICampaign> => {
    const pending = campaign.pendingMedia;
    if (!pending) throw new AppError('Aucun changement de visuel en attente.', 400);

    const oldHash = await currentCreativeHash(campaign);
    if (oldHash && !(campaign.previousMediaPerceptualHashes ?? []).includes(oldHash)) {
        campaign.previousMediaPerceptualHashes = [...(campaign.previousMediaPerceptualHashes ?? []), oldHash];
    }

    campaign.mediaFileId = pending.fileId;
    campaign.mediaType = pending.type;
    campaign.mediaMimeType = pending.mimeType;
    campaign.mediaSha256 = pending.sha256;
    campaign.mediaPerceptualHash = undefined;
    campaign.pendingMedia = undefined;
    campaign.mediaChangeRejection = undefined;
    campaign.reviewedBy = adminId;
    campaign.reviewedAt = new Date();
    return campaign.save();
};

/** The admin refuses the replacement; the current creative stays. A reason is required. */
export const rejectMediaChange = async (
    campaign: ICampaign,
    adminId: Types.ObjectId,
    reason: string | undefined,
): Promise<ICampaign> => {
    const trimmed = (reason ?? '').trim();
    if (!trimmed) throw new AppError('Un motif de refus est obligatoire.', 400);
    if (!campaign.pendingMedia) throw new AppError('Aucun changement de visuel en attente.', 400);

    campaign.pendingMedia = undefined;
    campaign.mediaChangeRejection = { reason: trimmed, at: new Date() };
    campaign.reviewedBy = adminId;
    campaign.reviewedAt = new Date();
    return campaign.save();
};

/** Replacement creatives waiting for an admin, oldest first. */
export const listPendingMediaChanges = () =>
    CampaignModel.find({ pendingMedia: { $exists: true } })
        .sort({ 'pendingMedia.submittedAt': 1 })
        .lean();

/**
 * The old review-then-pay entry point. It no longer does anything.
 *
 * Under pay-first, paying is what puts a campaign in the moderation queue, so
 * this must not be another way in — a client still calling it was quietly
 * refilling the queue with campaigns nobody had paid for, which is the exact
 * problem pay-first exists to solve. Kept as an explicit refusal rather than
 * deleted, so an old app build gets a clear instruction instead of a 404.
 */
export const submitForReview = async (campaign: ICampaign): Promise<ICampaign> => {
    // Already paid — typically refused, then edited. Sending it back to the queue
    // must not cost anything: the money was taken once and is still on the
    // campaign. Without this the only route back into review was paying a second
    // time for the same campaign.
    if (campaign.paidAt) {
        campaign.status = CampaignStatus.PAID;
        campaign.submittedForReviewAt = new Date();
        campaign.rejectionReason = undefined;
        campaign.reviewedBy = undefined;
        campaign.reviewedAt = undefined;
        return campaign.save();
    }

    throw new AppError(
        "Payez votre campagne pour l'envoyer en validation : elle démarre dès qu'un administrateur la valide.",
        400,
    );
};

/** Admin verdict: the creative may now be paid for and go live. */
/** Statuses an admin may pass judgement on: paid (pay-first) or the frozen legacy queue. */
const REVIEWABLE_STATUSES = [CampaignStatus.PAID, CampaignStatus.PENDING_REVIEW];

/**
 * Admin verdict: the creative may run.
 *
 * Under pay-first the campaign is already paid for, so approving is what puts it
 * live — the caller activates it straight after. A legacy PENDING_REVIEW campaign
 * (approved before it was paid) still lands on APPROVED and waits for payment.
 */
export const approveCampaign = async (campaign: ICampaign, adminUserId: Types.ObjectId): Promise<ICampaign> => {
    if (!REVIEWABLE_STATUSES.includes(campaign.status)) {
        throw new AppError(
            `Seule une campagne payée en attente de validation peut être approuvée (statut actuel : ${campaign.status}).`,
            400,
        );
    }

    // A paid campaign is flipped live by the caller through activatePaidCampaign,
    // which is the single guarded path to ACTIVE; the status is left as PAID here
    // so that function still sees a payment it can act on.
    if (campaign.status === CampaignStatus.PENDING_REVIEW) {
        campaign.status = CampaignStatus.APPROVED;
    }
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
    if (!REVIEWABLE_STATUSES.includes(campaign.status)) {
        throw new AppError(
            `Seule une campagne payée en attente de validation peut être refusée (statut actuel : ${campaign.status}).`,
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
