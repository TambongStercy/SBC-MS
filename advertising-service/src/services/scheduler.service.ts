import { Types } from 'mongoose';
import CampaignModel, { CampaignStatus, ICampaign } from '../database/models/campaign.model';
import { allocateCampaign, expireStaleOffers, remainingViewsToCover } from './allocation.service';
import CampaignParticipationModel, {
    DayStatus,
    ParticipationStatus,
} from '../database/models/campaign-participation.model';
import DiffuseurProfileModel, { ReferralTier } from '../database/models/diffuseur-profile.model';
import { forfeitExpired, completeMaturedParticipations } from './verification.service';
import { sweepPendingPayouts } from './payout.service';
import { sweepReferralCommissions } from './referral-commission.service';
import { nextUnpostedDay, scheduleSummary } from './day-window.service';
import { sweepStaleCreditReservations } from './credit.service';
import { offerTestCampaignToNewDiffuseurs } from './test-campaign.service';
import { sweepReviewedVideos } from './manual-verification.service';
import {
    notifyVerificationDue,
    notifyDayDue,
    notifyDayOpened,
    notifyCampaignForfeited,
    notifyTestCampaignForfeited,
    notifyReferralSuspended,
    notifyAdvertiserCampaignComplete,
} from './clients/notification.service.client';
import config from '../config';
import logger from '../utils/logger';

const log = logger.getLogger('Scheduler');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** A status is readable for 24h; remind while there is still time to act. */
const VERIFY_REMINDER_AT_HOURS_LEFT = 2;

/**
 * Reminds diffuseurs to verify a posted-but-unverified day before its status
 * expires.
 *
 * The most valuable job here: once a status is gone the views are unrecoverable,
 * and unlike a missed post there is no grace budget that can undo it.
 */
export const remindPendingVerifications = async (): Promise<number> => {
    const now = new Date();
    // Posted between 24h and 22h ago: inside the expiry window, close to the edge.
    const windowStart = new Date(now.getTime() - DAY_MS);
    const windowEnd = new Date(now.getTime() - (24 - VERIFY_REMINDER_AT_HOURS_LEFT) * HOUR_MS);

    const participations = await CampaignParticipationModel.find({
        status: ParticipationStatus.IN_PROGRESS,
        days: {
            $elemMatch: {
                status: DayStatus.POSTED,
                postedAt: { $gte: windowStart, $lte: windowEnd },
                verificationReminderSentAt: { $exists: false },
            },
        },
    });

    let sent = 0;
    for (const p of participations) {
        const campaign = await CampaignModel.findById(p.campaignId).select('title').lean();
        for (const day of p.days) {
            if (day.status !== DayStatus.POSTED || !day.postedAt) continue;
            if (day.verificationReminderSentAt) continue;
            if (day.postedAt < windowStart || day.postedAt > windowEnd) continue;

            const hoursLeft = Math.max(
                1,
                Math.round((day.postedAt.getTime() + DAY_MS - now.getTime()) / HOUR_MS),
            );
            await notifyVerificationDue(
                String(p.diffuseurUserId),
                campaign?.title ?? 'votre campagne',
                day.day,
                hoursLeft,
            );
            // Stamped whether or not delivery succeeded: a mail outage must not turn
            // into a reminder every minute once it recovers.
            day.verificationReminderSentAt = now;
            sent++;
        }
        await p.save();
    }

    if (sent) log.info(`Sent ${sent} verification reminders`);
    return sent;
};

/**
 * Reminds diffuseurs whose next day is open and due within the next few hours.
 *
 * Unlike verification, missing this only spends grace, so it is a nudge rather
 * than a last call.
 */
