import { Types } from 'mongoose';
import CampaignModel, { CampaignStatus } from '../database/models/campaign.model';
import { allocateCampaign } from './allocation.service';
import { AppError } from '../utils/errors';
import logger from '../utils/logger';

const log = logger.getLogger('ActivationService');

/**
 * Flips a paid campaign live and issues the first round of offers.
 *
 * The single path to ACTIVE, shared by the payment callback and the internal
 * endpoint, so the moderation guard below cannot be bypassed by reaching for the
 * other one.
 *
 * Idempotent: payment webhooks retry, and a second call must not produce a second
 * round of offers.
 */
export const activateApprovedCampaign = async (campaignId: string | Types.ObjectId) => {
    const campaign = await CampaignModel.findById(campaignId);
    if (!campaign) throw new AppError('Campaign not found', 404);

    if (campaign.status === CampaignStatus.ACTIVE) {
        log.info(`Campaign ${campaign._id} already active, ignoring duplicate activation`);
        return { status: campaign.status, alreadyActive: true as const };
    }
    // ONLY an approved campaign may go live. Payment must never be able to skip
    // moderation — a creative reaching ACTIVE unreviewed lands on thousands of
    // people's personal WhatsApp statuses.
    if (campaign.status !== CampaignStatus.APPROVED && campaign.status !== CampaignStatus.PAID) {
        throw new AppError(
            campaign.status === CampaignStatus.DRAFT || campaign.status === CampaignStatus.PENDING_REVIEW
                ? 'Cette campagne doit être approuvée par un administrateur avant activation.'
                : `Cannot activate a campaign in status ${campaign.status}`,
            400,
        );
    }

    campaign.status = CampaignStatus.ACTIVE;
    campaign.activatedAt = new Date();
    await campaign.save();

    const allocation = await allocateCampaign(campaign._id);
    log.info(`Campaign ${campaign._id} activated; ${allocation.offersCreated} offers issued`);

    return { status: campaign.status, allocation };
};

/**
 * What a successful payment does to a campaign.
 *
 * Pay-first (Rufus): paying does NOT start the campaign, it buys a place in the
 * moderation queue — the campaign becomes PAID and waits for an admin to
 * validate. Only that validation activates it, so a paid creative still never
 * reaches anyone's WhatsApp unreviewed.
 *
 * The exception is a campaign an admin already approved under the old
 * review-then-pay order: it has been judged, so payment completes it and it goes
 * live immediately.
 *
 * Idempotent: payment callbacks retry, and a campaign already PAID or ACTIVE is
 * left alone.
 */
export const settlePaidCampaign = async (
    campaignId: string | Types.ObjectId,
    paymentSessionId?: string,
) => {
    const campaign = await CampaignModel.findById(campaignId);
    if (!campaign) throw new AppError('Campaign not found', 404);

    if (campaign.status === CampaignStatus.ACTIVE) {
        log.info(`Campaign ${campaign._id} already active, ignoring duplicate payment`);
        return { status: campaign.status, alreadyActive: true as const };
    }

    // Legacy: reviewed before it was paid, so the money is the last step.
    if (campaign.status === CampaignStatus.APPROVED) {
        if (paymentSessionId) {
            await CampaignModel.updateOne(
                { _id: campaign._id },
                { $set: { paymentSessionId, paidAt: new Date() } },
            );
        }
        return activateApprovedCampaign(campaign._id);
    }

    if (campaign.status === CampaignStatus.PAID) {
        log.info(`Campaign ${campaign._id} already paid and awaiting validation`);
        return { status: campaign.status, alreadyPaid: true as const };
    }

    campaign.status = CampaignStatus.PAID;
    campaign.paidAt = new Date();
    // Drives the moderation queue's ordering, which sorts on this.
    campaign.submittedForReviewAt = new Date();
    if (paymentSessionId) campaign.paymentSessionId = paymentSessionId;
    // A previous refusal must not sit next to a freshly paid campaign.
    campaign.rejectionReason = undefined;
    campaign.reviewedBy = undefined;
    campaign.reviewedAt = undefined;
    await campaign.save();

    log.info(`Campaign ${campaign._id} paid; awaiting admin validation`);
    return { status: campaign.status, awaitingValidation: true as const };
};
