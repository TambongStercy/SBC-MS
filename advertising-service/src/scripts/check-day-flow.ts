/**
 * Asserts the post → verify → next day cycle.
 *
 * This is the loop a diffuseur actually lives in, and it was broken in a way no
 * existing suite could see: three days could be marked posted within seconds of
 * each other, and the day awaiting verification vanished from the schedule, so
 * the verify screen was unreachable.
 *
 * Needs a Mongo instance. Uses its own database and drops it afterwards.
 *
 *   npx ts-node src/scripts/check-day-flow.ts
 */
import mongoose, { Types } from 'mongoose';
import CampaignParticipationModel, {
    DayStatus,
    ParticipationStatus,
} from '../database/models/campaign-participation.model';
import {
    openParticipation,
    scheduleSummary,
    currentDay,
    nextUnpostedDay,
} from '../services/day-window.service';
import config from '../config';

const DB = process.env.DAYFLOW_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_advertising_dayflow_check';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { markPosted } = require('../api/controllers/diffuseur.controller');

const HOUR = 60 * 60 * 1000;

/** Calls the real controller, so the guards under test are the shipped ones. */
const post = async (participationId: Types.ObjectId, userId: Types.ObjectId) => {
    let code = 200;
    let body: any;
    const res: any = {
        status(n: number) { code = n; return this; },
        json(b: unknown) { body = b; return this; },
    };
    await markPosted({ params: { id: String(participationId) }, user: { userId: String(userId) } } as any, res);
    return { code, body };
};

const main = async () => {
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();

    const userId = new Types.ObjectId();
    const participation = await CampaignParticipationModel.create({
        campaignId: new Types.ObjectId(),
        diffuseurUserId: userId,
        diffuseurProfileId: new Types.ObjectId(),
        trackingCode: `d${Date.now()}`,
        status: ParticipationStatus.IN_PROGRESS,
        days: Array.from({ length: config.campaign.durationDays }, (_, i) => ({
            day: i + 1, status: DayStatus.PENDING, viewCount: 0, deliveredCount: 0,
            ratePerView: 1, earnedAmount: 0,
        })),
    });

    openParticipation(participation, new Date());
    await participation.save();

    check('day 1 opens on acceptance', Boolean(participation.days[0].windowOpensAt));
    check('day 2 is not open yet', !participation.days[1].windowOpensAt,
        'it opens 24h after day 1 is posted');

    // --- Posting day 1 ---
    const first = await post(participation._id, userId);
    check('day 1 can be posted', first.code === 200, JSON.stringify(first.body?.message ?? ''));

    let fresh = (await CampaignParticipationModel.findById(participation._id))!;
    check('day 1 is marked posted', fresh.days[0].status === DayStatus.POSTED);
    check(
        'posting day 1 opens day 2',
        Boolean(fresh.days[1].windowOpensAt),
        'openNextDay used to run only on verification, leaving day 2 with no window at all',
    );

    // --- The bug Sterling hit ---
    const second = await post(participation._id, userId);
    check(
        'day 2 cannot be posted while day 1 awaits verification',
        second.code === 400,
        second.code === 200 ? 'THREE DAYS COULD GO OUT IN ONE MINUTE' : String(second.body?.message ?? ''),
    );

    fresh = (await CampaignParticipationModel.findById(participation._id))!;
    check('and day 2 stays pending', fresh.days[1].status === DayStatus.PENDING);

    // --- The schedule must keep showing the posted day ---
    const posted = currentDay(fresh);
    check(
        'the posted day is still the current one',
        posted?.day === 1 && posted?.status === DayStatus.POSTED,
        'it used to jump to day 2, which is why the verify screen never appeared',
    );
    check('while the next day owed is day 2', nextUnpostedDay(fresh)?.day === 2);

    const summary = scheduleSummary(fresh);
    check('the schedule says a day awaits verification', summary.awaitingVerification?.day === 1);
    check('and refuses posting for now', summary.canPostNow === false);
    check('the completion deadline is exposed', Boolean(summary.completionDeadline),
        'the screen showed "À terminer avant le —" without it');

    // --- After verification, day 2 still has to wait out its 24h ---
    fresh.days[0].status = DayStatus.VERIFIED;
    fresh.days[0].verifiedAt = new Date();
    await fresh.save();

    const tooSoon = await post(fresh._id, userId);
    check('day 2 still waits for its window', tooSoon.code === 400, String(tooSoon.body?.message ?? ''));

    const summaryAfter = scheduleSummary(fresh);
    check('day 1 counts as completed', summaryAfter.daysCompleted === 1);
    check('the current day moves on once verified', currentDay(fresh)?.day === 2);

    // --- Once the window opens, day 2 posts ---
    fresh.days[1].windowOpensAt = new Date(Date.now() - HOUR);
    await fresh.save();

    const dayTwo = await post(fresh._id, userId);
    check('day 2 posts once its window has opened', dayTwo.code === 200, String(dayTwo.body?.message ?? ''));

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();

    console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`);
    process.exit(failures === 0 ? 0 : 1);
};

main().catch(async err => {
    console.error('Failed:', err.message);
    await mongoose.disconnect().catch(() => { });
    process.exit(1);
});
