import CampaignModel, { CampaignStatus, ICampaign } from '../database/models/campaign.model';
import { getSpendableBalance } from './clients/user.service.client';
import { refundBalanceSpend, spendFromBalance } from './clients/payment.service.client';
import logger from '../utils/logger';

const log = logger.getLogger('BalancePayment');

/**
 * Paying a campaign, fully or partly, from the annonceur's SBC balance (Rufus,
 * 2026-10-17: « payer ou compléter la campagne avec son solde SBC »).
 *
 * Same life as a credit reservation (credit.service): the money is taken when
 * the payment is opened, so a second payment page cannot spend it again; it is
 * spent for good once the campaign is paid (paidAt), and given back if the
 * campaign is cancelled, its mobile-money part fails, or nothing is paid within
 * the TTL. Real money: the debit is one conditional update in user-service and
 * the refund happens at most once per reservation (payment-service).
 */
const RESERVATION_TTL_MS = Number(process.env.BALANCE_RESERVATION_TTL_MS || 2 * 60 * 60 * 1000);

/**
 * Takes up to `maxAmount` from the balance for `campaign` and returns what was
 * taken. Returns the existing reservation when there is one (a second "Payer"
 * on the same campaign), and 0 when the balance has nothing to give.
 */
export const reserveBalance = async (campaign: ICampaign, maxAmount: number): Promise<number> => {
    if (campaign.balanceApplied) return campaign.balanceApplied;
    if (!(maxAmount > 0)) return 0;

    const available = await getSpendableBalance(String(campaign.advertiserUserId));
    const amount = Math.min(Math.floor(maxAmount), available);
    if (amount <= 0) return 0;

    // Claim the campaign first: two "Payer" taps landing together must not both
    // debit. Only the one that sets balanceRef goes on to take the money.
    const reservedAt = new Date();
    const reference = `ads-campaign:${campaign._id}:${reservedAt.getTime()}`;
    const claimed = await CampaignModel.findOneAndUpdate(
        { _id: campaign._id, balanceRef: { $exists: false }, paidAt: { $exists: false } },
        { $set: { balanceRef: reference, balanceReservedAt: reservedAt }, $unset: { balanceReleasedAmount: 1 } },
        { new: true },
    );
    if (!claimed) {
        // Another tap holds the claim: wait for its outcome rather than answer 0,
        // which would send this caller to a payment page for the full price of a
        // campaign the other tap is paying from the balance.
        for (let i = 0; i < 40; i++) {
            const current = await CampaignModel.findById(campaign._id).select('balanceRef balanceApplied').lean();
            if (current?.balanceApplied) return current.balanceApplied;
            if (!current?.balanceRef) return 0; // the other attempt took nothing
            await new Promise(r => setTimeout(r, 250));
        }
        throw new Error('Un paiement est déjà en cours pour cette campagne. Réessayez dans un instant.');
    }

    let taken = false;
    try {
        taken = await spendFromBalance({
            userId: String(campaign.advertiserUserId),
            amount,
            reference,
            campaignId: String(campaign._id),
            campaignTitle: campaign.title,
        });
    } catch (err) {
        // The debit may or may not have happened: refunding the reference is safe
        // either way (nothing is given back for a reference that took nothing).
        await refundBalanceSpend({ userId: String(campaign.advertiserUserId), reference, campaignTitle: campaign.title })
            .catch(e => log.error(`Refund after a failed balance payment ${reference} failed; the sweep retries: ${e.message}`));
        await CampaignModel.updateOne({ _id: campaign._id, balanceRef: reference }, { $unset: { balanceRef: 1, balanceReservedAt: 1 } });
        throw err;
    }
    if (!taken) {
        await CampaignModel.updateOne({ _id: campaign._id, balanceRef: reference }, { $unset: { balanceRef: 1, balanceReservedAt: 1 } });
        return 0;
    }

    await CampaignModel.updateOne({ _id: campaign._id, balanceRef: reference }, { $set: { balanceApplied: amount } });
    campaign.balanceApplied = amount;
    campaign.balanceRef = reference;
    campaign.balanceReservedAt = reservedAt;
    log.info(`Campaign ${campaign._id}: ${amount} XAF paid from the SBC balance (${reference})`);
    return amount;
};

/**
 * Gives the balance part back. Never for a paid campaign: once paidAt is set
 * the money was spent on it. Safe to call twice.
 */
