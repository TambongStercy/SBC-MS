import { Types } from 'mongoose';
import CampaignModel from '../database/models/campaign.model';
import CampaignParticipationModel, {
    DayStatus,
    ICampaignParticipation,
    ParticipationStatus,
} from '../database/models/campaign-participation.model';
import { ExtractedStatus, ExtractionResult } from './whatsapp-status.service';
import { buildTrackingUrl } from './tracking.service';
import DiffuseurProfileModel from '../database/models/diffuseur-profile.model';
import config from '../config';
import logger from '../utils/logger';

const log = logger.getLogger('VerificationService');

export type DayVerdict = {
    day: number;
    accepted: boolean;
    reason?: string;
    statusMessageId?: string;
    viewCount: number;
    deliveredCount: number;
    earnedAmount: number;
};

/**
 * Does this status carry the diffuseur's tracking link?
 *
 * This is the primary proof that they posted THIS campaign. The code is unique per
 * (campaign, diffuseur) and unguessable, so its presence cannot be faked without
 * having accepted the campaign.
 *
 * Matched on the bare code rather than the full URL: WhatsApp and link shorteners
 * rewrite URLs, and the user may add text around it, but the code survives.
 */
const captionHasTrackingCode = (caption: string | undefined, trackingCode: string): boolean =>
    Boolean(caption && caption.toLowerCase().includes(trackingCode.toLowerCase()));

/**
 * Picks the status that backs a given campaign day.
 *
 * A diffuseur may post several statuses in a day, most unrelated to us, so this
 * selects on the tracking code rather than assuming the newest post is ours.
 */
const findMatchingStatus = (
    statuses: ExtractedStatus[],
    trackingCode: string,
    alreadyClaimed: Set<string>,
): ExtractedStatus | undefined =>
    statuses.find(s =>
        !alreadyClaimed.has(s.statusMessageId) && captionHasTrackingCode(s.caption, trackingCode));

/**
 * Applies an extraction to a participation, filling in whichever days it proves.
 *
 * Deliberately reconciles ALL unverified days rather than only the current one: a
 * diffuseur catching up inside the grace window may have two live statuses, and
 * making them run the QR flow once per day would be needless friction.
 */
export const applyExtraction = async (
    participationId: Types.ObjectId,
    extraction: ExtractionResult,
): Promise<DayVerdict[]> => {
    const participation = await CampaignParticipationModel.findById(participationId);
    if (!participation) throw new Error('Participation not found');

    const campaign = await CampaignModel.findById(participation.campaignId);
    if (!campaign) throw new Error('Campaign not found');

    // A status can only ever back one day, here or on any other participation.
    const claimedElsewhere = await CampaignParticipationModel.find({
        'days.statusMessageId': { $in: extraction.statuses.map(s => s.statusMessageId) },
        _id: { $ne: participation._id },
    }).select('days.statusMessageId').lean();

    const claimed = new Set<string>();
    for (const p of claimedElsewhere) {
        for (const d of p.days ?? []) if (d.statusMessageId) claimed.add(d.statusMessageId);
    }
    for (const d of participation.days) {
        if (d.statusMessageId) claimed.add(d.statusMessageId);
    }

    const verdicts: DayVerdict[] = [];

    for (const day of participation.days) {
        if (day.status === DayStatus.VERIFIED) continue;

        const match = findMatchingStatus(extraction.statuses, participation.trackingCode, claimed);
        if (!match) {
            verdicts.push({
                day: day.day,
                accepted: false,
                reason: 'Aucune publication contenant votre lien de suivi n\'a été trouvée.',
                viewCount: 0,
                deliveredCount: 0,
                earnedAmount: 0,
            });
            // Later days cannot be satisfied by a status this one already failed on.
            break;
        }

        claimed.add(match.statusMessageId);

        const earned = Math.round(match.viewCount * day.ratePerView * 100) / 100;

        day.status = DayStatus.VERIFIED;
        day.statusMessageId = match.statusMessageId;
        day.postedAt = match.postedAt ?? undefined;
        day.verifiedAt = new Date();
        day.captionCaptured = match.caption;
        day.trackingLinkPresent = true;
        day.mediaSha256 = match.mediaSha256;
        // Exact-hash matching is unreliable because WhatsApp recompresses on
        // upload; a perceptual check lands separately. Recorded, not gated on.
        day.mediaMatches = campaign.mediaSha256
            ? campaign.mediaSha256 === match.mediaSha256
            : undefined;
        day.viewCount = match.viewCount;
        day.deliveredCount = match.deliveredCount;
        day.earnedAmount = earned;

        verdicts.push({
            day: day.day,
            accepted: true,
            statusMessageId: match.statusMessageId,
            viewCount: match.viewCount,
            deliveredCount: match.deliveredCount,
            earnedAmount: earned,
        });
    }

    recomputeTotals(participation);
    await participation.save();

    await syncCampaignCounters(participation);

    log.info(
        `Participation ${participation._id}: ${verdicts.filter(v => v.accepted).length}/${verdicts.length} days verified`,
    );

    return verdicts;
};

