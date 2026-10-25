/**
 * Relance packs bought with the SBC balance (Rufus, 2026-10-20: « ça marche
 * seulement avec les campagnes, pas encore avec la relance »).
 *
 * payment-service is replaced by a fake wallet with the same rules as the real
 * one: a debit only if the balance covers it, one debit per reference, a refund
 * at most once per reference and only of what that reference took. Mongo is
 * real, so "one purchase per tap" rests on the actual unique index.
 *
 * Needs MongoDB at TEST_MONGODB_URI (default mongodb://127.0.0.1:27017). Uses
 * its own database and drops it.
 */
const getRelanceDetails = jest.fn();
jest.mock('../services/clients/user.service.client', () => ({
    userServiceClient: { getRelanceDetails: (...a: unknown[]) => getRelanceDetails(...a) },
}));
const axiosPost = jest.fn();
jest.mock('axios', () => {
    const actual = jest.requireActual('axios');
    return { ...actual, __esModule: true, default: { ...actual.default, post: (...a: unknown[]) => axiosPost(...a) } };
});

import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import config from '../config';
import { findPack } from '../config/relance-packs';
import relanceRoutes from '../api/routes/relance.routes';
import RelanceConfigModel from '../database/models/relance-config.model';
import RelancePackCreditModel from '../database/models/relance-pack-credit.model';
import RelanceBalancePurchaseModel from '../database/models/relance-balance-purchase.model';
import { buyPackWithBalance, sweepInterruptedBalancePurchases } from '../services/relance-balance-purchase.service';