export const releaseBalance = async (campaign: ICampaign): Promise<number> => {
    const current = await CampaignModel.findById(campaign._id).select('balanceRef balanceApplied paidAt advertiserUserId title').lean();
    if (!current?.balanceRef || current.paidAt) return 0;

    // Refund first, then forget the reservation: if forgetting fails, the next
    // call refunds the same reference again, which payment-service ignores.
    await refundBalanceSpend({ userId: String(current.advertiserUserId), reference: current.balanceRef, campaignTitle: current.title });
    await CampaignModel.updateOne(
        { _id: campaign._id, balanceRef: current.balanceRef, paidAt: { $exists: false } },
        {
            $unset: { balanceRef: 1, balanceReservedAt: 1, balanceApplied: 1 },
            ...(current.balanceApplied ? { $set: { balanceReleasedAmount: current.balanceApplied } } : {}),
        },
    );
    const released = current.balanceApplied ?? 0;
    campaign.balanceApplied = undefined;
    campaign.balanceRef = undefined;
    campaign.balanceReservedAt = undefined;
    log.info(`Campaign ${campaign._id}: ${released} XAF given back to the SBC balance`);
    return released;
};

/**
 * Gives back balance held by campaigns whose payment never came. An abandoned
 * payment page sends no signal, so a timeout is the only way to know.
 */
export const sweepStaleBalanceReservations = async (): Promise<number> => {
    const cutoff = new Date(Date.now() - RESERVATION_TTL_MS);
    const stale = await CampaignModel.find({
        balanceRef: { $exists: true },
        balanceReservedAt: { $lt: cutoff },
        paidAt: { $exists: false },
        status: { $nin: [CampaignStatus.PAID, CampaignStatus.ACTIVE, CampaignStatus.PAUSED, CampaignStatus.COMPLETED] },
    });
    let released = 0;
    for (const campaign of stale) {
        try {
            if (await releaseBalance(campaign)) released++;
        } catch (err) {
            log.error(`Failed to give back the balance held by campaign ${campaign._id}:`, err);
        }
    }
    if (released) log.info(`Gave back stale balance reservations on ${released} campaign(s)`);
    return released;
};

/** What is still to pay once credit, balance and mobile money received are counted. */
export const outstandingAmount = (c: Pick<ICampaign, 'amountPaid' | 'creditApplied' | 'balanceApplied' | 'mobileMoneyPaid'>): number =>
    Math.max(0, (c.amountPaid ?? 0) - (c.creditApplied ?? 0) - (c.balanceApplied ?? 0) - (c.mobileMoneyPaid ?? 0));

/**
 * A mobile-money payment can complete after its balance part was given back
 * (operator delays; the payin reconciler confirms payments up to 7 days old).
 * Take the balance part again if the balance still has it; whatever it cannot
 * cover stays to pay — the campaign does not move until it is.
 */
export const reclaimBalanceForLatePayment = async (campaign: ICampaign): Promise<void> => {
    const owed = campaign.balanceReleasedAmount ?? 0;
    if (!owed || campaign.balanceRef || campaign.paidAt) return;
    try {
        await reserveBalance(campaign, owed);
    } catch (err) {
        log.error(`Campaign ${campaign._id}: could not take back ${owed} XAF for a late payment:`, err);
    }
};

/**
 * Counts a successful mobile-money session toward its campaign, once.
 *
 * Sterling (2026-10-17): the payment is fully done before a campaign moves. So
 * the caller settles only when `remaining` is 0; otherwise the campaign stays
 * unpaid, keeps what was received, and asks for the rest. `known: false` is a
 * session opened before sessions were recorded: the caller settles it as before.
 */
export const recordMobileMoneyPayment = async (
    campaignId: string,
    sessionId: string,
): Promise<{ known: boolean; remaining: number }> => {
    const current = await CampaignModel.findById(campaignId).lean();
    const entry = current?.paymentSessions?.find(s => s.sessionId === sessionId);
    if (!current || !entry) return { known: false, remaining: 0 };

    if (!entry.paidAt) {
        // Mark this session paid and count its amount in one update: a repeated
        // callback finds it already paid and changes nothing.
        await CampaignModel.updateOne(
            { _id: campaignId, paymentSessions: { $elemMatch: { sessionId, paidAt: { $exists: false } } } },
            { $set: { 'paymentSessions.$.paidAt': new Date() }, $inc: { mobileMoneyPaid: entry.amount } },
        );
    }
    const after = await CampaignModel.findById(campaignId);
    if (!after) return { known: true, remaining: 0 };
    await reclaimBalanceForLatePayment(after);
    const settled = (await CampaignModel.findById(campaignId))!;
    const remaining = outstandingAmount(settled);
    if (remaining > 0) log.warn(`Campaign ${campaignId}: mobile money ${sessionId} received, ${remaining} XAF still to pay; it stays unpaid`);
    return { known: true, remaining };
};
