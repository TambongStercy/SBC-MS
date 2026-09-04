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
import { AppError } from '../utils/errors';
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

/** A day 1 that can no longer change the unique-view count it contributed. */
const dayOneSettled = (days: IDayProof[]): boolean => {
    const day1 = days.find(d => d.day === 1);
    return Boolean(day1 && day1.status !== DayStatus.PENDING && day1.status !== DayStatus.POSTED);
};

/**
 * Views still needed, counting reach already booked as well as reach delivered.
 *
 * Booked, not just delivered: a diffuseur who accepts today posts within 24h and
 * is only verified after that, so a delivered-only count reads zero for a full day
 * after the campaign is fully staffed. sweepUnderfilledCampaigns runs every tick,
 * saw the target untouched every time, and handed the campaign to a fresh batch of
 * diffuseurs on each pass — an annonceur who bought 2000 unique views was billed
 * 2517 on day 1 alone, with more diffuseurs still posting (Rufus, 2026-09-04).
 *
 * Pass `excludeParticipationId` when deciding whether one specific offer may still
 * be accepted: its own reservation must not be what makes it look too late. Pass
 * `acceptedOnly` to ask the different question "is this campaign finished?", where
 * an offer nobody has taken up yet delivers nothing and must count for nothing.
 */
export const remainingViewsToCover = async (
    campaign: ICampaign,
    { excludeParticipationId, acceptedOnly = false }: {
        excludeParticipationId?: Types.ObjectId;
        acceptedOnly?: boolean;
    } = {},
): Promise<number> => {
    // The test campaign is a measuring instrument, not an ad buy: its target is
    // a placeholder and must never gate anything. Treating it as real expired
    // every acceptance after the first diffuseur delivered a view — accepting
    // showed « objectif déjà atteint » and the offer just vanished (Jamelle and
    // Christian, 2026-08-10).
    if (campaign.isTestCampaign) return Number.POSITIVE_INFINITY;

    const counted = [ParticipationStatus.IN_PROGRESS, ParticipationStatus.COMPLETED];
    if (!acceptedOnly) counted.push(ParticipationStatus.OFFERED);

    const live = await CampaignParticipationModel.find({
        campaignId: campaign._id,
        status: { $in: counted },
        ...(excludeParticipationId ? { _id: { $ne: excludeParticipationId } } : {}),
    }).select('status uniqueViews expectedViews diffuseurProfileId offeredAt days').lean();

    // Participations offered before the reservation field existed carry no
    // forecast, and would reserve nothing at all — exactly the bug this fixes.
    // Their profile is still the best estimate available.
    const missing = live.filter(p => p.status !== ParticipationStatus.COMPLETED && !p.expectedViews);
    const forecastByProfile = new Map<string, number>();
    if (missing.length) {
        const profiles = await DiffuseurProfileModel
            .find({ _id: { $in: missing.map(p => p.diffuseurProfileId) } })
            .select('_id hasCompletedTestCampaign measuredAverageViews declaredAverageViews')
            .lean<CandidateDiffuseur[]>();
        for (const p of profiles) forecastByProfile.set(String(p._id), expectedViews(p));
    }

    const staleBefore = Date.now() - config.campaign.offerTtlHours * 60 * 60 * 1000;

    let committed = 0;
    for (const p of live) {
        if (p.status === ParticipationStatus.COMPLETED) {
            committed += p.uniqueViews;
            continue;
        }

        const forecast = p.expectedViews || forecastByProfile.get(String(p.diffuseurProfileId)) || 0;

        if (p.status === ParticipationStatus.OFFERED) {
            // An offer nobody ever answered stops holding a slot, so the campaign
            // can be handed to someone who will actually post it.
            if (p.offeredAt.getTime() > staleBefore) committed += forecast;
            continue;
        }

        // In progress: once day 1 is verified, missed or failed, what they brought
        // is final. Before that, their forecast is all we have — and if they have
        // already beaten it, the larger number is the honest reservation.
        committed += dayOneSettled(p.days) ? p.uniqueViews : Math.max(p.uniqueViews, forecast);
    }

    return Math.max(0, campaign.targetUniqueViews - committed);
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
 * Offers exactly enough forecast reach to cover what is still uncovered, and each
 * offer holds its share until it is accepted, declined, or goes stale. A campaign
 * with every slot booked therefore stops being offered rather than being topped up
 * again on the next tick — see remainingViewsToCover.
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

    // Targeting that matches nobody is indistinguishable, from the outside, from
    // diffuseurs ignoring the campaign: it simply sits at zero with « aucun
    // diffuseur n'a accepté ». Say so, with the criteria, so it is diagnosable
    // instead of looking like disinterest.
    if (!targeted.length) {
        log.warn(
            `Campaign ${campaign._id}: targeting matches NONE of the ${fresh.length} available `
            + `diffuseurs, so no offer can be made. Targeting: ${JSON.stringify(campaign.targeting)}`,
        );
        return { offersCreated: 0, projectedViews: 0, remainingViews: remaining, capRelaxed: false };
    }

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

        const forecast = Math.max(1, expectedViews(pick));
        taken.add(String(pick._id));
        offers.push({
            campaignId: campaign._id,
            diffuseurUserId: pick.userId,
            diffuseurProfileId: pick._id,
            status: ParticipationStatus.OFFERED,
            trackingCode: newTrackingCode(),
            offeredAt: new Date(),
            expectedViews: forecast,
            days: buildDays(),
        });
        projected += forecast;
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
    if (!participation) throw new AppError('Offre introuvable.', 404);
    if (participation.status !== ParticipationStatus.OFFERED) {
        throw new AppError('Cette campagne n\'est plus disponible.', 409);
    }

    const campaign = await CampaignModel.findById(participation.campaignId);
    if (!campaign || campaign.status !== CampaignStatus.ACTIVE) {
        participation.status = ParticipationStatus.EXPIRED;
        await participation.save();
        throw new AppError('Cette campagne n\'est plus active.', 409);
    }

    // acceptedOnly, and excluding this participation. Reservations exist to stop
    // the campaign being offered to MORE people; they must not turn round and
    // refuse the people it was already offered to. Someone holding a genuine offer
    // is turned away only once the diffuseurs who accepted already cover the
    // target — including, on the other side, their own reservation, which would
    // otherwise make whoever completed the staffing reject themselves.
    const remaining = await remainingViewsToCover(campaign, {
        acceptedOnly: true,
        excludeParticipationId: participation._id,
    });
    if (remaining <= 0) {
        participation.status = ParticipationStatus.EXPIRED;
        await participation.save();
        throw new AppError('Cette campagne a déjà atteint son objectif.', 409);
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

/**
 * Withdraws outstanding offers once accepted diffuseurs alone cover the target.
 *
 * acceptedOnly, or this expires precisely the offers whose own reservations made
 * the campaign look covered, freeing the capacity that then gets re-offered next
 * tick — churning the campaign around the diffuseur pool forever.
 */
export const expireStaleOffers = async (campaignId: Types.ObjectId): Promise<number> => {
    const campaign = await CampaignModel.findById(campaignId);
    if (!campaign) return 0;

    const remaining = await remainingViewsToCover(campaign, { acceptedOnly: true });
    if (remaining > 0) return 0;

    const result = await CampaignParticipationModel.updateMany(
        { campaignId, status: ParticipationStatus.OFFERED },
        { $set: { status: ParticipationStatus.EXPIRED } },
    );
    return result.modifiedCount;
};
