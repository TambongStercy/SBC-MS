/**
 * Asserts a diffuseur waiting on OUR review is not forfeited for it.
 *
 * The chain that produced « Cette participation n'est pas en cours (statut :
 * offered) » (Rufus, 2026-09-06), which stranded 71 recordings:
 *
 *   1. a diffuseur posts and uploads their screen recording
 *   2. manual verification only marks the day VERIFIED when an admin approves,
 *      so until then the day still reads as unposted
 *   3. the deadline sweep forfeits them for not completing day 1
 *   4. on the test campaign a forfeit makes them revivable, so the next sweep
 *      resets the participation to OFFERED and wipes its days
 *   5. the recording an admin was about to review now points at an OFFERED
 *      participation, and every attempt to validate it fails forever
 *
 * Every step was individually reasonable. Together they punished people for our
 * review latency and destroyed work they had already done.
 *
 * Needs a Mongo instance. Uses its own database and drops it afterwards.
 *
 *   npx ts-node src/scripts/check-forfeit-vs-review.ts
 */
import mongoose, { Types } from 'mongoose';
import CampaignParticipationModel, {
    ParticipationStatus,
    DayStatus,
} from '../database/models/campaign-participation.model';
import ManualVerificationModel, { ManualVerificationStatus } from '../database/models/manual-verification.model';
import { forfeitExpired } from '../services/verification.service';

const DB = process.env.FORFEIT_TEST_DB
    || 'mongodb://127.0.0.1:27017/sbc_advertising_forfeit_check';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

const DAY = 24 * 60 * 60 * 1000;
let n = 0;

/** A participation well past its day-1 deadline with nothing posted. */
const overdue = async () =>
    CampaignParticipationModel.create({
        campaignId: new Types.ObjectId(),
        diffuseurUserId: new Types.ObjectId(),
        diffuseurProfileId: new Types.ObjectId(),
        status: ParticipationStatus.IN_PROGRESS,
        trackingCode: `t${Date.now()}${n++}`,
        offeredAt: new Date(Date.now() - 10 * DAY),
        acceptedAt: new Date(Date.now() - 10 * DAY),
        startedAt: new Date(Date.now() - 10 * DAY),
        day1Deadline: new Date(Date.now() - 9 * DAY),
        completionDeadline: new Date(Date.now() - 8 * DAY),
        days: [{ day: 1, status: DayStatus.PENDING, viewCount: 0, deliveredCount: 0, ratePerView: 0, earnedAmount: 0 }],
    });

const verificationFor = (participationId: Types.ObjectId, status: ManualVerificationStatus) =>
    ManualVerificationModel.create({
        participationId,
        campaignId: new Types.ObjectId(),
        diffuseurUserId: new Types.ObjectId(),
        day: 1,
        code: String(100000 + n++),
        codeIssuedAt: new Date(),
        expiresAt: new Date(Date.now() + 900_000),
        status,
        videoFileId: 'proof.mp4',
        uploadedAt: new Date(),
    });

const main = async () => {
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();

    const waiting = await overdue();
    await verificationFor(waiting._id, ManualVerificationStatus.PENDING_REVIEW);

    const abandoned = await overdue();

    const stale = await overdue();
    await verificationFor(stale._id, ManualVerificationStatus.EXPIRED);

    const forfeited = await forfeitExpired();

    check('someone who abandoned is still forfeited', forfeited >= 1);
    check(
        'but not someone whose recording is awaiting review',
        (await CampaignParticipationModel.findById(waiting._id))?.status === ParticipationStatus.IN_PROGRESS,
        'they did everything asked; the delay is ours',
    );
    check(
        'the abandoned one really did forfeit',
        (await CampaignParticipationModel.findById(abandoned._id))?.status === ParticipationStatus.FORFEITED,
    );
    check(
        'an expired recording does not shield them either',
        (await CampaignParticipationModel.findById(stale._id))?.status === ParticipationStatus.FORFEITED,
        'only a recording actually queued for review holds the clock',
    );

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
