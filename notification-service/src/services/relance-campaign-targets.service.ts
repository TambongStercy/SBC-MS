import mongoose from 'mongoose';
import RelanceTargetModel, { TargetStatus } from '../database/models/relance-target.model';
import { TargetFilter } from '../database/models/relance-campaign.model';
import { userServiceClient } from './clients/user.service.client';

/** One email a day for 7 days: what a filleul costs at most. */
export const EMAILS_PER_FILLEUL = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const hasPaidInscription = (ref: any) =>
    Array.isArray(ref.activeSubscriptionTypes) &&
    (ref.activeSubscriptionTypes.includes('CLASSIQUE') || ref.activeSubscriptionTypes.includes('CIBLE'));

/**
 * The parrain's referrals that a campaign with this filter would reach, newest
 * first. The campaign preview and the enrollment job both use this, so the
 * number a parrain is shown is the number that gets enrolled — they used to
 * carry two copies of the same filter code.
 */
/**
 * A parrain's whole filleul list, kept briefly for the wizard's live count.
 * Fetching it takes ~8s for a network the size of millioncfa's (35,000), and
 * the count runs again on every tap of a period chip; the stale number shown
 * meanwhile read as the answer (Rufus, 2026-10-07). Campaign creation never
 * uses this: it always reads a fresh list.
 */
const REFERRAL_CACHE_MS = 5 * 60_000;
const REFERRAL_CACHE_MAX = 50;
const referralCache = new Map<string, { at: number; list: any[] }>();
export const resetReferralCache = () => referralCache.clear();

async function cachedReferrals(userId: string): Promise<any[]> {
    const hit = referralCache.get(userId);
    if (hit && Date.now() - hit.at < REFERRAL_CACHE_MS) return hit.list;
    const list: any[] = await userServiceClient.getReferralsForCampaign(userId);
    if (list.length) {
        referralCache.delete(userId);
        referralCache.set(userId, { at: Date.now(), list });
        if (referralCache.size > REFERRAL_CACHE_MAX) referralCache.delete(referralCache.keys().next().value!);
    }
    return list;
}

export async function matchCampaignReferrals(userId: string, filter: TargetFilter, opts: { cached?: boolean } = {}): Promise<any[]> {
    const dateFrom = filter.registrationDateFrom ? new Date(filter.registrationDateFrom).toISOString() : undefined;
    const dateTo = filter.registrationDateTo ? new Date(filter.registrationDateTo).toISOString() : undefined;
    let referrals: any[];
    if (opts.cached) {
        // The whole list, filtered here, so every period answers from one fetch.
        const from = dateFrom ? new Date(dateFrom).getTime() : -Infinity;
        const to = dateTo ? new Date(dateTo).getTime() : Infinity;
        referrals = (await cachedReferrals(userId)).filter(ref => {
            const t = ref.createdAt ? new Date(ref.createdAt).getTime() : NaN;
            return !Number.isNaN(t) ? t >= from && t <= to : from === -Infinity && to === Infinity;
        });
    } else {
        // Date range is applied by user-service at the DB level.
        referrals = await userServiceClient.getReferralsForCampaign(userId, dateFrom, dateTo);
    }

    if (filter.countries?.length) {
        referrals = referrals.filter(ref => filter.countries!.includes(ref.country));
    }
    if (filter.subscriptionStatus && filter.subscriptionStatus !== 'all') {
        const wantPaid = filter.subscriptionStatus === 'subscribed';
        referrals = referrals.filter(ref => hasPaidInscription(ref) === wantPaid);
    }
    if (filter.gender && filter.gender !== 'all') {
        referrals = referrals.filter(ref => ref.gender === filter.gender);
    }
    if (filter.professions?.length) {
        referrals = referrals.filter(ref => filter.professions!.includes(ref.profession));
    }
    if (filter.minAge || filter.maxAge) {
        referrals = referrals.filter(ref => {
            if (!ref.age) return false;
            if (filter.minAge && ref.age < filter.minAge) return false;
            if (filter.maxAge && ref.age > filter.maxAge) return false;
            return true;
        });
    }
    if (filter.excludeCurrentTargets) {
        const inRelance = new Set(
            (await RelanceTargetModel.distinct('referralUserId', {
                status: { $in: [TargetStatus.ACTIVE, TargetStatus.PAUSED] },
            })).map(id => id.toString()),
        );
        referrals = referrals.filter(ref => !inRelance.has(ref._id.toString()));
    }

    const time = (ref: any) => (ref.createdAt ? new Date(ref.createdAt).getTime() : 0);
    return referrals.sort((a, b) => time(b) - time(a));
}

