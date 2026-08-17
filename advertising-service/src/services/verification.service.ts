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
import { openNextDay, isBeyondRecovery } from './day-window.service';
import { recordCompletion, recordForfeit } from './ranking.service';
import DiffuseurProfileModel from '../database/models/diffuseur-profile.model';
import config from '../config';
import { AppError } from '../utils/errors';
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

    // What the account actually held. Without this, « aucune publication
    // contenant votre lien » was unfalsifiable: a WhatsApp that returned
    // nothing and one full of statuses without the code read identically,
    // to us and to the diffuseur.
    const withCode = extraction.statuses.filter(
        st => captionHasTrackingCode(st.caption, participation.trackingCode),
    ).length;
    log.info(
        `Participation ${participation._id}: extracted ${extraction.statuses.length} status(es), `
        + `${withCode} carrying tracking code ${participation.trackingCode}`,
    );

    // A status can only ever back one day, here or on any other participation.
    const claimedElsewhere = await CampaignParticipationModel.find({
        'days.statusMessageId': { $in: extraction.statuses.map(s => s.statusMessageId) },
        _id: { $ne: participation._id },
    }).select('days.statusMessageId').lean();

    const claimedByOthers = new Set<string>();
    for (const p of claimedElsewhere) {
        for (const d of p.days ?? []) if (d.statusMessageId) claimedByOthers.add(d.statusMessageId);
    }

    /**
     * Statuses that are off-limits when judging `dayNumber`.
     *
     * Everything another participation claimed, plus everything this
     * participation's *other* days claimed — but never the day's own previous
     * match. Including it meant a day that had already matched a status could
     * never match it again, so re-verifying always reported "no publication
     * containing your tracking link was found" for a status sitting right there
     * on the account.
     */
    // Statuses matched earlier in this same run. Without it two days could both
    // match the same status, since each day now gets its own claimed set.
    const consumedThisRun = new Set<string>();

    const claimedFor = (dayNumber: number): Set<string> => {
        const set = new Set([...claimedByOthers, ...consumedThisRun]);
        for (const d of participation.days) {
            if (d.day !== dayNumber && d.statusMessageId) set.add(d.statusMessageId);
        }
        return set;
    };

    const verdicts: DayVerdict[] = [];

    for (const day of participation.days) {
        // Only days the diffuseur actually posted. Days not yet open — let alone
        // published — used to be checked against the account's statuses and marked
        // failed, which reads as being punished for not time-travelling.
        //
        // Already-verified days are re-checked deliberately: views keep arriving
        // for 24h, so "Revérifier" has to be able to refresh a day it already
        // accepted. Limiting this to POSTED made that button a no-op — it
        // reported zero views and no verdict at all.
        const wasPosted = day.status === DayStatus.POSTED
            || day.status === DayStatus.VERIFIED
            || day.status === DayStatus.FAILED;
        if (!wasPosted) continue;

        // Once the money has moved, the counts behind it are history.
        if (participation.creditedAt && day.status === DayStatus.VERIFIED) continue;

        const notBefore = earliestAllowedPost(participation.days, day.day);
        const claimed = claimedFor(day.day);
        const match = findMatchingStatus(
            extraction.statuses,
            participation.trackingCode,
            claimed,
            notBefore,
        );

        if (!match) {
            // A day already validated keeps its result. Statuses expire after 24h,
            // so a later re-verification legitimately finds nothing — downgrading
            // it here would take back a day the diffuseur had already earned.
            if (day.status === DayStatus.VERIFIED) continue;

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
                    : extraction.statuses.length === 0
                        ? "Aucun statut n'a été trouvé sur ce WhatsApp. Publiez la campagne, puis vérifiez avant que le statut n'expire (24 h)."
                        : `Nous avons vu ${extraction.statuses.length} statut(s) sur votre WhatsApp, mais aucun ne contient votre lien de suivi. Republiez en collant le texte fourni sans le modifier — le lien doit rester dans la légende.`,
                viewCount: 0,
                deliveredCount: 0,
                earnedAmount: 0,
            });
            // Later days cannot be satisfied by a status this one already failed on.
            break;
        }

        consumedThisRun.add(match.statusMessageId);

        const earned = Math.round(match.viewCount * day.ratePerView * 100) / 100;
        // A re-verification refreshes the count, nothing else. Re-assigning
        // postedAt from the match is a no-op in real time (the status's
        // timestamp never changes) but it rewrites history the simulation
        // tools deliberately shifted — one "Revérifier" on day 1 was enough
        // to snap every later day's window back to real time.
        const firstVerification = day.status !== DayStatus.VERIFIED;

        day.status = DayStatus.VERIFIED;
        day.statusMessageId = match.statusMessageId;
        if (firstVerification) day.postedAt = match.postedAt ?? undefined;
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
        // Views only ever accumulate, so a re-check that reports fewer than we
        // already validated is looking at something else — an expired status, or
        // a different post carrying the same link. Keep the higher figure rather
        // than quietly reducing what a diffuseur has earned.
        if (day.status === DayStatus.VERIFIED && match.viewCount < day.viewCount) {
            verdicts.push({
                day: day.day,
                accepted: true,
                viewCount: day.viewCount,
                deliveredCount: day.deliveredCount,
                earnedAmount: day.earnedAmount,
            });
            continue;
        }

        day.viewCount = match.viewCount;
        day.deliveredCount = match.deliveredCount;
        day.earnedAmount = earned;

        // Same reasoning: the next window was opened when this day was first
        // verified; recomputing it on a re-check moves goalposts that later
        // days may already be standing on.
        if (firstVerification) openNextDay(participation, day.day);

        verdicts.push({
            day: day.day,
            accepted: true,
            statusMessageId: match.statusMessageId,
            viewCount: match.viewCount,
            deliveredCount: match.deliveredCount,
            earnedAmount: earned,
        });
    }

    const justCompleted = recomputeTotals(participation);
    await participation.save();

    await syncCampaignCounters(participation, justCompleted);

    log.info(
        `Participation ${participation._id}: ${verdicts.filter(v => v.accepted).length}/${verdicts.length} days verified`,
    );

    return verdicts;
};

