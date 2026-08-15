/**
 * Asserts the admin dashboard aggregates.
 *
 * Aggregation pipelines fail quietly: a wrong $match still returns a number, and
 * a number on a dashboard is believed. These checks pin the ones Rufus reads —
 * revenue, headcounts and what has been paid out.
 *
 * Needs a Mongo instance. Uses its own database and drops it afterwards.
 *
 *   npx ts-node src/scripts/check-analytics.ts
 */
import mongoose, { Types } from 'mongoose';
import CampaignModel, { CampaignStatus } from '../database/models/campaign.model';
import CampaignParticipationModel, { ParticipationStatus } from '../database/models/campaign-participation.model';
import DiffuseurProfileModel from '../database/models/diffuseur-profile.model';
import { overview, monthlySeries, inFlight } from '../services/analytics.service';

const DB = process.env.ANALYTICS_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_advertising_analytics_check';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

let n = 0;
const campaign = (advertiserUserId: Types.ObjectId, status: CampaignStatus, over: Record<string, unknown> = {}) =>
    CampaignModel.create({
        advertiserUserId,
        title: `C${n}`,
        mediaFileId: 'f',
        mediaType: 'image',
        landingPageSlug: `an${n++}${Date.now()}`,
        amountPaid: 6000,
        pricePerUniqueView: 3,
        targetUniqueViews: 2000,
        uniqueViewsDelivered: 100,
        repeatViewsDelivered: 50,
        clicksTotal: 10,
        status,
        ...over,
    });

