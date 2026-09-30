/**
 * Asserts a new diffuseur gets offered work before a veteran does.
 *
 * Allocation sorted purely by reach, so the same big accounts won every campaign.
 * Measured on prod 2026-09-17: the top diffuseurs had 11 and 12 paid offers while
 * 32 eligible diffuseurs had never been offered a single one. Christian finished
 * his test campaign and waited a week for nothing while five campaigns went out
 * (Rufus, 2026-09-17: « les nouveaux diffuseurs soient priorisés »).
 *
 * The risk in fixing it is under-filling: if newcomers are preferred so hard that
 * a campaign stops short of what the annonceur bought, the cure is worse than the
 * disease. So this checks both directions — newcomers go first, AND veterans still
 * cover whatever newcomers cannot.
 *
 * Needs a Mongo instance. Uses its own database and drops it afterwards.
 *
 *   npx ts-node src/scripts/check-newcomer-priority.ts
 */
import mongoose, { Types } from 'mongoose';
import CampaignModel, { CampaignStatus } from '../database/models/campaign.model';
import CampaignParticipationModel, { ParticipationStatus } from '../database/models/campaign-participation.model';
import DiffuseurProfileModel from '../database/models/diffuseur-profile.model';
import * as userClient from '../services/clients/user.service.client';
import * as notifier from '../services/clients/notification.service.client';

const DB = process.env.NEWCOMER_TEST_DB
    || 'mongodb://127.0.0.1:27017/sbc_advertising_newcomer_check';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

(notifier as any).notifyCampaignOffer = async () => true;
(userClient as any).getUserProfiles = async (ids: string[]) =>
    ids.map(id => ({
        _id: id, name: 'Test', country: 'CM', city: 'Douala', region: 'Littoral',
        sex: 'male', birthDate: '1995-01-01', language: ['fr'], interests: [], profession: 'x',
    }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { allocateCampaign } = require('../services/allocation.service');

let n = 0;
const diffuseur = (views: number) =>
    DiffuseurProfileModel.create({
        userId: new Types.ObjectId(),
        declaredAverageViews: views,
        measuredAverageViews: views,
        hasCompletedTestCampaign: true,
        whatsappLid: `lid${n++}`,
    });

const paidCampaign = (target: number) =>
    CampaignModel.create({
        advertiserUserId: new Types.ObjectId(),
        title: `Campagne ${n++}`,
        mediaFileId: 'f', mediaType: 'image',
        landingPageSlug: `nc${Date.now()}${n}`,
        amountPaid: 6000, pricePerUniqueView: 3,
        targetUniqueViews: target,
        status: CampaignStatus.ACTIVE,
        activatedAt: new Date(),
    });

/** Marks a diffuseur as having had real work before, the way prod history would. */
const givePastPaidCampaign = async (userId: Types.ObjectId, profileId: Types.ObjectId) => {
    const past = await paidCampaign(500);
    await CampaignParticipationModel.create({
        campaignId: past._id,
        diffuseurUserId: userId,
        diffuseurProfileId: profileId,
        status: ParticipationStatus.COMPLETED,
        trackingCode: `past${n++}`,
        expectedViews: 100,
        days: [],
    });
};

const offeredUserIds = async (campaignId: Types.ObjectId) =>
    (await CampaignParticipationModel.find({ campaignId }).select('diffuseurUserId').lean())
        .map(p => String(p.diffuseurUserId));

const main = async () => {
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();

    // A veteran with the BIGGEST audience, and a smaller newcomer. Sorting by
    // reach alone would always pick the veteran.
    const veteran = await diffuseur(500);
    await givePastPaidCampaign(veteran.userId, veteran._id);
    const newcomer = await diffuseur(100);

    const c1 = await paidCampaign(100);
    await allocateCampaign(c1._id);
    const got1 = await offeredUserIds(c1._id);
    check(
        'the newcomer is offered the campaign, not the bigger veteran',
        got1.includes(String(newcomer.userId)) && !got1.includes(String(veteran.userId)),
        `offered ${got1.length}`,
    );

    // Newcomers cannot cover it alone — the veteran must still be used, or the
    // annonceur is short of what they paid for.
    //
    // A fresh newcomer, because the one above is no longer new: it has been
    // offered a campaign, which is exactly what stops it holding the queue.
    const newcomer2 = await diffuseur(100);
    const c2 = await paidCampaign(600);
    await allocateCampaign(c2._id);
    const got2 = await offeredUserIds(c2._id);
    check(
        'veterans still fill what newcomers cannot cover',
        got2.includes(String(newcomer2.userId)) && got2.includes(String(veteran.userId)),
        'under-filling an annonceur would be worse than the starvation this fixes',
    );

    // Once a newcomer has been offered something, they are no longer a newcomer:
    // being offered and ignoring it still counts as having had a turn.
    const fresher = await diffuseur(100);
    const c3 = await paidCampaign(100);
    await allocateCampaign(c3._id);
    const got3 = await offeredUserIds(c3._id);
    check(
        'the turn passes to the next never-offered diffuseur',
        got3.includes(String(fresher.userId)) && !got3.includes(String(newcomer.userId)),
        'otherwise the same "newcomer" would hold the queue forever',
    );

    // The test campaign must not count as having had work, or everybody eligible
    // looks experienced and nobody is ever prioritised.
    const test = await CampaignModel.create({
        advertiserUserId: new Types.ObjectId(),
        title: 'Campagne test', mediaFileId: 'f', mediaType: 'image',
        landingPageSlug: `tst${Date.now()}`,
        amountPaid: 0, pricePerUniqueView: 0, targetUniqueViews: 1,
        isTestCampaign: true, status: CampaignStatus.ACTIVE,
    });
    const virgin = await diffuseur(100);
    await CampaignParticipationModel.create({
        campaignId: test._id,
        diffuseurUserId: virgin.userId,
        diffuseurProfileId: virgin._id,
        status: ParticipationStatus.COMPLETED,
        trackingCode: `t${n++}`,
        expectedViews: 0,
        days: [],
    });

    const c4 = await paidCampaign(100);
    await allocateCampaign(c4._id);
    const got4 = await offeredUserIds(c4._id);
    check(
        'completing the test campaign does not make someone a veteran',
        got4.includes(String(virgin.userId)),
        'every eligible diffuseur has done it, so counting it would prioritise nobody',
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
