import { Types } from 'mongoose';
import CampaignParticipationModel, {
    ICampaignParticipation,
    ParticipationStatus,
} from '../database/models/campaign-participation.model';
import DiffuseurProfileModel from '../database/models/diffuseur-profile.model';
import CampaignModel from '../database/models/campaign.model';
import ClickEventModel, { ClickAction } from '../database/models/click-event.model';
import { notifyTestCampaignCompleted } from './clients/notification.service.client';
import logger from '../utils/logger';

const log = logger.getLogger('RankingService');

/**
 * Diffuseur reputation: measured reach, click-through, and reliability.
 *
 * Advertisers pick by these numbers and the allocation engine ranks by them, so
 * they have to reflect what a diffuseur actually delivered rather than what they
 * claimed at signup.
 */

/** Everyone starts here; there is no evidence either way yet. */
const TRUST_START = 50;
const TRUST_ON_COMPLETION = 5;
/** Abandoning costs far more than completing earns — one is the behaviour we are pricing against. */
const TRUST_ON_FORFEIT = -15;
/** Posted something that is not the campaign creative. */
const TRUST_ON_MEDIA_MISMATCH = -10;

const clampTrust = (value: number) => Math.max(0, Math.min(100, value));

/**
 * Rolling average of day-1 views across completed campaigns.
 *
 * Day 1 specifically, because that is what the advertiser buys and what
 * allocation projects against. Averaging all three days would understate reach,
 * since later days reach the same audience with less novelty.
 */
const recomputeAverageViews = async (diffuseurUserId: Types.ObjectId): Promise<number | null> => {
    const result = await CampaignParticipationModel.aggregate<{ avg: number; n: number }>([
        {
            $match: {
                diffuseurUserId,
                status: ParticipationStatus.COMPLETED,
            },
        },
        { $group: { _id: null, avg: { $avg: '$uniqueViews' }, n: { $sum: 1 } } },
    ]);

    if (!result[0]?.n) return null;
    return Math.round(result[0].avg);
};

/**
 * Updates a diffuseur's standing after a campaign completes.
 *
 * The first completion is the test campaign: it replaces their self-declared
 * average with a measured one, which is the whole reason Rufus wanted a test
 * campaign before real allocation.
 */
export const recordCompletion = async (participation: ICampaignParticipation): Promise<void> => {
    const profile = await DiffuseurProfileModel.findById(participation.diffuseurProfileId);
    if (!profile) return;

    const wasFirstCampaign = !profile.hasCompletedTestCampaign;

    profile.campaignsCompleted += 1;
    profile.totalVerifiedViews += participation.totalViews;
    profile.totalClicksGenerated += participation.clicksGenerated;
    profile.lastCampaignCompletedAt = new Date();
    profile.trustScore = clampTrust((profile.trustScore ?? TRUST_START) + TRUST_ON_COMPLETION);

    const measured = await recomputeAverageViews(participation.diffuseurUserId);
    if (measured !== null) profile.measuredAverageViews = measured;

    if (wasFirstCampaign) {
        profile.hasCompletedTestCampaign = true;
    }

    // Posting something other than the campaign creative is deliberate, unlike
    // being late, so it costs trust even on an otherwise complete campaign.
    const mismatched = participation.days.some(d => d.mediaMatches === false);
    if (mismatched) {
        profile.trustScore = clampTrust(profile.trustScore + TRUST_ON_MEDIA_MISMATCH);
        log.warn(`Diffuseur ${profile.userId} posted non-matching media; trust now ${profile.trustScore}`);
    }

    await profile.save();

    if (wasFirstCampaign && measured !== null) {
        await notifyTestCampaignCompleted(String(profile.userId), measured);
        log.info(`Test campaign complete for ${profile.userId}: measured average ${measured} views`);
    }
};

