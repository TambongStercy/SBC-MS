import { Request, Response } from 'express';
import { Types } from 'mongoose';
import CampaignModel, { CampaignStatus } from '../../database/models/campaign.model';
import { allocateCampaign, expireStaleOffers, remainingViewsToCover } from '../../services/allocation.service';
import { activateApprovedCampaign, settlePaidCampaign } from '../../services/activation.service';
import { AppError } from '../../utils/errors';
import logger from '../../utils/logger';

const log = logger.getLogger('InternalController');

const fail = (res: Response, err: unknown, context: string) => {
    const status = (err as AppError)?.statusCode ?? 500;
    if (status >= 500) log.error(`${context}:`, err);
    return res.status(status).json({ success: false, message: (err as Error).message });
};

/**
 * Manual activation, for recovery when a payment landed but the callback did not.
 *
 * The normal path is the payment-confirmation webhook; both go through the same
 * service function, so neither can bypass the moderation guard.
 */
export const activateCampaign = async (req: Request, res: Response) => {
    try {
        const result = await activateApprovedCampaign(req.params.id);
        return res.json({ success: true, data: result });
    } catch (err) {
        return fail(res, err, 'activateCampaign');
    }
};

/**
 * Payment-service's terminal-status callback, registered as `metadata.callbackPath`
 * when the intent is created. This is what actually puts campaigns live.
 *
 * Always answers 200 on a non-success status: payment-service treats a non-2xx as
 * a delivery failure, and there is nothing to retry when a payment simply failed.
 */
export const handlePaymentConfirmation = async (req: Request, res: Response) => {
    const { sessionId, status, metadata } = req.body ?? {};
    const campaignId = metadata?.campaignId;

    if (status !== 'SUCCEEDED') {
        log.info(`Payment ${sessionId} for campaign ${campaignId} ended as ${status}; campaign stays unpaid`);
        return res.json({ success: true, message: `Webhook received (status: ${status}).` });
    }
    if (!campaignId) {
        log.error(`Payment ${sessionId} succeeded but carries no campaignId; cannot activate`);
        return res.status(400).json({ success: false, message: 'Missing campaignId in payment metadata.' });
    }

    try {
        // Pay-first: the payment settles the campaign into PAID (awaiting an
        // admin's validation), and only activates it outright when it was already
        // approved under the old review-then-pay order.
        const result = await settlePaidCampaign(campaignId, sessionId);
        log.info(`Campaign ${campaignId} settled from payment ${sessionId}: ${result.status}`);
        return res.json({ success: true, data: result });
    } catch (err) {
        return fail(res, err, 'handlePaymentConfirmation');
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

        // acceptedOnly: outstanding offers hold a share of the target, and closing
        // a campaign as COMPLETED on the strength of offers nobody has taken up
        // would end it having delivered nothing.
        const remaining = await remainingViewsToCover(campaign, { acceptedOnly: true });

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
