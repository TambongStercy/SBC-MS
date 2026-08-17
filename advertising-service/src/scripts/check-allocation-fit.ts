/**
 * Asserts how closely allocation lands on the target it was asked for.
 *
 * An annonceur buys a number of unique views. Overshooting means delivering more
 * than they paid for — generous on the surface, but the extra comes out of SBC's
 * margin, and it also spends diffuseurs who a later campaign genuinely needs.
 *
 * Needs a Mongo instance. Uses its own database and drops it afterwards.
 *
 *   npx ts-node src/scripts/check-allocation-fit.ts
 */
import mongoose, { Types } from 'mongoose';
import CampaignModel, { CampaignStatus } from '../database/models/campaign.model';
import CampaignParticipationModel from '../database/models/campaign-participation.model';
import DiffuseurProfileModel from '../database/models/diffuseur-profile.model';
import * as userClient from '../services/clients/user.service.client';
import * as notifier from '../services/clients/notification.service.client';

const DB = process.env.ALLOC_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_advertising_allocfit_check';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

(notifier as any).notifyCampaignOffer = async () => true;
(userClient as any).getUserProfiles = async (ids: string[]) =>
    ids.map(id => ({
        _id: id, name: 'D', country: 'CM', city: 'Douala', region: 'Littoral',
        sex: 'male', birthDate: '1995-01-01', language: ['fr'], interests: [], profession: 'x',
    }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { allocateCampaign } = require('../services/allocation.service');

let seq = 0;

/** A pool of diffuseurs with the given measured averages. */
const seedPool = async (reaches: number[]) => {
    await DiffuseurProfileModel.deleteMany({});
    for (const reach of reaches) {
        await DiffuseurProfileModel.create({
            userId: new Types.ObjectId(),
            declaredAverageViews: reach,
            measuredAverageViews: reach,
            hasCompletedTestCampaign: true,
            whatsappLid: `lid${seq++}`,
            trustScore: 50,
        });
    }
};

/** Runs a real allocation and reports what it projected against the target. */
const allocate = async (target: number) => {
    await CampaignParticipationModel.deleteMany({});
    const campaign = await CampaignModel.create({
        advertiserUserId: new Types.ObjectId(),
        title: `T${seq++}`, mediaFileId: 'f', mediaType: 'image',
        landingPageSlug: `af${seq++}${Date.now()}`,
        amountPaid: target * 3, pricePerUniqueView: 3,
        targetUniqueViews: target,
        status: CampaignStatus.ACTIVE,
    });
    const result = await allocateCampaign(campaign._id);
    return {
        offers: result.offersCreated as number,
        projected: result.projectedViews as number,
        overshoot: result.projectedViews > target
            ? (result.projectedViews - target) / target
            : 0,
    };
};

const main = async () => {
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();

    // Sterling's case: 2000 wanted, two 1000s and a crowd of 100s available.
    await seedPool([1000, 1000, ...Array(15).fill(100)]);
    let r = await allocate(2000);
    check(
        '2000 views is covered by the two big diffuseurs exactly',
        r.projected === 2000 && r.offers === 2,
        `${r.offers} offers, ${r.projected} projected`,
    );

    // The tail must be fitted rather than taking another whole big diffuseur.
    await seedPool([1000, 1000, 1000, ...Array(15).fill(100)]);
    r = await allocate(2500);
    check(
        'the last 500 is filled with small diffuseurs, not a third 1000',
        r.projected === 2500,
        `${r.offers} offers, ${r.projected} projected — a third 1000 would have been 3000`,
    );

    // Awkward remainder.
    await seedPool([900, 900, 900, ...Array(10).fill(100)]);
    r = await allocate(2000);
    check('an awkward remainder still lands on target', r.projected === 2000,
        `${r.offers} offers, ${r.projected} projected`);

    // Overshoot stays small across a range of targets.
    await seedPool([1000, 800, 600, 500, 400, 300, ...Array(20).fill(100)]);
    const overshoots: number[] = [];
    for (const target of [1500, 2000, 2400, 3000]) {
        overshoots.push((await allocate(target)).overshoot);
    }
    const worst = Math.max(...overshoots);
    check('overshoot stays under 5% across targets', worst < 0.05,
        `worst ${(worst * 100).toFixed(1)}%`);

    // A campaign must still fill when only an oversized diffuseur is available —
    // delivering more beats delivering nothing.
    await seedPool([5000]);
    r = await allocate(2000);
    check('a campaign still fills when only a large diffuseur exists', r.offers === 1,
        `${r.projected} projected for a 2000 target`);

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
