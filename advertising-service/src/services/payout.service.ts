import { Types } from 'mongoose';
import CampaignModel from '../database/models/campaign.model';
import CampaignParticipationModel, {
    DayStatus,
    ICampaignParticipation,
    ParticipationStatus,
} from '../database/models/campaign-participation.model';
import DiffuseurProfileModel from '../database/models/diffuseur-profile.model';
import { creditAdvertisingEarnings } from './clients/user.service.client';
import { notifyCampaignCompleted } from './clients/notification.service.client';
import config from '../config';
import logger from '../utils/logger';

const log = logger.getLogger('PayoutService');

/**
 * Credits diffuseur earnings for completed campaigns.
 *
 * Financial code — see CLAUDE.md. The rules it exists to enforce:
 *
 *   - Nothing is credited until EVERY campaign day is verified. Rufus's rule:
 *     « l'argent n'est crédité que si l'utilisateur valide les 3 jours ».
 *   - A participation is credited AT MOST ONCE, guarded by an atomic
 *     compare-and-set on creditedAt rather than a read-then-write.
 *   - Earnings are recomputed from the verified days at payout time rather than
 *     trusting the running total, so a corrupted counter cannot overpay.
 *   - A failed credit leaves creditedAt unset so the next sweep retries. Paying
 *     late is recoverable; paying twice is not.
 */

/** Recomputed from the days, never read off the denormalised total. */
const earningsFromDays = (participation: ICampaignParticipation): number => {
    let total = 0;
    for (const day of participation.days) {
        if (day.status !== DayStatus.VERIFIED) continue;
        // Recomputed from viewCount x ratePerView rather than earnedAmount, so a
        // bad write to one field cannot become a payment.
        total += day.viewCount * day.ratePerView;
    }
    return Math.round(total * 100) / 100;
};

export type PayoutResult = {
    participationId: string;
    credited: boolean;
    amount: number;
    reason?: string;
};

/**
 * Credits one participation. Safe to call repeatedly.
 */
export const creditParticipation = async (
    participationId: Types.ObjectId,
): Promise<PayoutResult> => {
    const participation = await CampaignParticipationModel.findById(participationId);
    if (!participation) {
        return { participationId: String(participationId), credited: false, amount: 0, reason: 'not found' };
    }

    const id = String(participation._id);

    if (participation.status !== ParticipationStatus.COMPLETED) {
        return { participationId: id, credited: false, amount: 0, reason: `status is ${participation.status}` };
    }
    if (participation.creditedAt) {
        return { participationId: id, credited: false, amount: 0, reason: 'already credited' };
    }

    // Belt and braces: COMPLETED should already imply this, but paying on a
    // partially verified campaign would break Rufus's core rule.
    const allVerified = participation.days.every(d => d.status === DayStatus.VERIFIED);
    if (!allVerified) {
        log.warn(`Participation ${id} is COMPLETED but has unverified days; refusing to credit`);
        return { participationId: id, credited: false, amount: 0, reason: 'days not all verified' };
    }

    const amount = earningsFromDays(participation);
    if (amount <= 0) {
        // Nothing owed, but mark it so the sweep stops reconsidering it.
        participation.creditedAt = new Date();
        await participation.save();
        return { participationId: id, credited: false, amount: 0, reason: 'zero earnings' };
    }

    // Atomic claim: only one caller can flip creditedAt from unset, so concurrent
    // sweeps cannot both proceed to credit.
    const claimed = await CampaignParticipationModel.findOneAndUpdate(
        { _id: participation._id, creditedAt: { $exists: false } },
        { $set: { creditedAt: new Date() } },
        { new: true },
    );
    if (!claimed) {
        return { participationId: id, credited: false, amount: 0, reason: 'claimed by another run' };
    }

    try {
        await creditAdvertisingEarnings({
            userId: String(participation.diffuseurUserId),
            amount,
            reference: `campaign-participation:${id}`,
            description: `Gains publicitaires — ${participation.totalViews} vues vérifiées`,
        });
    } catch (err) {
        // Release the claim so the next sweep retries. Paying late is recoverable;
        // a swallowed failure that never retries is a diffuseur who never gets paid.
        await CampaignParticipationModel.updateOne(
            { _id: participation._id },
            { $unset: { creditedAt: 1 } },
        );
        log.error(`Failed to credit ${amount} XAF for participation ${id}, will retry:`, err);
        return { participationId: id, credited: false, amount, reason: 'credit failed, will retry' };
    }

    log.info(`Credited ${amount} XAF to ${participation.diffuseurUserId} for participation ${id}`);

    const campaign = await CampaignModel.findById(participation.campaignId).select('title').lean();
    await notifyCampaignCompleted(
        String(participation.diffuseurUserId),
        campaign?.title ?? 'votre campagne',
        participation.totalViews,
        amount,
    );

    await maybeUnlockReferral(participation);

    return { participationId: id, credited: true, amount };
};

/**
 * Unlocks the referral commission once the diffuseur passes the campaign
 * threshold, or restores it if they were suspended for inactivity.
 */
const maybeUnlockReferral = async (participation: ICampaignParticipation): Promise<void> => {
    const profile = await DiffuseurProfileModel.findById(participation.diffuseurProfileId);
    if (!profile) return;

    const { ReferralTier } = await import('../database/models/diffuseur-profile.model');

    // Completing a campaign is exactly the activity suspension was waiting for,
    // and it must not require redoing the 100.
    if (profile.referralTier === ReferralTier.SUSPENDED) {
        profile.referralTier = ReferralTier.UNLOCKED;
        profile.referralSuspendedAt = undefined;
        await profile.save();
        log.info(`Referral commission reinstated for ${profile.userId}`);
        return;
    }

    if (
        profile.referralTier === ReferralTier.LOCKED
        && profile.campaignsCompleted >= config.referral.campaignsToUnlock
    ) {
        profile.referralTier = ReferralTier.UNLOCKED;
        profile.referralUnlockedAt = new Date();
        await profile.save();

        const { notifyReferralUnlocked } = await import('./clients/notification.service.client');
        await notifyReferralUnlocked(String(profile.userId), config.referral.commissionRate);
        log.info(`Referral commission unlocked for ${profile.userId}`);
    }
};

/**
 * Credits every completed-but-unpaid participation.
 *
 * Sweep rather than crediting inline on the last verification: a credit that fails
 * mid-request would otherwise be lost, and this way it is simply picked up next
 * tick.
 */
export const sweepPendingPayouts = async (): Promise<{ credited: number; total: number }> => {
    const pending = await CampaignParticipationModel.find({
        status: ParticipationStatus.COMPLETED,
        creditedAt: { $exists: false },
    }).select('_id').lean();

    let credited = 0;
    let total = 0;

    for (const p of pending) {
        const result = await creditParticipation(p._id);
        if (result.credited) {
            credited++;
            total += result.amount;
        }
    }

    if (credited) log.info(`Payout sweep credited ${credited} participations, ${total} XAF total`);
    return { credited, total };
};
