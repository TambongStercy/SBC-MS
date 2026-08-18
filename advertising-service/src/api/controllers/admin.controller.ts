import { Response } from 'express';
import { Types } from 'mongoose';
import CampaignModel, { CampaignStatus } from '../../database/models/campaign.model';
import CampaignParticipationModel from '../../database/models/campaign-participation.model';
import { campaignClickBreakdown, getLeaderboard as leaderboard } from '../../services/ranking.service';
import {
    approveCampaign,
    rejectCampaign,
    approvedCampaignCounts,
    campaignProgress,
} from '../../services/campaign.service';
import { overview, monthlySeries, inFlight } from '../../services/analytics.service';
import {
    getTestCampaign,
    upsertTestCampaign,
    retireTestCampaign,
    offerTestCampaignToNewDiffuseurs,
} from '../../services/test-campaign.service';
import { getUserProfiles } from '../../services/clients/user.service.client';
import { previewSignature } from './public.controller';
import {
    assertSimulationAllowed,
    simulatePayment,
    shiftParticipationClock,
    simulateVerification,
    simulationSnapshot,
    activeCampaignsForSimulation,
} from '../../services/simulation.service';
import { notifyCampaignApproved, notifyCampaignRejected } from '../../services/clients/notification.service.client';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { AppError } from '../../utils/errors';
import config from '../../config';
import logger from '../../utils/logger';

const log = logger.getLogger('AdminController');

const fail = (res: Response, err: unknown, context: string) => {
    // A Mongoose ValidationError carries the real reason (e.g. a field over its
    // maxlength). Without this it falls through to the generic 500 below and the
    // admin sees "Une erreur est survenue" with no clue which field is wrong.
    if (err instanceof Error && err.name === 'ValidationError') {
        const first = Object.values((err as { errors?: Record<string, { message?: string }> }).errors ?? {})[0];
        return res.status(400).json({ success: false, message: first?.message || err.message });
    }
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

        // Managed on its own page, and its "progress" is meaningless here: it has
        // no view target, so it renders as 21/1 (100%).
        const filter: Record<string, unknown> = { isTestCampaign: { $ne: true } };
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
                    // Signed, so an admin can open a campaign that is not live yet
                    // — which is every campaign in this queue.
                    previewUrl: `${config.publicBaseUrl.replace(/\/$/, '')}/a/${c.landingPageSlug}`
                        + `?preview=${previewSignature(c.landingPageSlug)}`,
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

/**
 * Per-diffuseur breakdown for any campaign.
 *
 * Same shape the annonceur sees on their own campaign, minus the ownership scope —
 * an admin investigating a complaint has no way in otherwise.
 */
export const getCampaignPerformance = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const campaign = await CampaignModel.findById(req.params.id);
        if (!campaign) throw new AppError('Campagne introuvable.', 404);

        const participations = await CampaignParticipationModel
            .find({ campaignId: campaign._id })
            .select('diffuseurUserId status uniqueViews repeatViews totalViews clicksGenerated totalEarned creditedAt trackingCode acceptedAt')
            .lean();

        const [byDiffuseur, profiles] = await Promise.all([
            campaignClickBreakdown(campaign._id),
            getUserProfiles([...new Set(participations.map(p => String(p.diffuseurUserId)))]).catch(() => []),
        ]);
        const profileById = new Map(profiles.map(p => [String(p._id), p]));

        return res.json({
            success: true,
            data: {
                campaign: { ...campaign.toObject(), progress: campaignProgress(campaign) },
                diffuseurs: participations.map(p => ({
                    diffuseurUserId: p.diffuseurUserId,
                    name: profileById.get(String(p.diffuseurUserId))?.name ?? null,
                    phoneNumber: profileById.get(String(p.diffuseurUserId))?.phoneNumber ?? null,
                    status: p.status,
                    acceptedAt: p.acceptedAt,
                    uniqueViews: p.uniqueViews,
                    repeatViews: p.repeatViews,
                    totalViews: p.totalViews,
                    clicks: p.clicksGenerated,
                    clicksByAction: byDiffuseur.get(String(p.diffuseurUserId)) ?? {},
                    earned: p.totalEarned,
                    paidAt: p.creditedAt ?? null,
                    clickThroughRate: p.totalViews > 0
                        ? Number((p.clicksGenerated / p.totalViews).toFixed(4))
                        : 0,
                })),
            },
        });
    } catch (err) {
        return fail(res, err, 'getCampaignPerformance');
    }
};

/**
 * The diffuseur leaderboard with identities attached.
 *
 * The public leaderboard deliberately exposes user ids only; an admin chasing a
 * complaint needs to know who the row actually is.
 */
