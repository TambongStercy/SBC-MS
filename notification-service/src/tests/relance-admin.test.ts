/**
 * Admin relance routes.
 *
 * Found 2026-10-04 while rebuilding the admin Relance screens: every admin
 * campaign route reused the member handler, which scoped the query to the
 * signed-in user's own id. So the admin list showed only the admin's own
 * campaigns, and pause/resume/cancel on anyone else's answered "Campaign not
 * found". On the member side `GET /campaigns?userId=<someone>` listed that
 * person's campaigns.
 *
 * Also covers the admin overview and parrain list, which count "relance des
 * nouveaux" (no campaignId) and "campagnes" (campaignId set) separately.
 *
 * Needs MongoDB at TEST_MONGODB_URI (default mongodb://127.0.0.1:27017). Uses
 * its own database and drops it.
 */
const getBatchUserDetails = jest.fn();
jest.mock('../services/clients/user.service.client', () => ({
    userServiceClient: { getBatchUserDetails: (...a: unknown[]) => getBatchUserDetails(...a) },
}));

import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import config from '../config';
import relanceRoutes from '../api/routes/relance.routes';
import CampaignModel, { CampaignStatus, CampaignType } from '../database/models/relance-campaign.model';
import RelanceTargetModel, { TargetStatus, ExitReason } from '../database/models/relance-target.model';
import RelanceConfigModel from '../database/models/relance-config.model';
import RelancePackCreditModel from '../database/models/relance-pack-credit.model';

