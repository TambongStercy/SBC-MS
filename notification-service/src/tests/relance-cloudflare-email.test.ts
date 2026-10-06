/**
 * Relance emails through Cloudflare Email Sending, with iRedMail as the net.
 *
 * Cloudflare bills per email past 3,000 a month (hard bounces included), so:
 * every send is counted per month and an optional cap stops the paid path;
 * whatever Cloudflare does not take goes out through iRedMail instead; a dead
 * address is suppressed rather than retried. Every relance email carries a
 * signed one-click unsubscribe (Gmail requires it at volume) that actually works.
 *
 * axios (the Cloudflare API) and the iRedMail transport are mocked; Mongo is real.
 * Needs MongoDB at TEST_MONGODB_URI (default mongodb://127.0.0.1:27017).
 */
const post = jest.fn();
jest.mock('axios', () => ({ __esModule: true, default: { post: (...a: unknown[]) => post(...a) } }));
const sendEmailWithTracking = jest.fn();
const passesPreflight = jest.fn();
jest.mock('../services/email.service', () => ({
    emailService: {
        sendEmailWithTracking: (...a: unknown[]) => sendEmailWithTracking(...a),
        passesPreflight: (...a: unknown[]) => passesPreflight(...a),
    },
}));

import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import mongoose from 'mongoose';
import config from '../config';
import EmailProviderUsageModel from '../database/models/email-provider-usage.model';
import RelanceBounceSuppressionModel from '../database/models/relance-bounce-suppression.model';
import { emailRelanceService } from '../services/email.relance.service';
import { parseSender } from '../services/cloudflare-email.service';
import { relanceUnsubscribeUrl } from '../utils/relance-unsubscribe';
import relanceRoutes from '../api/routes/relance.routes';
import { BounceHandlerService } from '../services/bounceHandler.service';

