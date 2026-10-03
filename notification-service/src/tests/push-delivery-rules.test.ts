/**
 * When a push goes out, and when it waits.
 *
 * Push now reaches money, chat, filleuls, events, tombola, Ads Network,
 * subscriptions and announcements. Each kind can be turned off; non-urgent
 * ones wait out the night (22:00–07:00 Douala) and go at 07:00, one per topic;
 * other services send through /internal/send; admin announcements are capped.
 *
 * web-push is mocked; everything else runs against a real Mongo.
 * Needs MongoDB at TEST_MONGODB_URI (default mongodb://127.0.0.1:27017).
 */
const sendNotification = jest.fn();
jest.mock('web-push', () => ({
    __esModule: true,
    default: { setVapidDetails: jest.fn(), sendNotification: (...a: unknown[]) => sendNotification(...a) },
}));
jest.mock('../config', () => {
    const actual = jest.requireActual('../config').default;
    return { __esModule: true, default: { ...actual, push: { publicKey: 'PUBLIC_KEY', privateKey: 'PRIVATE_KEY', subject: 'mailto:t@t' } } };
});

import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import config from '../config';
import pushRoutes from '../api/routes/push.routes';
import PushSubscriptionModel from '../database/models/push-subscription.model';
import PushPreferenceModel from '../database/models/push-preference.model';
import PendingPushModel from '../database/models/pending-push.model';
import PushAnnouncementModel from '../database/models/push-announcement.model';
import InboxItemModel from '../database/models/inbox-item.model';
import { flushDuePushes, sendPushToUser } from '../services/push.service';
import { endOfQuietHours, inQuietHours } from '../services/push-categories';

