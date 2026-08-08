import { PipelineStage } from 'mongoose';
import CampaignModel, { CampaignStatus } from '../database/models/campaign.model';
import CampaignParticipationModel, { ParticipationStatus } from '../database/models/campaign-participation.model';
import DiffuseurProfileModel from '../database/models/diffuseur-profile.model';

/**
 * Statuses a campaign only reaches after money has landed. Used everywhere revenue
 * is counted, so an unpaid draft can never inflate it.
 */
const PAID_STATUSES = [CampaignStatus.ACTIVE, CampaignStatus.COMPLETED, CampaignStatus.BANKED];

const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);

const sumOne = async <T>(
    model: { aggregate: <R>(pipeline: PipelineStage[]) => { exec(): Promise<R[]> } },
    pipeline: PipelineStage[],
): Promise<T | null> => {
    const [row] = await model.aggregate<T>(pipeline).exec();
    return row ?? null;
};

/**
 * The numbers Rufus asked to see on the admin dashboard.
 *
 * "This month" is calendar month in server time, which is what a monthly report
 * means to him — not a rolling 30 days.
 */
export const overview = async () => {
    const monthStart = startOfMonth(new Date());

    const [
        campaignTotals,
        monthCampaigns,
        annonceurs,
        newAnnonceurs,
        diffuseurTotal,
        newDiffuseurs,
        payouts,
        byStatus,
    ] = await Promise.all([
        sumOne<{ revenue: number; uniqueViews: number; repeatViews: number; clicks: number; count: number }>(
            CampaignModel,
            [
                { $match: { status: { $in: PAID_STATUSES } } },
                {
                    $group: {
                        _id: null,
                        count: { $sum: 1 },
                        revenue: { $sum: '$amountPaid' },
                        uniqueViews: { $sum: '$uniqueViewsDelivered' },
                        repeatViews: { $sum: '$repeatViewsDelivered' },
                        clicks: { $sum: '$clicksTotal' },
                    },
                },
            ],
        ),
        sumOne<{ launched: number; revenue: number }>(CampaignModel, [
            { $match: { status: { $in: PAID_STATUSES }, activatedAt: { $gte: monthStart } } },
            { $group: { _id: null, launched: { $sum: 1 }, revenue: { $sum: '$amountPaid' } } },
        ]),
        CampaignModel.distinct('advertiserUserId', { status: { $in: PAID_STATUSES } }),
        // An annonceur is "new" the month their first paid campaign went live, not
        // the month they created an account they may never have used.
        CampaignModel.aggregate([
            { $match: { status: { $in: PAID_STATUSES } } },
            { $group: { _id: '$advertiserUserId', firstAt: { $min: '$activatedAt' } } },
            { $match: { firstAt: { $gte: monthStart } } },
            { $count: 'count' },
        ]),
        DiffuseurProfileModel.countDocuments({ isActive: true }),
        DiffuseurProfileModel.countDocuments({ createdAt: { $gte: monthStart } }),
        sumOne<{ paidOut: number; completed: number }>(CampaignParticipationModel, [
            { $match: { creditedAt: { $exists: true } } },
            { $group: { _id: null, paidOut: { $sum: '$totalEarned' }, completed: { $sum: 1 } } },
        ]),
        CampaignModel.aggregate<{ _id: CampaignStatus; count: number }>([
            { $group: { _id: '$status', count: { $sum: 1 } } },
        ]),
    ]);

    const statusCounts = Object.fromEntries(byStatus.map(r => [r._id, r.count])) as Record<string, number>;
    const revenue = campaignTotals?.revenue ?? 0;
    const paidToDiffuseurs = payouts?.paidOut ?? 0;

    return {
        annonceurs: {
            total: annonceurs.length,
            newThisMonth: newAnnonceurs[0]?.count ?? 0,
        },
        diffuseurs: {
            total: diffuseurTotal,
            newThisMonth: newDiffuseurs,
        },
        campaigns: {
            total: campaignTotals?.count ?? 0,
            launchedThisMonth: monthCampaigns?.launched ?? 0,
            completedThisMonth: statusCounts[CampaignStatus.COMPLETED] ?? 0,
            /** The queue an admin has to work through. Drives the review badge. */
            pendingReview: statusCounts[CampaignStatus.PENDING_REVIEW] ?? 0,
            byStatus: statusCounts,
        },
        delivery: {
            uniqueViews: campaignTotals?.uniqueViews ?? 0,
            repeatViews: campaignTotals?.repeatViews ?? 0,
            totalViews: (campaignTotals?.uniqueViews ?? 0) + (campaignTotals?.repeatViews ?? 0),
            clicks: campaignTotals?.clicks ?? 0,
        },
        money: {
            revenue,
            revenueThisMonth: monthCampaigns?.revenue ?? 0,
            paidToDiffuseurs,
            /** What is left after diffuseurs, before the referral commission. */
            grossMargin: revenue - paidToDiffuseurs,
            participationsPaid: payouts?.completed ?? 0,
        },
    };
};

