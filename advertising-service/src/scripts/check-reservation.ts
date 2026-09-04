/**
 * Asserts that a fully staffed campaign stops being handed out.
 *
 * Allocation counted only VERIFIED views, so for the first 24h of a campaign —
 * before anyone has had time to post, let alone be verified — the target read as
 * untouched on every scheduler tick and the campaign was staffed again from
 * scratch each time. An annonceur who bought 2000 unique views was billed 2517 on
 * day 1 with more diffuseurs still posting (Rufus, 2026-09-04).
 *
 * Offers now hold the reach they forecast until they are accepted, declined or go
 * stale. The three things that has to keep working are covered here: the campaign
 * stops recruiting, an offer nobody answers eventually frees its slot, and holding
 * an offer still lets you accept it.
 *
 * Needs a Mongo instance. Uses its own database and drops it afterwards.
 *
 *   npx ts-node src/scripts/check-reservation.ts
 */
import mongoose, { Types } from 'mongoose';
import CampaignModel, { CampaignStatus } from '../database/models/campaign.model';
import CampaignParticipationModel, {
    ParticipationStatus,
} from '../database/models/campaign-participation.model';
import DiffuseurProfileModel from '../database/models/diffuseur-profile.model';
import config from '../config';
import * as userClient from '../services/clients/user.service.client';
import * as notifier from '../services/clients/notification.service.client';

const DB = process.env.RESERVATION_TEST_DB
    || 'mongodb://127.0.0.1:27017/sbc_advertising_reservation_check';

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

// Required after the client stubs: these modules capture the exports at import.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { acceptOffer } = require('../services/allocation.service');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { sweepUnderfilledCampaigns, sweepUnansweredOffers } = require('../services/scheduler.service');

let n = 0;
const diffuseur = (views: number) =>
    DiffuseurProfileModel.create({
        userId: new Types.ObjectId(),
        declaredAverageViews: views,
        measuredAverageViews: views,
        hasCompletedTestCampaign: true,
        whatsappLid: `lid${n++}`,
    });

const offers = (campaignId: Types.ObjectId) =>
    CampaignParticipationModel.countDocuments({ campaignId });

const main = async () => {
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();

    const campaign = await CampaignModel.create({
        advertiserUserId: new Types.ObjectId(),
        title: 'Campagne complète',
        mediaFileId: 'f', mediaType: 'image',
        landingPageSlug: `res${Date.now()}`,
        amountPaid: 6000, pricePerUniqueView: 3,
        targetUniqueViews: 1000,
        status: CampaignStatus.ACTIVE,
        activatedAt: new Date(),
    });

    // Four diffuseurs of 500 each: two cover the target, two are spare.
    for (let i = 0; i < 4; i++) await diffuseur(500);

    await sweepUnderfilledCampaigns();
    const staffed = await offers(campaign._id);
    check('the target is staffed in one pass', staffed === 2, `${staffed} offer(s) for 1000 views`);

    // The regression itself: nobody has posted, so nothing is verified yet.
    await sweepUnderfilledCampaigns();
    await sweepUnderfilledCampaigns();
    check(
        'later ticks do not staff it all over again',
        await offers(campaign._id) === staffed,
        'offers hold their forecast until answered',
    );

    // Holding an offer must not stop you accepting it, even though the outstanding
    // offers between them reserve the entire target.
    const mine = await CampaignParticipationModel.findOne({ campaignId: campaign._id });
    await acceptOffer(mine!._id, mine!.diffuseurUserId);
    check(
        'a diffuseur can still accept the offer they were sent',
        (await CampaignParticipationModel.findById(mine!._id))!.status
        === ParticipationStatus.IN_PROGRESS,
    );

    await sweepUnderfilledCampaigns();
    check(
        'accepting does not free capacity either',
        await offers(campaign._id) === staffed,
        'the accepted diffuseur still owes their views',
    );

    // The other offer is never answered. Its slot has to come back, or the
    // advertiser is short exactly the views that diffuseur was never going to post.
    const stale = new Date(Date.now() - (config.campaign.offerTtlHours + 1) * 60 * 60 * 1000);
    await CampaignParticipationModel.updateOne(
        { campaignId: campaign._id, status: ParticipationStatus.OFFERED },
        { $set: { offeredAt: stale } },
    );
    const expired = await sweepUnansweredOffers();
    check('an unanswered offer expires', expired === 1, `${expired} expired`);
    check(
        'and its share of the target is offered to someone else',
        await offers(campaign._id) === staffed + 1,
        'reallocated in the same tick',
    );

    // Once the accepted diffuseurs cover the target on their own, the offers still
    // waiting are surplus: accepting them would bill the advertiser past what they
    // bought.
    await CampaignParticipationModel.updateOne(
        { _id: mine!._id },
        { $set: { status: ParticipationStatus.COMPLETED, uniqueViews: 1000 } },
    );
    await sweepUnderfilledCampaigns();
    check(
        'surplus offers are withdrawn once the target is genuinely covered',
        await CampaignParticipationModel.countDocuments({
            campaignId: campaign._id, status: ParticipationStatus.OFFERED,
        }) === 0,
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