const MONGO = (process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017') + '/sbc_notifications_push_rules_test';
const at = (iso: string) => new Date(iso);
// Douala is UTC+1: 21:30 UTC = 22:30 there.
const NIGHT = at('2026-10-01T21:30:00Z');
const DAY = at('2026-10-01T12:00:00Z');

const userId = new mongoose.Types.ObjectId().toString();
const tokenFor = (id: string, role = 'user') => jwt.sign({ userId: id, id, email: 'u@x.com', role }, config.jwt.secret, { expiresIn: '1h' });
const device = (uid = userId, n = 1) => PushSubscriptionModel.create({
    userId: uid, endpoint: `https://fcm.googleapis.com/fcm/send/${uid}-${n}`, keys: { p256dh: 'p', auth: 'a' },
});

let server: http.Server;
let base: string;
const call = async (method: string, path: string, opts: { auth?: string; body?: unknown } = {}) => {
    const res = await fetch(`${base}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(opts.auth ? { Authorization: `Bearer ${opts.auth}` } : {}) },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
};

beforeAll(async () => {
    await mongoose.connect(MONGO, { serverSelectionTimeoutMS: 3000 });
    await mongoose.connection.dropDatabase();
    await PushSubscriptionModel.syncIndexes();
    const app = express();
    app.use(express.json());
    app.use('/api/notifications/push', pushRoutes);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
    server?.close();
    await mongoose.connection.dropDatabase().catch(() => undefined);
    await mongoose.disconnect();
});
beforeEach(async () => {
    sendNotification.mockReset().mockResolvedValue({ statusCode: 201 });
    await Promise.all([PushSubscriptionModel, PushPreferenceModel, PendingPushModel, PushAnnouncementModel, InboxItemModel].map(m => (m as any).deleteMany({})));
});

describe('quiet hours (Douala time)', () => {
    it.each([
        ['2026-10-01T20:59:00Z', false], // 21:59
        ['2026-10-01T21:00:00Z', true],  // 22:00
        ['2026-10-02T05:59:00Z', true],  // 06:59
        ['2026-10-02T06:00:00Z', false], // 07:00
    ])('%s is quiet: %s', (iso, quiet) => expect(inQuietHours(at(iso))).toBe(quiet));

    it('ends at the next 07:00 there, whether before or after midnight', () => {
        expect(endOfQuietHours(NIGHT).toISOString()).toBe('2026-10-02T06:00:00.000Z');
        expect(endOfQuietHours(at('2026-10-02T02:00:00Z')).toISOString()).toBe('2026-10-02T06:00:00.000Z');
    });
});

describe('sending', () => {
    it('sends right away in the day', async () => {
        await device();
        expect(await sendPushToUser(userId, { title: 'T', body: 'B' }, { category: 'filleuls', now: DAY })).toBe('sent');
        expect(sendNotification).toHaveBeenCalledTimes(1);
    });

    it('holds a non-urgent push through the night and sends it at 07:00', async () => {
        await device();
        expect(await sendPushToUser(userId, { title: 'Nouveau filleul', body: 'Paul' }, { category: 'filleuls', now: NIGHT })).toBe('deferred');
        expect(sendNotification).not.toHaveBeenCalled();

        expect(await flushDuePushes(at('2026-10-02T05:00:00Z'))).toBe(0);
        expect(await flushDuePushes(at('2026-10-02T06:00:00Z'))).toBe(1);
        expect(JSON.parse(sendNotification.mock.calls[0][1]).title).toBe('Nouveau filleul');
        expect(await PendingPushModel.countDocuments()).toBe(0);
    });

    it('keeps one push per topic overnight — the latest', async () => {
        await device();
        for (const n of [1, 2, 3]) {
            await sendPushToUser(userId, { title: `Jour ${n}`, body: 'b', tag: 'ads-day' }, { category: 'ads', now: NIGHT });
        }
        await flushDuePushes(at('2026-10-02T06:00:00Z'));
        expect(sendNotification).toHaveBeenCalledTimes(1);
        expect(JSON.parse(sendNotification.mock.calls[0][1]).title).toBe('Jour 3');
    });

    it.each(['money', 'chat'] as const)('sends %s at night too, flagged high urgency', async (category) => {
        await device();
        expect(await sendPushToUser(userId, { title: 'T', body: 'B' }, { category, now: NIGHT })).toBe('sent');
        expect(sendNotification.mock.calls[0][2]).toEqual(expect.objectContaining({ urgency: 'high' }));
    });

    it('sends nothing of a kind the user turned off — even one already waiting for morning', async () => {
        await device();
        await sendPushToUser(userId, { title: 'T', body: 'B' }, { category: 'tombola', now: NIGHT });
        await PushPreferenceModel.create({ userId, disabled: ['tombola'] });

        expect(await sendPushToUser(userId, { title: 'T', body: 'B' }, { category: 'tombola', now: DAY })).toBe('disabled');
        await flushDuePushes(at('2026-10-02T06:00:00Z'));
        expect(sendNotification).not.toHaveBeenCalled();
    });

    it('does not queue anything for someone without a device', async () => {
        expect(await sendPushToUser(userId, { title: 'T', body: 'B' }, { category: 'events', now: NIGHT })).toBe('no_device');
        expect(await PendingPushModel.countDocuments()).toBe(0);
    });
});

describe('the list and the phone stay in step', () => {
    it('gives the push the same tag as its list entry, so clearing one can close the other', async () => {
        await device();
        await sendPushToUser(userId, { title: 'T', body: 'B' }, { category: 'money', now: DAY });
        const entry = await InboxItemModel.findOne({ userId }).lean();
        const pushed = JSON.parse(sendNotification.mock.calls[0][1]);
        expect(entry!.tag).toBe(`n-${entry!._id}`);
        expect(pushed.tag).toBe(entry!.tag);
    });

    it('keeps a tag the sender chose, on both', async () => {
        await device();
        await sendPushToUser(userId, { title: 'T', body: 'B', tag: 'withdrawal-42' }, { category: 'money', now: DAY });
        expect((await InboxItemModel.findOne({ userId }).lean())!.tag).toBe('withdrawal-42');
        expect(JSON.parse(sendNotification.mock.calls[0][1]).tag).toBe('withdrawal-42');
    });
});

describe('the button on the notification', () => {
    it.each([
        ['money', 'Voir mon solde'],
        ['filleuls', 'Voir mes filleuls'],
        ['events', 'Voir mes billets'],
        ['subscription', 'Renouveler'],
        ['announcements', 'Découvrir'],
    ] as const)('a %s push gets "%s" when the sender names no button', async (category, cta) => {
        await device();
        await sendPushToUser(userId, { title: 'T', body: 'B' }, { category, now: DAY });
        expect(JSON.parse(sendNotification.mock.calls[0][1]).cta).toBe(cta);
    });

    it('keeps the button the sender chose, through the night too', async () => {
        await device();
        await sendPushToUser(userId, { title: 'T', body: 'B', cta: 'Recharger' }, { category: 'relance', now: NIGHT });
        await flushDuePushes(at('2026-10-02T06:00:00Z'));
        expect(JSON.parse(sendNotification.mock.calls[0][1]).cta).toBe('Recharger');
    });

    it('lets another service name the button, kept short', async () => {
        await device();
        await call('POST', '/api/notifications/push/internal/send', {
            auth: config.services.serviceSecret,
            body: { userId, category: 'ads', title: 'T', body: 'B', cta: 'Publier le jour 2 maintenant tout de suite svp' },
        });
        expect(JSON.parse(sendNotification.mock.calls[0][1]).cta).toBe('Publier le jour 2 maintenant t');
    });
});

describe('the user\'s settings', () => {
    it('lists every kind, all on by default, and remembers what is turned off', async () => {
        const before = await call('GET', '/api/notifications/push/preferences', { auth: tokenFor(userId) });
        expect(before.json.data.categories.every((c: any) => c.enabled)).toBe(true);
        expect(before.json.data.categories.map((c: any) => c.key)).toEqual(expect.arrayContaining(['money', 'chat', 'ads', 'announcements']));

        await call('PUT', '/api/notifications/push/preferences', { auth: tokenFor(userId), body: { disabled: ['chat', 'not-a-kind'] } });
        const after = await call('GET', '/api/notifications/push/preferences', { auth: tokenFor(userId) });
        expect(after.json.data.categories.filter((c: any) => !c.enabled).map((c: any) => c.key)).toEqual(['chat']);
    });
});

describe('other services sending', () => {
    it('sends to each user given and reports what happened', async () => {
        const other = new mongoose.Types.ObjectId().toString();
        await device();
        const r = await call('POST', '/api/notifications/push/internal/send', {
            auth: config.services.serviceSecret,
            body: { userIds: [userId, other], category: 'money', title: '+1 000 FCFA', body: 'Commission', url: '/wallet' },
        });
        expect(r.status).toBe(200);
        expect(r.json.data).toEqual({ sent: 1, no_device: 1 });
    });

    it('refuses an unknown kind, a missing text, or a caller without the service secret', async () => {
        const body = { userId, category: 'money', title: 'T', body: 'B' };
        expect((await call('POST', '/api/notifications/push/internal/send', { auth: config.services.serviceSecret, body: { ...body, category: 'spam' } })).status).toBe(400);
        expect((await call('POST', '/api/notifications/push/internal/send', { auth: config.services.serviceSecret, body: { ...body, title: ' ' } })).status).toBe(400);
        expect((await call('POST', '/api/notifications/push/internal/send', { auth: tokenFor(userId), body })).status).toBeGreaterThanOrEqual(401);
    });

    it('passes a sender photo and the re-buzz flag through to the phone', async () => {
        await device();
        await call('POST', '/api/notifications/push/internal/send', {
            auth: config.services.serviceSecret,
            body: { userId, category: 'chat', title: 'Paul', body: 'Salut', tag: 'chat-1', renotify: true, icon: '/api/settings/files/abc?w=128' },
        });
        expect(JSON.parse(sendNotification.mock.calls[0][1])).toEqual(expect.objectContaining({ icon: '/api/settings/files/abc?w=128', renotify: true, tag: 'chat-1' }));
    });
});

describe('admin announcements', () => {
    const admin = new mongoose.Types.ObjectId().toString();
    const announce = () => call('POST', '/api/notifications/push/admin/announce', {
        auth: tokenFor(admin, 'admin'), body: { title: 'Nouveau', body: 'Une formation arrive', url: '/formations' },
    });

    it('reaches everyone with a device', async () => {
        await device();
        await device(new mongoose.Types.ObjectId().toString());
        const r = await announce();
        expect(r.status).toBe(202);
        expect(r.json.data.recipients).toBe(2);
    });

    it('stops at three a week', async () => {
        for (let i = 0; i < 3; i++) expect((await announce()).status).toBe(202);
        expect((await announce()).status).toBe(429);
    });

    it('is for admins only', async () => {
        const r = await call('POST', '/api/notifications/push/admin/announce', { auth: tokenFor(userId), body: { title: 'x', body: 'y' } });
        expect(r.status).toBe(403);
    });
});