export const remindDueDays = async (): Promise<number> => {
    const now = new Date();
    const soon = new Date(now.getTime() + 6 * HOUR_MS);

    const participations = await CampaignParticipationModel.find({
        status: ParticipationStatus.IN_PROGRESS,
        days: {
            $elemMatch: {
                status: DayStatus.PENDING,
                windowOpensAt: { $lte: now },
                dueAt: { $gte: now, $lte: soon },
                dayReminderSentAt: { $exists: false },
            },
        },
    });

    let sent = 0;
    for (const p of participations) {
        // nextUnpostedDay, not currentDay: currentDay is the day in progress and
        // stays on a posted-but-unverified day, which is not the one owed.
        const pending = nextUnpostedDay(p);
        if (!pending || pending.dayReminderSentAt) continue;
        if (!pending.windowOpensAt || pending.windowOpensAt > now) continue;
        if (!pending.dueAt || pending.dueAt > soon) continue;

        const campaign = await CampaignModel.findById(p.campaignId).select('title').lean();
        const summary = scheduleSummary(p, now);

        await notifyDayDue(
            String(p.diffuseurUserId),
            campaign?.title ?? 'votre campagne',
            pending.day,
            summary.hoursRemaining ?? 0,
        );
        pending.dayReminderSentAt = now;
        sent++;
        await p.save();
    }

    if (sent) log.info(`Sent ${sent} day reminders`);
    return sent;
};

/** Forfeits participations past recovery and tells the diffuseur why. */
export const sweepForfeits = async (): Promise<number> => {
    const before = await CampaignParticipationModel.find({
        status: ParticipationStatus.IN_PROGRESS,
    }).select('_id campaignId diffuseurUserId').lean();

    const count = await forfeitExpired();
    if (!count) return 0;

    const forfeited = await CampaignParticipationModel.find({
        _id: { $in: before.map(p => p._id) },
        status: ParticipationStatus.FORFEITED,
    }).select('campaignId diffuseurUserId').lean();

    const affectedCampaigns = new Set<string>();
    for (const p of forfeited) {
        const campaign = await CampaignModel.findById(p.campaignId).select('title isTestCampaign').lean();
        if (campaign?.isTestCampaign) {
            await notifyTestCampaignForfeited(String(p.diffuseurUserId));
        } else {
            await notifyCampaignForfeited(String(p.diffuseurUserId), campaign?.title ?? 'votre campagne');
        }
        affectedCampaigns.add(String(p.campaignId));
    }

    // The 24h day-1 rule exists so an unclaimed slot can go to someone else, which
    // only happens if the campaign is re-offered. Without this, a diffuseur who
    // accepts and ghosts silently costs the advertiser their views.
    for (const campaignId of affectedCampaigns) {
        try {
            await allocateCampaign(new Types.ObjectId(campaignId));
        } catch (err) {
            log.error(`Reallocation after forfeit failed for campaign ${campaignId}:`, err);
        }
    }

    log.info(`Forfeited ${count} participations, reallocated ${affectedCampaigns.size} campaigns`);
    return count;
};

/**
 * Tells a diffuseur the moment their next day becomes postable.
 *
 * Days are 24h apart, so otherwise they have to keep opening the app to find
 * out — and remindDueDays only fires 18h later, six hours before the nudge
 * deadline, which is far too late to be the first they hear of it.
 */
export const announceOpenedDays = async (): Promise<number> => {
    const now = new Date();

    const participations = await CampaignParticipationModel.find({
        status: ParticipationStatus.IN_PROGRESS,
        days: {
            $elemMatch: {
                status: DayStatus.PENDING,
                windowOpensAt: { $lte: now },
                dayOpenedNotifiedAt: { $exists: false },
            },
        },
    });

    let sent = 0;
    for (const p of participations) {
        const pending = nextUnpostedDay(p);
        if (!pending || pending.dayOpenedNotifiedAt) continue;
        if (!pending.windowOpensAt || pending.windowOpensAt > now) continue;
        // Day 1 opens at acceptance, and they have just been told about the
        // campaign — a second mail in the same minute is noise.
        if (pending.day === 1) {
            pending.dayOpenedNotifiedAt = now;
            await p.save();
            continue;
        }

        const campaign = await CampaignModel.findById(p.campaignId).select('title').lean();
        await notifyDayOpened(String(p.diffuseurUserId), campaign?.title ?? 'votre campagne', pending.day);

        // Stamped whether or not the mail went out, so a mail outage cannot turn
        // into a notification on every tick once it recovers.
        pending.dayOpenedNotifiedAt = now;
        await p.save();
        sent++;
    }

    if (sent) log.info(`Announced ${sent} newly opened day(s)`);
    return sent;
};

/**
 * Drops offers nobody ever answered.
 *
 * An outstanding offer reserves the reach it forecast, so the campaign is not
 * offered around it. Diffuseurs who never open the app would otherwise hold their
 * share of the target for the life of the campaign, and the advertiser would be
 * short exactly the views those people were never going to post.
 */
