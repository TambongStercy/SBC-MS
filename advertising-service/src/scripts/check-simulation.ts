/**
 * Asserts the preprod simulation tools.
 *
 * These skip waiting and skip payment, so the one thing that must never be in
 * doubt is that they cannot run in production — and that skipping the wait does
 * not also skip the rules.
 *
 * Needs a Mongo instance. Uses its own database and drops it afterwards.
 *
 *   npx ts-node src/scripts/check-simulation.ts
 */
import mongoose, { Types } from 'mongoose';
import CampaignModel, { CampaignStatus } from '../database/models/campaign.model';
import CampaignParticipationModel, {
    DayStatus,
    ParticipationStatus,
} from '../database/models/campaign-participation.model';
import * as notifier from '../services/clients/notification.service.client';
import * as userClient from '../services/clients/user.service.client';

const DB = process.env.SIM_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_advertising_simulation_check';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

(notifier as any).notifyCampaignOffer = async () => true;
(userClient as any).getUserProfiles = async () => [];

// eslint-disable-next-line @typescript-eslint/no-var-requires
const sim = require('../services/simulation.service');

const HOUR = 60 * 60 * 1000;
let n = 0;

const seedCampaign = (status: CampaignStatus) => CampaignModel.create({
    advertiserUserId: new Types.ObjectId(),
    title: `Sim${n}`, mediaFileId: 'f', mediaType: 'image',
    landingPageSlug: `sim${n++}${Date.now()}`,
    amountPaid: 6000, pricePerUniqueView: 3, targetUniqueViews: 2000,
    status,
});

const main = async () => {
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();

    // --- The guard is the whole safety story ---
    process.env.SIMULATION_ENABLED = 'true';
    process.env.NODE_ENV = 'preprod';
    let allowed = true;
    try { sim.assertSimulationAllowed(); } catch { allowed = false; }
    check('allowed on preprod when explicitly enabled', allowed);

    process.env.SIMULATION_ENABLED = 'false';
    allowed = true;
    try { sim.assertSimulationAllowed(); } catch { allowed = false; }
    check('refused when not enabled', !allowed);

    process.env.SIMULATION_ENABLED = 'true';
    const realEnv = require('../config').default;
    const previous = realEnv.nodeEnv;
    realEnv.nodeEnv = 'production';
    allowed = true;
    try { sim.assertSimulationAllowed(); } catch { allowed = false; }
    check('refused in production even when enabled', !allowed, 'the flag alone must not be enough');
    realEnv.nodeEnv = previous;

    // --- A simulated payment still respects moderation ---
    const draft = await seedCampaign(CampaignStatus.DRAFT);
    let refused = false;
    try { await sim.simulatePayment(String(draft._id)); } catch { refused = true; }
    check('cannot activate an unapproved campaign', refused, 'skipping money must not skip review');

    const approved = await seedCampaign(CampaignStatus.APPROVED);
    await sim.simulatePayment(String(approved._id));
    const live = await CampaignModel.findById(approved._id);
    check('an approved campaign goes live', live?.status === CampaignStatus.ACTIVE);
    check('and is marked paid', Boolean(live?.paidAt && live?.paymentSessionId?.startsWith('simulated-')));

    // --- Shifting the clock opens the next day ---
    const now = new Date();
    const participation = await CampaignParticipationModel.create({
        campaignId: approved._id,
        diffuseurUserId: new Types.ObjectId(),
        diffuseurProfileId: new Types.ObjectId(),
        trackingCode: `s${Date.now()}`,
        status: ParticipationStatus.IN_PROGRESS,
        acceptedAt: now,
        completionDeadline: new Date(now.getTime() + 6 * 24 * HOUR),
        days: [
            { day: 1, status: DayStatus.VERIFIED, viewCount: 20, deliveredCount: 60, ratePerView: 1, earnedAmount: 20, postedAt: now, verifiedAt: now },
            { day: 2, status: DayStatus.PENDING, viewCount: 0, deliveredCount: 0, ratePerView: 0.5, earnedAmount: 0, windowOpensAt: new Date(now.getTime() + 24 * HOUR) },
            { day: 3, status: DayStatus.PENDING, viewCount: 0, deliveredCount: 0, ratePerView: 0.25, earnedAmount: 0 },
        ],
    });

    check(
        'day 2 is shut before the shift',
        participation.days[1].windowOpensAt! > new Date(),
    );

    const shifted = await sim.shiftParticipationClock(String(participation._id), 25);
    check('day 2 opens after shifting 25h', shifted.nextDayOpenNow === true,
        `opens ${shifted.nextDayOpensAt}`);

    const moved = (await CampaignParticipationModel.findById(participation._id))!;
    check(
        'the whole clock moves, not just the next window',
        moved.acceptedAt!.getTime() < now.getTime() && moved.days[0].postedAt!.getTime() < now.getTime(),
        'shifting one field alone would produce a state the real flow cannot reach',
    );
    check(
        'the completion deadline moves with it',
        moved.completionDeadline!.getTime() < new Date(now.getTime() + 6 * 24 * HOUR).getTime(),
    );

    let rejected = false;
    try { await sim.shiftParticipationClock(String(participation._id), -5); } catch { rejected = true; }
    check('refuses a negative shift', rejected);

    // --- Simulated verification fills a day and pays at the real rate ---
    const result = await sim.simulateVerification(String(participation._id), 2, 40);
    check('day 2 is verified with the given views', result.viewCount === 40);
    check('earnings use the rate fixed at offer time', result.earnedAmount === 20,
        `40 views x 0.5 = 20; got ${result.earnedAmount}`);

    await sim.simulateVerification(String(participation._id), 3, 10);
    const done = (await CampaignParticipationModel.findById(participation._id))!;
    check('completing every day completes the participation',
        done.status === ParticipationStatus.COMPLETED, done.status);
    check('totals add up across the three days', done.totalEarned === 20 + 20 + 2.5,
        `got ${done.totalEarned}`);
    check('day 1 counts as unique, the rest as repeat',
        done.uniqueViews === 20 && done.repeatViews === 50,
        `${done.uniqueViews} unique / ${done.repeatViews} repeat`);

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
