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
const filterForAnnouncement = jest.fn();
jest.mock('../services/clients/user.service.client', () => ({
    userServiceClient: { filterForAnnouncement: (...a: unknown[]) => filterForAnnouncement(...a) },
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

    // Sterling, 2026-10-03: holding pushes for the morning is only worth it for
    // announcements. A personal one is about something that just happened, and
    // some go stale held (an event reminder "dans moins d'une heure" at 07:00).
    it.each(['money', 'chat', 'filleuls', 'relance', 'events', 'tombola', 'ads', 'subscription'] as const)(
        'sends a %s push at night too, at once and flagged high urgency', async (category) => {
            await device();
            expect(await sendPushToUser(userId, { title: 'T', body: 'B' }, { category, now: NIGHT })).toBe('sent');
            expect(sendNotification.mock.calls[0][2]).toEqual(expect.objectContaining({ urgency: 'high' }));
        });

    it('holds an announcement through the night and sends it at 07:00', async () => {
        await device();
        expect(await sendPushToUser(userId, { title: 'Nouvelle formation', body: 'b' }, { category: 'announcements', now: NIGHT })).toBe('deferred');
        expect(sendNotification).not.toHaveBeenCalled();

        expect(await flushDuePushes(at('2026-10-02T05:00:00Z'))).toBe(0);
        expect(await flushDuePushes(at('2026-10-02T06:00:00Z'))).toBe(1);
        expect(JSON.parse(sendNotification.mock.calls[0][1]).title).toBe('Nouvelle formation');
        expect(await PendingPushModel.countDocuments()).toBe(0);
    });

    it('sends an announcement at night when the admin chose to send it now', async () => {
        await device();
        expect(await sendPushToUser(userId, { title: 'Urgent', body: 'b' }, { category: 'announcements', now: NIGHT, sendNow: true })).toBe('sent');
        expect(sendNotification.mock.calls[0][2]).toEqual(expect.objectContaining({ urgency: 'high' }));
    });

    it('keeps one push per topic overnight — the latest', async () => {
        await device();
        for (const n of [1, 2, 3]) {
            await sendPushToUser(userId, { title: `Annonce ${n}`, body: 'b', tag: 'same-topic' }, { category: 'announcements', now: NIGHT });
        }
        await flushDuePushes(at('2026-10-02T06:00:00Z'));
        expect(sendNotification).toHaveBeenCalledTimes(1);
        expect(JSON.parse(sendNotification.mock.calls[0][1]).title).toBe('Annonce 3');
    });

    it('sends nothing of a kind the user turned off — even one already waiting for morning', async () => {
        await device();
        await sendPushToUser(userId, { title: 'T', body: 'B' }, { category: 'announcements', now: NIGHT });
        await PushPreferenceModel.create({ userId, disabled: ['announcements'] });

        expect(await sendPushToUser(userId, { title: 'T', body: 'B' }, { category: 'announcements', now: DAY })).toBe('disabled');
        await flushDuePushes(at('2026-10-02T06:00:00Z'));
        expect(sendNotification).not.toHaveBeenCalled();
    });

    it('does not queue anything for someone without a device', async () => {
        expect(await sendPushToUser(userId, { title: 'T', body: 'B' }, { category: 'announcements', now: NIGHT })).toBe('no_device');
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
        await sendPushToUser(userId, { title: 'T', body: 'B', cta: 'Lire' }, { category: 'announcements', now: NIGHT });
        await flushDuePushes(at('2026-10-02T06:00:00Z'));
        expect(JSON.parse(sendNotification.mock.calls[0][1]).cta).toBe('Lire');
    });

    it('lets another service name the button, kept short', async () => {
        await device();
        await call('POST', '/api/notifications/push/internal/send', {
            auth: config.services.serviceSecret,
            // Urgent kind, so the result does not depend on the hour the test runs.
            body: { userId, category: 'money', title: 'T', body: 'B', cta: 'Publier le jour 2 maintenant tout de suite svp' },
        });
        expect(JSON.parse(sendNotification.mock.calls[0][1]).cta).toBe('Publier le jour 2 maintenant t');
    });
});

describe('the WhatsApp button (new filleul)', () => {
    const wa = 'https://wa.me/237675123456?text=Bonjour%20Paul';

    it('reaches the phone and the list, through the night too', async () => {
        await device();
        await call('POST', '/api/notifications/push/internal/send', {
            auth: config.services.serviceSecret,
            body: { userId, category: 'filleuls', title: 'Nouveau filleul', body: 'Paul vient de s\'inscrire.', url: '/filleuls', whatsapp: wa },
        });
        expect((await InboxItemModel.findOne({ userId }).lean())!.whatsapp).toBe(wa);
        await flushDuePushes(at('2099-01-01T06:00:00Z'));
        expect(JSON.parse(sendNotification.mock.calls[0][1]).whatsapp).toBe(wa);
    });

    it.each([
        ['another site', 'https://evil.example/237675123456'],
        ['a script', 'javascript:alert(1)'],
        ['wa.me without a number', 'https://wa.me/?text=hi'],
    ])('is dropped when the link is %s', async (_label, link) => {
        await device();
        await call('POST', '/api/notifications/push/internal/send', {
            auth: config.services.serviceSecret,
            body: { userId, category: 'money', title: 'T', body: 'B', whatsapp: link },
        });
        expect((await InboxItemModel.findOne({ userId }).lean())!.whatsapp).toBeUndefined();
        expect(JSON.parse(sendNotification.mock.calls[0][1]).whatsapp).toBeUndefined();
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
    const post = (path: string, body: unknown) => call('POST', `/api/notifications/push${path}`, { auth: tokenFor(admin, 'admin'), body });
    const announce = (extra: Record<string, unknown> = {}) =>
        post('/admin/announce', { title: 'Nouveau', body: 'Une formation arrive', url: '/formations', ...extra });
    const nightClock = () => jest.useFakeTimers({
        now: NIGHT,
        doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'hrtime', 'performance'],
    });
    const settle = async (n: number, model: any = PendingPushModel) => {
        for (let i = 0; i < 100 && (await model.countDocuments()) < n; i++) await new Promise(r => setTimeout(r, 50));
    };
    beforeEach(() => filterForAnnouncement.mockReset());

    it('reaches everyone with a device when no filter is set', async () => {
        await device();
        await device(new mongoose.Types.ObjectId().toString());
        const r = await announce();
        expect(r.status).toBe(202);
        expect(r.json.data.recipients).toBe(2);
        expect(filterForAnnouncement).not.toHaveBeenCalled();
    });

    it('reaches only the members the filter picks', async () => {
        const cameroonian = new mongoose.Types.ObjectId().toString();
        await device();
        await device(cameroonian);
        filterForAnnouncement.mockResolvedValue([cameroonian]);
        const r = await announce({ filter: { countries: ['cm'], subscription: 'unsubscribed', sex: 'female', junk: 1 } });
        expect(r.json.data.recipients).toBe(1);
        expect(filterForAnnouncement.mock.calls[0][1]).toEqual({ countries: ['CM'], subscription: 'unsubscribed', sex: 'female' });
        expect((await PushAnnouncementModel.findOne().lean())!.toAll).toBe(false);
    });

    it('counts who a filter reaches while the admin sets it', async () => {
        await device();
        filterForAnnouncement.mockResolvedValue([]);
        expect((await post('/admin/audience', { filter: { countries: ['SN'] } })).json.data.count).toBe(0);
        expect((await post('/admin/audience', {})).json.data.count).toBe(1);
    });

    it('allows one announcement to everyone a day, and any number of targeted ones', async () => {
        await device();
        filterForAnnouncement.mockResolvedValue([userId]);
        expect((await announce()).status).toBe(202);
        expect((await announce()).status).toBe(429);
        for (let i = 0; i < 3; i++) expect((await announce({ filter: { countries: ['CM'] } })).status).toBe(202);
    });

    it('refuses rather than guesses when the filter cannot be resolved', async () => {
        await device();
        filterForAnnouncement.mockResolvedValue(null);
        expect((await announce({ filter: { countries: ['CM'] } })).status).toBe(503);
        expect(await PushAnnouncementModel.countDocuments()).toBe(0);
    });

    // Preprod 2026-10-03: two announcements sent at 22:32 and 22:33 Douala
    // shared one tag, so the night queue kept only the second.
    it('keeps every announcement sent at night, and says when phones will get it', async () => {
        nightClock();
        try {
            await device();
            filterForAnnouncement.mockResolvedValue([userId]);
            const first = await announce({ title: 'Annonce A', filter: { countries: ['CM'] } });
            await announce({ title: 'Annonce B', filter: { countries: ['CM'] } });
            expect(first.json.data.heldUntil).toBe('2026-10-02T06:00:00.000Z');
            await settle(2);
            expect((await PendingPushModel.find().lean()).map(p => (p.message as any).title).sort()).toEqual(['Annonce A', 'Annonce B']);
        } finally {
            jest.useRealTimers();
        }
    });

    it('sends at once at night when the admin chose "send now"', async () => {
        nightClock();
        try {
            await device();
            const r = await announce({ sendNow: true });
            expect(r.json.data.heldUntil).toBeNull();
            for (let i = 0; i < 100 && sendNotification.mock.calls.length < 1; i++) await new Promise(res => setTimeout(res, 50));
            expect(sendNotification).toHaveBeenCalledTimes(1);
            expect(await PendingPushModel.countDocuments()).toBe(0);
        } finally {
            jest.useRealTimers();
        }
    });

    it('is for admins only', async () => {
        const r = await call('POST', '/api/notifications/push/admin/announce', { auth: tokenFor(userId), body: { title: 'x', body: 'y' } });
        expect(r.status).toBe(403);
    });
});