export const listDiffuseurs = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { entries, total } = await leaderboard({
            page: Number(req.query.page) || 1,
            limit: Number(req.query.limit) || 50,
            sortBy: req.query.sortBy as 'views' | 'clicks' | 'trust' | undefined,
            measuredOnly: req.query.measuredOnly === 'true',
        });

        const profiles = await getUserProfiles(entries.map(e => e.userId)).catch(err => {
            log.warn(`Could not resolve diffuseur profiles: ${(err as Error).message}`);
            return [];
        });
        const profileById = new Map(profiles.map(p => [String(p._id), p]));

        return res.json({
            success: true,
            data: entries.map(e => ({
                ...e,
                name: profileById.get(e.userId)?.name ?? null,
                phoneNumber: profileById.get(e.userId)?.phoneNumber ?? null,
                country: profileById.get(e.userId)?.country ?? null,
            })),
            pagination: { total, page: Number(req.query.page) || 1 },
        });
    } catch (err) {
        return fail(res, err, 'listDiffuseurs');
    }
};

/**
 * The test campaign an admin has configured, with how many diffuseurs it has
 * measured so far. Answers 200 with data: null when there is none — an empty
 * editor is a normal state, not an error.
 */
export const getTestCampaignConfig = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const campaign = await getTestCampaign();
        if (!campaign) return res.json({ success: true, data: null });

        const [offered, inProgress, completed] = await Promise.all([
            CampaignParticipationModel.countDocuments({ campaignId: campaign._id, status: 'offered' }),
            CampaignParticipationModel.countDocuments({ campaignId: campaign._id, status: 'in_progress' }),
            CampaignParticipationModel.countDocuments({ campaignId: campaign._id, status: 'completed' }),
        ]);

        return res.json({
            success: true,
            data: {
                ...campaign.toObject(),
                landingPageUrl: `${config.publicBaseUrl.replace(/\/$/, '')}/a/${campaign.landingPageSlug}`,
                stats: { offered, inProgress, measured: completed },
            },
        });
    } catch (err) {
        return fail(res, err, 'getTestCampaignConfig');
    }
};

/** Creates the test campaign, or edits the live one in place. */
export const saveTestCampaign = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const campaign = await upsertTestCampaign(adminUserId(req), req.body);
        // Push it to anyone waiting on one straight away, rather than making the
        // admin wait for the next scheduler tick to see it take effect.
        const offered = await offerTestCampaignToNewDiffuseurs().catch(() => 0);

        return res.json({
            success: true,
            data: {
                ...campaign.toObject(),
                landingPageUrl: `${config.publicBaseUrl.replace(/\/$/, '')}/a/${campaign.landingPageSlug}`,
                offeredNow: offered,
            },
        });
    } catch (err) {
        return fail(res, err, 'saveTestCampaign');
    }
};

/**
 * Retires it. New diffuseurs then go straight to paid campaigns on their
 * declared figure, so this is a deliberate loosening, not a delete.
 */
export const removeTestCampaign = async (req: AuthenticatedRequest, res: Response) => {
    try {
        const retired = await retireTestCampaign();
        return res.json({ success: true, data: { retired } });
    } catch (err) {
        return fail(res, err, 'removeTestCampaign');
    }
};

/**
 * Preprod testing tools. Refused outright in production, and behind the admin
 * role on top of that.
 */
export const getSimulationState = async (req: AuthenticatedRequest, res: Response) => {
    try {
        assertSimulationAllowed();
        const [participations, campaigns] = await Promise.all([
            simulationSnapshot(req.query.userId as string | undefined),
            activeCampaignsForSimulation(),
        ]);
        return res.json({ success: true, data: { participations, campaigns } });
    } catch (err) {
        return fail(res, err, 'getSimulationState');
    }
};

/** Activates a campaign as though payment had cleared. Moderation still applies. */
export const runSimulatePayment = async (req: AuthenticatedRequest, res: Response) => {
    try {
        assertSimulationAllowed();
        const result = await simulatePayment(req.params.id);
        log.warn(`Payment simulated for campaign ${req.params.id} by admin ${adminUserId(req)}`);
        return res.json({ success: true, data: result });
    } catch (err) {
        return fail(res, err, 'simulatePayment');
    }
};

/** Moves a participation's whole clock back, so the next day opens now. */
export const runShiftClock = async (req: AuthenticatedRequest, res: Response) => {
    try {
        assertSimulationAllowed();
        const hours = Number(req.body?.hours ?? 24);
        const result = await shiftParticipationClock(req.params.id, hours);
        log.warn(`Clock shifted ${hours}h for participation ${req.params.id} by admin ${adminUserId(req)}`);
        return res.json({ success: true, data: result });
    } catch (err) {
        return fail(res, err, 'shiftClock');
    }
};

/** Fills in a verified day without needing a phone and a real status. */
export const runSimulateVerification = async (req: AuthenticatedRequest, res: Response) => {
    try {
        assertSimulationAllowed();
        const result = await simulateVerification(
            req.params.id,
            Number(req.body?.day),
            Number(req.body?.viewCount),
        );
        log.warn(`Verification simulated for participation ${req.params.id} by admin ${adminUserId(req)}`);
        return res.json({ success: true, data: result });
    } catch (err) {
        return fail(res, err, 'simulateVerification');
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