export const sweepUnansweredOffers = async (): Promise<number> => {
    const cutoff = new Date(Date.now() - config.campaign.offerTtlHours * HOUR_MS);

    // The test campaign reserves nothing, and a newcomer who takes a week to open
    // the app should still find it waiting.
    const testCampaigns = await CampaignModel
        .find({ isTestCampaign: true }).select('_id').lean();

    const stale = await CampaignParticipationModel.find({
        status: ParticipationStatus.OFFERED,
        offeredAt: { $lt: cutoff },
        campaignId: { $nin: testCampaigns.map(c => c._id) },
    }).select('campaignId').lean();

    if (!stale.length) return 0;

    await CampaignParticipationModel.updateMany(
        { _id: { $in: stale.map(p => p._id) } },
        { $set: { status: ParticipationStatus.EXPIRED } },
    );

    // Hand the freed reach to someone else in the same tick, rather than leaving
    // the campaign short until the next one.
    for (const campaignId of new Set(stale.map(p => String(p.campaignId)))) {
        try {
            await allocateCampaign(new Types.ObjectId(campaignId));
        } catch (err) {
            log.error(`Reallocation after stale offers failed for campaign ${campaignId}:`, err);
        }
    }

    log.info(`Expired ${stale.length} unanswered offer(s)`);
    return stale.length;
};

/**
 * Tops up every active campaign that is still short of its target.
 *
 * Allocation used to run only at activation and after a forfeit, so a campaign
 * that could not be filled on day one stayed unfilled — a diffuseur who finished
 * their test campaign an hour later was never pulled into it, however well they
 * matched. The advertiser simply never got the views they paid for.
 *
 * allocateCampaign skips anyone already offered the campaign, so running this on
 * every tick tops up rather than re-offers.
 */
export const sweepUnderfilledCampaigns = async (): Promise<number> => {
    const active = await CampaignModel
        .find({ status: CampaignStatus.ACTIVE, isTestCampaign: { $ne: true } })
        .select('_id title targetUniqueViews')
        .lean();

    let topped = 0;
    for (const campaign of active) {
        try {
            const remaining = await remainingViewsToCover(campaign as unknown as ICampaign);
            if (remaining <= 0) {
                // Fully booked. If the diffuseurs who accepted already cover the
                // target on their own, the offers still sitting unanswered are
                // surplus and would push the campaign past what was paid for.
                await expireStaleOffers(campaign._id);
                continue;
            }

            const result = await allocateCampaign(campaign._id);
            if (result.offersCreated > 0) {
                topped++;
                log.info(`Topped up "${campaign.title}" with ${result.offersCreated} offer(s), ${remaining} views short`);
            }
        } catch (err) {
            log.error(`Top-up failed for campaign ${campaign._id}:`, err);
        }
    }
    return topped;
};

/**
 * Suspends the referral commission for diffuseurs who were offered campaigns over
 * the inactivity window and completed none.
 *
 * Being offered nothing is explicitly not a penalty — a quiet month with no
 * matching campaigns is not the diffuseur's fault.
 */
export const sweepReferralSuspensions = async (): Promise<number> => {
    const cutoff = new Date(Date.now() - config.referral.inactivityDays * DAY_MS);

    const stale = await DiffuseurProfileModel.find({
        referralTier: ReferralTier.UNLOCKED,
        lastCampaignOfferedAt: { $gte: cutoff },
        $or: [
            { lastCampaignCompletedAt: { $lt: cutoff } },
            { lastCampaignCompletedAt: { $exists: false } },
        ],
    });

    for (const profile of stale) {
        profile.referralTier = ReferralTier.SUSPENDED;
        profile.referralSuspendedAt = new Date();
        await profile.save();
        await notifyReferralSuspended(String(profile.userId));
        log.info(`Referral commission suspended for ${profile.userId}`);
    }

    return stale.length;
};