const MONGO = (process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017') + '/sbc_notifications_relance_admin_test';

const oid = () => new mongoose.Types.ObjectId().toString();
const tokenFor = (role: string, userId = oid()) =>
    jwt.sign({ userId, id: userId, email: `${role}@example.com`, role }, config.jwt.secret, { expiresIn: '1h' });

let server: http.Server;
let base: string;

const call = async (method: string, path: string, opts: { auth?: string; body?: unknown } = {}) => {
    const res = await fetch(`${base}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(opts.auth ? { Authorization: `Bearer ${opts.auth}` } : {}) },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    let json: any = null;
    try { json = await res.json(); } catch { /* non-JSON */ }
    return { status: res.status, json };
};

const ADMIN_ID = oid();
const ALICE = oid();
const BOB = oid();
const admin = tokenFor('admin', ADMIN_ID);
const alice = tokenFor('user', ALICE);

const campaign = (userId: string, status = CampaignStatus.ACTIVE, name = 'Relance mars') =>
    CampaignModel.create({ userId, createdBy: userId, name, type: CampaignType.FILTERED, status });

const target = (over: Record<string, unknown>) =>
    RelanceTargetModel.create({
        referralUserId: oid(), referrerUserId: ALICE, enteredLoopAt: new Date(), nextMessageDue: new Date(),
        currentDay: 1, status: TargetStatus.ACTIVE, language: 'fr', ...over,
    });

beforeAll(async () => {
    try {
        await mongoose.connect(MONGO, { serverSelectionTimeoutMS: 3000 });
    } catch (err: any) {
        throw new Error(`These tests need MongoDB at ${MONGO} (set TEST_MONGODB_URI): ${err.message}`);
    }
    await mongoose.connection.dropDatabase();
    await RelancePackCreditModel.syncIndexes();
    const app = express();
    app.use(express.json());
    app.use('/api/relance', relanceRoutes);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
    server?.close();
    await mongoose.connection.dropDatabase().catch(() => undefined);
    await mongoose.disconnect();
});

beforeEach(async () => {
    await Promise.all([
        CampaignModel.deleteMany({}), RelanceTargetModel.deleteMany({}),
        RelanceConfigModel.deleteMany({}), RelancePackCreditModel.deleteMany({}),
    ]);
    getBatchUserDetails.mockReset();
    getBatchUserDetails.mockImplementation(async (ids: string[]) =>
        ids.map(id => ({ _id: id, name: id === ALICE ? 'Alice Ngo' : `Membre ${id.slice(-4)}`, phoneNumber: '237650000000' })));
});

describe('admin campaign routes act on everyone\'s campaigns', () => {
    it('lists every member\'s campaigns with the owner\'s name', async () => {
        await campaign(ALICE, CampaignStatus.ACTIVE, 'A');
        await campaign(BOB, CampaignStatus.PAUSED, 'B');
        const r = await call('GET', '/api/relance/admin/campaigns', { auth: admin });
        expect(r.status).toBe(200);
        expect(r.json.data.total).toBe(2);
        const a = r.json.data.campaigns.find((c: any) => c.name === 'A');
        expect(a.owner).toMatchObject({ _id: ALICE, name: 'Alice Ngo' });
    });

    it('narrows to one owner and one status when asked', async () => {
        await campaign(ALICE, CampaignStatus.ACTIVE);
        await campaign(ALICE, CampaignStatus.CANCELLED);
        await campaign(BOB, CampaignStatus.ACTIVE);
        const r = await call('GET', `/api/relance/admin/campaigns?userId=${ALICE}&status=active`, { auth: admin });
        expect(r.json.data.total).toBe(1);
    });

    it('pauses, resumes and cancels a member\'s campaign, recording the admin', async () => {
        const c = await campaign(ALICE);
        const t = await target({ campaignId: c._id });

        expect((await call('POST', `/api/relance/admin/campaigns/${c._id}/pause`, { auth: admin })).status).toBe(200);
        let fresh: any = await CampaignModel.findById(c._id).lean();
        expect(fresh.status).toBe(CampaignStatus.PAUSED);
        expect(String(fresh.pausedBy)).toBe(ADMIN_ID);

        expect((await call('POST', `/api/relance/admin/campaigns/${c._id}/resume`, { auth: admin })).status).toBe(200);
        expect((await CampaignModel.findById(c._id).lean())!.status).toBe(CampaignStatus.ACTIVE);

        const cancel = await call('POST', `/api/relance/admin/campaigns/${c._id}/cancel`, { auth: admin, body: { reason: 'Contenu trompeur' } });
        expect(cancel.status).toBe(200);
        fresh = await CampaignModel.findById(c._id).lean();
        expect(fresh).toMatchObject({ status: CampaignStatus.CANCELLED, cancelReason: 'Contenu trompeur' });
        expect(String(fresh.cancelledBy)).toBe(ADMIN_ID);
        expect((await RelanceTargetModel.findById(t._id).lean())).toMatchObject({ status: TargetStatus.COMPLETED, exitReason: ExitReason.MANUAL });
    });

    it('answers 404 for an unknown or malformed campaign id', async () => {
        expect((await call('POST', `/api/relance/admin/campaigns/${oid()}/pause`, { auth: admin })).status).toBe(404);
        expect((await call('POST', '/api/relance/admin/campaigns/nope/pause', { auth: admin })).status).toBe(404);
    });

    it('shows a member\'s campaign targets with the filleuls\' names', async () => {
        const c = await campaign(BOB);
        await target({ campaignId: c._id, referrerUserId: BOB });
        const r = await call('GET', `/api/relance/admin/campaigns/${c._id}/targets`, { auth: admin });
        expect(r.status).toBe(200);
        expect(r.json.data.pagination.total).toBe(1);
        expect(r.json.data.targets[0].referralUser.name).toMatch(/^Membre /);
    });
});

describe('member campaign routes stay scoped to the member', () => {
    it('ignores ?userId= and lists only the member\'s own campaigns', async () => {
        await campaign(ALICE, CampaignStatus.ACTIVE, 'mine');
        await campaign(BOB, CampaignStatus.ACTIVE, 'not mine');
        const r = await call('GET', `/api/relance/campaigns?userId=${BOB}`, { auth: alice });
        expect(r.json.data.campaigns.map((c: any) => c.name)).toEqual(['mine']);
    });

    it('cannot pause someone else\'s campaign', async () => {
        const c = await campaign(BOB);
        const r = await call('POST', `/api/relance/campaigns/${c._id}/pause`, { auth: alice });
        expect(r.status).toBe(400);
        expect((await CampaignModel.findById(c._id).lean())!.status).toBe(CampaignStatus.ACTIVE);
    });

    it('refuses the admin overview and parrain list to a member', async () => {
        expect((await call('GET', '/api/relance/admin/overview', { auth: alice })).status).toBe(403);
        expect((await call('GET', '/api/relance/admin/parrains', { auth: alice })).status).toBe(403);
    });
});

describe('admin overview', () => {
    it('counts the two products apart, with sends, credits and packs', async () => {
        const now = Date.now();
        const c = await campaign(ALICE);
        await target({ messagesDelivered: [
            { day: 1, channel: 'email', sentAt: new Date(now - 60_000), status: 'delivered' },
            { day: 0, channel: 'sms', sentAt: new Date(now - 3 * 86400_000), status: 'delivered' },
        ] });
        await target({ status: TargetStatus.COMPLETED, exitReason: ExitReason.PAID, exitedLoopAt: new Date(now - 86400_000),
            messagesDelivered: [{ day: 1, channel: 'email', sentAt: new Date(now - 2 * 86400_000), status: 'failed' }] });
        await target({ campaignId: c._id });
        await target({ status: TargetStatus.COMPLETED, exitReason: ExitReason.PAID, exitedLoopAt: new Date(now - 40 * 86400_000) });
        await RelanceConfigModel.create({ userId: ALICE, emailBalance: 2500, smsBalance: 0 });
        await RelanceConfigModel.create({ userId: BOB, emailBalance: 0, smsBalance: 100 });
        await RelanceConfigModel.create({ userId: oid(), emailBalance: 0, smsBalance: 0 });
        await RelancePackCreditModel.create({ sessionId: 's1', userId: ALICE, packId: 'email_3k', packType: 'email', credits: 3000 });
        await RelancePackCreditModel.create({ sessionId: 's2', userId: BOB, packId: 'sms_250', packType: 'sms', credits: 250, creditedAt: new Date(now - 60 * 86400_000) });

        const r = await call('GET', '/api/relance/admin/overview', { auth: admin });
        expect(r.status).toBe(200);
        const d = r.json.data;
        expect(d.nouveaux).toMatchObject({ active: 1, paidLast30Days: 1 });
        expect(d.campaigns).toMatchObject({ byStatus: { active: 1 }, activeTargets: 1 });
        // The email a minute ago counts today; the SMS (3 days) and the failure (2 days) only in the week.
        expect(d.sends.today).toEqual({ email: 1, sms: 0, failed: 0 });
        expect(d.sends.last7Days).toEqual({ email: 1, sms: 1, failed: 1 });
        expect(d.credits).toEqual({ emailLeft: 2500, smsLeft: 100, parrainsWithCredits: 2 });
        expect(d.packs.total).toEqual({ count: 2, amountXAF: 2500 + 4000 });
        expect(d.packs.last30Days).toEqual({ count: 1, amountXAF: 2500 });
    });
});

describe('admin parrain list', () => {
    it('lists parrains with credits by default, with names, filleuls in progress and packs', async () => {
        const c = await campaign(ALICE);
        await RelanceConfigModel.create({ userId: ALICE, emailBalance: 500, messagesSentToday: 40, lastResetDate: new Date() });
        await RelanceConfigModel.create({ userId: BOB, emailBalance: 0, smsBalance: 0 });
        await target({});
        await target({ campaignId: c._id });
        await RelancePackCreditModel.create({ sessionId: 's1', userId: ALICE, packId: 'email_3k', packType: 'email', credits: 3000 });

        const r = await call('GET', '/api/relance/admin/parrains', { auth: admin });
        expect(r.status).toBe(200);
        expect(r.json.data.total).toBe(1);
        expect(r.json.data.parrains[0]).toMatchObject({
            userId: ALICE, user: { name: 'Alice Ngo' }, emailBalance: 500, emailsSentToday: 40,
            inLoop: { nouveaux: 1, campaigns: 1 }, packs: { count: 1 },
        });

        const all = await call('GET', '/api/relance/admin/parrains?withCredits=false', { auth: admin });
        expect(all.json.data.total).toBe(2);
    });

    it('does not report yesterday\'s count as today\'s', async () => {
        await RelanceConfigModel.create({ userId: ALICE, emailBalance: 10, messagesSentToday: 300, lastResetDate: new Date(Date.now() - 2 * 86400_000) });
        const r = await call('GET', '/api/relance/admin/parrains', { auth: admin });
        expect(r.json.data.parrains[0].emailsSentToday).toBe(0);
    });
});

describe('admin config update', () => {
    it('validates the campaign size and the flags', async () => {
        await RelanceConfigModel.create({ userId: ALICE });
        expect((await call('PUT', `/api/relance/admin/configs/${ALICE}`, { auth: admin, body: { maxTargetsPerCampaign: 5 } })).status).toBe(400);
        expect((await call('PUT', `/api/relance/admin/configs/${ALICE}`, { auth: admin, body: { maxTargetsPerCampaign: '800' } })).status).toBe(400);
        expect((await call('PUT', `/api/relance/admin/configs/${ALICE}`, { auth: admin, body: { sendingPaused: 'yes' } })).status).toBe(400);
        expect((await call('PUT', `/api/relance/admin/configs/${ALICE}`, { auth: admin, body: {} })).status).toBe(400);
        const ok = await call('PUT', `/api/relance/admin/configs/${ALICE}`, { auth: admin, body: { maxTargetsPerCampaign: 800, sendingPaused: true } });
        expect(ok.status).toBe(200);
        expect(await RelanceConfigModel.findOne({ userId: ALICE }).lean()).toMatchObject({ maxTargetsPerCampaign: 800, sendingPaused: true });
    });
});