const main = async () => {
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();

    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15);

    const annonceurA = new Types.ObjectId();
    const annonceurB = new Types.ObjectId();

    await campaign(annonceurA, CampaignStatus.ACTIVE, { activatedAt: now });
    await campaign(annonceurA, CampaignStatus.COMPLETED, { activatedAt: lastMonth });
    await campaign(annonceurB, CampaignStatus.BANKED, { activatedAt: now });
    // Money has not landed on these two. They must not touch revenue or headcount.
    await campaign(new Types.ObjectId(), CampaignStatus.DRAFT);
    await campaign(new Types.ObjectId(), CampaignStatus.PENDING_REVIEW);

    await DiffuseurProfileModel.create({ userId: new Types.ObjectId(), declaredAverageViews: 100 });
    await DiffuseurProfileModel.create({ userId: new Types.ObjectId(), declaredAverageViews: 200 });
    await DiffuseurProfileModel.create({ userId: new Types.ObjectId(), declaredAverageViews: 50, isActive: false });

    const campaignId = new Types.ObjectId();
    await CampaignParticipationModel.create({
        campaignId, diffuseurUserId: new Types.ObjectId(), diffuseurProfileId: new Types.ObjectId(),
        trackingCode: `t${n++}`,
        status: ParticipationStatus.COMPLETED, totalEarned: 175, creditedAt: now,
    });
    await CampaignParticipationModel.create({
        campaignId, diffuseurUserId: new Types.ObjectId(), diffuseurProfileId: new Types.ObjectId(),
        trackingCode: `t${n++}`,
        status: ParticipationStatus.IN_PROGRESS, totalEarned: 60,
    });
    await CampaignParticipationModel.create({
        campaignId, diffuseurUserId: new Types.ObjectId(), diffuseurProfileId: new Types.ObjectId(),
        trackingCode: `t${n++}`,
        status: ParticipationStatus.OFFERED,
    });

    const o = await overview();

    check('revenue counts only paid campaigns', o.money.revenue === 18000, `got ${o.money.revenue}`);
    check('revenue this month excludes last month', o.money.revenueThisMonth === 12000, `got ${o.money.revenueThisMonth}`);
    check('annonceur count ignores unpaid drafts', o.annonceurs.total === 2, `got ${o.annonceurs.total}`);
    check(
        'a returning annonceur is not counted as new',
        o.annonceurs.newThisMonth === 1,
        `A first activated last month, B this month; got ${o.annonceurs.newThisMonth}`,
    );
    check('diffuseur total counts active profiles only', o.diffuseurs.total === 2, `got ${o.diffuseurs.total}`);
    check('new diffuseurs this month', o.diffuseurs.newThisMonth === 3, `got ${o.diffuseurs.newThisMonth}`);
    check('campaigns launched this month', o.campaigns.launchedThisMonth === 2, `got ${o.campaigns.launchedThisMonth}`);
    check('the review queue size is exposed', o.campaigns.pendingReview === 1, `got ${o.campaigns.pendingReview}`);

    check('views sum across paid campaigns', o.delivery.totalViews === 450, `got ${o.delivery.totalViews}`);
    check('clicks sum across paid campaigns', o.delivery.clicks === 30, `got ${o.delivery.clicks}`);

    check(
        'payouts count only credited participations',
        o.money.paidToDiffuseurs === 175,
        `an in-progress 60 must not appear; got ${o.money.paidToDiffuseurs}`,
    );
    check('margin is revenue minus payouts', o.money.grossMargin === 18000 - 175, `got ${o.money.grossMargin}`);

    const pipe = await inFlight();
    check('in-flight splits offered from in-progress', pipe.offered === 1 && pipe.inProgress === 1,
        `offered ${pipe.offered}, in progress ${pipe.inProgress}`);

    const series = await monthlySeries(3);
    check('series returns one bucket per month asked', series.length === 3, `got ${series.length}`);
    check('quiet months appear as zeroes, not gaps', series.every(s => typeof s.revenue === 'number'));

    const thisKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const current = series.find(s => s.month === thisKey);
    check('the current month lands in its own bucket', current?.revenue === 12000, `got ${current?.revenue}`);
    check('payouts bucket by credit date', current?.paidToDiffuseurs === 175, `got ${current?.paidToDiffuseurs}`);

    // --- The test campaign is SBC's instrument, not marketplace activity ---
    // Counted in, it inflated campaign totals, delivered views, the status
    // breakdown, in-flight, and even the annonceur roster with SBC's own admin.
    // It is managed on its own admin page and belongs in none of these numbers.
    const before = await overview();
    const beforeFlight = await inFlight();

    const testCampaign = await CampaignModel.create({
        advertiserUserId: new Types.ObjectId(),
        title: 'Campagne test', mediaFileId: 'f', mediaType: 'image',
        landingPageSlug: `tc${Date.now()}`,
        amountPaid: 0, pricePerUniqueView: 0, targetUniqueViews: 1,
        isTestCampaign: true,
        status: CampaignStatus.ACTIVE,
        activatedAt: now,
        uniqueViewsDelivered: 500, repeatViewsDelivered: 300, clicksTotal: 40,
    });
    await CampaignParticipationModel.create({
        campaignId: testCampaign._id,
        diffuseurUserId: new Types.ObjectId(),
        diffuseurProfileId: new Types.ObjectId(),
        trackingCode: `tcp${Date.now()}`,
        status: ParticipationStatus.IN_PROGRESS,
        creditedAt: now,
        totalEarned: 0,
    });

    const after = await overview();
    const afterFlight = await inFlight();

    check('the test campaign is not counted as a campaign',
        after.campaigns.total === before.campaigns.total,
        `${before.campaigns.total} → ${after.campaigns.total}`);
    check('its views stay out of delivered views',
        after.delivery.uniqueViews === before.delivery.uniqueViews
        && after.delivery.repeatViews === before.delivery.repeatViews
        && after.delivery.clicks === before.delivery.clicks,
        `${before.delivery.uniqueViews}/${before.delivery.repeatViews} → ${after.delivery.uniqueViews}/${after.delivery.repeatViews}`);
    check('its admin owner is not counted as an annonceur',
        after.annonceurs.total === before.annonceurs.total,
        `${before.annonceurs.total} → ${after.annonceurs.total}`);
    check('it is absent from the status breakdown',
        (after.campaigns.byStatus?.active ?? 0) === (before.campaigns.byStatus?.active ?? 0),
        'byStatus counted every campaign, test ones included');
    check('its run is absent from in-flight',
        afterFlight.inProgress === beforeFlight.inProgress,
        `${beforeFlight.inProgress} → ${afterFlight.inProgress}`);

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
