/**
 * Asserts that an under-filled campaign keeps looking for diffuseurs.
 *
 * Allocation used to run only at activation and after a forfeit. A campaign that
 * could not be filled on day one therefore stayed unfilled forever, and a
 * diffuseur who became eligible an hour later was never pulled in — the
 * advertiser paid for views nobody was left to deliver.
 *
 * Needs a Mongo instance. Uses its own database and drops it afterwards.
 *
 *   npx ts-node src/scripts/check-topup.ts
 */
import mongoose, { Types } from 'mongoose';
import CampaignModel, { CampaignStatus } from '../database/models/campaign.model';
import CampaignParticipationModel from '../database/models/campaign-participation.model';
import DiffuseurProfileModel from '../database/models/diffuseur-profile.model';
import * as userClient from '../services/clients/user.service.client';
import * as notifier from '../services/clients/notification.service.client';

const DB = process.env.TOPUP_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_advertising_topup_check';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

(notifier as any).notifyCampaignOffer = async () => true;

/** Targeting reads the user, so every diffuseur here is a matching Cameroonian. */
(userClient as any).getUserProfiles = async (ids: string[]) =>
    ids.map(id => ({
        _id: id, name: 'Test', country: 'CM', city: 'Douala', region: 'Littoral',
        sex: 'male', birthDate: '1995-01-01', language: ['fr'], interests: [], profession: 'x',
    }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { sweepUnderfilledCampaigns } = require('../services/scheduler.service');

let n = 0;
const diffuseur = async (over: Record<string, unknown> = {}) =>
    DiffuseurProfileModel.create({
        userId: new Types.ObjectId(),
        declaredAverageViews: 100,
        measuredAverageViews: 100,
        hasCompletedTestCampaign: true,
        whatsappLid: `lid${n++}`,
        ...over,
    });

const main = async () => {
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();

    const campaign = await CampaignModel.create({
        advertiserUserId: new Types.ObjectId(),
        title: 'Campagne sous-remplie',
        mediaFileId: 'f', mediaType: 'image',
        landingPageSlug: `top${Date.now()}`,
        amountPaid: 6000, pricePerUniqueView: 3,
        targetUniqueViews: 500,
        status: CampaignStatus.ACTIVE,
        activatedAt: new Date(),
    });

    // Nobody eligible yet — exactly the state a campaign launches into when the
    // pool is thin.
    check('no offers while nobody is eligible', await sweepUnderfilledCampaigns() === 0);

    // A diffuseur finishes their test campaign and becomes eligible.
    const late = await diffuseur();
    const topped = await sweepUnderfilledCampaigns();
    check('a newly eligible diffuseur is picked up', topped === 1, `topped ${topped} campaign(s)`);
    check(
        'and actually receives the offer',
        await CampaignParticipationModel.countDocuments({
            campaignId: campaign._id, diffuseurUserId: late.userId,
        }) === 1,
    );

    const afterFirst = await CampaignParticipationModel.countDocuments({ campaignId: campaign._id });
    await sweepUnderfilledCampaigns();
    check(
        'running again does not re-offer the same campaign',
        await CampaignParticipationModel.countDocuments({ campaignId: campaign._id }) === afterFirst,
        'allocation skips anyone already offered',
    );

    // A campaign that has met its target must be left alone.
    //
    // "At target" means views committed by participations, not the campaign's own
    // uniqueViewsDelivered counter — remainingViewsToCover sums the participations,
    // so that is what has to be satisfied here.
    await CampaignParticipationModel.updateOne(
        { campaignId: campaign._id, diffuseurUserId: late.userId },
        { $set: { status: 'completed', uniqueViews: 500 } },
    );
    await diffuseur();
    const before = await CampaignParticipationModel.countDocuments({ campaignId: campaign._id });
    await sweepUnderfilledCampaigns();
    check(
        'a campaign at target stops recruiting',
        await CampaignParticipationModel.countDocuments({ campaignId: campaign._id }) === before,
        'else the advertiser keeps paying past what they bought',
    );

    // The test campaign has its own offering path and must not be topped up here.
    await CampaignModel.create({
        advertiserUserId: new Types.ObjectId(),
        title: 'Campagne test', mediaFileId: 'f', mediaType: 'image',
        landingPageSlug: `tst${Date.now()}`,
        amountPaid: 0, pricePerUniqueView: 0, targetUniqueViews: 1,
        isTestCampaign: true, status: CampaignStatus.ACTIVE,
    });
    const beforeTest = await CampaignParticipationModel.countDocuments({});
    await sweepUnderfilledCampaigns();
    check(
        'the test campaign is left to its own path',
        await CampaignParticipationModel.countDocuments({}) === beforeTest,
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
