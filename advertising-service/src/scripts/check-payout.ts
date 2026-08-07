/**
 * Asserts the payout guards against a real database.
 *
 * This is the only code here that causes money to move, so the failure modes are
 * asymmetric: paying late is recoverable, paying twice is not. These checks cover
 * the second.
 *
 * Needs a Mongo instance. Uses its own database and drops it afterwards.
 *
 *   npx ts-node src/scripts/check-payout.ts
 */
import mongoose, { Types } from 'mongoose';
import CampaignParticipationModel, {
    DayStatus,
    ParticipationStatus,
} from '../database/models/campaign-participation.model';
import DiffuseurProfileModel from '../database/models/diffuseur-profile.model';
import CampaignModel, { CampaignStatus } from '../database/models/campaign.model';
import { creditParticipation } from '../services/payout.service';
import * as userClient from '../services/clients/user.service.client';
import * as notifier from '../services/clients/notification.service.client';

const DB = process.env.PAYOUT_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_advertising_payout_check';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

/** Records what the payout service tried to credit, without calling user-service. */
const credits: Array<{ userId: string; amount: number; reference: string }> = [];
let creditShouldFail = false;

(userClient as any).creditAdvertisingEarnings = async (args: any) => {
    if (creditShouldFail) throw new Error('simulated user-service failure');
    credits.push(args);
    return { newAdvertisingBalance: args.amount, transactionId: 'tx_test' };
};
(notifier as any).notifyCampaignCompleted = async () => true;
(notifier as any).notifyReferralUnlocked = async () => true;

const seed = async (overrides: Partial<Record<string, unknown>> = {}) => {
    const campaign = await CampaignModel.create({
        advertiserUserId: new Types.ObjectId(),
        title: 'Test',
        mediaFileId: 'file1',
        mediaType: 'image',
        landingPageSlug: `slug${Date.now()}${Math.floor(performance.now())}`,
        amountPaid: 6000,
        pricePerUniqueView: 3,
        targetUniqueViews: 2000,
        status: CampaignStatus.ACTIVE,
    });

    const profile = await DiffuseurProfileModel.create({
        userId: new Types.ObjectId(),
        declaredAverageViews: 100,
    });

    return CampaignParticipationModel.create({
        campaignId: campaign._id,
        diffuseurUserId: profile.userId,
        diffuseurProfileId: profile._id,
        status: ParticipationStatus.COMPLETED,
        trackingCode: `t${Date.now()}${Math.floor(performance.now())}`,
        totalViews: 300,
        days: [
            { day: 1, status: DayStatus.VERIFIED, viewCount: 100, deliveredCount: 300, ratePerView: 1, earnedAmount: 100 },
            { day: 2, status: DayStatus.VERIFIED, viewCount: 100, deliveredCount: 300, ratePerView: 0.5, earnedAmount: 50 },
            { day: 3, status: DayStatus.VERIFIED, viewCount: 100, deliveredCount: 300, ratePerView: 0.25, earnedAmount: 25 },
        ],
        ...overrides,
    });
};

const main = async () => {
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();

    // --- Happy path: 100x1 + 100x0.5 + 100x0.25 = 175 ---
    const p1 = await seed();
    const r1 = await creditParticipation(p1._id);
    check('credits a completed participation', r1.credited === true, `${r1.amount} XAF`);
    check('amount is recomputed from days', r1.amount === 175, `got ${r1.amount}`);

    // --- The one that must never happen ---
    const r2 = await creditParticipation(p1._id);
    check('refuses to credit the same participation twice', r2.credited === false, r2.reason);
    check('only one credit reached user-service', credits.length === 1, `${credits.length} credits`);

    // --- Rufus's core rule: all days or nothing ---
    const p3 = await seed({
        days: [
            { day: 1, status: DayStatus.VERIFIED, viewCount: 100, deliveredCount: 300, ratePerView: 1, earnedAmount: 100 },
            { day: 2, status: DayStatus.PENDING, viewCount: 0, deliveredCount: 0, ratePerView: 0.5, earnedAmount: 0 },
            { day: 3, status: DayStatus.PENDING, viewCount: 0, deliveredCount: 0, ratePerView: 0.25, earnedAmount: 0 },
        ],
    });
    const r3 = await creditParticipation(p3._id);
    check('refuses when days are unverified', r3.credited === false, r3.reason);

    // --- Not completed ---
    const p4 = await seed({ status: ParticipationStatus.IN_PROGRESS });
    const r4 = await creditParticipation(p4._id);
    check('refuses a participation still in progress', r4.credited === false, r4.reason);

    // --- Forfeited must never pay ---
    const p5 = await seed({ status: ParticipationStatus.FORFEITED });
    const r5 = await creditParticipation(p5._id);
    check('refuses a forfeited participation', r5.credited === false, r5.reason);

    // --- A failed credit must be retryable, not silently lost ---
    const before = credits.length;
    creditShouldFail = true;
    const p6 = await seed();
    const r6 = await creditParticipation(p6._id);
    check('reports failure when user-service errors', r6.credited === false, r6.reason);

    const afterFail = await CampaignParticipationModel.findById(p6._id).lean();
    check('releases the claim so the next sweep retries', !afterFail?.creditedAt);

    creditShouldFail = false;
    const r6b = await creditParticipation(p6._id);
    check('succeeds on retry', r6b.credited === true, `${r6b.amount} XAF`);
    check('retry produced exactly one credit', credits.length === before + 1);

    // --- A corrupted running total must not become a payment ---
    const p7 = await seed({ totalEarned: 999999 });
    const r7 = await creditParticipation(p7._id);
    check('ignores the denormalised total', r7.amount === 175, `got ${r7.amount}`);

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
