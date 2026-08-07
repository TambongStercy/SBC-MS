import { Types } from 'mongoose';
import CampaignModel, { ICampaign } from '../database/models/campaign.model';
import DiffuseurProfileModel, { ReferralTier } from '../database/models/diffuseur-profile.model';
import { getDirectReferrer, creditAdvertisingEarnings } from './clients/user.service.client';
import config from '../config';
import logger from '../utils/logger';

const log = logger.getLogger('ReferralCommission');

/**
 * Pays a diffuseur a share of SBC's margin when someone they directly invited
 * launches a campaign as an advertiser.
 *
 * Rufus's design:
 *   « à partir de 100 campagnes réussies, ils ont la possibilité de gagner 20 %
 *     sur ce que la SBC doit gagner par les annonceurs »
 *
 * His own arithmetic pins the base: 100 campaigns a month at the 6 000 F minimum
 * should yield 50 000 F, i.e. 500 F per campaign. SBC's margin on 6 000 F is
 * 2 500 F, and 20% of that is exactly 500 F. So the commission is 20% of MARGIN,
 * not of campaign value — the distinction is a 2.4x difference in payout.
 */

/**
 * SBC's margin on a campaign.
 *
 * The advertiser pays only for day-1 unique views, but diffuseurs are paid across
 * all three days. Margin is what is left after the full three-day cost, otherwise
 * the commission is computed against money SBC never keeps.
 */
export const sbcMargin = (campaign: ICampaign): number => {
    const diffuseurCostPerView = config.pricing.diffuseurRatePerDay.reduce((a, b) => a + b, 0);
    const diffuseurCost = campaign.targetUniqueViews * diffuseurCostPerView;
    return Math.max(0, campaign.amountPaid - diffuseurCost);
};

export type CommissionResult = {
    paid: boolean;
    amount: number;
    referrerUserId?: string;
    reason?: string;
};

/**
 * Pays the referral commission for a campaign, if one is owed.
 *
 * Idempotent via referralCommissionPaidAt on the campaign, claimed atomically —
 * activation retries and scheduler reruns must not pay twice.
 */
export const payReferralCommission = async (
    campaignId: Types.ObjectId,
): Promise<CommissionResult> => {
    const campaign = await CampaignModel.findById(campaignId);
    if (!campaign) return { paid: false, amount: 0, reason: 'campaign not found' };

    if (campaign.referralCommissionPaidAt) {
        return { paid: false, amount: 0, reason: 'already paid' };
    }

    const referrerUserId = await getDirectReferrer(String(campaign.advertiserUserId));
    if (!referrerUserId) {
        return { paid: false, amount: 0, reason: 'advertiser has no referrer' };
    }

    // The referrer must be an unlocked diffuseur. Being a referrer is not enough —
    // the commission is a reward for staying active as a diffuseur.
    const profile = await DiffuseurProfileModel.findOne({ userId: new Types.ObjectId(referrerUserId) });
    if (!profile) {
        return { paid: false, amount: 0, referrerUserId, reason: 'referrer is not a diffuseur' };
    }
    if (profile.referralTier !== ReferralTier.UNLOCKED) {
        return {
            paid: false,
            amount: 0,
            referrerUserId,
            reason: profile.referralTier === ReferralTier.SUSPENDED
                ? 'referrer commission suspended'
                : `referrer has ${profile.campaignsCompleted}/${config.referral.campaignsToUnlock} campaigns`,
        };
    }

    const margin = sbcMargin(campaign);
    const amount = Math.round(margin * config.referral.commissionRate * 100) / 100;
    if (amount <= 0) {
        return { paid: false, amount: 0, referrerUserId, reason: 'no margin on this campaign' };
    }

    // Atomic claim before any money moves.
    const claimed = await CampaignModel.findOneAndUpdate(
        { _id: campaign._id, referralCommissionPaidAt: { $exists: false } },
        { $set: { referralCommissionPaidAt: new Date(), referralCommissionAmount: amount } },
        { new: true },
    );
    if (!claimed) {
        return { paid: false, amount: 0, referrerUserId, reason: 'claimed by another run' };
    }

    try {
        await creditAdvertisingEarnings({
            userId: referrerUserId,
            amount,
            reference: `referral-commission:${campaign._id}`,
            description: `Commission parrainage (${Math.round(config.referral.commissionRate * 100)}%) — campagne d'un filleul`,
        });
    } catch (err) {
        // Release so the next sweep retries, same reasoning as the payout engine.
        await CampaignModel.updateOne(
            { _id: campaign._id },
            { $unset: { referralCommissionPaidAt: 1, referralCommissionAmount: 1 } },
        );
        log.error(`Referral commission of ${amount} XAF for ${referrerUserId} failed, will retry:`, err);
        return { paid: false, amount, referrerUserId, reason: 'credit failed, will retry' };
    }

    log.info(
        `Paid ${amount} XAF referral commission to ${referrerUserId} for campaign ${campaign._id} ` +
        `(margin ${margin}, rate ${config.referral.commissionRate})`,
    );

    return { paid: true, amount, referrerUserId };
};

/**
 * Pays commissions for campaigns that have gone live but not yet paid one.
 *
 * A sweep rather than an inline call at activation: a commission that failed
 * mid-activation would otherwise be lost, and activation must not fail because a
 * commission could not be paid.
 */
export const sweepReferralCommissions = async (): Promise<{ paid: number; total: number }> => {
    const { CampaignStatus } = await import('../database/models/campaign.model');

    const candidates = await CampaignModel.find({
        status: { $in: [CampaignStatus.ACTIVE, CampaignStatus.COMPLETED, CampaignStatus.BANKED] },
        referralCommissionPaidAt: { $exists: false },
        // Only campaigns that actually launched; a draft never earned SBC anything.
        activatedAt: { $exists: true },
    }).select('_id').lean();

    let paid = 0;
    let total = 0;

    for (const c of candidates) {
        const result = await payReferralCommission(c._id);
        if (result.paid) {
            paid++;
            total += result.amount;
        }
    }

    if (paid) log.info(`Referral sweep paid ${paid} commissions, ${total} XAF total`);
    return { paid, total };
};
