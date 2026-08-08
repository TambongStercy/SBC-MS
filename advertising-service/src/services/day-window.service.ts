import { IDayProof, ICampaignParticipation } from '../database/models/campaign-participation.model';
import config from '../config';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Campaign day scheduling.
 *
 * Two independent deadlines, no per-day quota:
 *
 *   1. Day 1 must be posted within 24h of accepting, or the offer is dropped. This
 *      stops someone accepting a campaign and sitting on it, which would block a
 *      slot other diffuseurs could have filled.
 *
 *   2. From the day-1 post, the diffuseur has durationDays (3) to finish, then
 *      graceDays (3) more regardless of what happened. Miss that and the whole
 *      campaign is forfeited.
 *
 * Anchored to the day-1 POST, not to acceptance: someone who accepts and posts
 * promptly should not lose window to someone who accepted at the same moment and
 * posted 23h later.
 *
 * Days are still spaced minHoursBetweenDays (24h) apart, so the three posts really
 * do span three days.
 */

/** Day 1 opens on acceptance and must be posted within 24h. */
export const openDayOne = (participation: ICampaignParticipation, acceptedAt: Date): void => {
    const first = participation.days.find(d => d.day === 1);
    if (!first) return;
    first.windowOpensAt = acceptedAt;
    first.dueAt = new Date(acceptedAt.getTime() + DAY_MS);
    participation.day1Deadline = first.dueAt;
};

/**
 * Opens day N+1 once day N is posted, and on the first post fixes the deadline for
 * the whole campaign.
 */
export const openNextDay = (participation: ICampaignParticipation, postedDay: number): void => {
    const posted = participation.days.find(d => d.day === postedDay);
    if (!posted?.postedAt) return;

    if (postedDay === 1) {
        participation.completionDeadline = new Date(
            posted.postedAt.getTime()
            + (config.campaign.durationDays + config.campaign.graceDays) * DAY_MS,
        );
    }

    const next = participation.days.find(d => d.day === postedDay + 1);
    if (!next) return;

    const opens = new Date(posted.postedAt.getTime() + config.campaign.minHoursBetweenDays * HOUR_MS);
    next.windowOpensAt = opens;
    // Informational only now that grace is a single campaign-level deadline; kept
    // so reminders can nudge before someone drifts into the grace period.
    next.dueAt = new Date(opens.getTime() + DAY_MS);
};

/** The day the diffuseur owes next, if any. */
export const currentDay = (participation: ICampaignParticipation): IDayProof | undefined =>
    participation.days.find(d => !d.postedAt);

/**
 * Whether this participation can no longer be saved.
 *
 * Either they never posted day 1 in time, or the full window has run out.
 */
export const isBeyondRecovery = (participation: ICampaignParticipation, at: Date): boolean => {
    const pending = currentDay(participation);
    if (!pending) return false;

    const dayOnePosted = participation.days.find(d => d.day === 1)?.postedAt;

    if (!dayOnePosted) {
        return Boolean(participation.day1Deadline && at > participation.day1Deadline);
    }
    return Boolean(participation.completionDeadline && at > participation.completionDeadline);
};

/** Shown to the diffuseur so they know exactly where they stand. */
export const scheduleSummary = (participation: ICampaignParticipation, at = new Date()) => {
    const pending = currentDay(participation);
    const dayOnePosted = participation.days.find(d => d.day === 1)?.postedAt;

    // Before day 1 the clock that matters is the 24h acceptance deadline; after it,
    // the campaign completion deadline.
    const deadline = dayOnePosted ? participation.completionDeadline : participation.day1Deadline;
    const normalEnd = dayOnePosted
        ? new Date(dayOnePosted.getTime() + config.campaign.durationDays * DAY_MS)
        : undefined;

    return {
        currentDay: pending?.day,
        windowOpensAt: pending?.windowOpensAt,
        canPostNow: Boolean(pending?.windowOpensAt && at >= pending.windowOpensAt),
        deadline,
        hoursRemaining: deadline
            ? Math.max(0, Math.round((deadline.getTime() - at.getTime()) / HOUR_MS))
            : undefined,
        /** True once past the normal 3 days and running on grace. */
        inGracePeriod: Boolean(normalEnd && at > normalEnd),
        graceDaysTotal: config.campaign.graceDays,
        beyondRecovery: isBeyondRecovery(participation, at),
    };
};
