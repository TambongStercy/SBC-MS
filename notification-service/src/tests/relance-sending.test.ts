/**
 * What the relance sender actually does to credits, targets and campaigns.
 *
 * Runs the real `processUserTargets` against a real Mongo. Only the outside world
 * is mocked: the email provider, the SMS gateway and user-service. Each case is a
 * behaviour that was wrong on prod on 2026-09-30:
 *  - credits decremented in memory and saved back whole, so a pack credited
 *    during a run was overwritten;
 *  - the daily email limit was stored, editable, and never enforced (since
 *    removed: the mail server's per-minute budget paces relance now);
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

const pushCreditsLow = jest.fn();
const pushCreditsExhausted = jest.fn();
const pushFilleulPaid = jest.fn();
jest.mock('../services/relance-alerts.service', () => ({
    pushCreditsLow: (...a: unknown[]) => pushCreditsLow(...a),
    pushCreditsExhausted: (...a: unknown[]) => pushCreditsExhausted(...a),
    pushFilleulPaid: (...a: unknown[]) => pushFilleulPaid(...a),
}));

process.env.RELANCE_EMAIL_DELAY_MS = '0';
process.env.RELANCE_SPARE_WAIT_MINUTES = '0';

import mongoose from 'mongoose';
import RelanceConfigModel from '../database/models/relance-config.model';
import RelanceTargetModel, { TargetStatus, ExitReason } from '../database/models/relance-target.model';
import RelanceMessageModel from '../database/models/relance-message.model';
import RelanceSmsTemplateModel from '../database/models/relance-sms-template.model';
import CampaignModel, { CampaignStatus, CampaignType } from '../database/models/relance-campaign.model';
import { inRelanceSendingHours, processUserTargets, resetDailyCountIfNewDay, reserveRelanceCredit, runMessageSendingJob } from '../jobs/relance-sender.job';
import { closeRelanceBacklog } from '../scripts/close-relance-backlog';

const MONGO = (process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017') + '/sbc_notifications_relance_sending_test';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const referrerId = new mongoose.Types.ObjectId();

const makeConfig = (over: Record<string, unknown> = {}) =>
    RelanceConfigModel.create({ userId: referrerId, emailBalance: 100, smsBalance: 0, ...over });

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
    [pushCreditsLow, pushCreditsExhausted, pushFilleulPaid].forEach(m => m.mockReset());
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

describe('no per-parrain daily limit (removed 2026-10-07)', () => {
    it('sends every due email, however many went out today — the mail server budget paces it instead', async () => {
        await makeConfig({ emailBalance: 100, messagesSentToday: 5000, lastResetDate: new Date() });
        await Promise.all([1, 2, 3, 4, 5].map(() => makeTarget()));

        await run();

        expect(sendRelanceEmail).toHaveBeenCalledTimes(5);
        const cfg = await balance();
        expect(cfg.emailBalance).toBe(95);
        expect(cfg.messagesSentToday).toBe(5005); // still counted, for the admin
    });

    it('takes a credit whatever the count says', async () => {
        await makeConfig({ emailBalance: 100, messagesSentToday: 9999 });
        const cfg: any = await RelanceConfigModel.findOne({ userId: referrerId });
        expect(await reserveRelanceCredit(cfg, 'email')).toBe(true);
        expect((await balance()).emailBalance).toBe(99);
    });

    it('restarts the sent-today count on a new day, once', async () => {
        await makeConfig({ messagesSentToday: 7, lastResetDate: new Date(Date.now() - 2 * DAY) });
        const cfg = await RelanceConfigModel.findOne({ userId: referrerId });
        await resetDailyCountIfNewDay(cfg);
        expect((await balance()).messagesSentToday).toBe(0);
        await RelanceConfigModel.updateOne({ userId: referrerId }, { $set: { messagesSentToday: 3 } });
        await resetDailyCountIfNewDay(await RelanceConfigModel.findOne({ userId: referrerId }));
        expect((await balance()).messagesSentToday).toBe(3);
    });
});

describe('no spare sending capacity (relance is lowest priority)', () => {
    const deferred = { success: false, deferred: true, error: 'No spare sending capacity this minute' };

    it('holds the welcome email at day 0, uncharged, and stops the run', async () => {
        await makeConfig({ emailBalance: 10 });
        const first = await makeTarget();
        const second = await makeTarget();
        sendRelanceEmail.mockResolvedValue(deferred);

        await run();

        expect(sendRelanceEmail).toHaveBeenCalledTimes(1); // the rest of the run waits
        expect((await balance()).emailBalance).toBe(10);
        for (const t of [first, second]) {
            const after = await reload(t._id);
            expect(after.currentDay).toBe(0);
            expect(after.messagesDelivered).toEqual([]);
        }
    });

    it('leaves a regular day due as it is — not a failure, nothing charged', async () => {
        await makeConfig({ emailBalance: 10 });
        const t = await makeTarget({ currentDay: 2 });
        const dueBefore = (await reload(t._id)).nextMessageDue;
        sendRelanceEmail.mockResolvedValue(deferred);

        await run();

        const after = await reload(t._id);
        expect((await balance()).emailBalance).toBe(10);
        expect(after.currentDay).toBe(2);
        expect(after.messagesDelivered).toEqual([]); // no "failed" entry counting toward retries
        expect(new Date(after.nextMessageDue).getTime()).toBe(new Date(dueBefore).getTime());
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

    // Preprod 2026-10-01: a March campaign whose filleuls were gone stayed
    // "active" for months, because completion was only checked on runs where
    // some target, anywhere, was due.
    it('closes an emptied campaign even when nobody is due a message', async () => {
        const empty = await makeCampaign(CampaignStatus.ACTIVE);
        const running = await makeCampaign(CampaignStatus.ACTIVE);
        await makeTarget({ campaignId: running._id, currentDay: 2, nextMessageDue: new Date(Date.now() + DAY) });

        await runMessageSendingJob(new Date('2026-10-07T10:00:00Z')); // 11:00 Douala, within sending hours

        expect((await CampaignModel.findById(empty._id))!.status).toBe(CampaignStatus.COMPLETED);
        expect((await CampaignModel.findById(running._id))!.status).toBe(CampaignStatus.ACTIVE);
        expect(sendRelanceEmail).not.toHaveBeenCalled();
    });
});

describe('telling the parrain (push)', () => {
    it('warns when the last credit goes — on a first-day email too, which used to warn nobody', async () => {
        await makeConfig({ emailBalance: 1 });
        await makeTarget({ currentDay: 0 });

        await run();

        expect(pushCreditsExhausted).toHaveBeenCalledWith(referrerId.toString());
    });

    it('warns at the low mark on a regular day', async () => {
        await makeConfig({ emailBalance: 51 });
        await makeTarget({ currentDay: 2 });

        await run();

        expect(pushCreditsLow).toHaveBeenCalledWith(referrerId.toString(), 50);
        expect(pushCreditsExhausted).not.toHaveBeenCalled();
    });

    it('says nothing while credits are comfortable', async () => {
        await makeConfig({ emailBalance: 500 });
        await makeTarget({ currentDay: 2 });
        await run();
        expect(pushCreditsLow).not.toHaveBeenCalled();
        expect(pushCreditsExhausted).not.toHaveBeenCalled();
    });

    it('tells the parrain when a relanced filleul pays', async () => {
        await makeConfig();
        const t = await makeTarget({ currentDay: 3 });
        getActiveSubscriptionTypes.mockResolvedValue(['CLASSIQUE']);

        await run();

        expect(pushFilleulPaid).toHaveBeenCalledWith(referrerId.toString(), t.referralUserId.toString());
    });
});

describe('SMS for campaigns (2026-10-03)', () => {
    const smsOn = { smsEnabled: true, smsBalance: 10 };
    beforeEach(async () => {
        await RelanceSmsTemplateModel.deleteMany({});
        await RelanceSmsTemplateModel.insertMany([
            { type: 'manual', dayNumber: 2, templateText: 'Campagne J2 {{link}}', active: true },
            { type: 'auto', dayNumber: 2, templateText: 'Nouveaux J2 {{link}}', active: true },
        ]);
    });
    const campaignWith = (channel: string) => CampaignModel.create({
        userId: referrerId, name: 'Anciens', type: CampaignType.FILTERED, status: CampaignStatus.ACTIVE, targetFilter: {}, channel,
    });

    it('sends no SMS for a campaign created for email only — the channel used to be ignored', async () => {
        await makeConfig(smsOn);
        const c = await campaignWith('email');
        await makeTarget({ campaignId: c._id, currentDay: 2 });
        await run();
        expect(sendRelanceEmail).toHaveBeenCalledTimes(1);
        expect(sendSms).not.toHaveBeenCalled();
    });

    it('sends the campaign SMS when the campaign was created with SMS', async () => {
        await makeConfig(smsOn);
        const c = await campaignWith('both');
        await makeTarget({ campaignId: c._id, currentDay: 2 });
        await run();
        expect(sendSms).toHaveBeenCalledTimes(1);
        expect(sendSms.mock.calls[0][0].body).toMatch(/^Campagne J2/);
    });

    it('leaves relance des nouveaux alone: SMS on means SMS sent', async () => {
        await makeConfig(smsOn);
        await makeTarget({ currentDay: 2 });
        await run();
        expect(sendSms).toHaveBeenCalledTimes(1);
        expect(sendSms.mock.calls[0][0].body).toMatch(/^Nouveaux J2/);
    });
});

// 2026-10-08 → 10-10 on prod: user-service returned phoneNumber as a number,
// phone.replace() threw after the email had gone out, target.save() never ran,
// and the same email was resent every 15 minutes (up to 35 times, 40 filleuls).
describe('a phone number stored as a number (2026-10-10)', () => {
    const smsOn = { smsEnabled: true, smsBalance: 10 };
    /** Picks targets the way the job does: only those whose time has come. */
    const runDue = async () => {
        const config = await RelanceConfigModel.findOne({ userId: referrerId });
        const ready = await RelanceTargetModel.find({
            referrerUserId: referrerId, status: TargetStatus.ACTIVE, nextMessageDue: { $lte: new Date() },
        }).populate('campaignId');
        return processUserTargets(referrerId.toString(), ready, config);
    };
    beforeEach(async () => {
        await RelanceSmsTemplateModel.deleteMany({});
        await RelanceSmsTemplateModel.insertMany([
            { type: 'auto', dayNumber: 0, templateText: 'Nouveaux J0', active: true },
            { type: 'manual', dayNumber: 1, templateText: 'Campagne J1', active: true },
        ]);
        getUserDetails.mockImplementation(async (id: string) => ({ _id: id, name: 'Filleul', email: `${id}@example.com`, phoneNumber: 237600000000 }));
    });

    it('sends a campaign day once, records it and moves on — the next run sends nothing', async () => {
        await makeConfig(smsOn);
        const c = await CampaignModel.create({
            userId: referrerId, name: 'Test', type: CampaignType.FILTERED, status: CampaignStatus.ACTIVE, targetFilter: {}, channel: 'both',
        });
        const t = await makeTarget({ campaignId: c._id, currentDay: 1 });
        await runDue();
        await runDue();
        expect(sendRelanceEmail).toHaveBeenCalledTimes(1);
        expect(sendSms).toHaveBeenCalledTimes(1);
        expect(sendSms.mock.calls[0][0].to).toBe('+237600000000');
        const after = await reload(t._id);
        expect(after.currentDay).toBe(2);
        expect((await balance()).emailBalance).toBe(99);
    });

    it('sends the welcome email once at day 0 and moves the filleul to day 1', async () => {
        await makeConfig(smsOn);
        const t = await makeTarget();
        await runDue();
        await runDue();
        expect(sendRelanceEmail).toHaveBeenCalledTimes(1);
        expect((await reload(t._id)).currentDay).toBe(1);
    });

    it('still records the email when the SMS step itself fails', async () => {
        await makeConfig(smsOn);
        sendSms.mockRejectedValue(new Error('gateway down'));
        const c = await CampaignModel.create({
            userId: referrerId, name: 'Test', type: CampaignType.FILTERED, status: CampaignStatus.ACTIVE, targetFilter: {}, channel: 'both',
        });
        const t = await makeTarget({ campaignId: c._id, currentDay: 1 });
        await runDue();
        await runDue();
        expect(sendRelanceEmail).toHaveBeenCalledTimes(1);
        expect((await reload(t._id)).currentDay).toBe(2);
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

describe('relance goes out in the daytime only (07:00–19:00 Douala)', () => {
    it.each([
        ['05:59 UTC = 06:59 Douala', '2026-10-07T05:59:00Z', false],
        ['06:00 UTC = 07:00 Douala', '2026-10-07T06:00:00Z', true],
        ['12:00 UTC = 13:00 Douala', '2026-10-07T12:00:00Z', true],
        ['17:59 UTC = 18:59 Douala', '2026-10-07T17:59:00Z', true],
        ['18:00 UTC = 19:00 Douala', '2026-10-07T18:00:00Z', false],
        ['21:30 UTC = 22:30 Douala (OTP peak)', '2026-10-07T21:30:00Z', false],
        ['01:00 UTC = 02:00 Douala', '2026-10-07T01:00:00Z', false],
    ])('%s', (_label, iso, expected) => {
        expect(inRelanceSendingHours(new Date(iso))).toBe(expected);
    });

    it('sends nothing at night: a due filleul waits for the morning', async () => {
        await makeConfig({ emailBalance: 10 });
        const t = await makeTarget();
        await runMessageSendingJob(new Date('2026-10-07T23:00:00Z')); // midnight Douala
        expect(sendRelanceEmail).not.toHaveBeenCalled();
        expect((await reload(t._id)).currentDay).toBe(0);
    });
});
