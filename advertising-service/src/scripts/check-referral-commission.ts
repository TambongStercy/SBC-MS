/**
 * Asserts the referral commission against Rufus's own arithmetic and its guards.
 *
 * The base matters: 20% of SBC's MARGIN, not of campaign value. Getting that wrong
 * is a 2.4x difference in what every referrer is paid.
 *
 *   npx ts-node src/scripts/check-referral-commission.ts
 */
import mongoose, { Types } from 'mongoose';
import CampaignModel, { CampaignStatus } from '../database/models/campaign.model';
import DiffuseurProfileModel, { ReferralTier } from '../database/models/diffuseur-profile.model';
import { sbcMargin, payReferralCommission } from '../services/referral-commission.service';
import * as userClient from '../services/clients/user.service.client';
import config from '../config';

const DB = process.env.REFERRAL_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_advertising_referral_check';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

const credits: Array<{ userId: string; amount: number }> = [];
let referrerId: string | null = null;
let creditShouldFail = false;

(userClient as any).getDirectReferrer = async () => referrerId;
(userClient as any).creditAdvertisingEarnings = async (args: any) => {
    if (creditShouldFail) throw new Error('simulated failure');
    credits.push(args);
    return { newAdvertisingBalance: args.amount, transactionId: 'tx' };
};

let slug = 0;
const makeCampaign = (amount = 6000) => CampaignModel.create({
    advertiserUserId: new Types.ObjectId(),
    title: 'Test',
    mediaFileId: 'f',
    mediaType: 'image',
    landingPageSlug: `s${slug++}`,
    amountPaid: amount,
    pricePerUniqueView: config.pricing.advertiserPricePerUniqueView,
    targetUniqueViews: Math.floor(amount / config.pricing.advertiserPricePerUniqueView),
    status: CampaignStatus.ACTIVE,
    activatedAt: new Date(),
});

const makeReferrer = async (tier: ReferralTier, completed = 100) => {
    const profile = await DiffuseurProfileModel.create({
        userId: new Types.ObjectId(),
        declaredAverageViews: 100,
        campaignsCompleted: completed,
        referralTier: tier,
    });
    referrerId = String(profile.userId);
    return profile;
};

const main = async () => {
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();

    // --- Rufus's numbers: 6 000 F campaign, SBC margin 2 500 F, 20% = 500 F ---
    const c1 = await makeCampaign(6000);
    const margin = sbcMargin(c1);
    check('margin on a 6 000 F campaign is 2 500 F', margin === 2500, `got ${margin}`);

    await makeReferrer(ReferralTier.UNLOCKED);
    const r1 = await payReferralCommission(c1._id);
    check('pays 500 F, matching Rufus\'s 100 campaigns = 50 000 F', r1.amount === 500, `got ${r1.amount}`);
    check('commission was paid', r1.paid === true);

    // --- Never twice ---
    const r2 = await payReferralCommission(c1._id);
    check('refuses to pay the same campaign twice', r2.paid === false, r2.reason);
    check('exactly one credit reached user-service', credits.length === 1, `${credits.length}`);

    // --- Tier gating ---
    const c3 = await makeCampaign();
    await makeReferrer(ReferralTier.LOCKED, 40);
    const r3 = await payReferralCommission(c3._id);
    check('refuses a referrer below the campaign threshold', r3.paid === false, r3.reason);

    const c4 = await makeCampaign();
    await makeReferrer(ReferralTier.SUSPENDED);
    const r4 = await payReferralCommission(c4._id);
    check('refuses a suspended referrer', r4.paid === false, r4.reason);

    // --- No referrer at all ---
    const c5 = await makeCampaign();
    referrerId = null;
    const r5 = await payReferralCommission(c5._id);
    check('handles an advertiser with no referrer', r5.paid === false, r5.reason);

    // --- Referrer exists but never became a diffuseur ---
    const c6 = await makeCampaign();
    referrerId = String(new Types.ObjectId());
    const r6 = await payReferralCommission(c6._id);
    check('refuses a referrer who is not a diffuseur', r6.paid === false, r6.reason);

    // --- Failure must be retryable ---
    const c7 = await makeCampaign();
    await makeReferrer(ReferralTier.UNLOCKED);
    creditShouldFail = true;
    const r7 = await payReferralCommission(c7._id);
    check('reports failure when the credit errors', r7.paid === false, r7.reason);

    const after = await CampaignModel.findById(c7._id).lean();
    check('releases the claim so the sweep retries', !after?.referralCommissionPaidAt);

    creditShouldFail = false;
    const r7b = await payReferralCommission(c7._id);
    check('succeeds on retry', r7b.paid === true, `${r7b.amount} F`);

    // --- Scaling: a 12 000 F campaign is exactly double ---
    const c8 = await makeCampaign(12000);
    await makeReferrer(ReferralTier.UNLOCKED);
    const r8 = await payReferralCommission(c8._id);
    check('scales linearly with campaign size', r8.amount === 1000, `got ${r8.amount}`);

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
