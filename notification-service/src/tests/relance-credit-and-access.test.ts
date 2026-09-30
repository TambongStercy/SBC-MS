/**
 * Relance pack crediting and route access.
 *
 * Found on prod 2026-09-30:
 *  - 31 relance packs were paid for (May → September) and none was ever
 *    credited: the callback read userId from metadata, which the purchase never
 *    set, so every payment was refused with a 400.
 *  - That callback was reachable from the internet with no token, so anyone
 *    could have minted credits with `{status: 'SUCCEEDED', metadata: {userId}}`.
 *  - Every relance `/admin/*` route accepted any signed-in user: all targets
 *    (filleuls' contact details) were readable, and the email/SMS templates sent
 *    to them under SBC's name were rewritable.
 *
 * The route tests mount the real relance router and call it over HTTP, so they
 * exercise the middleware exactly as the gateway does. The crediting tests run
 * against a real Mongo so that "at most once" rests on the actual unique index,
 * not on a mock of it.
 *
 * Needs MongoDB at TEST_MONGODB_URI (default mongodb://127.0.0.1:27017). Uses
 * its own database and drops it.
 */
import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import config from '../config';
import relanceRoutes from '../api/routes/relance.routes';
import RelanceConfigModel from '../database/models/relance-config.model';
import RelancePackCreditModel from '../database/models/relance-pack-credit.model';
import { creditRelancePack } from '../services/relance-credit.service';

