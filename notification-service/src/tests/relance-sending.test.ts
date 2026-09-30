/**
 * What the relance sender actually does to credits, targets and campaigns.
 *
 * Runs the real `processUserTargets` against a real Mongo. Only the outside world
 * is mocked: the email provider, the SMS gateway and user-service. Each case is a
 * behaviour that was wrong on prod on 2026-09-30:
 *  - credits decremented in memory and saved back whole, so a pack credited
 *    during a run was overwritten;
 *  - the daily email limit was stored, editable, and never enforced;
 *  - J0 advanced even when nothing could be sent, losing the welcome email;
 *  - the regular path sent emails with no email credit if any SMS credit existed;
 *  - a paused campaign kept sending;
 *  - a filleul who had already paid kept getting "you haven't paid" emails.
 *
 * Needs MongoDB at TEST_MONGODB_URI (default mongodb://127.0.0.1:27017).
 */
jest.mock('node-cron', () => ({ schedule: jest.fn() }));

const sendRelanceEmail = jest.fn();
jest.mock('../services/email.relance.service', () => ({
    emailRelanceService: { sendRelanceEmail: (...a: unknown[]) => sendRelanceEmail(...a) },
}));
const sendSms = jest.fn();
jest.mock('../services/sms.service', () => ({ smsService: { sendSms: (...a: unknown[]) => sendSms(...a) } }));
jest.mock('../services/email.service', () => ({
    emailService: {
        sendLowBalanceAlert: jest.fn().mockResolvedValue(true),
        sendCreditsExhaustedAlert: jest.fn().mockResolvedValue(true),
    },
}));
const getUserDetails = jest.fn();
const getActiveSubscriptionTypes = jest.fn();
jest.mock('../services/clients/user.service.client', () => ({
    userServiceClient: {
        getUserDetails: (...a: unknown[]) => getUserDetails(...a),
        getActiveSubscriptionTypes: (...a: unknown[]) => getActiveSubscriptionTypes(...a),
    },
}));

process.env.RELANCE_EMAIL_DELAY_MS = '0';

import mongoose from 'mongoose';
import RelanceConfigModel from '../database/models/relance-config.model';
import RelanceTargetModel, { TargetStatus, ExitReason } from '../database/models/relance-target.model';
import RelanceMessageModel from '../database/models/relance-message.model';
import CampaignModel, { CampaignStatus, CampaignType } from '../database/models/relance-campaign.model';
import { processUserTargets, resetDailyCountIfNewDay, reserveRelanceCredit } from '../jobs/relance-sender.job';
import { closeRelanceBacklog } from '../scripts/close-relance-backlog';

