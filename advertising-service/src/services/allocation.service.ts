import { Types } from 'mongoose';
import CampaignModel, { CampaignStatus, ICampaign, ITargeting } from '../database/models/campaign.model';
import CampaignParticipationModel, {
    ParticipationStatus,
    DayStatus,
    IDayProof,
} from '../database/models/campaign-participation.model';
import DiffuseurProfileModel, { IDiffuseurProfile } from '../database/models/diffuseur-profile.model';
import { getUserProfiles, IUserProfile } from './clients/user.service.client';
import { newTrackingCode } from './campaign.service';
import { getTestCampaign } from './test-campaign.service';
import { openParticipation } from './day-window.service';
import { notifyCampaignOffer } from './clients/notification.service.client';
import config from '../config';
import logger from '../utils/logger';

const log = logger.getLogger('AllocationService');

/**
 * Only the fields allocation reads. Declared separately because `.lean()` returns
 * plain objects that do not satisfy the Mongoose Document interface.
 */
type CandidateDiffuseur = Pick<
    IDiffuseurProfile,
    '_id' | 'userId' | 'trustScore' | 'hasCompletedTestCampaign'
> & {
    measuredAverageViews?: number | null;
    declaredAverageViews?: number | null;
};

/** Views a diffuseur is expected to bring. Declared until the test campaign measures it. */
const expectedViews = (p: CandidateDiffuseur): number =>
    p.hasCompletedTestCampaign && p.measuredAverageViews != null
        ? p.measuredAverageViews
        : (p.declaredAverageViews ?? 0);

const ageFrom = (birthDate?: string): number | undefined => {
    if (!birthDate) return undefined;
    const dob = new Date(birthDate);
    if (Number.isNaN(dob.getTime())) return undefined;
    return Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
};

// Accent-insensitive on top of case-insensitive: profiles store cities and
// interests with inconsistent accents ("Yaoundé" vs "Yaounde"), and a
// targeting criterion that silently misses half the matching diffuseurs is
// worse than none.
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const eqi = (a?: string, b?: string) => Boolean(a && b && fold(a) === fold(b));
const anyMatch = (want: string[] | undefined, have: string | undefined) =>
    !want?.length || want.some(w => eqi(w, have));
const anyOverlap = (want: string[] | undefined, have: string[] | undefined) =>
    !want?.length || Boolean(have?.some(h => want.some(w => eqi(w, h))));

/** An omitted criterion means "any". A criterion the user hasn't filled fails. */
export const matchesTargeting = (user: IUserProfile, t: ITargeting): boolean => {
    if (!anyMatch(t.countries, user.country)) return false;
    if (!anyMatch(t.cities, user.city)) return false;
    if (!anyMatch(t.regions, user.region)) return false;
    if (!anyMatch(t.sex, user.sex)) return false;
    if (!anyMatch(t.professions, user.profession)) return false;
    if (!anyOverlap(t.interests, user.interests)) return false;
    if (!anyOverlap(t.languages, user.language)) return false;

    if (t.minAge != null || t.maxAge != null) {
        const age = ageFrom(user.birthDate);
        if (age == null) return false;
        if (t.minAge != null && age < t.minAge) return false;
        if (t.maxAge != null && age > t.maxAge) return false;
    }
    return true;
};

/** Empty day slots, so the rate for each day is fixed when the offer is made. */
const buildDays = (): IDayProof[] =>
    Array.from({ length: config.campaign.durationDays }, (_, i) => ({
        day: i + 1,
        status: DayStatus.PENDING,
        viewCount: 0,
        deliveredCount: 0,
        ratePerView: config.pricing.diffuseurRatePerDay[i] ?? 0,
        earnedAmount: 0,
    }));

/** Views still needed, counting what accepted diffuseurs are expected to bring. */
export const remainingViewsToCover = async (campaign: ICampaign): Promise<number> => {
    const committed = await CampaignParticipationModel.aggregate<{ total: number }>([
        {
            $match: {
                campaignId: campaign._id,
                status: { $in: [ParticipationStatus.IN_PROGRESS, ParticipationStatus.COMPLETED] },
            },
        },
        { $group: { _id: null, total: { $sum: '$uniqueViews' } } },
    ]);

    const delivered = committed[0]?.total ?? 0;
    return Math.max(0, campaign.targetUniqueViews - delivered);
};

