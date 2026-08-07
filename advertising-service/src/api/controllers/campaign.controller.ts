import { Response } from 'express';
import { Types } from 'mongoose';
import CampaignModel, { CampaignStatus } from '../../database/models/campaign.model';
import CampaignParticipationModel from '../../database/models/campaign-participation.model';
import { createCampaign, quoteCampaign, campaignProgress } from '../../services/campaign.service';
import { getLeaderboard as leaderboard, campaignClickBreakdown } from '../../services/ranking.service';
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

const fail = (res: Response, err: unknown, context: string) => {
    const status = (err as AppError)?.statusCode ?? 500;
    if (status >= 500) log.error(`${context}:`, err);
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
        return res.json({
            success: true,
            data: {
                amount: quote.amount,
                uniqueViews: quote.uniqueViews,
                repeatViews: quote.repeatViews,
                totalViews: quote.totalViews,
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

        const filter: Record<string, unknown> = { advertiserUserId: userId };
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
        const userId = currentUserId(req);
        const campaign = await CampaignModel.findOne({ _id: req.params.id, advertiserUserId: userId });
        if (!campaign) throw new AppError('Campagne introuvable.', 404);

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

/**
 * Per-diffuseur breakdown: views delivered against clicks generated. This is what
 * lets an advertiser pick better diffuseurs next time, and it is the reason the
 * tracking link exists at all.
 */
export const getPerformance = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = currentUserId(req);
        const campaign = await CampaignModel.findOne({ _id: req.params.id, advertiserUserId: userId });
        if (!campaign) throw new AppError('Campagne introuvable.', 404);

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
export const decideUnfilled = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = currentUserId(req);
        const { decision } = req.body;
        if (decision !== 'bank' && decision !== 'wait') {
            throw new AppError("decision doit être 'bank' ou 'wait'.", 400);
        }

        const campaign = await CampaignModel.findOne({ _id: req.params.id, advertiserUserId: userId });
        if (!campaign) throw new AppError('Campagne introuvable.', 404);
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

        log.info(`Campaign ${campaign._id} banked with ${remaining} FCFA credit for advertiser ${userId}`);

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