/**
 * Monthly buckets for the dashboard graphs.
 *
 * Months with no activity are emitted as zeroes rather than skipped — a gap in the
 * series reads as a flat line between two points, which is a different claim.
 */
export const monthlySeries = async (months = 12) => {
    const from = addMonths(startOfMonth(new Date()), -(months - 1));

    const bucket = { $dateToString: { format: '%Y-%m', date: '$activatedAt' } };

    const [campaigns, diffuseurs, payouts] = await Promise.all([
        CampaignModel.aggregate<{ _id: string; launched: number; revenue: number; views: number; clicks: number }>([
            { $match: { status: { $in: PAID_STATUSES }, activatedAt: { $gte: from } } },
            {
                $group: {
                    _id: bucket,
                    launched: { $sum: 1 },
                    revenue: { $sum: '$amountPaid' },
                    views: { $sum: { $add: ['$uniqueViewsDelivered', '$repeatViewsDelivered'] } },
                    clicks: { $sum: '$clicksTotal' },
                },
            },
        ]),
        DiffuseurProfileModel.aggregate<{ _id: string; joined: number }>([
            { $match: { createdAt: { $gte: from } } },
            { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, joined: { $sum: 1 } } },
        ]),
        CampaignParticipationModel.aggregate<{ _id: string; paidOut: number }>([
            { $match: { creditedAt: { $gte: from } } },
            { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$creditedAt' } }, paidOut: { $sum: '$totalEarned' } } },
        ]),
    ]);

    const campaignByMonth = new Map(campaigns.map(r => [r._id, r]));
    const diffuseurByMonth = new Map(diffuseurs.map(r => [r._id, r.joined]));
    const payoutByMonth = new Map(payouts.map(r => [r._id, r.paidOut]));

    return Array.from({ length: months }, (_, i) => {
        const d = addMonths(from, i);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const c = campaignByMonth.get(key);
        return {
            month: key,
            campaignsLaunched: c?.launched ?? 0,
            revenue: c?.revenue ?? 0,
            views: c?.views ?? 0,
            clicks: c?.clicks ?? 0,
            newDiffuseurs: diffuseurByMonth.get(key) ?? 0,
            paidToDiffuseurs: payoutByMonth.get(key) ?? 0,
        };
    });
};

/** Campaigns whose diffuseurs are still mid-run. Shows an admin what is in flight. */
export const inFlight = async () => {
    const [rows] = await CampaignParticipationModel.aggregate<{ inProgress: number; offered: number }>([
        {
            $group: {
                _id: null,
                inProgress: {
                    $sum: { $cond: [{ $eq: ['$status', ParticipationStatus.IN_PROGRESS] }, 1, 0] },
                },
                offered: {
                    $sum: { $cond: [{ $eq: ['$status', ParticipationStatus.OFFERED] }, 1, 0] },
                },
            },
        },
    ]);
    return { inProgress: rows?.inProgress ?? 0, offered: rows?.offered ?? 0 };
};