/** Closes campaigns whose unique-view target has been met. */
export const sweepCompletedCampaigns = async (): Promise<number> => {
    // The test campaign is deliberately excluded. It has no view target — the
    // schema needs targetUniqueViews >= 1, so it carries 1 — and the first
    // diffuseur to deliver a single view would otherwise complete it. Once it is
    // no longer ACTIVE, getTestCampaign returns null, new diffuseurs stop being
    // measured, and the editor happily creates a second one. It ends only when an
    // admin retires it.
    const active = await CampaignModel.find({
        status: CampaignStatus.ACTIVE,
        isTestCampaign: { $ne: true },
    });

    let closed = 0;
    for (const campaign of active) {
        if (campaign.uniqueViewsDelivered < campaign.targetUniqueViews) continue;
        campaign.status = CampaignStatus.COMPLETED;
        campaign.completedAt = new Date();
        await campaign.save();
        // Nothing else stops an outstanding offer being accepted, and acceptOffer
        // on a campaign that is no longer ACTIVE only expires it after the
        // diffuseur has bothered to tap « Accepter ».
        await CampaignParticipationModel.updateMany(
            { campaignId: campaign._id, status: ParticipationStatus.OFFERED },
            { $set: { status: ParticipationStatus.EXPIRED } },
        );
        await notifyAdvertiserCampaignComplete(
            String(campaign.advertiserUserId),
            campaign.title,
            campaign.uniqueViewsDelivered,
        );
        closed++;
    }

    if (closed) log.info(`Closed ${closed} completed campaigns`);
    return closed;
};

/**
 * One tick of all periodic work.
 *
 * Each job is isolated: a failure in one must not stop the rest, and the forfeit
 * sweep in particular has to keep running even if notifications are broken.
 */
export const runScheduledJobs = async (): Promise<void> => {
    const jobs: Array<[string, () => Promise<number>]> = [
        ['remindPendingVerifications', remindPendingVerifications],
        ['announceOpenedDays', announceOpenedDays],
        ['remindDueDays', remindDueDays],
        ['sweepForfeits', sweepForfeits],
        // A participation completes when its LAST status expires (24h after the
        // final post), not at the final click on « Vérifier » — the last day
        // keeps collecting views until WhatsApp kills the status.
        ['completeMaturedParticipations', completeMaturedParticipations],
        ['sweepReferralSuspensions', sweepReferralSuspensions],
        // Reviewed recordings have no second reader, and were the fastest-growing
        // thing in storage until this.
        ['sweepReviewedVideos', sweepReviewedVideos],
        ['sweepCompletedCampaigns', sweepCompletedCampaigns],
        // Returns credit held by campaigns whose payment page was abandoned. No
        // callback ever arrives for those, so a timeout is the only signal.
        ['sweepStaleCreditReservations', sweepStaleCreditReservations],
        // Before allocation: a diffuseur who links WhatsApp today should be
        // measured before being offered anything an annonceur is paying for.
        ['offerTestCampaignToNewDiffuseurs', offerTestCampaignToNewDiffuseurs],
        // Before the top-up, so the reach held by offers nobody answered is free
        // to be re-offered on this tick rather than the next.
        ['sweepUnansweredOffers', sweepUnansweredOffers],
        // After the test campaign is handed out: a diffuseur measured on an
        // earlier tick becomes eligible here, and under-filled campaigns should
        // pick them up without waiting for someone to forfeit.
        ['sweepUnderfilledCampaigns', sweepUnderfilledCampaigns],
        // Last: it depends on participations the earlier jobs may have just
        // completed, and a credit that fails here is simply retried next tick.
        ['sweepPendingPayouts', async () => (await sweepPendingPayouts()).credited],
        // After payouts: completing a campaign can unlock a referrer's tier, and
        // that unlock should apply from the same tick.
        ['sweepReferralCommissions', async () => (await sweepReferralCommissions()).paid],
    ];

    for (const [name, job] of jobs) {
        try {
            await job();
        } catch (err) {
            log.error(`Scheduled job ${name} failed:`, err);
        }
    }
};

let timer: NodeJS.Timeout | undefined;

export const startScheduler = (): void => {
    const intervalMs = Number(process.env.SCHEDULER_INTERVAL_MS || 10 * 60 * 1000);
    if (process.env.SCHEDULER_ENABLED === 'false') {
        log.warn('Scheduler disabled by SCHEDULER_ENABLED=false');
        return;
    }

    log.info(`Scheduler started, every ${Math.round(intervalMs / 1000)}s`);
    timer = setInterval(() => void runScheduledJobs(), intervalMs);
    // Do not hold the process open on shutdown.
    timer.unref();
};

export const stopScheduler = (): void => {
    if (timer) clearInterval(timer);
};
