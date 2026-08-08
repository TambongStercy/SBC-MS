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
    if (campaign.status !== CampaignStatus.APPROVED) {
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