/** New filleuls relance des nouveaux took on for this parrain over the last 30 days. */
export async function newFilleulsLast30Days(userId: string, now: Date = new Date()): Promise<number> {
    return RelanceTargetModel.countDocuments({
        referrerUserId: new mongoose.Types.ObjectId(userId),
        campaignId: null,
        enteredLoopAt: { $gte: new Date(now.getTime() - 30 * DAY_MS) },
    });
}

/**
 * How many filleuls a campaign can afford without starving relance des
 * nouveaux, which keeps running alongside it: a month of new filleuls at
 * 7 emails each stays reserved.
 */
export function campaignBudget(emailBalance: number, newPerMonth: number) {
    const reservedForNew = Math.max(0, newPerMonth) * EMAILS_PER_FILLEUL;
    const available = Math.max(0, emailBalance - reservedForNew);
    return { reservedForNew, maxTargets: Math.floor(available / EMAILS_PER_FILLEUL) };
}

export interface CampaignSuggestion {
    /** '30d' = the last 30 days; 'custom' = the calendar month with the most unpaid filleuls. */
    period: '30d' | 'custom';
    from: string;
    to: string;
    /** Filleuls in that range who registered, haven't paid, and aren't in relance now. */
    count: number;
    /** How many of them the parrain's email credits can relance (a month of relance des nouveaux kept aside). */
    affordable: number;
}

/**
 * What to suggest to a parrain who has credits and no campaign running (Rufus,
 * 2026-10-05): relance des nouveaux only takes filleuls in the 2 hours after
 * they sign up, so a parrain without new filleuls never spends what they paid
 * for. Suggest the last 30 days when they have unpaid filleuls there; otherwise
 * the month of the past year where they have the most; otherwise nothing.
 */
export async function suggestCampaign(userId: string, emailBalance: number, now: Date = new Date()): Promise<CampaignSuggestion | null> {
    const referrals: any[] = await userServiceClient.getReferralsForCampaign(userId);
    const inRelance = new Set(
        (await RelanceTargetModel.distinct('referralUserId', {
            referrerUserId: new mongoose.Types.ObjectId(userId),
            status: { $in: [TargetStatus.ACTIVE, TargetStatus.PAUSED] },
        })).map(id => id.toString()),
    );
    const yearAgo = now.getTime() - 365 * DAY_MS;
    const unpaid = referrals
        .filter(ref => !hasPaidInscription(ref) && !inRelance.has(String(ref._id)) && ref.createdAt)
        .map(ref => new Date(ref.createdAt))
        .filter(d => d.getTime() >= yearAgo && d.getTime() <= now.getTime());
    if (unpaid.length === 0) return null;

    const { maxTargets } = campaignBudget(emailBalance, await newFilleulsLast30Days(userId, now));
    const since30 = new Date(now.getTime() - 30 * DAY_MS);
    const last30 = unpaid.filter(d => d >= since30).length;
    if (last30 > 0) {
        return { period: '30d', from: since30.toISOString(), to: now.toISOString(), count: last30, affordable: Math.min(last30, maxTargets) };
    }

    // No unpaid filleul in the last 30 days: the month where they have the most.
    const byMonth = new Map<number, number>(); // key: year * 12 + month
    for (const d of unpaid) {
        const key = d.getUTCFullYear() * 12 + d.getUTCMonth();
        byMonth.set(key, (byMonth.get(key) ?? 0) + 1);
    }
    // Most filleuls first; on a tie, the more recent month.
    const [bestKey, count] = [...byMonth.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    const y = Math.floor(bestKey / 12), m = bestKey % 12;
    const from = new Date(Date.UTC(y, m, 1));
    const to = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999));
    return { period: 'custom', from: from.toISOString(), to: to.toISOString(), count, affordable: Math.min(count, maxTargets) };
}
