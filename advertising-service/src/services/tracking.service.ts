import { createHash } from 'crypto';
import { Request } from 'express';
import { Types } from 'mongoose';
import ClickEventModel, { ClickAction } from '../database/models/click-event.model';
import CampaignModel from '../database/models/campaign.model';
import CampaignParticipationModel from '../database/models/campaign-participation.model';
import config from '../config';
import logger from '../utils/logger';

const log = logger.getLogger('TrackingService');

/**
 * A visitor who reloads the landing page five times is one interested person, not
 * five. Collapse repeats of the same (link, visitor, action) inside this window.
 */
const DEDUPE_WINDOW_MS = 30 * 60 * 1000;

/**
 * Coarse, non-reversible visitor fingerprint. Deliberately weak: enough to collapse
 * refreshes, not enough to identify anyone. Salted with SERVICE_SECRET so the
 * hashes are useless outside this deployment.
 */
export const hashVisitor = (req: Request, trackingCode: string): string => {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
        || req.socket.remoteAddress
        || 'unknown';
    const ua = req.headers['user-agent'] || 'unknown';
    return createHash('sha256')
        .update(`${config.services.serviceSecret}:${ip}:${ua}:${trackingCode}`)
        .digest('hex')
        .slice(0, 32);
};

type RecordArgs = {
    req: Request;
    trackingCode?: string;
    campaignId: Types.ObjectId;
    action: ClickAction;
};

/**
 * Records one interaction and keeps the denormalised counters in step.
 *
 * Never throws: a failure here must not break the redirect the visitor is waiting
 * on. Losing a click is acceptable, sending someone to a dead end is not.
 */
export const recordClick = async ({ req, trackingCode, campaignId, action }: RecordArgs): Promise<void> => {
    try {
        const visitorHash = trackingCode ? hashVisitor(req, trackingCode) : undefined;

        if (trackingCode && visitorHash) {
            const recent = await ClickEventModel.findOne({
                trackingCode,
                visitorHash,
                action,
                createdAt: { $gte: new Date(Date.now() - DEDUPE_WINDOW_MS) },
            }).lean();
            if (recent) return;
        }

        const participation = trackingCode
            ? await CampaignParticipationModel.findOne({ trackingCode }).select('_id diffuseurUserId').lean()
            : null;

        await ClickEventModel.create({
            campaignId,
            participationId: participation?._id,
            diffuseurUserId: participation?.diffuseurUserId,
            trackingCode,
            action,
            visitorHash,
            userAgent: req.headers['user-agent'],
            referer: req.headers.referer,
            countryCode: (req.headers['cf-ipcountry'] as string) || undefined,
        });

        // A landing-page open is not a click on anything, so it must not inflate
        // the click counters the advertiser and the ranking both read.
        if (action === ClickAction.VIEW) return;

        await CampaignModel.updateOne({ _id: campaignId }, { $inc: { clicksTotal: 1 } });
        if (participation) {
            await CampaignParticipationModel.updateOne(
                { _id: participation._id },
                { $inc: { clicksGenerated: 1 } },
            );
        }
    } catch (err) {
        log.error(`Failed to record ${action} for campaign ${campaignId}:`, err);
    }
};

/** Public URL a diffuseur pastes into their status. Kept short on purpose. */
export const buildTrackingUrl = (trackingCode: string): string =>
    `${config.publicBaseUrl.replace(/\/$/, '')}/s/${trackingCode}`;

/**
 * Caption pre-filled into the share sheet.
 *
 * The link must survive into the WhatsApp status caption: verification looks for
 * it, and a diffuseur who edits it out silently loses the day. It goes on its own
 * line at the end so it stays visible and is hard to delete by accident.
 */
export const buildShareCaption = (suggestedCaption: string | undefined, trackingCode: string): string => {
    const url = buildTrackingUrl(trackingCode);
    const body = suggestedCaption?.trim();
    return body ? `${body}\n\n${url}` : url;
};
