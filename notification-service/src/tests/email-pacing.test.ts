/**
 * The smart sender (SMART-SENDER-OVERFLOW-SPEC, 2026-10-06).
 *
 * Our own mail server takes at most emailPacing.ratePerMinute sends a minute
 * (Contabo throttles above ~25/min; bursts made Gmail defer us). OTP goes
 * first; other email next and waits a minute rather than burst; relance only
 * takes what those are not expected to need, and never leaves our server. An
 * OTP that would wait more than 30s overflows to Cloudflare (1,000/day,
 * increase refused → stop at 900), sent as the main domain, never as relance.
 *
 * axios (Cloudflare), the iRedMail transport and Bull are mocked; Mongo is real.
 * Needs MongoDB at TEST_MONGODB_URI (default mongodb://127.0.0.1:27017).
 */
const post = jest.fn();
jest.mock('axios', () => ({ __esModule: true, default: { post: (...a: unknown[]) => post(...a) } }));
const sendEmailWithTracking = jest.fn();
const sendEmail = jest.fn();
jest.mock('../services/email.service', () => ({
    emailService: {
        sendEmailWithTracking: (...a: unknown[]) => sendEmailWithTracking(...a),
        sendEmail: (...a: unknown[]) => sendEmail(...a),
        passesPreflight: (...a: unknown[]) => passesPreflight(...a),
    },
}));
const passesPreflight = jest.fn();
// Bull: capture the email processor and the jobs it re-queues.
const queueAdd = jest.fn();
let processEmail: (job: any) => Promise<void>;
jest.mock('bull', () => ({
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
        add: (...a: unknown[]) => queueAdd(...a),
        process: (name: string, _c: number, fn: (job: any) => Promise<void>) => { if (name === 'send-email') processEmail = fn; },
        on: jest.fn(),
    })),
}));
const repo = { findById: jest.fn(), markAsSent: jest.fn(), markAsFailed: jest.fn() };
jest.mock('../database/repositories/notification.repository', () => ({ notificationRepository: repo }));
jest.mock('../services/sms.service', () => ({ smsService: {} }));
jest.mock('../services/whatsapp-service-factory', () => ({ __esModule: true, default: { getService: () => ({ onDisconnect: jest.fn() }) } }));
jest.mock('../services/notification.service', () => ({ notificationService: {} }));

import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import mongoose from 'mongoose';
import config from '../config';
import EmailProviderUsageModel from '../database/models/email-provider-usage.model';
import RelanceBounceSuppressionModel from '../database/models/relance-bounce-suppression.model';
import { EmailSendMinuteModel, relanceBudget, reserveHighPrioritySend, reserveRelanceSend } from '../services/send-budget.service';
import { resetCloudflarePause, sendOtpViaCloudflare, parseSender } from '../services/cloudflare-email.service';
import { emailRelanceService } from '../services/email.relance.service';
import { QueueService } from '../services/queue.service';
import { relanceUnsubscribeUrl } from '../utils/relance-unsubscribe';
import relanceRoutes from '../api/routes/relance.routes';
import { BounceHandlerService } from '../services/bounceHandler.service';

