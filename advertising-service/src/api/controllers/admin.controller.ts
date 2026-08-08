import { Response } from 'express';
import { Types } from 'mongoose';
import CampaignModel, { CampaignStatus } from '../../database/models/campaign.model';
import {
    approveCampaign,
    rejectCampaign,
    approvedCampaignCounts,
    campaignProgress,
} from '../../services/campaign.service';
import { overview, monthlySeries, inFlight } from '../../services/analytics.service';
import { getUserProfiles } from '../../services/clients/user.service.client';
import { notifyCampaignApproved, notifyCampaignRejected } from '../../services/clients/notification.service.client';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { AppError } from '../../utils/errors';
import config from '../../config';
import logger from '../../utils/logger';

const log = logger.getLogger('AdminController');

const fail = (res: Response, err: unknown, context: string) => {
    const status = (err as AppError)?.statusCode ?? 500;
    if (status >= 500) log.error(`${context}:`, err);
    return res.status(status).json({
        success: false,
        message: status >= 500 ? 'Une erreur est survenue.' : (err as Error).message,
    });
};

const adminUserId = (req: AuthenticatedRequest): Types.ObjectId => {
    const id = req.user?.userId || req.user?.id;
    if (!id) throw new AppError('Authentication required', 401);
    return new Types.ObjectId(id);
};

/**
 * The moderation queue.
 *
 * Carries the annonceur's identity and their approved history alongside the
 * creative, because "who is asking" is most of the judgement on a first campaign.
 * Defaults to PENDING_REVIEW; `status` widens it so the same endpoint backs the
 * admin panel's full campaign list.
 */
export const listForReview = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(100, Number(req.query.limit) || 20);

        const filter: Record<string, unknown> = {};
        if (req.query.status) {
            const requested = String(req.query.status).split(',');
            const unknown = requested.filter(s => !Object.values(CampaignStatus).includes(s as CampaignStatus));
            if (unknown.length) throw new AppError(`Statut inconnu : ${unknown.join(', ')}`, 400);
            filter.status = { $in: requested };
        } else {
            filter.status = CampaignStatus.PENDING_REVIEW;
        }

        const [items, total] = await Promise.all([
            // Oldest first: an annonceur waiting on review is blocked from paying.
            CampaignModel.find(filter).sort({ submittedForReviewAt: 1, createdAt: 1 })
                .skip((page - 1) * limit).limit(limit),
            CampaignModel.countDocuments(filter),
        ]);

        const advertiserIds = [...new Set(items.map(c => String(c.advertiserUserId)))];
        // Neither lookup is worth failing a review queue over — the creative and the
        // targeting, which is what an admin actually judges, are already here.
        const [profiles, approvedCounts] = await Promise.all([
            getUserProfiles(advertiserIds).catch(err => {
                log.warn(`Could not resolve annonceur profiles: ${(err as Error).message}`);
                return [];
            }),
            approvedCampaignCounts(items.map(c => c.advertiserUserId)).catch(err => {
                log.warn(`Could not count approved campaigns: ${(err as Error).message}`);
                return new Map<string, number>();
            }),
        ]);
        const profileById = new Map(profiles.map(p => [String(p._id), p]));

        return res.json({
            success: true,
            data: items.map(c => {
                const priorApprovals = approvedCounts.get(String(c.advertiserUserId)) ?? 0;
                return {
                    ...c.toObject(),
                    landingPageUrl: `${config.publicBaseUrl.replace(/\/$/, '')}/a/${c.landingPageSlug}`,
                    progress: campaignProgress(c),
                    advertiser: profileById.get(String(c.advertiserUserId)) ?? null,
                    priorApprovedCampaigns: priorApprovals,
                    /** Review this one properly — nothing of theirs has been vetted before. */
                    isFirstCampaign: priorApprovals === 0,
                };
            }),
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        });
    } catch (err) {
        return fail(res, err, 'listForReview');
    }
};

/** Everything the dashboard draws, computed here — the frontend aggregates nothing. */
export const getAnalytics = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const months = Math.min(36, Math.max(1, Number(req.query.months) || 12));
        const [summary, series, pipeline] = await Promise.all([
            overview(),
            monthlySeries(months),
            inFlight(),
        ]);

        return res.json({ success: true, data: { ...summary, pipeline, series } });
    } catch (err) {
        return fail(res, err, 'getAnalytics');
    }
};

export const approve = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const campaign = await CampaignModel.findById(req.params.id);
        if (!campaign) throw new AppError('Campagne introuvable.', 404);

        const approved = await approveCampaign(campaign, adminUserId(req));
        log.info(`Campaign ${approved._id} approved by ${approved.reviewedBy}`);
        await notifyCampaignApproved(String(approved.advertiserUserId), approved.title);

        return res.json({
            success: true,
            data: { status: approved.status, reviewedAt: approved.reviewedAt },
        });
    } catch (err) {
        return fail(res, err, 'approveCampaign');
    }
};

export const reject = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const campaign = await CampaignModel.findById(req.params.id);
        if (!campaign) throw new AppError('Campagne introuvable.', 404);

        const rejected = await rejectCampaign(campaign, adminUserId(req), req.body?.reason);
        log.info(`Campaign ${rejected._id} rejected by ${rejected.reviewedBy}`);
        await notifyCampaignRejected(
            String(rejected.advertiserUserId),
            rejected.title,
            rejected.rejectionReason!,
        );

        return res.json({
            success: true,
            data: {
                status: rejected.status,
                reviewedAt: rejected.reviewedAt,
                rejectionReason: rejected.rejectionReason,
            },
        });
    } catch (err) {
        return fail(res, err, 'rejectCampaign');
    }
};
