/**
 * Campagnes de relance sized to the parrain's credits.
 *
 * Sterling, 2026-10-01: relancing older filleuls "should be based on their
 * budget, not forgetting the automatic relance is also there". So a campaign
 * can be capped, newest filleuls first, and the cap it suggests keeps a month
 * of relance des nouveaux in reserve.
 *
 * Also covers a re-enrollment bug found on the way: the "already in this
 * campaign?" check only looked at active targets, so a filleul who had finished
 * their 7 days was put back at day 1 on the next enrollment run.
 *
 * Needs MongoDB at TEST_MONGODB_URI (default mongodb://127.0.0.1:27017).
 */
jest.mock('node-cron', () => ({ schedule: jest.fn() }));
const getReferralsForCampaign = jest.fn();
jest.mock('../services/clients/user.service.client', () => ({
    userServiceClient: { getReferralsForCampaign: (...a: unknown[]) => getReferralsForCampaign(...a) },
}));

import mongoose from 'mongoose';
import RelanceTargetModel, { TargetStatus, ExitReason } from '../database/models/relance-target.model';
import RelanceConfigModel from '../database/models/relance-config.model';
import CampaignModel, { CampaignStatus, CampaignType } from '../database/models/relance-campaign.model';
import { campaignBudget, matchCampaignReferrals, newFilleulsLast30Days, resetReferralCache } from '../services/relance-campaign-targets.service';
import { enrollFilteredTargets } from '../jobs/relance-enrollment.job';
import { relanceCampaignController } from '../api/controllers/relance-campaign.controller';

const MONGO = (process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017') + '/sbc_notifications_relance_budget_test';
const DAY = 24 * 60 * 60 * 1000;
const parrain = new mongoose.Types.ObjectId();

const referral = (daysAgo: number, over: Record<string, unknown> = {}) => ({
    _id: new mongoose.Types.ObjectId(),
    name: `F${daysAgo}`,
    createdAt: new Date(Date.now() - daysAgo * DAY).toISOString(),
    activeSubscriptionTypes: [],
    ...over,
});

const target = (over: Record<string, unknown>) => RelanceTargetModel.create({
    referralUserId: new mongoose.Types.ObjectId(),
    referrerUserId: parrain,
    campaignId: null,
    currentDay: 1,
    status: TargetStatus.ACTIVE,
    enteredLoopAt: new Date(),
    nextMessageDue: new Date(),
    language: 'fr',
    messagesDelivered: [],
    ...over,
});

const campaign = (targetFilter: Record<string, unknown>) => CampaignModel.create({
    userId: parrain, name: 'Anciens', type: CampaignType.FILTERED, status: CampaignStatus.ACTIVE, targetFilter,
});

beforeAll(async () => {
    await mongoose.connect(MONGO, { serverSelectionTimeoutMS: 3000 });
    await mongoose.connection.dropDatabase();
});
afterAll(async () => {
    await mongoose.connection.dropDatabase().catch(() => undefined);
    await mongoose.disconnect();
});
beforeEach(async () => {
    getReferralsForCampaign.mockReset();
    resetReferralCache();
    await Promise.all([RelanceTargetModel.deleteMany({}), CampaignModel.deleteMany({}), RelanceConfigModel.deleteMany({})]);
});

describe('the budget a campaign can use', () => {
    it.each([
        [3000, 0, 0, 428],     // nothing to keep back: every credit can go to the campaign
        [3000, 100, 700, 328], // 100 new filleuls a month keep 700 credits back
        [500, 100, 700, 0],    // everything is needed for the newcomers
    ])('%i credits, %i new filleuls a month → keeps %i, covers %i', (balance, perMonth, reserved, max) => {
        expect(campaignBudget(balance, perMonth)).toEqual({ reservedForNew: reserved, maxTargets: max });
    });

    it('counts only this parrain\'s relance-des-nouveaux filleuls from the last 30 days', async () => {
        await target({});
        await target({ enteredLoopAt: new Date(Date.now() - 10 * DAY) });
        await target({ enteredLoopAt: new Date(Date.now() - 40 * DAY) });             // too old
        await target({ campaignId: new mongoose.Types.ObjectId() });                    // a campaign's
        await target({ referrerUserId: new mongoose.Types.ObjectId() });                // someone else's
        expect(await newFilleulsLast30Days(parrain.toString())).toBe(2);
    });
});

describe('who a campaign reaches', () => {
    it('keeps unpaid filleuls not already in relance, newest first', async () => {
        const inRelance = referral(5);
        await target({ referralUserId: inRelance._id });
        getReferralsForCampaign.mockResolvedValue([
            referral(30), referral(2), referral(9, { activeSubscriptionTypes: ['CLASSIQUE'] }), inRelance,
        ]);
        const got = await matchCampaignReferrals(parrain.toString(), { subscriptionStatus: 'non-subscribed', excludeCurrentTargets: true });
        expect(got.map(r => r.name)).toEqual(['F2', 'F30']);
    });

    it('tells the wizard the budget alongside the count', async () => {
        await RelanceConfigModel.create({ userId: parrain, emailBalance: 1400 });
        await target({}); // one new filleul this month → 7 credits kept back
        getReferralsForCampaign.mockResolvedValue([referral(1), referral(2), referral(3)]);
        const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        await relanceCampaignController.previewFilterResults(
            { user: { userId: parrain.toString() }, body: { targetFilter: { subscriptionStatus: 'non-subscribed' } } } as any, res,
        );
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json.mock.calls[0][0].data).toMatchObject({
            totalCount: 3,
            budget: { emailBalance: 1400, reservedForNew: 7, maxTargets: 199 },
        });
    });
});