const MONGO = (process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017') + '/sbc_notifications_relance_credit_test';

const tokenFor = (role: string, userId = new mongoose.Types.ObjectId().toString()) =>
    jwt.sign({ userId, id: userId, email: `${role}@example.com`, role }, config.jwt.secret, { expiresIn: '1h' });

let server: http.Server;
let base: string;

const call = async (method: string, path: string, opts: { auth?: string; body?: unknown } = {}) => {
    const res = await fetch(`${base}${path}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(opts.auth ? { Authorization: `Bearer ${opts.auth}` } : {}),
        },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    let json: any = null;
    try { json = await res.json(); } catch { /* non-JSON */ }
    return { status: res.status, json };
};

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
    await RelanceConfigModel.deleteMany({});
    await RelancePackCreditModel.deleteMany({});
});

const balanceOf = async (userId: string) => {
    const cfg: any = await RelanceConfigModel.findOne({ userId }).lean();
    return { email: cfg?.emailBalance ?? 0, sms: cfg?.smsBalance ?? 0 };
};

describe('crediting a paid pack', () => {
    it('credits the amount from the pack table, creating the config if needed', async () => {
        const userId = new mongoose.Types.ObjectId().toString();
        const r = await creditRelancePack({ sessionId: 'S1', userId, packId: 'email_3k' });
        expect(r).toMatchObject({ outcome: 'credited', credits: 3000, packType: 'email' });
        expect(await balanceOf(userId)).toEqual({ email: 3000, sms: 0 });
    });

    it('adds to an existing balance rather than replacing it', async () => {
        const userId = new mongoose.Types.ObjectId().toString();
        await creditRelancePack({ sessionId: 'A', userId, packId: 'email_3k' });
        await creditRelancePack({ sessionId: 'B', userId, packId: 'email_7k' });
        await creditRelancePack({ sessionId: 'C', userId, packId: 'sms_250' });
        expect(await balanceOf(userId)).toEqual({ email: 10000, sms: 250 });
    });

    it('credits the same payment only once when the callback is delivered again', async () => {
        const userId = new mongoose.Types.ObjectId().toString();
        await creditRelancePack({ sessionId: 'DUP', userId, packId: 'email_3k' });
        const again = await creditRelancePack({ sessionId: 'DUP', userId, packId: 'email_3k' });
        expect(again.outcome).toBe('already_credited');
        expect(await balanceOf(userId)).toEqual({ email: 3000, sms: 0 });
    });

    it('credits once even when five deliveries land together', async () => {
        const userId = new mongoose.Types.ObjectId().toString();
        const results = await Promise.all(
            Array.from({ length: 5 }, () => creditRelancePack({ sessionId: 'RACE', userId, packId: 'email_3k' })),
        );
        expect(results.filter(r => r.outcome === 'credited')).toHaveLength(1);
        expect(await balanceOf(userId)).toEqual({ email: 3000, sms: 0 });
    });

    it('refuses an unknown pack and moves no balance', async () => {
        const userId = new mongoose.Types.ObjectId().toString();
        const r = await creditRelancePack({ sessionId: 'X', userId, packId: 'email_1m_free' });
        expect(r.outcome).toBe('rejected');
        expect(await balanceOf(userId)).toEqual({ email: 0, sms: 0 });
        expect(await RelancePackCreditModel.countDocuments()).toBe(0);
    });

    it('refuses a missing or malformed userId', async () => {
        expect((await creditRelancePack({ sessionId: 'Y', packId: 'email_3k' })).outcome).toBe('rejected');
        expect((await creditRelancePack({ sessionId: 'Z', userId: 'not-an-id', packId: 'email_3k' })).outcome).toBe('rejected');
    });
});

describe('POST /api/relance/internal/credit-pack', () => {
    const paid = (userId: string, sessionId = 'CB1', where: 'top' | 'metadata' = 'top') => ({
        sessionId,
        status: 'SUCCEEDED',
        ...(where === 'top' ? { userId } : {}),
        metadata: { packId: 'email_3k', packType: 'email', credits: 3000, ...(where === 'metadata' ? { userId } : {}) },
    });

    it('rejects a caller with no token — this is what was open to the internet', async () => {
        const userId = new mongoose.Types.ObjectId().toString();
        const r = await call('POST', '/api/relance/internal/credit-pack', { body: paid(userId) });
        expect(r.status).toBe(401);
        expect(await balanceOf(userId)).toEqual({ email: 0, sms: 0 });
    });

    it('rejects a signed-in user, even an admin — only services may credit', async () => {
        const userId = new mongoose.Types.ObjectId().toString();
        const r = await call('POST', '/api/relance/internal/credit-pack', { auth: tokenFor('admin'), body: paid(userId) });
        expect(r.status).toBe(403);
        expect(await balanceOf(userId)).toEqual({ email: 0, sms: 0 });
    });

    it('credits when payment-service calls with the service secret', async () => {
        const userId = new mongoose.Types.ObjectId().toString();
        const r = await call('POST', '/api/relance/internal/credit-pack', { auth: config.services.serviceSecret, body: paid(userId) });
        expect(r.status).toBe(200);
        expect(await balanceOf(userId)).toEqual({ email: 3000, sms: 0 });
    });

    it('finds the buyer in metadata too — where new purchases put it', async () => {
        const userId = new mongoose.Types.ObjectId().toString();
        const r = await call('POST', '/api/relance/internal/credit-pack', {
            auth: config.services.serviceSecret, body: paid(userId, 'CB-META', 'metadata'),
        });
        expect(r.status).toBe(200);
        expect(await balanceOf(userId)).toEqual({ email: 3000, sms: 0 });
    });

    it('ignores an inflated credit count in the body and uses the pack table', async () => {
        const userId = new mongoose.Types.ObjectId().toString();
        const body = paid(userId, 'CB-INFLATE');
        body.metadata.credits = 9_999_999;
        await call('POST', '/api/relance/internal/credit-pack', { auth: config.services.serviceSecret, body });
        expect(await balanceOf(userId)).toEqual({ email: 3000, sms: 0 });
    });

    it('does nothing for a payment that did not succeed', async () => {
        const userId = new mongoose.Types.ObjectId().toString();
        const r = await call('POST', '/api/relance/internal/credit-pack', {
            auth: config.services.serviceSecret, body: { ...paid(userId, 'CB-FAIL'), status: 'FAILED' },
        });
        expect(r.status).toBe(200);
        expect(await balanceOf(userId)).toEqual({ email: 0, sms: 0 });
    });
});

describe('relance admin routes', () => {
    // A representative spread: reading everyone's filleuls, rewriting what they
    // are sent, and acting on someone else's campaign.
    // Every row carries all three values, `undefined` included: a shorter row makes
    // Jest pass a `done` callback in the missing slot and wait for it until timeout.
    const adminRoutes: Array<[string, string, unknown]> = [
        ['GET', '/api/relance/admin/targets', undefined],
        ['GET', '/api/relance/admin/configs', undefined],
        ['POST', '/api/relance/admin/messages', { dayNumber: 1, subject: 'x', messageTemplate: { fr: 'x' } }],
        ['PUT', '/api/relance/admin/sms-templates/auto/1', { templateText: 'x {{link}}' }],
        ['POST', `/api/relance/admin/campaigns/${new mongoose.Types.ObjectId()}/cancel`, undefined],
    ];

    it.each(adminRoutes)('%s %s refuses an ordinary signed-in user', async (method, path, body) => {
        const r = await call(method, path, { auth: tokenFor('user'), body });
        expect(r.status).toBe(403);
    });

    it.each(adminRoutes)('%s %s refuses anonymous callers', async (method, path, body) => {
        const r = await call(method, path, { body });
        expect(r.status).toBe(401);
    });

    it('lets an admin through (lowercase role, as our tokens carry it)', async () => {
        const r = await call('GET', '/api/relance/admin/configs', { auth: tokenFor('admin') });
        expect(r.status).not.toBe(401);
        expect(r.status).not.toBe(403);
    });

    it('lets an admin update a config — the old inline check turned admins away', async () => {
        const userId = new mongoose.Types.ObjectId().toString();
        await RelanceConfigModel.create({ userId });
        const r = await call('PUT', `/api/relance/admin/configs/${userId}`, { auth: tokenFor('admin'), body: { sendingPaused: true } });
        expect(r.status).toBe(200);
    });

    it('does not let an admin set balances through the config route', async () => {
        const userId = new mongoose.Types.ObjectId().toString();
        await RelanceConfigModel.create({ userId });
        await call('PUT', `/api/relance/admin/configs/${userId}`, { auth: tokenFor('admin'), body: { emailBalance: 1_000_000 } });
        expect(await balanceOf(userId)).toEqual({ email: 0, sms: 0 });
    });
});

describe('POST /api/relance/internal/exit-user', () => {
    it('refuses anonymous callers', async () => {
        expect((await call('POST', '/api/relance/internal/exit-user', { body: { userId: 'x' } })).status).toBe(401);
    });

    it('refuses an ordinary user', async () => {
        expect((await call('POST', '/api/relance/internal/exit-user', { auth: tokenFor('user'), body: { userId: 'x' } })).status).toBe(403);
    });

    it.each([
        ['user-service, with the service secret', () => config.services.serviceSecret],
        ['the admin panel, with an admin login', () => tokenFor('admin')],
    ])('still accepts %s', async (_who, auth) => {
        const r = await call('POST', '/api/relance/internal/exit-user', { auth: auth(), body: { userId: new mongoose.Types.ObjectId().toString() } });
        expect([401, 403]).not.toContain(r.status);
    });
});
