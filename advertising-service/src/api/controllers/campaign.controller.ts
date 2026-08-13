import { Response } from 'express';
import { Types } from 'mongoose';
import CampaignModel, { CampaignStatus } from '../../database/models/campaign.model';
import CampaignParticipationModel from '../../database/models/campaign-participation.model';
import {
    createCampaign,
    quoteCampaign,
    campaignProgress,
    updateCampaign,
    submitForReview,
} from '../../services/campaign.service';
import { getLeaderboard as leaderboard, campaignClickBreakdown } from '../../services/ranking.service';
import { createCampaignPaymentIntent } from '../../services/clients/payment.service.client';
import { activateApprovedCampaign } from '../../services/activation.service';
import { reserveCredit, releaseCredit, availableCredit } from '../../services/credit.service';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { AppError } from '../../utils/errors';
import config from '../../config';
import logger from '../../utils/logger';

const log = logger.getLogger('CampaignController');

const currentUserId = (req: AuthenticatedRequest): Types.ObjectId => {
    // JWTs carry both; userId is canonical, id is the fallback (see CLAUDE.md).
    const id = req.user?.userId || req.user?.id;
    if (!id) throw new AppError('Authentication required', 401);
    return new Types.ObjectId(id);
};

/** Every per-campaign route scopes by owner, so a campaign id alone leaks nothing. */
const ownedCampaign = async (req: AuthenticatedRequest) => {
    const campaign = await CampaignModel.findOne({
        _id: req.params.id,
        advertiserUserId: currentUserId(req),
        // The test campaign belongs to SBC and is managed in the admin panel.
        // It is stored against the admin's user id, so without this it would
        // appear among that admin's own campaigns — and its view counts are not
        // an annonceur-facing number.
        isTestCampaign: { $ne: true },
    });
    if (!campaign) throw new AppError('Campagne introuvable.', 404);
    return campaign;
};

const fail = (res: Response, err: unknown, context: string) => {
    const status = (err as AppError)?.statusCode ?? 500;
    // Pino serializes a bare Error to {} — every 500 logged as "details: {}"
    // and the real cause was unrecoverable from the logs. Spell it out.
    if (status >= 500) {
        log.error(`${context}: ${(err as Error)?.message}`, { stack: (err as Error)?.stack });
    }
    return res.status(status).json({
        success: false,
        message: status >= 500 ? 'Une erreur est survenue.' : (err as Error).message,
    });
};

/**
 * Shows what an amount buys, before any money moves. Advertisers see the headline
 * "X vues uniques + Y vues répétées" here.
 */
export const getQuote = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const amount = Number(req.query.amount);
        if (!Number.isFinite(amount)) throw new AppError('Montant invalide.', 400);

        const quote = quoteCampaign(amount);
        // Shown alongside the quote so an annonceur sitting on banked credit knows
        // what they will actually be charged before they commit to a budget.
        const credit = await availableCredit(currentUserId(req));

        return res.json({
            success: true,
            data: {
                amount: quote.amount,
                uniqueViews: quote.uniqueViews,
                repeatViews: quote.repeatViews,
                totalViews: quote.totalViews,
                availableCredit: credit,
                amountDue: Math.max(0, quote.amount - credit),
                message: `${quote.amount} FCFA = ${quote.uniqueViews} vues uniques + ${quote.repeatViews} vues répétées`,
            },
        });
    } catch (err) {
        return fail(res, err, 'getQuote');
    }
};

export const create = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = currentUserId(req);
        const {
            title, description, mediaFileId, mediaType, mediaMimeType, mediaSha256,
            suggestedCaption, contactWhatsapp, contactPhone, websiteUrl, targeting, amount,
        } = req.body;

        if (!title || !mediaFileId || !mediaType) {
            throw new AppError('title, mediaFileId et mediaType sont requis.', 400);
        }
        if (mediaType !== 'image' && mediaType !== 'video') {
            throw new AppError("mediaType doit être 'image' ou 'video'.", 400);
        }

        const campaign = await createCampaign({
            advertiserUserId: userId,
            title, description, mediaFileId, mediaType, mediaMimeType, mediaSha256,
            suggestedCaption, contactWhatsapp, contactPhone, websiteUrl, targeting,
            amount: Number(amount),
        });

        return res.status(201).json({
            success: true,
            data: {
                ...campaign.toObject(),
                landingPageUrl: `${config.publicBaseUrl.replace(/\/$/, '')}/a/${campaign.landingPageSlug}`,
                progress: campaignProgress(campaign),
            },
        });
    } catch (err) {
        return fail(res, err, 'createCampaign');
    }
};