/** Diffuseurs already holding a campaign today, who are capped out. */
const busyToday = async (): Promise<Set<string>> => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const busy = await CampaignParticipationModel.find({
        status: { $in: [ParticipationStatus.OFFERED, ParticipationStatus.IN_PROGRESS] },
        offeredAt: { $gte: startOfDay },
    }).select('diffuseurUserId').lean();

    return new Set(busy.map(p => String(p.diffuseurUserId)));
};

export type AllocationResult = {
    offersCreated: number;
    projectedViews: number;
    remainingViews: number;
    /** True when the day cap was relaxed because every match was already busy. */
    capRelaxed: boolean;
};

/**
 * Offers a campaign to matching diffuseurs.
 *
 * Deliberately offers in excess of the target rather than exactly enough: an offer
 * is not an acceptance, most will be ignored, and under-offering stalls the
 * campaign. Over-delivery is bounded because acceptance stops once the target is
 * covered (see acceptOffer).
 */
export const allocateCampaign = async (campaignId: Types.ObjectId): Promise<AllocationResult> => {
    const campaign = await CampaignModel.findById(campaignId);
    if (!campaign) throw new Error(`Campaign ${campaignId} not found`);
    if (campaign.status !== CampaignStatus.ACTIVE) {
        return { offersCreated: 0, projectedViews: 0, remainingViews: 0, capRelaxed: false };
    }

    const remaining = await remainingViewsToCover(campaign);
    if (remaining <= 0) {
        return { offersCreated: 0, projectedViews: 0, remainingViews: 0, capRelaxed: false };
    }

    // Never re-offer to someone who already saw this campaign, whatever they did with it.
    const alreadyOffered = await CampaignParticipationModel
        .find({ campaignId: campaign._id })
        .select('diffuseurUserId')
        .lean();
    const excluded = new Set(alreadyOffered.map(p => String(p.diffuseurUserId)));

    // While a test campaign exists, a diffuseur who has not completed it is not
    // eligible for paid work — their audience is still self-declared, and
    // allocating on a claim spends an annonceur's budget on a guess. With none
    // configured the filter has to be dropped entirely, or nobody is eligible
    // for anything.
    const testCampaign = await getTestCampaign();
    const eligibility: Record<string, unknown> = { isActive: true, whatsappLid: { $exists: true } };
    if (testCampaign && !campaign.isTestCampaign) {
        eligibility.hasCompletedTestCampaign = true;
    }

    const candidates = await DiffuseurProfileModel
        .find(eligibility)
        .sort({ measuredAverageViews: -1, declaredAverageViews: -1, trustScore: -1 })
        .limit(1000)
        .select('_id userId trustScore hasCompletedTestCampaign measuredAverageViews declaredAverageViews')
        .lean<CandidateDiffuseur[]>();

    const fresh = candidates.filter(c => !excluded.has(String(c.userId)));
    if (!fresh.length) {
        return { offersCreated: 0, projectedViews: 0, remainingViews: remaining, capRelaxed: false };
    }

    // One batched lookup; the targeting fields live on the user, not on us.
    const users = await getUserProfiles(fresh.map(c => String(c.userId)));
    const userById = new Map(users.map(u => [String(u._id), u]));

    const targeted = fresh.filter(c => {
        const u = userById.get(String(c.userId));
        return u ? matchesTargeting(u, campaign.targeting) : false;
    });

    const busy = await busyToday();
    let eligible = targeted.filter(c => !busy.has(String(c.userId)));

    // Rufus's exception: if everyone who matches already has a campaign today, an
    // advertiser would otherwise wait a full day for nothing. Relax the cap.
    const capRelaxed = eligible.length === 0 && targeted.length > 0;
    if (capRelaxed) {
        log.info(`Campaign ${campaign._id}: all ${targeted.length} matches busy today, relaxing per-day cap`);
        eligible = targeted;
    }

    // Best reach first, so the target is covered by as few diffuseurs as possible.
    eligible.sort((a, b) => expectedViews(b) - expectedViews(a) || b.trustScore - a.trustScore);

    // Big diffuseurs carry the bulk, then the tail is fitted to what is actually
    // left. Taking them in pure descending order overshot badly at the end: with
    // 200 views still needed, the next 1000-view diffuseur was taken anyway, and
    // an annonceur who bought 2000 unique views received 3000. Generous, but they
    // paid for 2000 and the extra comes out of SBC's margin.
    //
    // At each step: the largest diffuseur who still fits inside the shortfall;
    // and if nobody fits, the smallest who overshoots — so the campaign always
    // completes, by the narrowest margin available.
    const offers: Array<Record<string, unknown>> = [];
    const taken = new Set<string>();
    let projected = 0;

    while (projected < remaining) {
        const stillNeeded = remaining - projected;
        const available = eligible.filter(c => !taken.has(String(c._id)));
        if (!available.length) break;

        const fits = available.filter(c => Math.max(1, expectedViews(c)) <= stillNeeded);
        const pick = fits.length
            ? fits[0]                                  // already descending: the largest that fits
            : available[available.length - 1];         // nobody fits: the smallest overshoot

        taken.add(String(pick._id));
        offers.push({
            campaignId: campaign._id,
            diffuseurUserId: pick.userId,
            diffuseurProfileId: pick._id,
            status: ParticipationStatus.OFFERED,
            trackingCode: newTrackingCode(),
            offeredAt: new Date(),
            days: buildDays(),
        });
        projected += Math.max(1, expectedViews(pick));
    }

    if (!offers.length) {
        return { offersCreated: 0, projectedViews: 0, remainingViews: remaining, capRelaxed };
    }

    // ordered:false so one duplicate (a race with a concurrent run) doesn't drop
    // the rest of the batch.
    try {
        await CampaignParticipationModel.insertMany(offers, { ordered: false });
    } catch (err) {
        log.warn(`Some offers for campaign ${campaign._id} were rejected (likely duplicates):`, err);
    }

    await DiffuseurProfileModel.updateMany(
        { _id: { $in: offers.map(o => o.diffuseurProfileId) } },
        { $set: { lastCampaignOfferedAt: new Date() } },
    );

    // Fire and forget. Allocation must not slow down or fail because a mail
    // server is unhappy, and an undelivered offer email is recoverable — the offer
    // is still visible in the app.
    void Promise.all(
        offers.map(o =>
            notifyCampaignOffer(
                String(o.diffuseurUserId),
                campaign.title,
                expectedViews(eligible.find(c => String(c._id) === String(o.diffuseurProfileId))!),
            ).catch(() => undefined),
        ),
    );

    log.info(`Campaign ${campaign._id}: ${offers.length} offers, ~${projected} projected views, ${remaining} needed`);

    return {
        offersCreated: offers.length,
        projectedViews: projected,
        remainingViews: remaining,
        capRelaxed,
    };
};

