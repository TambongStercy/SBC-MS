/**
 * Web push: subscribing a phone's browser, and sending to it.
 *
 * Relance used to tell a parrain about credits running out only by email,
 * through a mail server that is often slow, so relance could stop without
 * them noticing. Push reaches the phone directly.
 *
 * web-push (the network side) is mocked; subscriptions live in a real Mongo.
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
import { sendPushToUser } from '../services/push.service';

const MONGO = (process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017') + '/sbc_notifications_push_test';
const userId = new mongoose.Types.ObjectId().toString();
const token = jwt.sign({ userId, id: userId, email: 'p@x.com', role: 'user' }, config.jwt.secret, { expiresIn: '1h' });
const sub = (n: number) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`, keys: { p256dh: `p${n}`, auth: `a${n}` } });

let server: http.Server;
let base: string;
const call = async (method: string, path: string, body?: unknown, auth = true) => {
    const res = await fetch(`${base}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
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
    await PushSubscriptionModel.deleteMany({});
});

describe('subscribing a device', () => {
    it('hands the app the public key it subscribes with', async () => {
        const r = await call('GET', '/api/notifications/push/public-key', undefined, false);
        expect(r.json.data.publicKey).toBe('PUBLIC_KEY');
    });

    it('saves a device once, even when it subscribes again', async () => {
        expect((await call('POST', '/api/notifications/push/subscribe', { subscription: sub(1) })).status).toBe(200);
        expect((await call('POST', '/api/notifications/push/subscribe', { subscription: sub(1) })).status).toBe(200);
        expect(await PushSubscriptionModel.countDocuments({ userId })).toBe(1);
    });

    it('refuses a subscription that is not one', async () => {
        const bad = await call('POST', '/api/notifications/push/subscribe', { subscription: { endpoint: 'http://evil.example/x', keys: { p256dh: 'p', auth: 'a' } } });
        expect(bad.status).toBe(400);
        expect(await PushSubscriptionModel.countDocuments()).toBe(0);
    });

    it('needs a signed-in user', async () => {
        expect((await call('POST', '/api/notifications/push/subscribe', { subscription: sub(1) }, false)).status).toBe(401);
    });

    it('forgets a device the user turns off', async () => {
        await call('POST', '/api/notifications/push/subscribe', { subscription: sub(1) });
        await call('POST', '/api/notifications/push/unsubscribe', { endpoint: sub(1).endpoint });
        expect(await PushSubscriptionModel.countDocuments()).toBe(0);
    });
});

describe('sending', () => {
    it('reaches every device the user enabled', async () => {
        await call('POST', '/api/notifications/push/subscribe', { subscription: sub(1) });
        await call('POST', '/api/notifications/push/subscribe', { subscription: sub(2) });

        expect(await sendPushToUser(userId, { title: 'T', body: 'B', url: '/relance' }, { category: 'money' })).toBe('sent');
        expect(sendNotification).toHaveBeenCalledTimes(2);
        const [target, payload] = sendNotification.mock.calls[0];
        expect(target.keys).toEqual(expect.objectContaining({ p256dh: expect.any(String) }));
        // The kind's button comes along when the sender names none.
        expect(JSON.parse(payload)).toEqual({ title: 'T', body: 'B', url: '/relance', cta: 'Voir mon solde', tag: expect.stringMatching(/^n-/) });
    });

    it('forgets a device the push service says is gone, and keeps the others', async () => {
        await call('POST', '/api/notifications/push/subscribe', { subscription: sub(1) });
        await call('POST', '/api/notifications/push/subscribe', { subscription: sub(2) });
        sendNotification.mockImplementation(async (s: { endpoint: string }) => {
            if (s.endpoint.endsWith('device-1')) throw Object.assign(new Error('gone'), { statusCode: 410 });
            return { statusCode: 201 };
        });

        await sendPushToUser(userId, { title: 'T', body: 'B' }, { category: 'money' });
        expect((await PushSubscriptionModel.find().lean()).map(s => s.endpoint)).toEqual([sub(2).endpoint]);
    });

    it('keeps a device after a passing error', async () => {
        await call('POST', '/api/notifications/push/subscribe', { subscription: sub(1) });
        sendNotification.mockRejectedValue(Object.assign(new Error('busy'), { statusCode: 503 }));
        await sendPushToUser(userId, { title: 'T', body: 'B' }, { category: 'money' });
        expect(await PushSubscriptionModel.countDocuments()).toBe(1);
    });

    it('does nothing for a user without a device', async () => {
        expect(await sendPushToUser(new mongoose.Types.ObjectId().toString(), { title: 'T', body: 'B' }, { category: 'money' })).toBe('no_device');
        expect(sendNotification).not.toHaveBeenCalled();
    });
});
