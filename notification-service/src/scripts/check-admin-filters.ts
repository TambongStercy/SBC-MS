/**
 * Admin filters ?country / ?from / ?to on the relance admin routes and the push
 * announcements list (admin plan, phase 3).
 *
 * Runs the real routes over HTTP against its own throwaway DB, with user-service
 * stubbed (members of a country, names), and drops the DB at the end.
 *   npx ts-node --swc src/scripts/check-admin-filters.ts
 */
import assert from 'assert';
import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import jwt from 'jsonwebtoken';
import mongoose, { Types } from 'mongoose';
import config from '../config';
import relanceRoutes from '../api/routes/relance.routes';
import pushRoutes from '../api/routes/push.routes';
import RelanceConfigModel from '../database/models/relance-config.model';
import RelanceTargetModel from '../database/models/relance-target.model';
import CampaignModel from '../database/models/relance-campaign.model';
import RelancePackCreditModel from '../database/models/relance-pack-credit.model';
import PushAnnouncementModel from '../database/models/push-announcement.model';
import PushSubscriptionModel from '../database/models/push-subscription.model';
import { userServiceClient } from '../services/clients/user.service.client';
import { setCountryMembersResolver } from '../utils/country-members';

const URI = process.env.CHECK_MONGO_URI || 'mongodb://127.0.0.1:27017/sbc_notification_filters_check';

const CM_PARRAIN = new Types.ObjectId();
const CI_PARRAIN = new Types.ObjectId();
const OCT = new Date('2026-10-05T10:00:00Z');
const NOV = new Date('2026-11-05T10:00:00Z');

