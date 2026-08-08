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
 *   2. From ACCEPTANCE, the diffuseur has durationDays (3) to finish, then
 *      graceDays (3) more regardless of what happened. Miss that and the whole
 *      campaign is forfeited.
 *
 * Both clocks start at acceptance, so a diffuseur knows their whole timeline the
 * moment they accept rather than having it shift under them depending on when they
 * got around to posting.
 *
 * Days are still spaced minHoursBetweenDays (24h) apart, so the three posts really
 * do span three days.
 */

/**
 * Starts both clocks at acceptance.
 *
 * The 24h day-1 rule is what lets an unclaimed slot be released to another
 * diffuseur when the selected one does not act.
 */
export const openParticipation = (participation: ICampaignParticipation, acceptedAt: Date): void => {
    const first = participation.days.find(d => d.day === 1);
    if (first) {
        first.windowOpensAt = acceptedAt;
        first.dueAt = new Date(acceptedAt.getTime() + DAY_MS);
    }
    participation.day1Deadline = new Date(acceptedAt.getTime() + DAY_MS);
    participation.completionDeadline = new Date(
        acceptedAt.getTime() + (config.campaign.durationDays + config.campaign.graceDays) * DAY_MS,
    );
};

/** Opens day N+1 once day N is posted. Deadlines were fixed at acceptance. */
export const openNextDay = (participation: ICampaignParticipation, postedDay: number): void => {
    const posted = participation.days.find(d => d.day === postedDay);
    if (!posted?.postedAt) return;

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

    // Day 1 not posted in time: the slot is released so another diffuseur can take it.
    if (!dayOnePosted && participation.day1Deadline && at > participation.day1Deadline) {
        return true;
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
    const normalEnd = participation.acceptedAt
        ? new Date(participation.acceptedAt.getTime() + config.campaign.durationDays * DAY_MS)
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