export const listMine = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = currentUserId(req);
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(50, Number(req.query.limit) || 20);

        const filter: Record<string, unknown> = {
            advertiserUserId: userId,
            isTestCampaign: { $ne: true },
        };
        if (req.query.status) filter.status = req.query.status;

        const [items, total] = await Promise.all([
            CampaignModel.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
            CampaignModel.countDocuments(filter),
        ]);

        return res.json({
            success: true,
            data: items.map(c => ({ ...c.toObject(), progress: campaignProgress(c) })),
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        });
    } catch (err) {
        return fail(res, err, 'listMine');
    }
};

export const getOne = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const campaign = await ownedCampaign(req);

        return res.json({
            success: true,
            data: {
                ...campaign.toObject(),
                landingPageUrl: `${config.publicBaseUrl.replace(/\/$/, '')}/a/${campaign.landingPageSlug}`,
                progress: campaignProgress(campaign),
            },
        });
    } catch (err) {
        return fail(res, err, 'getCampaign');
    }
};

/** Editing a draft or a rejected campaign. The service enforces which statuses allow it. */
export const update = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const campaign = await updateCampaign(await ownedCampaign(req), req.body);
        return res.json({
            success: true,
            data: { ...campaign.toObject(), progress: campaignProgress(campaign) },
        });
    } catch (err) {
        return fail(res, err, 'updateCampaign');
    }
};

/**
 * Sends a campaign to moderation. Nothing an annonceur can do puts a creative in
 * front of diffuseurs without an admin having approved it first.
 */
export const submit = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const campaign = await submitForReview(await ownedCampaign(req));
        log.info(`Campaign ${campaign._id} submitted for review`);
        return res.json({
            success: true,
            data: {
                status: campaign.status,
                submittedForReviewAt: campaign.submittedForReviewAt,
                message: 'Votre campagne est en attente de validation par notre équipe.',
            },
        });
    } catch (err) {
        return fail(res, err, 'submitCampaign');
    }
};

/**
 * Opens the payment session for an approved campaign.
 *
 * Refused before approval, so an annonceur cannot pay for something that would
 * then sit unusable — and cannot use payment as a way around review.
 */
export const pay = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const campaign = await ownedCampaign(req);
        if (campaign.status !== CampaignStatus.APPROVED) {
            throw new AppError(
                campaign.status === CampaignStatus.PENDING_REVIEW
                    ? 'Votre campagne est encore en attente de validation.'
                    : `Une campagne au statut « ${campaign.status} » ne peut pas être payée.`,
                400,
            );
        }

        // Banked credit from earlier unfilled campaigns comes off the price first.
        // Rufus's rule: it comes back as credit toward a new campaign, never cash.
        const credit = await reserveCredit(campaign);
        const due = Math.max(0, campaign.amountPaid - credit);

        if (due === 0) {
            // Fully covered by credit — this campaign has already been paid for, so
            // there is nothing for a payment provider to do.
            const result = await activateApprovedCampaign(campaign._id);
            campaign.paidAt = new Date();
            await campaign.save();

            log.info(`Campaign ${campaign._id} activated entirely from ${credit} XAF of credit`);
            return res.json({
                success: true,
                data: {
                    sessionId: null,
                    amount: 0,
                    creditApplied: credit,
                    status: result.status,
                    message: 'Votre crédit couvre entièrement cette campagne. Elle est lancée.',
                },
            });
        }

        try {
            const intent = await createCampaignPaymentIntent({
                userId: String(campaign.advertiserUserId),
                amount: due,
                campaignId: String(campaign._id),
                campaignTitle: campaign.title,
            });

            log.info(`Payment session ${intent.sessionId} opened for campaign ${campaign._id} (${due} XAF due, ${credit} from credit)`);

            return res.json({
                success: true,
                // Only the session id: the frontend builds the payment page URL from it
                // (SBCApiService.generatePaymentUrl), same as subscriptions and tombola.
                data: { sessionId: intent.sessionId, amount: due, creditApplied: credit },
            });
        } catch (err) {
            // No payment session means nothing will ever consume the reservation,
            // and no callback will arrive to tell us so. Hand the credit back now
            // rather than leaving the annonceur to wait out the sweep.
            await releaseCredit(campaign).catch(() => { });
            throw err;
        }
    } catch (err) {
        return fail(res, err, 'payCampaign');
    }
};

/**
 * Per-diffuseur breakdown: views delivered against clicks generated. This is what
 * lets an advertiser pick better diffuseurs next time, and it is the reason the
 * tracking link exists at all.
 */