(async () => {
    // No index builds: they race the final drop and leave an empty DB behind.
    await mongoose.connect(URI, { autoIndex: false });
    await mongoose.connection.dropDatabase();

    // user-service stubs: country members, and names for the lists.
    let resolverCalls = 0;
    setCountryMembersResolver(async code => {
        resolverCalls++;
        if (code === 'ZZ') throw new Error('user-service down');
        if (code === 'CM') return [CM_PARRAIN.toHexString(), new Types.ObjectId().toHexString()];
        if (code === 'CI') return [CI_PARRAIN.toHexString()];
        return [];
    });
    (userServiceClient as any).getBatchUserDetails = async () => [];

    const target = (referrer: Types.ObjectId, at: Date, extra: Record<string, unknown> = {}) => ({
        referralUserId: new Types.ObjectId(), referrerUserId: referrer, enteredLoopAt: at, nextMessageDue: at,
        currentDay: 1, status: 'active', language: 'fr', campaignId: null, createdAt: at, updatedAt: at,
        messagesDelivered: [{ day: 1, channel: 'email', sentAt: at, status: 'delivered', success: true }],
        ...extra,
    });
    await RelanceConfigModel.collection.insertMany([
        { userId: CM_PARRAIN, enabled: true, emailBalance: 100, smsBalance: 0, createdAt: OCT, updatedAt: OCT },
        { userId: CI_PARRAIN, enabled: true, emailBalance: 40, smsBalance: 0, createdAt: NOV, updatedAt: NOV },
    ] as any[]);
    await RelanceTargetModel.collection.insertMany([
        target(CM_PARRAIN, OCT), target(CM_PARRAIN, OCT), target(CM_PARRAIN, NOV), target(CI_PARRAIN, NOV),
    ] as any[]);
    await CampaignModel.collection.insertMany([
        { userId: CM_PARRAIN, createdBy: CM_PARRAIN, name: 'CM oct', type: 'filtered', status: 'active', targetsEnrolled: 5, messagesSent: 4, messagesDelivered: 4, createdAt: OCT },
        { userId: CI_PARRAIN, createdBy: CI_PARRAIN, name: 'CI nov', type: 'filtered', status: 'completed', targetsEnrolled: 2, messagesSent: 2, messagesDelivered: 1, createdAt: NOV },
    ] as any[]);
    await RelancePackCreditModel.collection.insertMany([
        { userId: CM_PARRAIN, sessionId: 's1', packId: 'email_3k', creditedAt: new Date('2026-11-02T00:00:00Z') },
        { userId: CI_PARRAIN, sessionId: 's2', packId: 'email_3k', creditedAt: new Date('2026-10-02T00:00:00Z') },
    ] as any[]);
    const admin = new Types.ObjectId();
    await PushAnnouncementModel.collection.insertMany([
        { by: admin, title: 'CM', body: 'b', recipients: 1, filter: { countries: ['CM'] }, toAll: false, createdAt: NOV },
        { by: admin, title: 'ci lower', body: 'b', recipients: 1, filter: { countries: ['ci'] }, toAll: false, createdAt: NOV },
        { by: admin, title: 'everyone', body: 'b', recipients: 2, toAll: true, createdAt: OCT },
        { by: admin, title: 'women', body: 'b', recipients: 1, filter: { sex: 'female' }, toAll: false, createdAt: NOV },
    ] as any[]);
    await PushSubscriptionModel.collection.insertMany([
        { userId: CM_PARRAIN, endpoint: 'https://push.example/1', keys: { p256dh: 'x', auth: 'y' } },
        { userId: CI_PARRAIN, endpoint: 'https://push.example/2', keys: { p256dh: 'x', auth: 'y' } },
    ] as any[]);

    const app = express();
    app.use(express.json());
    app.use('/api/relance', relanceRoutes);
    app.use('/api/notifications/push', pushRoutes);
    const server = http.createServer(app).listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const token = jwt.sign({ userId: admin.toHexString(), id: admin.toHexString(), email: 'a@example.com', role: 'admin' }, config.jwt.secret, { expiresIn: '1h' });
    const get = async (path: string) => {
        const r = await fetch(base + path, { headers: { Authorization: `Bearer ${token}` } });
        return { status: r.status, body: await r.json() as any };
    };
    const NOVQ = 'from=2026-11-01&to=2026-11-30';

    try {
        // Bad input → 400 (French), user-service down → 502.
        let r = await get('/api/relance/admin/configs?country=zz9');
        assert.strictEqual(r.status, 400); assert.match(r.body.message, /Code pays invalide/);
        r = await get('/api/relance/admin/targets?from=yesterday');
        assert.strictEqual(r.status, 400);
        r = await get('/api/relance/admin/overview?from=2026-11-30&to=2026-11-01');
        assert.strictEqual(r.status, 400);
        r = await get('/api/relance/admin/stats?country=ZZ');
        assert.strictEqual(r.status, 502); assert.match(r.body.message, /Filtre pays indisponible/);
        r = await get('/api/notifications/push/admin/announcements?country=ZZ');
        assert.strictEqual(r.status, 502);

        // Configs: country via the parrain, dates on createdAt; "ALL" and any case.
        const cfg = async (q: string) => (await get(`/api/relance/admin/configs?${q}`)).body.data.length;
        assert.strictEqual(await cfg(''), 2);
        assert.strictEqual(await cfg('country=ALL'), 2);
        assert.strictEqual(await cfg('country=cm'), 1);
        assert.strictEqual(await cfg(NOVQ), 1);
        assert.strictEqual(await cfg(`country=CM&${NOVQ}`), 0);
        assert.strictEqual(await cfg('country=SN'), 0);

        // Parrains: same, and ?userId must also be of the country.
        const par = async (q: string) => (await get(`/api/relance/admin/parrains?${q}`)).body.data.total;
        assert.strictEqual(await par(''), 2);
        assert.strictEqual(await par('country=CI'), 1);
        assert.strictEqual(await par(`country=CM&userId=${CI_PARRAIN}`), 0);
        assert.strictEqual(await par(`country=CI&userId=${CI_PARRAIN}`), 1);

        // Targets (enteredLoopAt) and logs (createdAt).
        const tgt = async (q: string) => (await get(`/api/relance/admin/targets?${q}`)).body.data.total;
        assert.strictEqual(await tgt(''), 4);
        assert.strictEqual(await tgt('country=CM'), 3);
        assert.strictEqual(await tgt(`country=CM&${NOVQ}`), 1);
        assert.strictEqual(await tgt('to=2026-10-05'), 2); // bare `to` = end of that day
        const logs = async (q: string) => (await get(`/api/relance/admin/logs?${q}`)).body.data.total;
        assert.strictEqual(await logs('country=CI'), 1);
        assert.strictEqual(await logs(NOVQ), 2);

        // Stats.
        const stats = async (q: string) => (await get(`/api/relance/admin/stats?${q}`)).body.data;
        let s = await stats('');
        assert.strictEqual(s.totalActiveTargets, 4); assert.strictEqual(s.totalMessagesSent, 4); assert.strictEqual(s.activeConfigsCount, 2);
        s = await stats('country=CM');
        assert.strictEqual(s.totalActiveTargets, 3); assert.strictEqual(s.totalMessagesSent, 3); assert.strictEqual(s.activeConfigsCount, 1);
        s = await stats(`country=CM&${NOVQ}`);
        assert.strictEqual(s.totalActiveTargets, 1); assert.strictEqual(s.totalMessagesSent, 1);

        // Overview.
        const ov = async (q: string) => (await get(`/api/relance/admin/overview?${q}`)).body.data;
        let o = await ov('');
        assert.strictEqual(o.nouveaux.active, 4); assert.strictEqual(o.credits.emailLeft, 140); assert.strictEqual(o.packs.total.count, 2);
        o = await ov('country=CM');
        assert.strictEqual(o.nouveaux.active, 3); assert.strictEqual(o.credits.emailLeft, 100); assert.strictEqual(o.packs.total.count, 1);
        assert.deepStrictEqual(o.campaigns.byStatus, { active: 1 });
        o = await ov(`country=CI&${NOVQ}`);
        assert.strictEqual(o.nouveaux.active, 1); assert.strictEqual(o.packs.total.count, 0); assert.deepStrictEqual(o.campaigns.byStatus, { completed: 1 });
        o = await ov('from=2026-01-01&to=2026-01-31');
        assert.strictEqual(o.nouveaux.active, 0); assert.strictEqual(o.sends.last7Days.email, 0);

        // Campaigns list and stats (owner's country, createdAt).
        const camp = async (q: string) => (await get(`/api/relance/admin/campaigns?${q}`)).body.data.total;
        assert.strictEqual(await camp(''), 2);
        assert.strictEqual(await camp('country=CM'), 1);
        assert.strictEqual(await camp(NOVQ), 1);
        assert.strictEqual(await camp(`country=CM&${NOVQ}`), 0);
        assert.strictEqual(await camp(`country=CM&userId=${CI_PARRAIN}`), 0);
        const cs = (await get('/api/relance/admin/campaigns/stats?country=CI')).body.data;
        assert.strictEqual(cs.totalCampaigns, 1); assert.strictEqual(cs.totalTargetsEnrolled, 2); assert.strictEqual(cs.completedCampaigns, 1);

        // Announcements: stored filter.countries (any case) + those with no country filter.
        const ann = async (q: string) => (await get(`/api/notifications/push/admin/announcements?${q}`)).body.data;
        let a = await ann('');
        assert.strictEqual(a.recent.length, 4); assert.strictEqual(a.audience, 2);
        a = await ann('country=CM');
        assert.deepStrictEqual(a.recent.map((x: any) => x.title).sort(), ['CM', 'everyone', 'women']); assert.strictEqual(a.audience, 1);
        a = await ann('country=ci');
        assert.deepStrictEqual(a.recent.map((x: any) => x.title).sort(), ['ci lower', 'everyone', 'women']);
        a = await ann(`country=CM&${NOVQ}`);
        assert.deepStrictEqual(a.recent.map((x: any) => x.title).sort(), ['CM', 'women']);
        a = await ann('country=SN');
        assert.deepStrictEqual(a.recent.map((x: any) => x.title).sort(), ['everyone', 'women']); assert.strictEqual(a.audience, 0);

        // Country members are fetched once per country and cached (ZZ failures are not cached).
        assert.ok(resolverCalls <= 6, `resolver called ${resolverCalls} times`);

        console.log('OK notification-service admin filters (relance configs/parrains/targets/logs/stats/overview/campaigns, push announcements)');
    } finally {
        server.close();
        await mongoose.connection.dropDatabase();
        await mongoose.disconnect();
    }
    // The routes pull in the mail transporter and timers, which keep the process alive.
    process.exit(0);
})().catch(err => {
    console.error(err);
    mongoose.connection.dropDatabase().catch(() => undefined).finally(() => process.exit(1));
});