/**
 * A diffuseur accepts an offer.
 *
 * Re-checks the target here rather than trusting the offer: several diffuseurs may
 * accept at once, and without this the campaign over-fills and SBC pays for views
 * the advertiser never bought.
 */
export const acceptOffer = async (
    participationId: Types.ObjectId,
    diffuseurUserId: Types.ObjectId,
) => {
    const participation = await CampaignParticipationModel.findOne({
        _id: participationId,
        diffuseurUserId,
    });
    if (!participation) throw new Error('Offer not found');
    if (participation.status !== ParticipationStatus.OFFERED) {
        throw new Error('Cette campagne n\'est plus disponible.');
    }

    const campaign = await CampaignModel.findById(participation.campaignId);
    if (!campaign || campaign.status !== CampaignStatus.ACTIVE) {
        participation.status = ParticipationStatus.EXPIRED;
        await participation.save();
        throw new Error('Cette campagne n\'est plus active.');
    }

    const remaining = await remainingViewsToCover(campaign);
    if (remaining <= 0) {
        participation.status = ParticipationStatus.EXPIRED;
        await participation.save();
        throw new Error('Cette campagne a déjà atteint son objectif.');
    }

    const now = new Date();

    participation.status = ParticipationStatus.IN_PROGRESS;
    participation.acceptedAt = now;
    participation.startedAt = now;
    // Both clocks start now: 24h to post day 1, and durationDays + graceDays to
    // finish everything.
    openParticipation(participation, now);
    await participation.save();

    return participation;
};

/** Withdraws outstanding offers once the target is covered. */
export const expireStaleOffers = async (campaignId: Types.ObjectId): Promise<number> => {
    const campaign = await CampaignModel.findById(campaignId);
    if (!campaign) return 0;

    const remaining = await remainingViewsToCover(campaign);
    if (remaining > 0) return 0;

    const result = await CampaignParticipationModel.updateMany(
        { campaignId, status: ParticipationStatus.OFFERED },
        { $set: { status: ParticipationStatus.EXPIRED } },
    );
    return result.modifiedCount;
};