describe('enrolling a budgeted campaign', () => {
    it('stops at the chosen number, newest filleuls first, and stays there on later runs', async () => {
        const newest = [referral(1), referral(5)];
        getReferralsForCampaign.mockResolvedValue([referral(30), newest[0], referral(10), newest[1]]);
        const c = await campaign({ subscriptionStatus: 'non-subscribed', maxTargets: 2 });

        expect(await enrollFilteredTargets(parrain.toString(), c, {})).toBe(2);
        expect(await enrollFilteredTargets(parrain.toString(), await CampaignModel.findById(c._id), {})).toBe(0);

        const enrolled = await RelanceTargetModel.find({ campaignId: c._id }).lean();
        expect(enrolled.map(t => t.referralUserId.toString()).sort()).toEqual(newest.map(r => r._id.toString()).sort());
        expect((await CampaignModel.findById(c._id))!.targetsEnrolled).toBe(2);
    });

    it('enrolls everyone matching when no budget is set', async () => {
        getReferralsForCampaign.mockResolvedValue([referral(1), referral(2), referral(3)]);
        const c = await campaign({ subscriptionStatus: 'non-subscribed' });
        expect(await enrollFilteredTargets(parrain.toString(), c, {})).toBe(3);
    });

    it('does not start a filleul over once they have finished their 7 days', async () => {
        const done = referral(3);
        getReferralsForCampaign.mockResolvedValue([done]);
        const c = await campaign({ subscriptionStatus: 'non-subscribed', excludeCurrentTargets: true });
        await target({
            referralUserId: done._id, campaignId: c._id, currentDay: 7,
            status: TargetStatus.COMPLETED, exitReason: ExitReason.COMPLETED_7_DAYS,
        });

        expect(await enrollFilteredTargets(parrain.toString(), c, {})).toBe(0);
        expect(await RelanceTargetModel.countDocuments({ campaignId: c._id })).toBe(1);
    });
});

describe('the live count for a big network (millioncfa, 35,000 filleuls)', () => {
    const at = (days: number) => ({ _id: new mongoose.Types.ObjectId().toString(), activeSubscriptionTypes: [], createdAt: new Date(Date.now() - days * 86400_000).toISOString() });
    const list = [at(2), at(20), at(100), at(400)];

    it('fetches the whole list once and answers every period from it', async () => {
        getReferralsForCampaign.mockResolvedValue(list);
        const all = await matchCampaignReferrals('p1', { subscriptionStatus: 'non-subscribed' }, { cached: true });
        const month = await matchCampaignReferrals('p1', { subscriptionStatus: 'non-subscribed', registrationDateFrom: new Date(Date.now() - 30 * 86400_000) }, { cached: true });
        expect(all).toHaveLength(4);
        expect(month).toHaveLength(2);
        expect(getReferralsForCampaign).toHaveBeenCalledTimes(1);
        expect(getReferralsForCampaign).toHaveBeenCalledWith('p1'); // no date range: the whole list
    });

    it('never serves campaign creation from the cache', async () => {
        getReferralsForCampaign.mockResolvedValue(list);
        await matchCampaignReferrals('p1', { subscriptionStatus: 'non-subscribed' }, { cached: true });
        await matchCampaignReferrals('p1', { subscriptionStatus: 'non-subscribed' });
        expect(getReferralsForCampaign).toHaveBeenCalledTimes(2);
    });

    it('does not keep an empty answer (user-service down), so the next tap retries', async () => {
        getReferralsForCampaign.mockResolvedValueOnce([]).mockResolvedValueOnce(list);
        expect(await matchCampaignReferrals('p1', { subscriptionStatus: 'non-subscribed' }, { cached: true })).toHaveLength(0);
        expect(await matchCampaignReferrals('p1', { subscriptionStatus: 'non-subscribed' }, { cached: true })).toHaveLength(4);
    });
});
