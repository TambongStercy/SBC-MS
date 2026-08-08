/**
 * Asserts the day-gap rule, which gates payment.
 *
 * Without it, three statuses posted in one afternoon satisfy days 1, 2 and 3 in a
 * single verification pass, and the advertiser is billed for repeat reach that
 * never happened. No database needed; these are pure functions.
 *
 *   npx ts-node src/scripts/check-day-gap.ts
 */
import { findMatchingStatus, earliestAllowedPost } from '../services/verification.service';
import { openParticipation, isBeyondRecovery } from '../services/day-window.service';
import { DayStatus, IDayProof } from '../database/models/campaign-participation.model';
import { ExtractedStatus } from '../services/whatsapp-status.service';
import config from '../config';

const CODE = 'abc123xyz9';
const HOUR = 60 * 60 * 1000;
const T0 = new Date('2026-08-07T09:00:00Z');

const day = (n: number, postedAt?: Date): IDayProof => ({
    day: n,
    status: postedAt ? DayStatus.VERIFIED : DayStatus.PENDING,
    postedAt,
    viewCount: 0,
    deliveredCount: 0,
    ratePerView: config.pricing.diffuseurRatePerDay[n - 1] ?? 0,
    earnedAmount: 0,
});

const status = (id: string, postedAt: Date, caption = `Promo ${CODE}`): ExtractedStatus => ({
    statusMessageId: id,
    postedAt,
    mediaType: 'image',
    caption,
    viewCount: 100,
    deliveredCount: 300,
});

let failures = 0;
const check = (label: string, ok: boolean) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (!ok) failures++;
};

// --- Day 1 has no predecessor, so it is always allowed ---
check('day 1 has no earliest bound', earliestAllowedPost([day(1)], 1) === undefined);

// --- The attack this exists to stop ---
const days = [day(1, T0), day(2), day(3)];
const gapMs = config.campaign.minHoursBetweenDays * HOUR;

const twoHoursLater = findMatchingStatus(
    [status('S2', new Date(T0.getTime() + 2 * HOUR))],
    CODE,
    new Set(['S1']),
    earliestAllowedPost(days, 2),
);
check('day 2 rejects a status posted 2h after day 1', twoHoursLater === undefined);

const nextMorning = findMatchingStatus(
    [status('S2', new Date(T0.getTime() + gapMs + HOUR))],
    CODE,
    new Set(['S1']),
    earliestAllowedPost(days, 2),
);
check('day 2 accepts a status posted the next morning', nextMorning?.statusMessageId === 'S2');

// Exactly on the boundary must pass, or a punctual daily poster is refused.
const exactlyAtBound = findMatchingStatus(
    [status('S2', new Date(T0.getTime() + gapMs))],
    CODE,
    new Set(['S1']),
    earliestAllowedPost(days, 2),
);
check('day 2 accepts a status exactly at the boundary', exactlyAtBound?.statusMessageId === 'S2');

// --- Tracking code is what identifies our post ---
check(
    'a status without the tracking code is ignored',
    findMatchingStatus([status('SX', T0, 'just a normal status')], CODE, new Set()) === undefined,
);
check(
    'the code is matched case-insensitively',
    findMatchingStatus([status('SU', T0, `Promo ${CODE.toUpperCase()}`)], CODE, new Set())
        ?.statusMessageId === 'SU',
);
check(
    'an already-claimed status cannot be reused',
    findMatchingStatus([status('S1', T0)], CODE, new Set(['S1'])) === undefined,
);

// --- Oldest-first, so consecutive days consume posts in real order ---
const outOfOrder = findMatchingStatus(
    [
        status('LATE', new Date(T0.getTime() + 5 * HOUR)),
        status('EARLY', T0),
    ],
    CODE,
    new Set(),
);
check('picks the oldest matching status first', outOfOrder?.statusMessageId === 'EARLY');

// --- Deadlines: day 1 within 24h of accepting, then 6 days to finish ---
const mkParticipation = (ds: IDayProof[]) => ({ days: ds } as any);

const accepted = T0;
const p1 = mkParticipation([day(1), day(2), day(3)]);
p1.acceptedAt = accepted;
openParticipation(p1, accepted);
check(
    'day 1 deadline is 24h after accepting',
    p1.day1Deadline?.getTime() === accepted.getTime() + 24 * HOUR,
);
check(
    'not forfeited while inside the day-1 window',
    isBeyondRecovery(p1, new Date(accepted.getTime() + 23 * HOUR)) === false,
);
check(
    'forfeited when day 1 was never posted in 24h',
    isBeyondRecovery(p1, new Date(accepted.getTime() + 25 * HOUR)) === true,
);

const p2 = mkParticipation([day(1, T0), day(2), day(3)]);
p2.acceptedAt = accepted;
openParticipation(p2, accepted);
const totalWindow = (config.campaign.durationDays + config.campaign.graceDays) * 24 * HOUR;
check(
    'completion deadline is duration + grace from ACCEPTANCE',
    p2.completionDeadline?.getTime() === accepted.getTime() + totalWindow,
);
check(
    'still recoverable inside the grace period',
    isBeyondRecovery(p2, new Date(accepted.getTime() + totalWindow - HOUR)) === false,
);
check(
    'forfeited once the full window has passed',
    isBeyondRecovery(p2, new Date(accepted.getTime() + totalWindow + HOUR)) === true,
);
check(
    'lateness alone does not forfeit, only the deadline does',
    isBeyondRecovery(p2, new Date(accepted.getTime() + 4 * 24 * HOUR)) === false,
);
check(
    'posting day 1 clears the 24h kick-out risk',
    isBeyondRecovery(p2, new Date(accepted.getTime() + 30 * HOUR)) === false,
);

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
