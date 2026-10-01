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
export async function matchCampaignReferrals(userId: string, filter: TargetFilter): Promise<any[]> {
    const dateFrom = filter.registrationDateFrom ? new Date(filter.registrationDateFrom).toISOString() : undefined;
    const dateTo = filter.registrationDateTo ? new Date(filter.registrationDateTo).toISOString() : undefined;
    // Date range is applied by user-service at the DB level.
    let referrals: any[] = await userServiceClient.getReferralsForCampaign(userId, dateFrom, dateTo);

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
