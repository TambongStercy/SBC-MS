/**
 * Asserts the test campaign.
 *
 * It is the one campaign that reaches ACTIVE without payment and without
 * moderation, and the one that must never pay a diffuseur. Both of those are
 * exceptions carved into rules that otherwise protect real money, so they are
 * pinned here.
 *
 * Needs a Mongo instance. Uses its own database and drops it afterwards.
 *
 *   npx ts-node src/scripts/check-test-campaign.ts
 */
import mongoose, { Types } from 'mongoose';
import CampaignModel, { CampaignStatus } from '../database/models/campaign.model';
import CampaignParticipationModel, {
    ParticipationStatus,
    DayStatus,
} from '../database/models/campaign-participation.model';
import DiffuseurProfileModel from '../database/models/diffuseur-profile.model';
import {
    getTestCampaign,
    upsertTestCampaign,
    retireTestCampaign,
    offerTestCampaignToNewDiffuseurs,
    mayReceivePaidCampaigns,
} from '../services/test-campaign.service';
import * as notifier from '../services/clients/notification.service.client';
import { creditParticipation } from '../services/payout.service';
import * as userClient from '../services/clients/user.service.client';

const DB = process.env.TEST_CAMPAIGN_DB || 'mongodb://127.0.0.1:27017/sbc_advertising_testcampaign_check';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

(notifier as any).notifyCampaignOffer = async () => true;
(notifier as any).notifyCampaignCompleted = async () => true;

const credits: Array<{ userId: string; amount: number }> = [];
(userClient as any).creditAdvertisingEarnings = async (args: any) => {
    credits.push(args);
    return { newAdvertisingBalance: args.amount, transactionId: 'tx' };
};

const admin = new Types.ObjectId();
const INPUT = {
    title: 'Campagne test SBC',
    mediaFileId: 'flyer.jpg',
    mediaType: 'image' as const,
    suggestedCaption: 'Rejoignez SBC',
    landingVideoFileId: 'intro.mp4',
};

const newDiffuseur = async (over: Record<string, unknown> = {}) =>
    DiffuseurProfileModel.create({
        userId: new Types.ObjectId(),
        declaredAverageViews: 100,
        whatsappLid: `lid${Math.random().toString(36).slice(2)}`,
        ...over,
    });

const main = async () => {
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();
    await CampaignModel.syncIndexes();

    // --- Creation ---
    const created = await upsertTestCampaign(admin, INPUT);
    check('goes live without payment or moderation', created.status === CampaignStatus.ACTIVE, created.status);
    check('is billed to nobody', created.amountPaid === 0 && created.pricePerUniqueView === 0);
    check('carries the landing video', created.landingVideoFileId === 'intro.mp4');
    check('is owned by the admin who made it', String(created.advertiserUserId) === String(admin));

    // --- Only one at a time ---
    const edited = await upsertTestCampaign(admin, { ...INPUT, title: 'Nouveau titre' });
    check('a second save edits rather than duplicates', String(edited._id) === String(created._id));
    check('the edit took', edited.title === 'Nouveau titre');
    check('exactly one live test campaign', await CampaignModel.countDocuments({
        isTestCampaign: true, status: CampaignStatus.ACTIVE,
    }) === 1);

    // The unique index is the real guard; upsert alone would not stop a race.
    let indexHeld = true;
    try {
        await CampaignModel.create({
            advertiserUserId: admin, title: 'Doublon', mediaFileId: 'x', mediaType: 'image',
            landingPageSlug: `dup${Date.now()}`, amountPaid: 0, pricePerUniqueView: 0,
            targetUniqueViews: 1, isTestCampaign: true, status: CampaignStatus.ACTIVE,
        });
        indexHeld = false;
    } catch { /* expected */ }
    check('the database refuses a second live one', indexHeld, 'partial unique index');

    // --- Offering ---
    const rookie = await newDiffuseur();
    const veteran = await newDiffuseur({ hasCompletedTestCampaign: true, campaignsCompleted: 4 });
    const unlinked = await newDiffuseur({ whatsappLid: undefined });

    const offered = await offerTestCampaignToNewDiffuseurs();
    check('offered to a diffuseur who has never been measured', offered === 2, `offered ${offered}`);
    check('not offered to someone already measured', await CampaignParticipationModel.countDocuments({
        diffuseurUserId: veteran.userId,
    }) === 0);
    check(
        'offered even before WhatsApp is linked',
        await CampaignParticipationModel.countDocuments({ diffuseurUserId: unlinked.userId }) === 1,
        'linking happens during this campaign\'s verification — requiring it first is a deadlock',
    );

    check('running twice does not double-offer', await offerTestCampaignToNewDiffuseurs() === 0);

    // --- It must never pay ---
    const participation = await CampaignParticipationModel.findOne({ diffuseurUserId: rookie.userId });
    check('every day is rated at zero', participation!.days.every(d => d.ratePerView === 0));

    participation!.status = ParticipationStatus.COMPLETED;
    participation!.totalViews = 900;
    participation!.uniqueViews = 300;
    participation!.days.forEach(d => { d.status = DayStatus.VERIFIED; d.viewCount = 300; });
    await participation!.save();

    const before = credits.length;
    const result = await creditParticipation(participation!._id);
    check('completing it credits nothing', result.credited === false && result.amount === 0, result.reason);
    check('no money left the building', credits.length === before);
    check('but it is marked so the sweep stops revisiting it',
        Boolean((await CampaignParticipationModel.findById(participation!._id))?.creditedAt));

    // --- Gating paid work ---
    check('unmeasured diffuseur is held back while one exists', mayReceivePaidCampaigns(false, true) === false);
    check('measured diffuseur may take paid work', mayReceivePaidCampaigns(true, true) === true);
    check(
        'with none configured, nobody is held back',
        mayReceivePaidCampaigns(false, false) === true,
        'otherwise enrolling leads nowhere at all',
    );

    // --- It must never be completed by the view sweep ---
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { sweepCompletedCampaigns } = require('../services/scheduler.service');

    const live = await getTestCampaign();
    await CampaignModel.updateOne(
        { _id: live!._id },
        { $set: { uniqueViewsDelivered: 999 } },
    );
    await sweepCompletedCampaigns();

    check(
        'views never complete the test campaign',
        (await getTestCampaign()) !== null,
        'completing it silently switches off measurement for every new diffuseur',
    );

    // --- Retiring ---
    check('retires', await retireTestCampaign() === true);
    check('and is then gone', await getTestCampaign() === null);
    check('retiring again is harmless', await retireTestCampaign() === false);
    check(
        'a retired one can be replaced',
        Boolean(await upsertTestCampaign(admin, INPUT)),
        'the index only constrains live ones',
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