const MONGO = (process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017') + '/sbc_notifications_relance_balance_test';

// ---- fake payment-service wallet ------------------------------------------------
const wallet = new Map<string, number>();
const spends = new Map<string, { userId: string; amount: number }>();
const refunded = new Set<string>();
let spendFailure: 'before-debit' | 'after-debit' | null = null;
let refundFailures = 0;

const conflict = () => Object.assign(new Error('Request failed with status code 409'), {
    isAxiosError: true,
    response: { status: 409, data: { success: false, message: 'Solde SBC insuffisant.' } },
});

axiosPost.mockImplementation(async (url: string, body: any, opts: any) => {
    if (url.endsWith('/internal/balance-spend') || url.endsWith('/internal/balance-refund')) {
        expect(opts?.headers?.Authorization).toBe(`Bearer ${config.services.serviceSecret}`);
    }
    if (url.endsWith('/internal/balance-spend')) {
        if (spendFailure === 'before-debit') { spendFailure = null; throw new Error('connect ECONNREFUSED'); }
        if (spends.has(body.reference)) return { data: { success: true } };
        const balance = wallet.get(body.userId) ?? 0;
        if (balance < body.amount) throw conflict();
        wallet.set(body.userId, balance - body.amount);
        spends.set(body.reference, { userId: body.userId, amount: body.amount });
        if (spendFailure === 'after-debit') { spendFailure = null; throw new Error('socket hang up'); }
        return { data: { success: true } };
    }
    if (url.endsWith('/internal/balance-refund')) {
        if (refundFailures > 0) { refundFailures--; throw new Error('payment-service unavailable'); }
        const spent = spends.get(body.reference);
        if (spent && !refunded.has(body.reference)) {
            refunded.add(body.reference);
            wallet.set(spent.userId, (wallet.get(spent.userId) ?? 0) + spent.amount);
        }
        return { data: { success: true } };
    }
    if (url.endsWith('/payments/intents')) return { data: { data: { sessionId: 'MM-SESSION' } } };
    throw new Error(`unexpected POST ${url}`);
});

const calls = (suffix: string) => axiosPost.mock.calls.filter(([url]) => String(url).endsWith(suffix));

// ---- helpers ---------------------------------------------------------------------
const newUser = (balance: number) => {
    const userId = new mongoose.Types.ObjectId().toString();
    wallet.set(userId, balance);
    return userId;
};
const creditsOf = async (userId: string) => {
    const cfg: any = await RelanceConfigModel.findOne({ userId }).lean();
    return { email: cfg?.emailBalance ?? 0, sms: cfg?.smsBalance ?? 0 };
};
const statusOf = async (userId: string) =>
    (await RelanceBalancePurchaseModel.find({ userId }).lean()).map(p => p.status);
const email3k = findPack('email_3k')!; // 3,000 credits for 2,500 F

let server: http.Server;
let base: string;
const tokenFor = (userId: string) =>
    jwt.sign({ userId, id: userId, email: 'member@example.com', role: 'user' }, config.jwt.secret, { expiresIn: '1h' });
const call = async (path: string, userId: string, body: unknown) => {
    const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenFor(userId)}` },
        body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json().catch(() => null) as any };
};

beforeAll(async () => {
    try {
        await mongoose.connect(MONGO, { serverSelectionTimeoutMS: 3000 });
    } catch (err: any) {
        throw new Error(`These tests need MongoDB at ${MONGO} (set TEST_MONGODB_URI): ${err.message}`);
    }
    await mongoose.connection.dropDatabase();
    await RelancePackCreditModel.syncIndexes();
    await RelanceBalancePurchaseModel.syncIndexes();

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
    axiosPost.mockClear();
    getRelanceDetails.mockReset();
    wallet.clear(); spends.clear(); refunded.clear();
    spendFailure = null; refundFailures = 0;
    await RelanceConfigModel.deleteMany({});
    await RelancePackCreditModel.deleteMany({});
    await RelanceBalancePurchaseModel.deleteMany({});
});

// ---- tests -----------------------------------------------------------------------
describe('buying a pack with the SBC balance', () => {
    it('takes the full price from the balance and credits the pack at once', async () => {
        const userId = newUser(5000);
        const r = await buyPackWithBalance({ userId, pack: email3k });

        expect(r).toMatchObject({ outcome: 'credited', credits: 3000, packType: 'email', amount: 2500 });
        expect(wallet.get(userId)).toBe(2500);
        expect(await creditsOf(userId)).toEqual({ email: 3000, sms: 0 });
        expect(await statusOf(userId)).toEqual(['credited']);

        const [[, body]] = calls('/internal/balance-spend');
        expect(body).toMatchObject({ userId, amount: 2500 });
        expect(body.description).toMatch(/^Pack relance : 3.000 crédits email$/);
        expect(body.reference).toMatch(new RegExp(`^relance-pack:${userId}:`));
        // The wallet line and the credit row join on the same reference.
        expect(await RelancePackCreditModel.exists({ sessionId: body.reference })).toBeTruthy();
    });

    it('takes nothing and credits nothing when the balance does not cover the pack', async () => {
        const userId = newUser(1000);
        const r = await buyPackWithBalance({ userId, pack: email3k });

        expect(r).toEqual({ outcome: 'insufficient' });
        expect(wallet.get(userId)).toBe(1000);
        expect(await creditsOf(userId)).toEqual({ email: 0, sms: 0 });
        expect(await statusOf(userId)).toEqual(['insufficient']);
        expect(calls('/internal/balance-refund')).toHaveLength(0);
    });

    it('makes one purchase when the same tap arrives three times', async () => {
        const userId = newUser(10000);
        const results = await Promise.all(
            [1, 2, 3].map(() => buyPackWithBalance({ userId, pack: email3k, requestId: 'tap-0123456789' })),
        );

        expect(results.every(r => r.outcome === 'credited')).toBe(true);
        expect(calls('/internal/balance-spend')).toHaveLength(1);
        expect(wallet.get(userId)).toBe(7500);
        expect(await creditsOf(userId)).toEqual({ email: 3000, sms: 0 });
    });

    it('lets a member buy two packs on purpose', async () => {
        const userId = newUser(10000);
        await buyPackWithBalance({ userId, pack: email3k, requestId: 'first-12345678' });
        await buyPackWithBalance({ userId, pack: email3k, requestId: 'second-1234567' });

        expect(wallet.get(userId)).toBe(5000);
        expect(await creditsOf(userId)).toEqual({ email: 6000, sms: 0 });
    });

    it('refunds when payment-service debits but its answer is lost', async () => {
        const userId = newUser(5000);
        spendFailure = 'after-debit';
        const r = await buyPackWithBalance({ userId, pack: email3k });

        expect(r).toEqual({ outcome: 'failed', refunded: true });
        expect(wallet.get(userId)).toBe(5000);
        expect(await creditsOf(userId)).toEqual({ email: 0, sms: 0 });
        expect(await statusOf(userId)).toEqual(['refunded']);
    });

    it('refunds nothing extra when payment-service fails before debiting', async () => {
        const userId = newUser(5000);
        spendFailure = 'before-debit';
        const r = await buyPackWithBalance({ userId, pack: email3k });

        expect(r).toEqual({ outcome: 'failed', refunded: true });
        expect(wallet.get(userId)).toBe(5000); // not 7,500
        expect(await statusOf(userId)).toEqual(['refunded']);
    });

    it('refunds the payment when crediting the pack fails', async () => {
        const userId = newUser(5000);
        jest.spyOn(RelanceConfigModel, 'findOneAndUpdate').mockRejectedValueOnce(new Error('mongo blip'));
        const r = await buyPackWithBalance({ userId, pack: email3k });

        expect(r).toEqual({ outcome: 'failed', refunded: true });
        expect(wallet.get(userId)).toBe(5000);
        expect(await creditsOf(userId)).toEqual({ email: 0, sms: 0 });
        expect(await RelancePackCreditModel.countDocuments()).toBe(0);
    });
});

describe('purchases interrupted between the debit and the crediting', () => {
    const later = () => new Date(Date.now() + 11 * 60 * 1000);

    it('stays pending when the refund fails, and the sweep refunds it later', async () => {
        const userId = newUser(5000);
        jest.spyOn(RelanceConfigModel, 'findOneAndUpdate').mockRejectedValueOnce(new Error('mongo blip'));
        refundFailures = 1;
        const r = await buyPackWithBalance({ userId, pack: email3k });

        expect(r).toEqual({ outcome: 'failed', refunded: false });
        expect(wallet.get(userId)).toBe(2500);
        expect(await statusOf(userId)).toEqual(['pending']);

        expect(await sweepInterruptedBalancePurchases()).toBe(0); // too recent to touch
        expect(await sweepInterruptedBalancePurchases(later())).toBe(1);
        expect(wallet.get(userId)).toBe(5000);
        expect(await statusOf(userId)).toEqual(['refunded']);

        await sweepInterruptedBalancePurchases(later()); // a second pass changes nothing
        expect(wallet.get(userId)).toBe(5000);
    });

    it('keeps a purchase whose pack was credited and never refunds it', async () => {
        const userId = newUser(5000);
        const reference = `relance-pack:${userId}:interrupted-123`;
        // Debited and credited, then the process died before recording the outcome.
        await RelanceBalancePurchaseModel.create({ reference, userId, packId: 'email_3k', amount: 2500 });
        spends.set(reference, { userId, amount: 2500 });
        wallet.set(userId, 2500);
        await RelancePackCreditModel.create({ sessionId: reference, userId, packId: 'email_3k', packType: 'email', credits: 3000 });

        await sweepInterruptedBalancePurchases(later());
        expect(await statusOf(userId)).toEqual(['credited']);
        expect(calls('/internal/balance-refund')).toHaveLength(0);
        expect(wallet.get(userId)).toBe(2500);
    });
});

describe('POST /api/relance/packs/purchase', () => {
    it('with useBalance, credits the pack and opens no payment page', async () => {
        const userId = newUser(3000);
        const r = await call('/api/relance/packs/purchase', userId, { packId: 'email_3k', useBalance: true, requestId: 'req-12345678' });

        expect(r.status).toBe(200);
        expect(r.json.data).toMatchObject({ paidWithBalance: true, credits: 3000 });
        expect(r.json.data.checkoutUrl).toBeUndefined();
        expect(calls('/payments/intents')).toHaveLength(0);
        expect(await creditsOf(userId)).toEqual({ email: 3000, sms: 0 });
    });

    it('answers 409 with a clear message when the balance is short', async () => {
        const userId = newUser(100);
        const r = await call('/api/relance/packs/purchase', userId, { packId: 'email_3k', useBalance: true });

        expect(r.status).toBe(409);
        expect(r.json.message).toBe('Votre solde SBC ne couvre pas ce pack.');
    });

    it('without useBalance, still opens a Mobile Money payment as before', async () => {
        const userId = newUser(100000);
        const r = await call('/api/relance/packs/purchase', userId, { packId: 'email_3k' });

        expect(r.status).toBe(200);
        expect(r.json.data.checkoutUrl).toMatch(/\/api\/payments\/page\/MM-SESSION$/);
        expect(calls('/internal/balance-spend')).toHaveLength(0);
        expect(wallet.get(userId)).toBe(100000);
    });

    it('keeps SMS packs for Cameroon before taking any balance', async () => {
        const userId = newUser(100000);
        getRelanceDetails.mockResolvedValue({ _id: userId, country: 'CI' });
        const r = await call('/api/relance/packs/purchase', userId, { packId: 'sms_250', useBalance: true });

        expect(r.status).toBe(403);
        expect(calls('/internal/balance-spend')).toHaveLength(0);
        expect(wallet.get(userId)).toBe(100000);
    });
});
