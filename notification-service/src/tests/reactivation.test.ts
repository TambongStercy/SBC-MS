/**
 * Security plan Phase 7 part 2: the « réactivation » message to one dormant member.
 * Needs MongoDB at TEST_MONGODB_URI (default mongodb://127.0.0.1:27017).
 */
const sendEmailWithTracking = jest.fn();
const passesPreflight = jest.fn();
jest.mock('../services/email.service', () => ({
    emailService: {
        sendEmailWithTracking: (...a: unknown[]) => sendEmailWithTracking(...a),
        passesPreflight: (...a: unknown[]) => passesPreflight(...a),
        createBaseTemplate: (title: string, content: string) => `<html><title>${title}</title>${content}</html>`,
    },
}));
const reserveRelanceSend = jest.fn();
const relanceDailyCapReached = jest.fn();
jest.mock('../services/send-budget.service', () => ({
    reserveRelanceSend: (...a: unknown[]) => reserveRelanceSend(...a),
    relanceDailyCapReached: (...a: unknown[]) => relanceDailyCapReached(...a),
}));
const sendPushToUser = jest.fn();
jest.mock('../services/push.service', () => ({ sendPushToUser: (...a: unknown[]) => sendPushToUser(...a) }));

import mongoose from 'mongoose';
import RelanceBounceSuppressionModel from '../database/models/relance-bounce-suppression.model';
import PushSubscriptionModel from '../database/models/push-subscription.model';
import PushPreferenceModel from '../database/models/push-preference.model';
import { ReactivationDeliveryModel, reactivationHtml, reactivationReach, sendReactivation, SAFETY_LINE } from '../services/reactivation.service';

const MONGO = (process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017') + '/sbc_notifications_reactivation_test';
const NOON = new Date('2026-11-24T11:00:00Z'); // 12:00 Douala
const NIGHT = new Date('2026-11-24T22:00:00Z'); // 23:00 Douala

const input = (over: Record<string, unknown> = {}) => ({
    campaignId: 'c1', userId: new mongoose.Types.ObjectId().toString(), email: 'Membre@Gmail.com', name: 'Awa <b>Diallo</b>',
    subject: '{{nom}}, votre compte SBC', body: 'Bonjour {{nom}},\n\nVotre compte vous attend.', pushTitle: 'Votre compte SBC', pushBody: 'Ouvrez SBC',
    ...over,
});

beforeAll(async () => { await mongoose.connect(MONGO); });
afterAll(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });
beforeEach(async () => {
    await Promise.all([ReactivationDeliveryModel.deleteMany({}), RelanceBounceSuppressionModel.deleteMany({}), PushSubscriptionModel.deleteMany({}), PushPreferenceModel.deleteMany({})]);
    jest.clearAllMocks();
    passesPreflight.mockReturnValue(true);
    reserveRelanceSend.mockResolvedValue(true);
    relanceDailyCapReached.mockResolvedValue(false);
    sendEmailWithTracking.mockResolvedValue({ success: true });
    sendPushToUser.mockResolvedValue('sent');
});

it('waits for the daytime: nothing sent at night, retry at 07:00 Douala', async () => {
    const r = await sendReactivation(input(), NIGHT);
    expect(r.status).toBe('deferred');
    expect(r.retryAt).toBe('2026-11-25T06:00:00.000Z');
    expect(sendEmailWithTracking).not.toHaveBeenCalled();
    expect(sendPushToUser).not.toHaveBeenCalled();
    expect(await ReactivationDeliveryModel.countDocuments()).toBe(0);
});

it('sends the email (lower-cased address, relance budget) and the push (announcements)', async () => {
    const i = input();
    const r = await sendReactivation(i, NOON);
    expect(r).toEqual({ status: 'done', email: 'sent', push: 'sent' });
    expect(reserveRelanceSend).toHaveBeenCalledTimes(1);
    expect(sendEmailWithTracking.mock.calls[0][0].to).toBe('membre@gmail.com');
    expect(sendEmailWithTracking.mock.calls[0][0].subject).toBe('Awa, votre compte SBC');
    expect(sendPushToUser.mock.calls[0][2].category).toBe('announcements');
    expect(sendPushToUser.mock.calls[0][1].url).toBe('/');
});

it('a second call for the same member and campaign sends nothing again', async () => {
    const i = input();
    await sendReactivation(i, NOON);
    const r = await sendReactivation(i, NOON);
    expect(r.status).toBe('duplicate');
    expect(sendEmailWithTracking).toHaveBeenCalledTimes(1);
    expect(sendPushToUser).toHaveBeenCalledTimes(1);
});

it('no room in the mail budget: deferred, nothing recorded, push not sent either', async () => {
    reserveRelanceSend.mockResolvedValue(false);
    const r = await sendReactivation(input(), NOON);
    expect(r.status).toBe('deferred');
    expect(new Date(r.retryAt!).getTime()).toBeGreaterThan(NOON.getTime());
    expect(sendPushToUser).not.toHaveBeenCalled();
    expect(await ReactivationDeliveryModel.countDocuments()).toBe(0);
});

it('an unsubscribed address gets no email (the push still goes)', async () => {
    await RelanceBounceSuppressionModel.create({ email: 'membre@gmail.com', reason: 'unsubscribe', source: 'unsubscribe', bouncedAt: new Date() } as any);
    const r = await sendReactivation(input(), NOON);
    expect(r.email).toBe('suppressed');
    expect(r.push).toBe('sent');
    expect(sendEmailWithTracking).not.toHaveBeenCalled();
    expect(reserveRelanceSend).not.toHaveBeenCalled();
});

it('the email escapes the text, links only to the app home, always carries the safety line and the unsubscribe link', () => {
    const html = reactivationHtml('Sujet', 'Bonjour {{nom}},\n\n<script>x</script>', 'Awa <b>Diallo</b>', 'membre@gmail.com');
    expect(html).toContain('Bonjour Awa,');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain(SAFETY_LINE.replace(/'/g, '&#39;'));
    expect(html).toContain('/api/relance/unsubscribe?e=membre%40gmail.com');
    const links = [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
    expect(links.filter(l => !l.includes('/unsubscribe'))).toEqual([expect.stringMatching(/^https?:\/\/[^/]+\/$/)]);
});

it('reach: suppressed addresses, and members with a device and announcements on', async () => {
    const [a, b, c] = [0, 1, 2].map(() => new mongoose.Types.ObjectId());
    await RelanceBounceSuppressionModel.create({ email: 'gone@gmail.com', reason: 'bounce', source: 'smtp_dsn', bouncedAt: new Date() } as any);
    await PushSubscriptionModel.create([a, b].map((u, n) => ({ userId: u, endpoint: `https://push.example/${n}`, keys: { p256dh: 'x', auth: 'y' } })) as any);
    await PushPreferenceModel.create({ userId: b, disabled: ['announcements'] } as any);
    const r = await reactivationReach(['Gone@gmail.com', 'ok@gmail.com'], [a, b, c].map(String));
    expect(r.suppressedEmails).toEqual(['gone@gmail.com']);
    expect(r.pushReachable).toEqual([String(a)]);
});