const MONGO = (process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017') + '/sbc_notifications_email_pacing_test';
const TO = 'filleul@example.com';
const OTP = { to: TO, subject: 'AbC123 is your SBC login code', html: '<img src="cid:sbc-logo" alt="SBC"><p>Code AbC123</p>' };
// Early in a minute, so "more than 30s to wait" holds.
const EARLY = new Date('2026-10-07T10:00:05Z');
const send = () => emailRelanceService.sendRelanceEmail(TO, 'Paul', 'Marie', 'Bonjour Paul', 2);
const accepted = () => ({ status: 200, data: { success: true, errors: [], result: { delivered: [TO], permanent_bounces: [], queued: [] } } });
const usage = async (key: string) => (await EmailProviderUsageModel.findById(key).lean())?.count ?? 0;
const fillMinute = (now: Date, high: number, relance = 0) =>
    EmailSendMinuteModel.updateOne({ _id: now.toISOString().slice(0, 16) }, { $set: { total: high + relance, high, relance } }, { upsert: true });

let server: http.Server;
let base: string;

beforeAll(async () => {
    await mongoose.connect(MONGO, { serverSelectionTimeoutMS: 3000 });
    await mongoose.connection.dropDatabase();
    new QueueService(); // registers the email processor with the mocked Bull
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
    jest.useRealTimers();
    post.mockReset().mockResolvedValue(accepted());
    sendEmailWithTracking.mockReset().mockResolvedValue({ success: true, messageId: '<abc@iredmail>' });
    sendEmail.mockReset().mockResolvedValue(true);
    passesPreflight.mockReset().mockReturnValue(true);
    queueAdd.mockReset().mockResolvedValue(undefined);
    Object.values(repo).forEach(f => f.mockReset());
    config.emailPacing.ratePerMinute = 25;
    Object.assign(config.cloudflareEmail, { accountId: 'acc123', apiToken: 'tok', otpFrom: 'Sniper Business Center <noreply@noreply.sniperbuisnesscenter.com>', otpOverflow: true, dailyCap: 900, monthlyCap: null });
    config.email.from = 'Sniper Business Center <noreply@sniperbuisnesscenter.com>';
    resetCloudflarePause();
    await Promise.all([EmailProviderUsageModel.deleteMany({}), RelanceBounceSuppressionModel.deleteMany({}), EmailSendMinuteModel.deleteMany({})]);
});

describe('the per-minute budget on our own server', () => {
    it('lets OTP and transactional mail take every send of the minute, and no more', async () => {
        config.emailPacing.ratePerMinute = 3;
        const results = [];
        for (let i = 0; i < 4; i++) results.push(await reserveHighPrioritySend(EARLY));
        expect(results).toEqual([true, true, true, false]);
    });

    it('gives relance only what the recent OTP peak leaves, plus a margin', async () => {
        await fillMinute(new Date(EARLY.getTime() - 120_000), 15); // busiest of the last 5 minutes
        expect(await relanceBudget(EARLY)).toBe(25 - 15 - 2);
    });

    it('gives relance nothing while OTP is at its peak', async () => {
        await fillMinute(new Date(EARLY.getTime() - 60_000), 24);
        expect(await reserveRelanceSend(EARLY)).toBe(false);
    });

    it('fills a quiet minute with relance, up to its share', async () => {
        config.emailPacing.ratePerMinute = 5; // share = 5 - 0 - 2 = 3
        const results = [];
        for (let i = 0; i < 4; i++) results.push(await reserveRelanceSend(EARLY));
        expect(results).toEqual([true, true, true, false]);
        expect(await reserveHighPrioritySend(EARLY)).toBe(true); // room kept for OTP
    });
});

describe('relance: lowest priority, our server only', () => {
    it('waits (deferred, nothing sent) when the minute has no spare room', async () => {
        config.emailPacing.ratePerMinute = 2; // share = 0
        expect(await send()).toEqual(expect.objectContaining({ success: false, deferred: true }));
        expect(sendEmailWithTracking).not.toHaveBeenCalled();
    });

    it('goes out through our server when there is room, and never through Cloudflare', async () => {
        expect((await send()).success).toBe(true);
        expect(sendEmailWithTracking).toHaveBeenCalledTimes(1);
        expect(post).not.toHaveBeenCalled();
    });
});

describe('OTP overflow to Cloudflare', () => {
    it('sends from the OTP domain onboarded in Cloudflare, over IPv4, without the inline logo', async () => {
        expect(await sendOtpViaCloudflare(OTP, EARLY)).toEqual({ status: 'sent' });
        const [url, body, opts] = post.mock.calls[0];
        expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/acc123/email/sending/send');
        expect(body.from).toEqual({ address: 'noreply@noreply.sniperbuisnesscenter.com', name: 'Sniper Business Center' });
        expect(body.html).not.toContain('cid:sbc-logo');
        expect(body.headers).toBeUndefined(); // no List-Unsubscribe (Gmail → Promotions)
        expect(opts.httpsAgent.options.family).toBe(4);
        expect(await usage('cloudflare:2026-10-07')).toBe(1);
        expect(await usage('cloudflare:2026-10')).toBe(1);
    });

    it('stops at the daily cap, leaving headroom under Cloudflare\'s 1,000', async () => {
        config.cloudflareEmail.dailyCap = 2;
        const results = [];
        for (let i = 0; i < 3; i++) results.push((await sendOtpViaCloudflare(OTP, EARLY)).status);
        expect(results).toEqual(['sent', 'sent', 'unavailable']);
        expect(post).toHaveBeenCalledTimes(2);
    });

    it('stays off when switched off or not configured', async () => {
        config.cloudflareEmail.otpOverflow = false;
        expect((await sendOtpViaCloudflare(OTP, EARLY)).status).toBe('unavailable');
        config.cloudflareEmail.otpOverflow = true;
        config.cloudflareEmail.apiToken = '';
        expect((await sendOtpViaCloudflare(OTP, EARLY)).status).toBe('unavailable');
        expect(post).not.toHaveBeenCalled();
    });

    it('after a refusal (quota, token, domain) leaves Cloudflare alone for an hour, uncounted', async () => {
        post.mockResolvedValue({ status: 429, data: { success: false, errors: [{ code: 10004, message: 'email.sending.error.throttled' }] } });
        expect((await sendOtpViaCloudflare(OTP, EARLY)).status).toBe('unavailable');
        post.mockResolvedValue(accepted());
        expect((await sendOtpViaCloudflare(OTP, new Date(EARLY.getTime() + 30 * 60_000))).status).toBe('unavailable');
        expect(post).toHaveBeenCalledTimes(1);
        expect(await usage('cloudflare:2026-10-07')).toBe(0);
    });

    it('reads a sender with or without a display name', () => {
        expect(parseSender('SBC <a@b.com>')).toEqual({ address: 'a@b.com', name: 'SBC' });
        expect(parseSender('"Sniper Business Center" <a@b.com>')).toEqual({ address: 'a@b.com', name: 'Sniper Business Center' });
        expect(parseSender('a@b.com')).toEqual({ address: 'a@b.com' });
    });
});

describe('the email queue worker', () => {
    const job = (type: string, deferrals = 0) => {
        repo.findById.mockResolvedValue({ _id: 'n1', type, recipient: TO, data: { subject: 'S', body: '<p>B</p>' } });
        return { data: { notificationId: 'n1', deferrals }, attemptsMade: 0, opts: {} };
    };
    const fullMinute = async () => { config.emailPacing.ratePerMinute = 1; await reserveHighPrioritySend(); };
    const earlyInMinute = () => { jest.useFakeTimers({ now: new Date('2026-10-07T10:00:05Z'), doNotFake: ['nextTick', 'setImmediate'] }); };

    it('sends through our server while the minute has room', async () => {
        await processEmail(job('otp'));
        expect(sendEmail).toHaveBeenCalledTimes(1);
        expect(repo.markAsSent).toHaveBeenCalled();
    });

    it('overflows an OTP to Cloudflare when the minute is full and the wait would pass 30s', async () => {
        earlyInMinute();
        await fullMinute();
        await processEmail(job('otp'));
        expect(post).toHaveBeenCalledTimes(1);
        expect(sendEmail).not.toHaveBeenCalled();
        expect(repo.markAsSent).toHaveBeenCalled();
    });

    it('makes other email wait for the next minute instead of bursting — never to Cloudflare', async () => {
        await fullMinute();
        await processEmail(job('system'));
        expect(sendEmail).not.toHaveBeenCalled();
        expect(post).not.toHaveBeenCalled();
        const [, data, opts] = queueAdd.mock.calls[0];
        expect(data.deferrals).toBe(1);
        expect(opts.priority).toBe(10);
        expect(opts.delay).toBeGreaterThan(0);
    });

    it('re-queues an OTP ahead of everything else when Cloudflare cannot take it', async () => {
        earlyInMinute();
        await fullMinute();
        config.cloudflareEmail.otpOverflow = false;
        await processEmail(job('otp'));
        expect(queueAdd.mock.calls[0][2].priority).toBe(1);
        expect(sendEmail).not.toHaveBeenCalled();
    });

    it('sends nothing to a bounced or invalid address, on either server, and spends no send', async () => {
        passesPreflight.mockReturnValue(false);
        earlyInMinute();
        await fullMinute();
        await processEmail(job('otp'));
        expect(sendEmail).not.toHaveBeenCalled();
        expect(post).not.toHaveBeenCalled();
        expect(queueAdd).not.toHaveBeenCalled();
        expect(repo.markAsFailed).toHaveBeenCalled();
    });

    it('sends anyway after waiting long enough: queued on the mail server, never lost', async () => {
        await fullMinute();
        await processEmail(job('system', 60));
        expect(sendEmail).toHaveBeenCalledTimes(1);
        expect(queueAdd).not.toHaveBeenCalled();
    });
});

describe('unsubscribe', () => {
    const link = () => new URL(relanceUnsubscribeUrl(TO));
    const at = (u: URL) => `${base}${u.pathname}${u.search}`;

    it('puts the recipient\'s own signed link in the footer, and no List-Unsubscribe header (Gmail → Promotions)', async () => {
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
        await sendOtpViaCloudflare(OTP);
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
