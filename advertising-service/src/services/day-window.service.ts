import { IDayProof, ICampaignParticipation } from '../database/models/campaign-participation.model';
import config from '../config';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Scheduling rules for campaign days.
 *
 * Grace is a QUOTA consumed by lateness, not a fixed calendar deadline. A deadline
 * set at acceptance punishes a diffuseur who posted day 1 immediately and rewards
 * one who stalled, since both hit the same wall. With a quota, everyone gets the
 * same slack measured from their own posting rhythm.
 *
 * Per day N:
 *   opens  = day N-1 posted + minHoursBetweenDays   (day 1 opens on acceptance)
 *   dueAt  = opens + 24h                            (on time, no grace consumed)
 *   later  = 1 grace day per whole day past dueAt, charged to a shared budget
 *   budget exhausted -> forfeited, nothing paid
 */

/** Day 1 opens the moment the offer is accepted. */
export const openDayOne = (participation: ICampaignParticipation, acceptedAt: Date): void => {
    const first = participation.days.find(d => d.day === 1);
    if (!first) return;
    first.windowOpensAt = acceptedAt;
    first.dueAt = new Date(acceptedAt.getTime() + DAY_MS);
};

/**
 * Opens day N+1 once day N is posted.
 *
 * A full 24h, so three posts genuinely span three days. A shorter gap would let
 * each post creep earlier than the last, compressing the campaign and delivering
 * less spread than the advertiser paid for. Lateness is absorbed by the grace
 * budget rather than by shortening the gap.
 */
export const openNextDay = (participation: ICampaignParticipation, postedDay: number): void => {
    const posted = participation.days.find(d => d.day === postedDay);
    const next = participation.days.find(d => d.day === postedDay + 1);
    if (!posted?.postedAt || !next) return;

    const opens = new Date(posted.postedAt.getTime() + config.campaign.minHoursBetweenDays * HOUR_MS);
    next.windowOpensAt = opens;
    next.dueAt = new Date(opens.getTime() + DAY_MS);
};

/** Whole days past the on-time deadline. 0 when on time or not yet due. */
export const graceDaysFor = (day: IDayProof, at: Date): number => {
    if (!day.dueAt || at <= day.dueAt) return 0;
    return Math.ceil((at.getTime() - day.dueAt.getTime()) / DAY_MS);
};

/**
 * Charges lateness for a day that was just posted, and reports whether the budget
 * is blown. Callers must forfeit when this returns exhausted.
 */
export const chargeGrace = (
    participation: ICampaignParticipation,
    day: IDayProof,
    postedAt: Date,
): { consumed: number; totalUsed: number; exhausted: boolean } => {
    const consumed = graceDaysFor(day, postedAt);
    day.graceDaysConsumed = consumed;

    // Recomputed from the days rather than incremented, so a re-verification that
    // revises a post time cannot double-charge.
    const totalUsed = participation.days.reduce((sum, d) => sum + (d.graceDaysConsumed ?? 0), 0);
    participation.graceDaysUsed = totalUsed;

    return { consumed, totalUsed, exhausted: totalUsed > config.campaign.graceDays };
};

/** The day the diffuseur owes next, if any. */
export const currentDay = (participation: ICampaignParticipation): IDayProof | undefined =>
    participation.days.find(d => !d.postedAt);

/**
 * Grace already spent plus grace a still-unposted day would cost right now.
 *
 * Used by the sweep: a participation is dead once no amount of posting today could
 * stay inside the budget, and waiting for a fixed deadline to pass would leave it
 * hanging for days after that became true.
 */
export const isBeyondRecovery = (participation: ICampaignParticipation, at: Date): boolean => {
    const pending = currentDay(participation);
    if (!pending) return false;

    const spent = participation.days.reduce((sum, d) => sum + (d.graceDaysConsumed ?? 0), 0);
    return spent + graceDaysFor(pending, at) > config.campaign.graceDays;
};

/** Shown to the diffuseur so they know exactly where they stand. */
export const scheduleSummary = (participation: ICampaignParticipation, at = new Date()) => {
    const pending = currentDay(participation);
    const spent = participation.graceDaysUsed ?? 0;
    const wouldCost = pending ? graceDaysFor(pending, at) : 0;

    return {
        currentDay: pending?.day,
        windowOpensAt: pending?.windowOpensAt,
        dueAt: pending?.dueAt,
        canPostNow: Boolean(pending?.windowOpensAt && at >= pending.windowOpensAt),
        graceDaysUsed: spent,
        graceDaysTotal: config.campaign.graceDays,
        graceDaysRemaining: Math.max(0, config.campaign.graceDays - spent - wouldCost),
        beyondRecovery: isBeyondRecovery(participation, at),
    };
};
