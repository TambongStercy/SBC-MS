import CampaignModel, { CampaignStatus } from '../database/models/campaign.model';
import CampaignParticipationModel, {
    DayStatus,
    ParticipationStatus,
} from '../database/models/campaign-participation.model';
import DiffuseurProfileModel, { ReferralTier } from '../database/models/diffuseur-profile.model';
import { forfeitExpired } from './verification.service';
import { currentDay, scheduleSummary } from './day-window.service';
import {
    notifyVerificationDue,
    notifyDayDue,
    notifyCampaignForfeited,
    notifyReferralSuspended,
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
        const pending = currentDay(p);
        if (!pending || pending.dayReminderSentAt) continue;
        if (!pending.windowOpensAt || pending.windowOpensAt > now) continue;
        if (!pending.dueAt || pending.dueAt > soon) continue;

        const campaign = await CampaignModel.findById(p.campaignId).select('title').lean();
        const summary = scheduleSummary(p, now);

        await notifyDayDue(
            String(p.diffuseurUserId),
            campaign?.title ?? 'votre campagne',
            pending.day,
            summary.graceDaysRemaining,
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

    for (const p of forfeited) {
        const campaign = await CampaignModel.findById(p.campaignId).select('title').lean();
        await notifyCampaignForfeited(String(p.diffuseurUserId), campaign?.title ?? 'votre campagne');
    }

    log.info(`Forfeited ${count} participations`);
    return count;
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
    const active = await CampaignModel.find({ status: CampaignStatus.ACTIVE });

    let closed = 0;
    for (const campaign of active) {
        if (campaign.uniqueViewsDelivered < campaign.targetUniqueViews) continue;
        campaign.status = CampaignStatus.COMPLETED;
        campaign.completedAt = new Date();
        await campaign.save();
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
        ['remindDueDays', remindDueDays],
        ['sweepForfeits', sweepForfeits],
        ['sweepReferralSuspensions', sweepReferralSuspensions],
        ['sweepCompletedCampaigns', sweepCompletedCampaigns],
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