const MONGO = (process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017') + '/sbc_notifications_relance_sending_test';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const referrerId = new mongoose.Types.ObjectId();

const makeConfig = (over: Record<string, unknown> = {}) =>
    RelanceConfigModel.create({ userId: referrerId, emailBalance: 100, smsBalance: 0, maxMessagesPerDay: 500, ...over });

const makeTarget = (over: Record<string, unknown> = {}) =>
    RelanceTargetModel.create({
        referralUserId: new mongoose.Types.ObjectId(),
        referrerUserId: referrerId,
        campaignId: null,
        currentDay: 0,
        status: TargetStatus.ACTIVE,
        enteredLoopAt: new Date(Date.now() - HOUR),
        nextMessageDue: new Date(Date.now() - 60_000),
        language: 'fr',
        messagesDelivered: [],
        ...over,
    });

/** The sender reads targets with their campaign populated, as the job does. */
const due = async () => RelanceTargetModel.find({ referrerUserId: referrerId, status: TargetStatus.ACTIVE }).populate('campaignId');
const run = async () => {
    const config = await RelanceConfigModel.findOne({ userId: referrerId });
    return processUserTargets(referrerId.toString(), await due(), config);
};
const reload = (id: unknown) => RelanceTargetModel.findById(id).lean() as Promise<any>;
const balance = async () => (await RelanceConfigModel.findOne({ userId: referrerId }).lean()) as any;

beforeAll(async () => {
    try {
        await mongoose.connect(MONGO, { serverSelectionTimeoutMS: 3000 });
    } catch (err: any) {
        throw new Error(`These tests need MongoDB at ${MONGO} (set TEST_MONGODB_URI): ${err.message}`);
    }
    await mongoose.connection.dropDatabase();
});

afterAll(async () => {
    await mongoose.connection.dropDatabase().catch(() => undefined);
    await mongoose.disconnect();
});

beforeEach(async () => {
    await Promise.all([
        RelanceConfigModel.deleteMany({}),
        RelanceTargetModel.deleteMany({}),
        CampaignModel.deleteMany({}),
        RelanceMessageModel.deleteMany({}),
    ]);
    await RelanceMessageModel.insertMany([1, 2, 3, 4, 5, 6, 7].map(d => ({
        dayNumber: d, subject: `Jour ${d}`, active: true,
        messageTemplate: { fr: `Bonjour {{name}}, jour ${d}`, en: `Hi {{name}}, day ${d}` },
    })));
    sendRelanceEmail.mockReset().mockResolvedValue({ success: true, messageId: '<m@x>' });
    sendSms.mockReset().mockResolvedValue(true);
    getUserDetails.mockReset().mockImplementation(async (id: string) => ({ _id: id, name: 'Filleul', email: `${id}@example.com`, phoneNumber: '237600000000' }));
    getActiveSubscriptionTypes.mockReset().mockResolvedValue([]);
});

describe('day 0 — the first message', () => {
    it('sends the welcome email, takes one credit and moves the filleul to day 1', async () => {
        await makeConfig({ emailBalance: 10 });
        const t = await makeTarget();

        await run();

        expect(sendRelanceEmail).toHaveBeenCalledTimes(1);
        expect((await balance()).emailBalance).toBe(9);
        const after = await reload(t._id);
        expect(after.currentDay).toBe(1);
        expect(new Date(after.nextMessageDue).getTime()).toBeGreaterThan(Date.now() + 23 * HOUR);
    });

    it('holds the filleul at day 0 when there is no email credit, instead of skipping their first email', async () => {
        // An SMS credit keeps the parrain "active"; the email itself has no credit.
        await makeConfig({ emailBalance: 0, smsBalance: 5, smsEnabled: false });
        const t = await makeTarget();

        await run();

        expect(sendRelanceEmail).not.toHaveBeenCalled();
        expect((await reload(t._id)).currentDay).toBe(0);
    });

    it('gives the credit back when the email provider refuses the message', async () => {
        await makeConfig({ emailBalance: 10 });
        await makeTarget();
        sendRelanceEmail.mockResolvedValue({ success: false, error: '421 too many connections' });

        await run();

        expect((await balance()).emailBalance).toBe(10);
    });
});

describe('credits', () => {
    it('never sends an email without an email credit — any SMS credit used to be enough', async () => {
        await makeConfig({ emailBalance: 0, smsBalance: 50, smsEnabled: true });
        const t = await makeTarget({ currentDay: 2 });

        await run();

        expect(sendRelanceEmail).not.toHaveBeenCalled();
        expect((await balance()).emailBalance).toBe(0);
        expect((await reload(t._id)).currentDay).toBe(2);
    });

    it('keeps a pack credited in the middle of a run instead of overwriting it', async () => {
        await makeConfig({ emailBalance: 2 });
        await makeTarget();
        await makeTarget();
        // A purchase lands while the first email is being sent.
        sendRelanceEmail.mockImplementationOnce(async () => {
            await RelanceConfigModel.updateOne({ userId: referrerId }, { $inc: { emailBalance: 3000 } });
            return { success: true, messageId: '<m@x>' };
        });

        await run();

        // 2 + 3000 bought − 2 sent. The old code saved "0" back over the purchase.
        expect((await balance()).emailBalance).toBe(3000);
    });

    it('stops the parrain entirely once credits run out, without touching the rest', async () => {
        await makeConfig({ emailBalance: 1 });
        const targets = await Promise.all([makeTarget(), makeTarget(), makeTarget()]);

        await run();

        expect(sendRelanceEmail).toHaveBeenCalledTimes(1);
        const days = (await Promise.all(targets.map(t => reload(t._id)))).map(t => t.currentDay).sort();
        expect(days).toEqual([0, 0, 1]);
    });
});

describe('daily email limit', () => {
    it('sends no more than the parrain\'s daily limit; the rest wait', async () => {
        await makeConfig({ emailBalance: 100, maxMessagesPerDay: 2 });
        await Promise.all([1, 2, 3, 4, 5].map(() => makeTarget()));

        await run();

        expect(sendRelanceEmail).toHaveBeenCalledTimes(2);
        const cfg = await balance();
        expect(cfg.emailBalance).toBe(98);
        expect(cfg.messagesSentToday).toBe(2);
        expect(await RelanceTargetModel.countDocuments({ currentDay: 0 })).toBe(3);
    });

    it('refuses a credit at the limit even if a caller skips the in-run check', async () => {
        // The sender also stops early on its in-memory count; this pins the
        // database-side guard, which is what holds if two runs ever overlap.
        await makeConfig({ emailBalance: 100, maxMessagesPerDay: 2, messagesSentToday: 2 });
        const cfg: any = await RelanceConfigModel.findOne({ userId: referrerId });
        expect(await reserveRelanceCredit(cfg, 'email')).toBe(false);
        expect((await balance()).emailBalance).toBe(100);
    });

    it('starts a fresh allowance on a new day', async () => {
        await makeConfig({ maxMessagesPerDay: 1, messagesSentToday: 1, lastResetDate: new Date(Date.now() - 2 * DAY) });
        const cfg = await RelanceConfigModel.findOne({ userId: referrerId });
        await resetDailyCountIfNewDay(cfg);
        expect((await balance()).messagesSentToday).toBe(0);

        await makeTarget();
        await run();
        expect(sendRelanceEmail).toHaveBeenCalledTimes(1);
    });

    it('does not reset twice in the same day', async () => {
        await makeConfig({ messagesSentToday: 7, lastResetDate: new Date() });
        const cfg = await RelanceConfigModel.findOne({ userId: referrerId });
        await resetDailyCountIfNewDay(cfg);
        expect((await balance()).messagesSentToday).toBe(7);
    });
});

describe('who gets messages', () => {
    it('lets a filleul who has already paid leave relance instead of emailing them', async () => {
        await makeConfig();
        const t = await makeTarget({ currentDay: 3 });
        getActiveSubscriptionTypes.mockResolvedValue(['CLASSIQUE']);

        await run();

        expect(sendRelanceEmail).not.toHaveBeenCalled();
        expect((await balance()).emailBalance).toBe(100);
        const after = await reload(t._id);
        expect(after.status).toBe(TargetStatus.COMPLETED);
        expect(after.exitReason).toBe(ExitReason.PAID);
    });

    it('keeps relancing when user-service cannot say — exiting an unpaid filleul would be permanent', async () => {
        await makeConfig();
        const t = await makeTarget({ currentDay: 3 });
        getActiveSubscriptionTypes.mockRejectedValue(new Error('user-service down'));

        await run();

        expect(sendRelanceEmail).toHaveBeenCalledTimes(1);
        expect((await reload(t._id)).status).toBe(TargetStatus.ACTIVE);
    });

    it('sends nothing while the parrain has paused sending', async () => {
        await makeConfig({ sendingPaused: true });
        await makeTarget();

        await run();

        expect(sendRelanceEmail).not.toHaveBeenCalled();
    });
});

describe('campaigns', () => {
    const makeCampaign = (status: CampaignStatus) => CampaignModel.create({
        userId: referrerId, name: 'Anciens filleuls', type: CampaignType.FILTERED, status,
        targetFilter: {},
    });

    it('holds a paused campaign\'s filleuls where they are', async () => {
        await makeConfig();
        const c = await makeCampaign(CampaignStatus.PAUSED);
        const t = await makeTarget({ campaignId: c._id, currentDay: 2 });

        await run();

        expect(sendRelanceEmail).not.toHaveBeenCalled();
        const after = await reload(t._id);
        expect(after.currentDay).toBe(2);
        expect(after.status).toBe(TargetStatus.ACTIVE);
    });

    it('sends for an active campaign — and does not apply the "already paid" exit to it', async () => {
        await makeConfig();
        const c = await makeCampaign(CampaignStatus.ACTIVE);
        await makeTarget({ campaignId: c._id, currentDay: 2 });
        getActiveSubscriptionTypes.mockResolvedValue(['CLASSIQUE']);

        await run();

        expect(sendRelanceEmail).toHaveBeenCalledTimes(1);
    });
});

describe('closing the backlog', () => {
    it('closes relance-des-nouveaux filleuls enrolled over 30 days ago and keeps the recent ones', async () => {
        const now = new Date();
        const old = await makeTarget({ enteredLoopAt: new Date(now.getTime() - 45 * DAY) });
        const recent = await makeTarget({ enteredLoopAt: new Date(now.getTime() - 5 * DAY) });
        const c = await CampaignModel.create({ userId: referrerId, name: 'x', type: CampaignType.FILTERED, status: CampaignStatus.ACTIVE, targetFilter: {} });
        const oldCampaignTarget = await makeTarget({ campaignId: c._id, enteredLoopAt: new Date(now.getTime() - 90 * DAY) });

        const dry = await closeRelanceBacklog(30, false, now);
        expect(dry).toMatchObject({ toClose: 1, toKeep: 1, closed: 0 });
        expect((await reload(old._id)).status).toBe(TargetStatus.ACTIVE);

        const applied = await closeRelanceBacklog(30, true, now);
        expect(applied.closed).toBe(1);
        const [o, r, ct] = await Promise.all([reload(old._id), reload(recent._id), reload(oldCampaignTarget._id)]);
        expect(o.status).toBe(TargetStatus.COMPLETED);
        expect(o.exitReason).toBe(ExitReason.EXPIRED);
        expect(r.status).toBe(TargetStatus.ACTIVE);
        expect(ct.status).toBe(TargetStatus.ACTIVE); // campaigns are the parrain's own choice
    });
});
