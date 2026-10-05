/**
 * The bell: every notification lands in the member's in-app list (chat
 * excepted), with an unread count, and can be read or cleared.
 *
 * Needs MongoDB at TEST_MONGODB_URI (default mongodb://127.0.0.1:27017).
 */
jest.mock('web-push', () => ({ __esModule: true, default: { setVapidDetails: jest.fn(), sendNotification: jest.fn() } }));

import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import config from '../config';
import inboxRoutes from '../api/routes/inbox.routes';
import InboxItemModel from '../database/models/inbox-item.model';
import { sendPushToUser } from '../services/push.service';

const MONGO = (process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017') + '/sbc_notifications_inbox_test';
const me = new mongoose.Types.ObjectId().toString();
const other = new mongoose.Types.ObjectId().toString();
const tokenFor = (id: string) => jwt.sign({ userId: id, id, email: 'u@x.com', role: 'user' }, config.jwt.secret, { expiresIn: '1h' });

let server: http.Server;
let base: string;
const call = async (method: string, path: string, body?: unknown, who = me) => {
    const res = await fetch(`${base}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenFor(who)}` },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
};
const notify = (title: string, category: any = 'money', userId = me) =>
    sendPushToUser(userId, { title, body: `${title} body`, url: '/wallet' }, { category });

beforeAll(async () => {
    await mongoose.connect(MONGO, { serverSelectionTimeoutMS: 3000 });
    await mongoose.connection.dropDatabase();
    const app = express();
    app.use(express.json());
    app.use('/api/notifications/inbox', inboxRoutes);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
    server?.close();
    await mongoose.connection.dropDatabase().catch(() => undefined);
    await mongoose.disconnect();
});
beforeEach(() => InboxItemModel.deleteMany({}));

describe('what lands in the list', () => {
    it('keeps every notification, newest first, even for someone with no phone set up', async () => {
        await notify('+1 000 FCFA');
        await notify('Nouveau filleul', 'filleuls');
        const r = await call('GET', '/api/notifications/inbox');
        expect(r.json.data.items.map((i: any) => i.title)).toEqual(['Nouveau filleul', '+1 000 FCFA']);
        expect(r.json.data.items[0]).toEqual(expect.objectContaining({ category: 'filleuls', url: '/wallet', body: 'Nouveau filleul body' }));
        expect(r.json.data.unread).toBe(2);
    });

    it('hands the app the WhatsApp link of a new filleul', async () => {
        const wa = 'https://wa.me/237675123456?text=Bonjour';
        await InboxItemModel.create({ userId: me, category: 'filleuls', title: 'Nouveau filleul', body: 'b', whatsapp: wa });
        expect((await call('GET', '/api/notifications/inbox')).json.data.items[0].whatsapp).toBe(wa);
    });

    it('leaves chat out — conversations have their own unread counts', async () => {
        await notify('Paul', 'chat');
        expect((await call('GET', '/api/notifications/inbox/unread-count')).json.data.unread).toBe(0);
    });

    it('shows a member only their own notifications', async () => {
        await notify('Pour quelqu\'un d\'autre', 'money', other);
        expect((await call('GET', '/api/notifications/inbox')).json.data.items).toEqual([]);
    });

    it('pages through older notifications', async () => {
        for (let i = 0; i < 3; i++) await InboxItemModel.create({ userId: me, category: 'money', title: `N${i}`, body: 'b', createdAt: new Date(Date.UTC(2026, 9, 1, i)) });
        const first = await call('GET', '/api/notifications/inbox?limit=2');
        expect(first.json.data.items.map((i: any) => i.title)).toEqual(['N2', 'N1']);
        expect(first.json.data.hasMore).toBe(true);
        const next = await call('GET', `/api/notifications/inbox?limit=2&before=${first.json.data.items[1].createdAt}`);
        expect(next.json.data.items.map((i: any) => i.title)).toEqual(['N0']);
    });
});

describe('reading and clearing', () => {
    it('marks some or all as read, and the count follows', async () => {
        await notify('A'); await notify('B'); await notify('C');
        const items = (await call('GET', '/api/notifications/inbox')).json.data.items;
        expect((await call('POST', '/api/notifications/inbox/read', { ids: [items[0]._id] })).json.data.unread).toBe(2);
        expect((await call('POST', '/api/notifications/inbox/read', { all: true })).json.data.unread).toBe(0);
    });

    it('cannot mark someone else\'s as read', async () => {
        await notify('Pas à toi', 'money', other);
        const theirs = await InboxItemModel.findOne({ userId: other });
        await call('POST', '/api/notifications/inbox/read', { ids: [String(theirs!._id)] });
        expect((await InboxItemModel.findById(theirs!._id))!.readAt).toBeUndefined();
    });

    it('removes one, or clears everything — and only the member\'s own', async () => {
        await notify('A'); await notify('B'); await notify('Autre', 'money', other);
        const [first] = (await call('GET', '/api/notifications/inbox')).json.data.items;
        await call('DELETE', `/api/notifications/inbox/${first._id}`);
        expect((await call('GET', '/api/notifications/inbox')).json.data.items.map((i: any) => i.title)).toEqual(['A']);
        await call('DELETE', '/api/notifications/inbox');
        expect((await call('GET', '/api/notifications/inbox')).json.data.items).toEqual([]);
        expect(await InboxItemModel.countDocuments({ userId: other })).toBe(1);
    });

    it('needs a signed-in member', async () => {
        const res = await fetch(`${base}/api/notifications/inbox`);
        expect(res.status).toBe(401);
    });
});
