import { Request, Response } from 'express';
import { Types } from 'mongoose';
import CampaignModel, { CampaignStatus } from '../../database/models/campaign.model';
import { allocateCampaign, expireStaleOffers, remainingViewsToCover } from '../../services/allocation.service';
import { AppError } from '../../utils/errors';
import logger from '../../utils/logger';

const log = logger.getLogger('InternalController');

const fail = (res: Response, err: unknown, context: string) => {
    const status = (err as AppError)?.statusCode ?? 500;
    if (status >= 500) log.error(`${context}:`, err);
    return res.status(status).json({ success: false, message: (err as Error).message });
};

/**
 * Flips a paid campaign live and issues the first round of offers.
 *
 * Called by payment-service once the advertiser's money has actually landed.
 * Deliberately the only path to ACTIVE, so an unpaid campaign can never be offered
 * to diffuseurs.
 *
 * Idempotent: payment webhooks retry, and a second call must not produce a second
 * round of offers.
 */
export const activateCampaign = async (req: Request, res: Response) => {
    try {
        const campaign = await CampaignModel.findById(req.params.id);
        if (!campaign) throw new AppError('Campaign not found', 404);

        if (campaign.status === CampaignStatus.ACTIVE) {
            log.info(`Campaign ${campaign._id} already active, ignoring duplicate activation`);
            return res.json({ success: true, data: { status: campaign.status, alreadyActive: true } });
        }
        // ONLY an approved campaign may go live. Payment must never be able to
        // skip moderation — a creative reaching ACTIVE unreviewed lands on
        // thousands of people's personal WhatsApp statuses.
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

        return res.json({ success: true, data: { status: campaign.status, allocation } });
    } catch (err) {
        return fail(res, err, 'activateCampaign');
    }
};

/**
 * Tops a campaign back up. Run on a schedule: diffuseurs decline, ignore, or
 * under-deliver, so a campaign that looked covered at activation often is not.
 */
export const reallocateCampaign = async (req: Request, res: Response) => {
    try {
        const campaignId = new Types.ObjectId(req.params.id);
        const campaign = await CampaignModel.findById(campaignId);
        if (!campaign) throw new AppError('Campaign not found', 404);

        const remaining = await remainingViewsToCover(campaign);

        if (remaining <= 0) {
            const expired = await expireStaleOffers(campaignId);
            if (campaign.status === CampaignStatus.ACTIVE) {
                campaign.status = CampaignStatus.COMPLETED;
                campaign.completedAt = new Date();
                await campaign.save();
            }
            return res.json({
                success: true,
                data: { status: campaign.status, offersExpired: expired, remainingViews: 0 },
            });
        }

        const allocation = await allocateCampaign(campaignId);
        return res.json({ success: true, data: { status: campaign.status, allocation } });
    } catch (err) {
        return fail(res, err, 'reallocateCampaign');
    }
};