export const getPerformance = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const campaign = await ownedCampaign(req);

        const participations = await CampaignParticipationModel
            .find({ campaignId: campaign._id })
            .select('diffuseurUserId status uniqueViews repeatViews totalViews clicksGenerated trackingCode')
            .lean();

        const byDiffuseur = await campaignClickBreakdown(campaign._id);

        return res.json({
            success: true,
            data: {
                progress: campaignProgress(campaign),
                diffuseurs: participations.map(p => ({
                    diffuseurUserId: p.diffuseurUserId,
                    status: p.status,
                    uniqueViews: p.uniqueViews,
                    repeatViews: p.repeatViews,
                    totalViews: p.totalViews,
                    clicks: p.clicksGenerated,
                    clicksByAction: byDiffuseur.get(String(p.diffuseurUserId)) ?? {},
                    // Ratio of people who acted, not just saw. The quality signal.
                    clickThroughRate: p.totalViews > 0
                        ? Number((p.clicksGenerated / p.totalViews).toFixed(4))
                        : 0,
                })),
            },
        });
    } catch (err) {
        return fail(res, err, 'getPerformance');
    }
};

/**
 * An unfilled campaign leaves the advertiser with unspent budget. They choose:
 * bank it as credit, or keep waiting. Recorded either way because it feeds the
 * recommendation system.
 */
/**
 * Cancels a campaign that has not yet been paid.
 *
 * Only pre-money statuses: an active campaign is closed via decideUnfilled
 * (bank), which settles the budget — cancelling would orphan it. Cancelling an
 * approved campaign forfeits the approval: re-launching means a new review.
 * Any credit reserved by an abandoned payment attempt is released on the spot
 * rather than waiting for the stale-reservation sweep.
 */
export const cancel = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const campaign = await ownedCampaign(req);

        const cancellable = [
            CampaignStatus.DRAFT,
            CampaignStatus.PENDING_REVIEW,
            CampaignStatus.APPROVED,
            CampaignStatus.REJECTED,
        ];
        if (!cancellable.includes(campaign.status)) {
            throw new AppError(
                'Seule une campagne non payée peut être annulée. Une campagne en diffusion se clôture depuis son tableau de bord.',
                400,
            );
        }

        await releaseCredit(campaign);
        campaign.status = CampaignStatus.CANCELLED;
        await campaign.save();

        log.info(`Campaign ${campaign._id} cancelled by advertiser before payment`);
        return res.json({ success: true, data: { status: campaign.status } });
    } catch (err) {
        return fail(res, err, 'cancel');
    }
};

export const decideUnfilled = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { decision } = req.body;
        if (decision !== 'bank' && decision !== 'wait') {
            throw new AppError("decision doit être 'bank' ou 'wait'.", 400);
        }

        const campaign = await ownedCampaign(req);
        if (campaign.status !== CampaignStatus.ACTIVE) {
            throw new AppError('Seule une campagne active peut être clôturée.', 400);
        }

        if (decision === 'wait') {
            return res.json({ success: true, data: { status: campaign.status, message: 'Campagne toujours active.' } });
        }

        const delivered = campaign.uniqueViewsDelivered * campaign.pricePerUniqueView;
        const remaining = Math.max(0, campaign.amountPaid - delivered);

        campaign.status = CampaignStatus.BANKED;
        campaign.bankedAmount = remaining;
        campaign.completedAt = new Date();
        await campaign.save();

        log.info(`Campaign ${campaign._id} banked with ${remaining} FCFA credit for advertiser ${campaign.advertiserUserId}`);

        return res.json({
            success: true,
            data: { status: campaign.status, bankedAmount: remaining },
        });
    } catch (err) {
        return fail(res, err, 'decideUnfilled');
    }
};

/**
 * Public classement of diffuseurs by reach, clicks and reliability.
 *
 * Advertisers use this to pick who to target, which is the point of tracking
 * clicks at all — reach alone does not tell them who delivers results.
 */
export const getLeaderboard = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { entries, total } = await leaderboard({
            page: Number(req.query.page) || 1,
            limit: Number(req.query.limit) || 50,
            sortBy: req.query.sortBy as 'views' | 'clicks' | 'trust' | undefined,
            measuredOnly: req.query.measuredOnly === 'true',
        });

        return res.json({
            success: true,
            data: entries,
            pagination: { total, page: Number(req.query.page) || 1 },
        });
    } catch (err) {
        return fail(res, err, 'getLeaderboard');
    }
};