/** Abandoning a campaign after accepting it is the behaviour trust exists to price. */
export const recordForfeit = async (participation: ICampaignParticipation): Promise<void> => {
    const profile = await DiffuseurProfileModel.findById(participation.diffuseurProfileId);
    if (!profile) return;

    // Abandoning the test campaign costs nothing and nobody: it is unpaid, no
    // annonceur is owed views, and it is the diffuseur's very first contact
    // with the flow. Charging trust for it buried beginners in allocation
    // ordering before they had ever run anything — and they are meant to get
    // the campaign offered again and try once more.
    const campaign = await CampaignModel.findById(participation.campaignId)
        .select('isTestCampaign')
        .lean();
    if (campaign?.isTestCampaign) {
        log.info(`Diffuseur ${profile.userId} did not finish the test campaign; no trust penalty, it will be re-offered`);
        return;
    }

    profile.campaignsAbandoned += 1;
    profile.trustScore = clampTrust((profile.trustScore ?? TRUST_START) + TRUST_ON_FORFEIT);
    await profile.save();

    log.info(`Diffuseur ${profile.userId} forfeited; trust now ${profile.trustScore}`);
};

export type LeaderboardEntry = {
    userId: string;
    averageViews: number;
    totalVerifiedViews: number;
    totalClicks: number;
    /** Clicks per view. What separates diffuseurs who deliver results from reach. */
    clickThroughRate: number;
    campaignsCompleted: number;
    trustScore: number;
    isMeasured: boolean;
};

/**
 * The classement Rufus asked for: diffuseurs by views and clicks.
 *
 * Self-declared averages are included but flagged via isMeasured, so an advertiser
 * can tell a proven diffuseur from one who has only made a claim.
 */
export const getLeaderboard = async (opts: {
    page?: number;
    limit?: number;
    sortBy?: 'views' | 'clicks' | 'trust';
    measuredOnly?: boolean;
} = {}): Promise<{ entries: LeaderboardEntry[]; total: number }> => {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, opts.limit ?? 50);

    const filter: Record<string, unknown> = { isActive: true };
    if (opts.measuredOnly) filter.hasCompletedTestCampaign = true;

    const sort: Record<string, 1 | -1> =
        opts.sortBy === 'clicks' ? { totalClicksGenerated: -1 }
            : opts.sortBy === 'trust' ? { trustScore: -1 }
                : { measuredAverageViews: -1, declaredAverageViews: -1 };

    const [profiles, total] = await Promise.all([
        DiffuseurProfileModel.find(filter)
            .sort(sort)
            .skip((page - 1) * limit)
            .limit(limit)
            .lean(),
        DiffuseurProfileModel.countDocuments(filter),
    ]);

    const entries = profiles.map(p => {
        const averageViews = p.hasCompletedTestCampaign && p.measuredAverageViews != null
            ? p.measuredAverageViews
            : (p.declaredAverageViews ?? 0);

        return {
            userId: String(p.userId),
            averageViews,
            totalVerifiedViews: p.totalVerifiedViews ?? 0,
            totalClicks: p.totalClicksGenerated ?? 0,
            clickThroughRate: p.totalVerifiedViews
                ? Number(((p.totalClicksGenerated ?? 0) / p.totalVerifiedViews).toFixed(4))
                : 0,
            campaignsCompleted: p.campaignsCompleted ?? 0,
            trustScore: p.trustScore ?? TRUST_START,
            isMeasured: Boolean(p.hasCompletedTestCampaign),
        };
    });

    return { entries, total };
};

/**
 * Per-diffuseur click breakdown for a campaign, used by the advertiser dashboard
 * to decide who to pick next time.
 */
export const campaignClickBreakdown = async (campaignId: Types.ObjectId) => {
    const rows = await ClickEventModel.aggregate<{
        _id: { diffuseur: Types.ObjectId | null; action: string };
        count: number;
    }>([
        { $match: { campaignId, action: { $ne: ClickAction.VIEW } } },
        { $group: { _id: { diffuseur: '$diffuseurUserId', action: '$action' }, count: { $sum: 1 } } },
    ]);

    const byDiffuseur = new Map<string, Record<string, number>>();
    for (const row of rows) {
        const key = String(row._id.diffuseur ?? 'direct');
        const entry = byDiffuseur.get(key) ?? {};
        entry[row._id.action] = row.count;
        byDiffuseur.set(key, entry);
    }
    return byDiffuseur;
};
