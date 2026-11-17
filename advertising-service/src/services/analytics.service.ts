import { PipelineStage } from 'mongoose';
import CampaignModel, { CampaignStatus } from '../database/models/campaign.model';
import CampaignParticipationModel, { ParticipationStatus } from '../database/models/campaign-participation.model';
import DiffuseurProfileModel from '../database/models/diffuseur-profile.model';
import { AdminFilters, dateMatch } from '../utils/admin-filters';
import { advertiserMatch, advertiserCampaignIds, diffuseurMatch } from './admin-scope.service';

/**
 * Statuses a campaign only reaches after money has landed. Used everywhere revenue
 * is counted, so an unpaid draft can never inflate it.
 */
const PAID_STATUSES = [CampaignStatus.ACTIVE, CampaignStatus.COMPLETED, CampaignStatus.BANKED];

/**
 * The test campaign is SBC's own measuring instrument: nobody pays for it and
 * nobody is paid for it. Counted here it inflated campaign totals, view counts
 * and the annonceur roster with SBC's own admin — the admin dashboard is meant
 * to answer "how is the marketplace doing", and the test campaign is not the
 * marketplace. It has its own page.
 */
const NOT_TEST = { isTestCampaign: { $ne: true } };

/**
 * Test-campaign ids, for excluding their participations.
 *
 * Stated as "not one of these" rather than "one of the real ones": a
 * participation whose campaign has been deleted is still real money that was
 * paid out, and an inclusive list would silently drop it from the totals.
 */
const testCampaignIds = async () =>
    (await CampaignModel.find({ isTestCampaign: true }).select('_id').lean()).map(c => c._id);

/**
 * Participations to count: never the test campaign's, and with a country, only
 * those of that country's annonceurs' campaigns (so "paid to diffuseurs" stays
 * comparable with that country's revenue, and the gross margin means something).
 */
const participationCampaignMatch = async (country?: string) => {
    const scoped = await advertiserCampaignIds(country);
    return {
        campaignId: {
            $nin: await testCampaignIds(),
            ...(scoped ? { $in: scoped } : {}),
        },
    };
};

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
 *
 * Admin filters (phase 3):
 * - country: campaign figures (revenue, views, annonceurs, statuses, paid to
 *   diffuseurs) by the ANNONCEUR's country; diffuseur headcounts by the
 *   DIFFUSEUR's country.
 * - from/to: paid-campaign totals and annonceurs on `activatedAt` (when the
 *   campaign went live, which is when its revenue counts — same date as the
 *   monthly graph); status counts on the campaign's `createdAt`; diffuseurs on
 *   their profile's `createdAt`; paid out on `creditedAt`. The "…ThisMonth"
 *   figures keep their fixed calendar-month meaning (country only).
 */
export const overview = async (filters: AdminFilters = {}) => {
    const monthStart = startOfMonth(new Date());
    const [adv, diff, participationScope] = await Promise.all([
        advertiserMatch(filters.country),
        diffuseurMatch('userId', filters.country),
        participationCampaignMatch(filters.country),
    ]);
    const launched = dateMatch('activatedAt', filters);

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
                { $match: { status: { $in: PAID_STATUSES }, ...NOT_TEST, ...adv, ...launched } },
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
            { $match: { status: { $in: PAID_STATUSES }, activatedAt: { $gte: monthStart }, ...NOT_TEST, ...adv } },
            { $group: { _id: null, launched: { $sum: 1 }, revenue: { $sum: '$amountPaid' } } },
        ]),
        CampaignModel.distinct('advertiserUserId', { status: { $in: PAID_STATUSES }, ...NOT_TEST, ...adv, ...launched }),
        // An annonceur is "new" the month their first paid campaign went live, not
        // the month they created an account they may never have used.
        CampaignModel.aggregate([
            { $match: { status: { $in: PAID_STATUSES }, ...NOT_TEST, ...adv } },
            { $group: { _id: '$advertiserUserId', firstAt: { $min: '$activatedAt' } } },
            { $match: { firstAt: { $gte: monthStart } } },
            { $count: 'count' },
        ]),
        DiffuseurProfileModel.countDocuments({ isActive: true, ...diff, ...dateMatch('createdAt', filters) }),
        DiffuseurProfileModel.countDocuments({ createdAt: { $gte: monthStart }, ...diff }),
        sumOne<{ paidOut: number; completed: number }>(CampaignParticipationModel, [
            {
                $match: {
                    creditedAt: { $exists: true, ...(dateMatch('creditedAt', filters).creditedAt ?? {}) },
                    ...participationScope,
                },
            },
            { $group: { _id: null, paidOut: { $sum: '$totalEarned' }, completed: { $sum: 1 } } },
        ]),
        CampaignModel.aggregate<{ _id: CampaignStatus; count: number }>([
            { $match: { ...NOT_TEST, ...adv, ...dateMatch('createdAt', filters) } },
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
 *
 * Admin filters: country as in `overview`. With from/to the buckets run from
 * from's month to to's month (to defaults to now; at most 36 buckets) instead of
 * the last `months`, and only records inside [from, to] are counted — campaigns
 * on `activatedAt`, diffuseurs on `createdAt`, payouts on `creditedAt`.
 */
export const monthlySeries = async (months = 12, filters: AdminFilters = {}) => {
    const now = new Date();
    const end = filters.to && filters.to < now ? filters.to : now;
    if (filters.from || filters.to) {
        const first = filters.from ? startOfMonth(filters.from) : addMonths(startOfMonth(end), -(months - 1));
        const span = (end.getFullYear() - first.getFullYear()) * 12 + (end.getMonth() - first.getMonth()) + 1;
        months = Math.min(36, Math.max(1, span));
    }
    const from = addMonths(startOfMonth(end), -(months - 1));
    // Lower bound of the counted records: the first bucket, or `from` itself when
    // it falls inside it; upper bound only when `to` was given.
    const lower = filters.from && filters.from > from ? filters.from : from;
    const range = (field: string) => ({ [field]: { $gte: lower, ...(filters.to ? { $lte: filters.to } : {}) } });

    const [adv, diff, participationScope] = await Promise.all([
        advertiserMatch(filters.country),
        diffuseurMatch('userId', filters.country),
        participationCampaignMatch(filters.country),
    ]);

    const bucket = { $dateToString: { format: '%Y-%m', date: '$activatedAt' } };

    const [campaigns, diffuseurs, payouts] = await Promise.all([
        CampaignModel.aggregate<{ _id: string; launched: number; revenue: number; views: number; clicks: number }>([
            { $match: { status: { $in: PAID_STATUSES }, ...range('activatedAt'), ...NOT_TEST, ...adv } },
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
            { $match: { ...range('createdAt'), ...diff } },
            { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, joined: { $sum: 1 } } },
        ]),
        CampaignParticipationModel.aggregate<{ _id: string; paidOut: number }>([
            { $match: { ...range('creditedAt'), ...participationScope } },
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

/**
 * Campaigns whose diffuseurs are still mid-run. Shows an admin what is in flight.
 *
 * A live state ("right now"), so from/to do not apply; country does, by the
 * campaign's annonceur.
 */
export const inFlight = async (filters: AdminFilters = {}) => {
    const [rows] = await CampaignParticipationModel.aggregate<{ inProgress: number; offered: number }>([
        { $match: await participationCampaignMatch(filters.country) },
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
