import { Types } from 'mongoose';
import CampaignModel, { ICampaign } from '../database/models/campaign.model';
import { perceptualHash, compareMedia } from './media-hash.service';
import { downloadFile } from './clients/settings.service.client';
import CampaignParticipationModel, {
    DayStatus,
    ICampaignParticipation,
    IDayProof,
    ParticipationStatus,
} from '../database/models/campaign-participation.model';
import { ExtractedStatus, ExtractionResult } from './whatsapp-status.service';
import { chargeGrace, openNextDay, isBeyondRecovery } from './day-window.service';
import { recordCompletion, recordForfeit } from './ranking.service';
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
    /** Whole days late this post cost, charged to the shared grace budget. */
    graceDaysConsumed?: number;
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
export const findMatchingStatus = (
    statuses: ExtractedStatus[],
    trackingCode: string,
    alreadyClaimed: Set<string>,
    /** Posts before this cannot satisfy the day; see enforceDayGap. */
    notBefore?: Date,
): ExtractedStatus | undefined =>
    statuses
        // Oldest first, so consecutive days consume statuses in the order they were
        // actually posted rather than whatever order the sync returned them in.
        .slice()
        .sort((a, b) => (a.postedAt?.getTime() ?? 0) - (b.postedAt?.getTime() ?? 0))
        .find(s =>
            !alreadyClaimed.has(s.statusMessageId)
            && captionHasTrackingCode(s.caption, trackingCode)
            && (!notBefore || !s.postedAt || s.postedAt >= notBefore));

/**
 * Earliest a given day may be satisfied.
 *
 * The 3-day structure only delivers what the advertiser paid for if the posts are
 * spread out. Without this, three statuses posted in one afternoon would satisfy
 * days 1, 2 and 3 in a single verification pass, and the advertiser would be billed
 * for repeat reach that never happened.
 */
export const earliestAllowedPost = (
    days: IDayProof[],
    day: number,
): Date | undefined => {
    const target = days.find(d => d.day === day);
    // Set when the previous day was posted; falling back to recomputing keeps
    // older participations working.
    if (target?.windowOpensAt) return target.windowOpensAt;

    if (day <= 1) return undefined;
    const previous = days.find(d => d.day === day - 1);
    if (!previous?.postedAt) return undefined;
    return new Date(
        previous.postedAt.getTime() + config.campaign.minHoursBetweenDays * 60 * 60 * 1000,
    );
};

/**
 * Campaign creative hash, computed once and cached.
 *
 * Lazy rather than at campaign creation so creating a campaign never blocks on a
 * file fetch, and a creative uploaded afterwards is still covered. Returns
 * undefined on failure, which degrades the media check to "unknown".
 */
const ensureCampaignHash = async (campaign: ICampaign): Promise<string | undefined> => {
    if (campaign.mediaPerceptualHash) return campaign.mediaPerceptualHash;
    // Only images are perceptually hashable; video would need frame extraction.
    if (campaign.mediaType !== 'image') return undefined;

    const bytes = await downloadFile(campaign.mediaFileId);
    if (!bytes) return undefined;

    const hash = await perceptualHash(bytes);
    if (!hash) return undefined;

    campaign.mediaPerceptualHash = hash;
    await CampaignModel.updateOne(
        { _id: campaign._id },
        { $set: { mediaPerceptualHash: hash } },
    );
    return hash;
};

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

    const campaignHash = await ensureCampaignHash(campaign);

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

        const notBefore = earliestAllowedPost(participation.days, day.day);
        const match = findMatchingStatus(
            extraction.statuses,
            participation.trackingCode,
            claimed,
            notBefore,
        );

        if (!match) {
            // Distinguish "you posted too soon" from "we found nothing": the first is
            // recoverable by waiting, the second means they have to post.
            const postedTooSoon = notBefore && findMatchingStatus(
                extraction.statuses, participation.trackingCode, claimed,
            );
            verdicts.push({
                day: day.day,
                accepted: false,
                reason: postedTooSoon
                    ? `La publication du jour ${day.day} doit être faite au moins ${config.campaign.minHoursBetweenDays}h après celle du jour ${day.day - 1}.`
                    : "Aucune publication contenant votre lien de suivi n'a été trouvée.",
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

        // Perceptual, not exact: WhatsApp recompresses on upload, so identical
        // pictures produce different bytes. Recorded rather than gated on — the
        // tracking code is the proof, this catches the link pasted onto an
        // unrelated photo.
        const postedHash = match.mediaBuffer ? await perceptualHash(match.mediaBuffer) : null;
        const comparison = compareMedia(campaignHash, postedHash);
        day.mediaPerceptualHash = postedHash ?? undefined;
        day.mediaDistance = comparison.distance ?? undefined;
        day.mediaMatches = comparison.matches ?? undefined;

        if (comparison.matches === false) {
            log.warn(
                `Participation ${participation._id} day ${day.day}: posted media does not match ` +
                `campaign creative (distance ${comparison.distance})`,
            );
        }
        day.viewCount = match.viewCount;
        day.deliveredCount = match.deliveredCount;
        day.earnedAmount = earned;

        // Charge lateness before opening the next window, so a diffuseur who has
        // already blown the budget is not handed another day to post.
        const grace = chargeGrace(participation, day, match.postedAt ?? new Date());
        openNextDay(participation, day.day);

        verdicts.push({
            day: day.day,
            accepted: true,
            statusMessageId: match.statusMessageId,
            viewCount: match.viewCount,
            deliveredCount: match.deliveredCount,
            earnedAmount: earned,
            graceDaysConsumed: grace.consumed,
        });

        if (grace.exhausted) {
            participation.status = ParticipationStatus.FORFEITED;
            log.info(
                `Participation ${participation._id} forfeited: grace budget exhausted ` +
                `(${grace.totalUsed}/${config.campaign.graceDays})`,
            );
            break;
        }
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
        // Ranking owns profile stats: it also recomputes the measured average and
        // trust score, which a bare $inc here would silently skip.
        await recordCompletion(p);
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

/**
 * Forfeits participations that can no longer finish inside their grace budget.
 *
 * Evaluated per participation rather than against a shared deadline: with a quota,
 * "out of time" depends on how late each individual day already was. Runs as soon
 * as recovery becomes impossible, so nobody is left thinking they can still catch
 * up for days afterwards.
 */
export const forfeitExpired = async (): Promise<number> => {
    const now = new Date();
    const candidates = await CampaignParticipationModel.find({
        status: ParticipationStatus.IN_PROGRESS,
    });

    const expired = candidates.filter(p => isBeyondRecovery(p, now));

    for (const p of expired) {
        p.status = ParticipationStatus.FORFEITED;
        await p.save();
        // Trust is what keeps serial abandoners out of future allocations.
        await recordForfeit(p);
        log.info(`Participation ${p._id} forfeited: grace window expired`);
    }

    return expired.length;
};