/** WhatsApp keeps a status alive — and collecting views — for 24 hours. */
const STATUS_LIFETIME_MS = 24 * 60 * 60 * 1000;

/**
 * True once the last posted status has expired and can gain no more views.
 *
 * Completion must wait for this: ending the campaign at the moment of the final
 * verification froze the last day's count at whatever it happened to be minutes
 * after posting — Sterling's day 3 was captured at 2 views because he verified
 * right away, and the measured average was computed from that.
 */
export const lastPostExpired = (p: ICampaignParticipation): boolean => {
    const last = Math.max(...p.days.map(d => d.postedAt?.getTime() ?? 0));
    return last > 0 && Date.now() >= last + STATUS_LIFETIME_MS;
};

/**
 * Day 1 views are billable "unique"; later days are free repeat reach.
 * Returns whether this call is the one that completed the participation, so the
 * caller records completion side effects exactly once.
 */
const recomputeTotals = (p: ICampaignParticipation): boolean => {
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
    if (allVerified && p.status === ParticipationStatus.IN_PROGRESS && lastPostExpired(p)) {
        // Earnings are NOT credited here. Completion only makes them payable; the
        // payout engine moves money, so that stays in one place.
        p.status = ParticipationStatus.COMPLETED;
        p.completedAt = new Date();
        return true;
    }
    return false;
};

/**
 * Recomputes campaign totals from participations rather than incrementing.
 *
 * A verification can re-run and revise a day's view count, so an $inc would drift.
 * The advertiser is billed on uniqueViewsDelivered, so drift here is a billing bug.
 */
const syncCampaignCounters = async (p: ICampaignParticipation, justCompleted: boolean): Promise<void> => {
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

    // Only on the transition, not on status: re-verifying an already-completed
    // participation used to call recordCompletion again, inflating
    // campaignsCompleted and trust on every re-check.
    if (justCompleted) {
        // Ranking owns profile stats: it also recomputes the measured average and
        // trust score, which a bare $inc here would silently skip.
        await recordCompletion(p);
    }
};

/**
 * Completes participations whose last status has expired.
 *
 * Verification can only complete a participation while someone is clicking; a
 * diffuseur who verifies day 3 and walks away would otherwise stay IN_PROGRESS
 * forever. The scheduler calls this each tick to finish what time has finished.
 */
export const completeMaturedParticipations = async (): Promise<number> => {
    const candidates = await CampaignParticipationModel.find({
        status: ParticipationStatus.IN_PROGRESS,
        days: { $not: { $elemMatch: { status: { $ne: DayStatus.VERIFIED } } } },
    });

    let completed = 0;
    for (const p of candidates) {
        const justCompleted = recomputeTotals(p);
        if (!justCompleted) continue;
        await p.save();
        await syncCampaignCounters(p, true);
        completed++;
    }

    if (completed) log.info(`Completed ${completed} matured participation(s)`);
    return completed;
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
        throw new AppError("Impossible d'identifier ce compte WhatsApp. Réessayez la connexion.", 400);
    }

    const existing = await DiffuseurProfileModel.findOne({ whatsappLid: extraction.whatsappLid });

    if (existing && !existing.userId.equals(diffuseurUserId)) {
        log.warn(
            `WhatsApp ${extraction.whatsappLid} already bound to ${existing.userId}, ` +
            `refused for ${diffuseurUserId}`,
        );
        // 409, and the message must reach the user: as a bare Error this became
        // a 500 rendered as « La vérification a échoué », leaving them to guess
        // that the phone they just linked belongs to another SBC account.
        throw new AppError(
            'Ce numéro WhatsApp est déjà lié à un autre compte SBC. '
            + 'Connectez le WhatsApp de ce compte-ci, ou contactez le support pour le détacher.',
            409,
        );
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
