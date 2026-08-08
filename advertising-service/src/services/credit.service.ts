import { Types } from 'mongoose';
import CampaignModel, { CampaignStatus, ICampaign } from '../database/models/campaign.model';
import logger from '../utils/logger';

const log = logger.getLogger('CreditService');

/**
 * How long a reservation may sit unpaid before it is returned to the annonceur.
 *
 * An abandoned payment page produces no signal at all — payment-service only
 * calls back on a terminal status — so the only way a reservation comes back is
 * a timeout. Two hours is far longer than any real payment takes and short
 * enough that a mistyped attempt does not lock the credit for a day.
 */
const RESERVATION_TTL_MS = Number(process.env.CREDIT_RESERVATION_TTL_MS || 2 * 60 * 60 * 1000);

/**
 * Unspent budget from banked campaigns, usable against a new one.
 *
 * Never cash. Rufus's rule: « ils ne peuvent pas le récupérer en espèces », only
 * credit toward a future campaign.
 */
export const availableCredit = async (advertiserUserId: Types.ObjectId): Promise<number> => {
    const [row] = await CampaignModel.aggregate<{ total: number }>([
        {
            $match: {
                advertiserUserId,
                status: CampaignStatus.BANKED,
                bankedAmount: { $gt: 0 },
            },
        },
        { $group: { _id: null, total: { $sum: '$bankedAmount' } } },
    ]);
    return row?.total ?? 0;
};

/**
 * Takes credit off the annonceur's banked campaigns and attaches it to `campaign`.
 *
 * Decrements at reservation time rather than at payment time: between opening a
 * payment page and paying, the same annonceur can open a second one, and two
 * campaigns spending the same voucher would each be activated for money that only
 * existed once.
 *
 * Each voucher is decremented with a conditional update, so a concurrent
 * reservation cannot take it twice. Whatever was actually taken is what gets
 * recorded — a lost race reduces the discount, it never overdraws.
 */
export const reserveCredit = async (campaign: ICampaign): Promise<number> => {
    if (campaign.creditApplied) return campaign.creditApplied;

    const vouchers = await CampaignModel
        .find({
            advertiserUserId: campaign.advertiserUserId,
            status: CampaignStatus.BANKED,
            bankedAmount: { $gt: 0 },
        })
        .sort({ completedAt: 1 })
        .select('_id bankedAmount')
        .lean();

    let remaining = campaign.amountPaid;
    const sources: Array<{ campaignId: Types.ObjectId; amount: number }> = [];

    for (const voucher of vouchers) {
        if (remaining <= 0) break;

        const take = Math.min(remaining, voucher.bankedAmount ?? 0);
        if (take <= 0) continue;

        // Conditional on the balance still being there: another reservation may
        // have drained it since the read above.
        const claimed = await CampaignModel.findOneAndUpdate(
            { _id: voucher._id, bankedAmount: { $gte: take } },
            { $inc: { bankedAmount: -take } },
            { new: true },
        );
        if (!claimed) continue;

        sources.push({ campaignId: voucher._id, amount: take });
        remaining -= take;
    }

    const applied = sources.reduce((sum, s) => sum + s.amount, 0);
    if (applied > 0) {
        campaign.creditApplied = applied;
        campaign.creditSources = sources;
        campaign.creditReservedAt = new Date();
        await campaign.save();
        log.info(`Reserved ${applied} XAF of credit for campaign ${campaign._id}`);
    }

    return applied;
};

/** Puts a reservation back on the vouchers it came from. Safe to call twice. */
export const releaseCredit = async (campaign: ICampaign): Promise<number> => {
    const sources = campaign.creditSources ?? [];
    if (!campaign.creditApplied || !sources.length) return 0;

    for (const source of sources) {
        await CampaignModel.updateOne(
            { _id: source.campaignId },
            { $inc: { bankedAmount: source.amount } },
        );
    }

    const released = campaign.creditApplied;
    campaign.creditApplied = undefined;
    campaign.creditSources = undefined;
    campaign.creditReservedAt = undefined;
    await campaign.save();

    log.info(`Released ${released} XAF of credit held by campaign ${campaign._id}`);
    return released;
};

/**
 * Returns credit held by campaigns whose payment never arrived.
 *
 * Without this an abandoned payment page silently costs the annonceur their
 * credit: nothing else ever tells us that a payment is not coming.
 */
export const sweepStaleCreditReservations = async (): Promise<number> => {
    const cutoff = new Date(Date.now() - RESERVATION_TTL_MS);

    const stale = await CampaignModel.find({
        creditReservedAt: { $lt: cutoff },
        creditApplied: { $gt: 0 },
        // Activation is what consumes the reservation, so anything live has
        // legitimately spent it.
        status: { $in: [CampaignStatus.APPROVED, CampaignStatus.REJECTED, CampaignStatus.CANCELLED] },
    });

    let released = 0;
    for (const campaign of stale) {
        try {
            if (await releaseCredit(campaign)) released++;
        } catch (err) {
            log.error(`Failed to release credit for campaign ${campaign._id}:`, err);
        }
    }

    if (released) log.info(`Released stale credit reservations on ${released} campaign(s)`);
    return released;
};