const MONGO = (process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017') + '/sbc_notifications_relance_cloudflare_test';
const TO = 'filleul@example.com';
const month = () => `cloudflare:${new Date().toISOString().slice(0, 7)}`;
const usage = async () => (await EmailProviderUsageModel.findById(month()).lean())?.count ?? 0;
const send = () => emailRelanceService.sendRelanceEmail(TO, 'Paul', 'Marie', 'Bonjour Paul', 2);
const accepted = (to = TO) => ({ status: 200, data: { success: true, errors: [], result: { delivered: [to], permanent_bounces: [], queued: [] } } });

let server: http.Server;
let base: string;

beforeAll(async () => {
    await mongoose.connect(MONGO, { serverSelectionTimeoutMS: 3000 });
    await mongoose.connection.dropDatabase();
    const app = express();
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
    post.mockReset().mockResolvedValue(accepted());
    sendEmailWithTracking.mockReset().mockResolvedValue({ success: true, messageId: '<abc@iredmail>' });
    passesPreflight.mockReset().mockReturnValue(true);
    Object.assign(config.relanceEmail, { provider: 'cloudflare', from: 'Sniper Business Center <noreply@relance.sniperbuisnesscenter.com>' });
    Object.assign(config.relanceEmail.cloudflare, { accountId: 'acc123', apiToken: 'tok', monthlyCap: null });
    await Promise.all([EmailProviderUsageModel.deleteMany({}), RelanceBounceSuppressionModel.deleteMany({})]);
});

describe('sending through Cloudflare', () => {
    it('posts to the account\'s send endpoint from relance.sniperbuisnesscenter.com, and skips iRedMail', async () => {
        expect(await send()).toEqual({ success: true });
        const [url, body, opts] = post.mock.calls[0];
        expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/acc123/email/sending/send');
        expect(opts.headers.Authorization).toBe('Bearer tok');
        // The token is IP-locked to the server's IPv4; IPv6 calls are refused.
        expect(opts.httpsAgent.options.family).toBe(4);
        expect(body.from).toEqual({ address: 'noreply@relance.sniperbuisnesscenter.com', name: 'Sniper Business Center' });
        expect(body.to).toBe(TO);
        // A List-Unsubscribe header sends the mail to Gmail's Promotions tab.
        expect(body.headers).toBeUndefined();
        expect(sendEmailWithTracking).not.toHaveBeenCalled();
        expect(await usage()).toBe(1);
    });

    it('stays on iRedMail when the provider is iredmail, or Cloudflare is not configured', async () => {
        config.relanceEmail.provider = 'iredmail';
        await send();
        config.relanceEmail.provider = 'cloudflare';
        config.relanceEmail.cloudflare.apiToken = '';
        await send();
        expect(post).not.toHaveBeenCalled();
        expect(sendEmailWithTracking).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['Cloudflare is throttled', { status: 429, data: { success: false, errors: [{ code: 10004, message: 'email.sending.error.throttled' }] } }],
        ['Cloudflare is down', { status: 503, data: {} }],
        ['the token is refused', { status: 403, data: { success: false, errors: [{ code: 10102, message: 'forbidden' }] } }],
    ])('falls back to iRedMail when %s, and does not count it', async (_label, response) => {
        post.mockResolvedValue(response);
        expect(await send()).toEqual({ success: true, messageId: '<abc@iredmail>' });
        expect(sendEmailWithTracking).toHaveBeenCalledTimes(1);
        expect(await usage()).toBe(0);
    });

    it('falls back to iRedMail when Cloudflare cannot be reached', async () => {
        post.mockRejectedValue(new Error('ETIMEDOUT'));
        expect((await send()).success).toBe(true);
        expect(sendEmailWithTracking).toHaveBeenCalledTimes(1);
        expect(await usage()).toBe(0);
    });

    it('stops using Cloudflare for the month once the cap is reached', async () => {
        config.relanceEmail.cloudflare.monthlyCap = 2;
        await send(); await send(); await send();
        expect(post).toHaveBeenCalledTimes(2);
        expect(sendEmailWithTracking).toHaveBeenCalledTimes(1);
        expect(await usage()).toBe(2);
    });

    it('suppresses a dead address instead of retrying it on iRedMail', async () => {
        post.mockResolvedValue({ status: 200, data: { success: true, result: { delivered: [], permanent_bounces: [TO], queued: [] } } });
        expect((await send()).success).toBe(false);
        expect(sendEmailWithTracking).not.toHaveBeenCalled();
        expect(await RelanceBounceSuppressionModel.findOne({ email: TO }).lean()).toEqual(expect.objectContaining({ source: 'cloudflare' }));
    });

    it('applies the same checks as iRedMail before paying for a send', async () => {
        passesPreflight.mockReturnValue(false);
        sendEmailWithTracking.mockResolvedValue({ success: false });
        expect((await send()).success).toBe(false);
        expect(post).not.toHaveBeenCalled();
    });

    it('reads a sender with or without a display name', () => {
        expect(parseSender('SBC <a@b.com>')).toEqual({ address: 'a@b.com', name: 'SBC' });
        expect(parseSender('"Sniper Business Center" <a@b.com>')).toEqual({ address: 'a@b.com', name: 'Sniper Business Center' });
        expect(parseSender('a@b.com')).toEqual({ address: 'a@b.com' });
    });
});

describe('unsubscribe', () => {
    const link = () => new URL(relanceUnsubscribeUrl(TO));
    const at = (u: URL) => `${base}${u.pathname}${u.search}`;

    it('puts the recipient\'s own signed link in the footer, and no List-Unsubscribe header (Gmail → Promotions)', async () => {
        config.relanceEmail.provider = 'iredmail';
        await send();
        const { html, headers } = sendEmailWithTracking.mock.calls[0][0];
        expect(html).toContain(relanceUnsubscribeUrl(TO));
        expect(headers).toBeUndefined();
    });

    it('asks first on GET — link scanners open links — and unsubscribes on POST', async () => {
        const page = await fetch(at(link()));
        expect(page.status).toBe(200);
        expect(await page.text()).toContain('Me désabonner');
        expect(await RelanceBounceSuppressionModel.countDocuments()).toBe(0);

        const done = await fetch(at(link()), { method: 'POST', body: 'List-Unsubscribe=One-Click', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        expect(done.status).toBe(200);
        expect(await RelanceBounceSuppressionModel.findOne({ email: TO }).lean()).toEqual(expect.objectContaining({ source: 'unsubscribe' }));
    });

    // The bounce blacklist gates EVERY email, OTP codes included.
    const blockedForAllEmail = async () => { const h = new BounceHandlerService(); await h.reloadBlacklist(); return h.isBlacklisted(TO); };
    const unsubscribe = () => fetch(at(link()), { method: 'POST' });

    it('stops relance only: an unsubscribed member still gets login codes', async () => {
        await unsubscribe();
        expect(await RelanceBounceSuppressionModel.exists({ email: TO })).toBeTruthy(); // relance skips them
        expect(await blockedForAllEmail()).toBe(false);
    });

    it('a Cloudflare bounce blocks every email, even after an unsubscribe', async () => {
        await unsubscribe();
        post.mockResolvedValue({ status: 200, data: { success: true, result: { delivered: [], permanent_bounces: [TO], queued: [] } } });
        await send();
        expect(await blockedForAllEmail()).toBe(true);
    });

    it('never turns a bounce into a mere unsubscribe', async () => {
        await RelanceBounceSuppressionModel.create({ email: TO, reason: 'bounce', bouncedAt: new Date(), source: 'cloudflare' });
        await unsubscribe();
        expect((await RelanceBounceSuppressionModel.findOne({ email: TO }).lean())!.source).toBe('cloudflare');
        expect(await blockedForAllEmail()).toBe(true);
    });

    it('refuses a link whose signature does not match the address', async () => {
        const forged = link();
        forged.searchParams.set('e', 'someone.else@example.com');
        expect((await fetch(at(forged), { method: 'POST' })).status).toBe(400);
        expect((await fetch(at(forged))).status).toBe(400);
        expect(await RelanceBounceSuppressionModel.countDocuments()).toBe(0);
    });
});