/** Day 1 views are billable "unique"; later days are free repeat reach. */
const recomputeTotals = (p: ICampaignParticipation): void => {
    let unique = 0;
    let repeat = 0;
    let earned = 0;

    for (const d of p.days) {
        if (d.status !== DayStatus.VERIFIED) continue;
        if (d.day === 1) unique += d.viewCount;
        else repeat += d.viewCount;
        earned += d.earnedAmount;
    }

    p.uniqueViews = unique;
    p.repeatViews = repeat;
    p.totalViews = unique + repeat;
    // Rounded once at the end: summing per-day rounding drifts over 3 days.
    p.totalEarned = Math.round(earned * 100) / 100;

    const allVerified = p.days.every(d => d.status === DayStatus.VERIFIED);
    if (allVerified && p.status === ParticipationStatus.IN_PROGRESS) {
        // Earnings are NOT credited here. Completion only makes them payable; the
        // payout engine moves money, so that stays in one place.
        p.status = ParticipationStatus.COMPLETED;
        p.completedAt = new Date();
    }
};

/**
 * Recomputes campaign totals from participations rather than incrementing.
 *
 * A verification can re-run and revise a day's view count, so an $inc would drift.
 * The advertiser is billed on uniqueViewsDelivered, so drift here is a billing bug.
 */
const syncCampaignCounters = async (p: ICampaignParticipation): Promise<void> => {
    const totals = await CampaignParticipationModel.aggregate<{
        _id: null; unique: number; repeat: number;
    }>([
        { $match: { campaignId: p.campaignId } },
        { $group: { _id: null, unique: { $sum: '$uniqueViews' }, repeat: { $sum: '$repeatViews' } } },
    ]);

    const unique = totals[0]?.unique ?? 0;
    const repeat = totals[0]?.repeat ?? 0;

    await CampaignModel.updateOne(
        { _id: p.campaignId },
        { $set: { uniqueViewsDelivered: unique, repeatViewsDelivered: repeat } },
    );

    if (p.status === ParticipationStatus.COMPLETED) {
        await DiffuseurProfileModel.updateOne(
            { _id: p.diffuseurProfileId },
            {
                $inc: { campaignsCompleted: 1, totalVerifiedViews: p.totalViews },
                $set: { lastCampaignCompletedAt: new Date() },
            },
        );
    }
};

/**
 * Binds a WhatsApp account to a diffuseur, or rejects the extraction.
 *
 * One WhatsApp account maps to exactly one SBC account, forever. Keyed on the LID
 * rather than the phone number because numbers get recycled and can change, while
 * the LID is stable — without this, one WhatsApp could farm several SBC accounts.
 */
export const bindWhatsAppIdentity = async (
    diffuseurUserId: Types.ObjectId,
    extraction: ExtractionResult,
): Promise<void> => {
    if (!extraction.whatsappLid) {
        throw new Error("Impossible d'identifier ce compte WhatsApp.");
    }

    const existing = await DiffuseurProfileModel.findOne({ whatsappLid: extraction.whatsappLid });

    if (existing && !existing.userId.equals(diffuseurUserId)) {
        log.warn(
            `WhatsApp ${extraction.whatsappLid} already bound to ${existing.userId}, ` +
            `refused for ${diffuseurUserId}`,
        );
        throw new Error('Ce compte WhatsApp est déjà lié à un autre compte SBC.');
    }

    if (!existing) {
        await DiffuseurProfileModel.updateOne(
            { userId: diffuseurUserId },
            {
                $set: {
                    whatsappLid: extraction.whatsappLid,
                    whatsappPhone: extraction.whatsappPhone,
                    whatsappLinkedAt: new Date(),
                },
            },
        );
    }
};

/** Grace window is over: nothing was completed, so nothing is paid. */
export const forfeitExpired = async (): Promise<number> => {
    const now = new Date();
    const expired = await CampaignParticipationModel.find({
        status: ParticipationStatus.IN_PROGRESS,
        graceDeadline: { $lt: now },
    });

    for (const p of expired) {
        p.status = ParticipationStatus.FORFEITED;
        await p.save();
        await DiffuseurProfileModel.updateOne(
            { _id: p.diffuseurProfileId },
            {
                $inc: { campaignsAbandoned: 1 },
                // Trust is what keeps serial abandoners out of future allocations.
                $max: { trustScore: 0 },
            },
        );
        log.info(`Participation ${p._id} forfeited: grace window expired`);
    }

    return expired.length;
};
