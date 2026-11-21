/**
 * Asserts Security plan Phase 11 (daily activity) on the user-service side:
 *   - each sign-up form sent is one attempt with one outcome, so
 *     started = completed + failed + in progress for every day and country;
 *   - refusals carry the right reason and group; a code is "not received" only
 *     when notification-service shows no channel sent it;
 *   - connected members: exact count once per member (main country), live
 *     HyperLogLog close to it; country rows add up to the total, members with
 *     no country land in "XX";
 *   - activated = first CLASSIQUE/CIBLE subscription only; payments merged;
 *   - a country filter shows only those countries; board under 500 ms.
 *
 * Needs local Mongo (and Redis for the live count). Uses its own database and
 * Redis DB 14, and drops them.
 *
 *   npx ts-node --transpile-only src/scripts/check-activity-dashboard.ts
 */
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379/14';

import mongoose, { Types } from 'mongoose';
import type { Request } from 'express';

const DB = process.env.ACTIVITY_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_users_activity_check';
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

const fakeReq = (body: Record<string, unknown>, headers: Record<string, string> = {}) => ({ body, headers } as unknown as Request);

const main = async () => {
    const { SignupAttemptModel } = await import('../database/models/signup-attempt.model');
    const { ActivityDayModel } = await import('../database/models/activity-day.model');
    const { UserGeoDayModel } = await import('../database/models/user-geo-day.model');
    const SubscriptionModel = (await import('../database/models/subscription.model')).default;
    const UserModel = (await import('../database/models/user.model')).default;
    const sa = await import('../services/signup-attempts.service');
    const dash = await import('../services/activity-dashboard.service');
    const hll = await import('../services/activity-hll.service');
    const { doualaDay } = await import('../services/activity-signals.service');
    const { notificationService } = await import('../services/clients/notification.service.client');
    const { paymentService } = await import('../services/clients/payment.service.client');
    const { closeRedis, withRedis } = await import('../utils/redis');

    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();
    await Promise.all([SignupAttemptModel.syncIndexes(), ActivityDayModel.syncIndexes(), UserGeoDayModel.syncIndexes()]);
    // The first calls may run before Redis has connected (fail-open answers the fallback).
    for (let i = 0; i < 20; i++) {
        if (await withRedis('test-flush', false, async r => { await r.flushdb(); return true; })) break;
        await new Promise(r => setTimeout(r, 100));
    }

    // ---- classification ----
    const c = sa.classifySignupError;
    check('duplicate → phone_or_email_used (member)', c(new Error('User with this email or phone number already exists')).reason === 'phone_or_email_used' && sa.reasonGroup('phone_or_email_used') === 'member');
    check('E11000 → phone_or_email_used', c(Object.assign(new Error('E11000 dup'), { code: 11000 })).reason === 'phone_or_email_used');
    check('bad sponsor code → invalid_sponsor_code', c(new Error('Invalid referrer code provided')).reason === 'invalid_sponsor_code');
    check('no sponsor → no_sponsor_code', c(new Error('Vous ne pouvez pas vous inscrire sans un code de parrainage')).reason === 'no_sponsor_code');
    check('email domain → invalid_email_domain', c(new Error('Invalid email domain')).reason === 'invalid_email_domain');
    check('anything else → server_error (SBC code, step server)', (() => { const x = c(new Error('connection reset')); return x.reason === 'server_error' && x.step === 'server' && sa.reasonGroup('server_error') === 'sbc_code'; })());

    // ---- context ----
    const ctx = sa.signupContext(fakeReq({ country: 'Cameroun', email: 'jean.dupont@gmail.com', phoneNumber: '237677123456', referrerCode: 'ABC' }, { 'x-sbc-client': 'app', 'x-sbc-geo': 'bj' }));
    check('declared country wins over Cloudflare, normalised', ctx.country === 'CM' && ctx.geoCountry === 'BJ', `${ctx.country}/${ctx.geoCountry}`);
    check('contact kept masked only', ctx.emailMasked === 'je***@gmail.com' && !String(ctx.phoneMasked).includes('677123'), `${ctx.emailMasked} ${ctx.phoneMasked}`);
    check('source app from X-SBC-Client', ctx.source === 'app');
    const local = sa.signupContext(fakeReq({ country: 'CM', phoneNumber: '677123456' }));
    check('a number typed without its dialling code is masked with the country’s', local.phoneMasked === '+237 •••• 456', String(local.phoneMasked));
    const noCountry = sa.signupContext(fakeReq({ email: 'x@gmail.com' }));
    check('no country anywhere → XX, source api', noCountry.country === 'XX' && noCountry.source === 'api');

    // ---- attempts ----
    const now = new Date();
    const today = doualaDay(now);
    const yesterdayStart = new Date(now.getTime() - 30 * 3600_000); // > 24 h ago
    const yDay = doualaDay(yesterdayStart);
    const mk = (country: string, source: string, at: Date = now) => ({ ...sa.signupContext(fakeReq({ country }, { 'x-sbc-client': source }), at) });

    const uDone = new Types.ObjectId().toString();
    const uWrong = new Types.ObjectId().toString();
    const uNoCode = new Types.ObjectId().toString();
    const uGaveUp = new Types.ObjectId().toString();
    const uLate = new Types.ObjectId().toString();
    const uPending = new Types.ObjectId().toString();

    sa.recordSignupAttempt(mk('CM', 'web'), { userId: uDone });
    sa.markSignupCompleted(uDone); // code typed before the buffered insert was written
    sa.recordSignupAttempt(mk('CM', 'web'), { error: new Error('User with this email or phone number already exists') });
    sa.recordSignupAttempt(mk('CM', 'app'), { reason: 'invalid_phone', step: 'form' });
    sa.recordSignupAttempt(mk('BJ', 'web'), { error: new Error('boom') });
    sa.recordSignupAttempt(mk('BJ', 'web'), { userId: uPending });
    sa.recordSignupAttempt({ ...noCountry, day: today, startedAt: now }, { error: new Error('Invalid referrer code provided') });
    // Started yesterday (> 24 h): closed by the 24 h pass.
    sa.recordSignupAttempt(mk('CM', 'web', yesterdayStart), { userId: uWrong });
    sa.recordSignupAttempt(mk('CM', 'web', yesterdayStart), { userId: uNoCode });
    sa.recordSignupAttempt(mk('BJ', 'app', yesterdayStart), { userId: uGaveUp });
    sa.recordSignupAttempt(mk('BJ', 'app', yesterdayStart), { userId: uLate });
    await sa.flushSignupAttempts();
    sa.markSignupWrongCode(uWrong);
    await new Promise(r => setTimeout(r, 200));

    check('one document per form sent', await SignupAttemptModel.countDocuments() === 10);
    check('code typed while buffered → completed', (await SignupAttemptModel.findOne({ userId: new Types.ObjectId(uDone) }).lean())?.outcome === 'completed');
    check('wrong code counted', (await SignupAttemptModel.findOne({ userId: new Types.ObjectId(uWrong) }).lean())?.wrongCodes === 1);

    const at = (ms: number) => new Date(yesterdayStart.getTime() + ms).toISOString();
    (notificationService as any).getOtpDelivery = async (ids: string[]) => {
        const out: Record<string, unknown[]> = {};
        for (const id of ids) {
            if (id === uNoCode) out[id] = [{ channel: 'whatsapp', status: 'failed', error: '132001 template', at: at(5_000) }, { channel: 'email', status: 'failed', error: 'SMTP 451', at: at(6_000) }];
            else out[id] = [{ channel: 'email', status: 'sent', error: null, at: at(5_000) }];
        }
        return out;
    };
    const closed = await sa.closeUnverifiedAttempts(now);
    const byUser = async (u: string) => SignupAttemptModel.findOne({ userId: new Types.ObjectId(u) }).lean();
    check('24 h pass closes only the attempts older than 24 h', closed.closed === 4 && (await byUser(uPending))?.outcome === 'in_progress', JSON.stringify(closed));
    check('no channel sent the code → code_not_received (provider), with the provider answer', (await byUser(uNoCode))?.reason === 'code_not_received' && sa.reasonGroup('code_not_received') === 'provider_api' && /132001/.test(String((await byUser(uNoCode))?.detail)));
    check('code sent, wrong code typed → wrong_code', (await byUser(uWrong))?.reason === 'wrong_code');
    check('code sent, nothing typed → never_verified', (await byUser(uGaveUp))?.reason === 'never_verified');
    sa.markSignupCompleted(uLate);
    await new Promise(r => setTimeout(r, 200));
    check('verified after the 24 h close → completed (still one outcome)', (await byUser(uLate))?.outcome === 'completed');

    (notificationService as any).getOtpDelivery = async () => null;
    const uDown = new Types.ObjectId().toString();
    sa.recordSignupAttempt(mk('CM', 'web', yesterdayStart), { userId: uDown });
    await sa.flushSignupAttempts();
    await sa.closeUnverifiedAttempts(now);
    check('notification-service down → waits (stays in progress before 48 h)', (await byUser(uDown))?.outcome === 'in_progress');
    await SignupAttemptModel.deleteOne({ userId: new Types.ObjectId(uDown) });

    // ---- connected members ----
    const users = Array.from({ length: 6 }, () => new Types.ObjectId());
    const geo = (u: Types.ObjectId, country: string, requests: number, src: { web?: number; app?: number }) => ({
        userId: u, day: today, country, requests, logins: 0, asns: [], ipRanges: [], devices: [],
        sources: { web: src.web ?? 0, app: src.app ?? 0, api: 0 }, noDevice: 0, firstAt: now, lastAt: now, expiresAt: new Date(now.getTime() + 86400_000),
    });
    await UserGeoDayModel.insertMany([
        geo(users[0], 'CM', 10, { web: 10 }), geo(users[1], 'CM', 5, { app: 5 }), geo(users[2], 'CM', 3, { web: 1, app: 2 }),
        geo(users[3], 'BJ', 7, { web: 7 }), geo(users[3], 'CM', 2, { web: 2 }), // travels: main country BJ
        geo(users[4], 'XX', 1, { web: 1 }),
    ]);
    const exact = await dash.exactConnected(today);
    check('exact: each member once, in their main country', exact.get('CM')?.all === 3 && exact.get('BJ')?.all === 1 && exact.get('XX')?.all === 1, JSON.stringify([...exact]));
    check('exact: per source', exact.get('CM')?.web === 2 && exact.get('CM')?.app === 2);

    await hll.trackConnected([
        { userId: String(users[0]), day: today, country: 'CM', sources: { web: 1 } },
        { userId: String(users[1]), day: today, country: 'CM', sources: { app: 1 } },
        { userId: String(users[2]), day: today, country: 'CM', sources: { web: 1, app: 1 } },
        { userId: String(users[0]), day: today, country: 'CM', sources: { web: 1 } },
        { userId: String(users[3]), day: today, country: 'BJ', sources: { web: 1 } },
        { userId: String(users[4]), day: today, country: 'XX', sources: { web: 1 } },
    ]);
    const live = await hll.liveConnected(today);
    if (live) check('live HyperLogLog counts distinct members', live.get('CM')?.all === 3 && live.get('CM')?.web === 2 && live.get('BJ')?.all === 1, JSON.stringify([...live]));
    else console.log('SKIP  live HyperLogLog (no Redis)');

    // ---- activated ----
    const mkUser = async (country: string) => (await UserModel.create({ name: 'M', email: `${new Types.ObjectId()}@gmail.com`, phoneNumber: `2376${Math.floor(Math.random() * 1e8)}`, password: 'Secret123!', country, referralCode: String(new Types.ObjectId()).slice(-8) } as any))._id;
    const a1 = await mkUser('CM');
    const a2 = await mkUser('BJ');
    const old = await mkUser('CM');
    let seq = 0;
    const sub = (user: Types.ObjectId, type: string, at: Date) => ({ _id: Types.ObjectId.createFromTime(Math.floor(at.getTime() / 1000) - 60 + (seq++)), user, subscriptionType: type, category: 'registration', startDate: at, endDate: new Date(at.getTime() + 365 * 86400_000) });
    await SubscriptionModel.insertMany([
        sub(a1, 'CLASSIQUE', now), sub(a2, 'CIBLE', now),
        sub(old, 'CLASSIQUE', new Date(now.getTime() - 40 * 86400_000)), sub(old, 'CIBLE', now), // upgrade, not a new activation
        { ...sub(a1, 'PRO', now), category: 'feature' },
    ] as any[]);

    // ---- payments ----
    (paymentService as any).getActivityPayments = async (from: string) => ({
        rows: [
            { day: from, country: 'CM', failed: 3, waiting: 2, abandoned: 5, groups: { sbc_code: 1, provider_api: 1, member: 1, unknown: 0 } },
            { day: from, country: 'TG', failed: 1, waiting: 0, abandoned: 0, groups: { sbc_code: 0, provider_api: 0, member: 0, unknown: 1 } },
        ],
    });

    await dash.rollupDay(today, undefined, now);
    await dash.rollupDay(yDay, undefined, now);
    const t0 = Date.now();
    const board = await dash.activityBoard({ range: 'today' }, now);
    const ms = Date.now() - t0;
    const row = (cc: string) => board.rows.find(r => r.country === cc);

    check('started = completed + failed + in progress, every country and the total',
        [...board.rows, board.total].every(r => r.signups.started === r.signups.completed + r.signups.failed + r.signups.inProgress),
        board.rows.map(r => `${r.country}:${r.signups.started}=${r.signups.completed}+${r.signups.failed}+${r.signups.inProgress}`).join(' '));
    const sum = (f: (r: typeof board.total) => number) => board.rows.reduce((a, r) => a + f(r), 0);
    check('country rows add up exactly to the total',
        sum(r => r.signups.started) === board.total.signups.started && sum(r => r.connected) === board.total.connected
        && sum(r => r.activated) === board.total.activated && sum(r => r.payments.failed) === board.total.payments.failed);
    check('members and sign-ups with no country appear in XX, not dropped', (row('XX')?.signups.started ?? 0) === 1 && (row('XX')?.connected ?? 0) === 1);
    check('today CM: 3 forms, 1 completed, 2 refused', row('CM')?.signups.started === 3 && row('CM')?.signups.completed === 1 && row('CM')?.signups.failed === 2);
    check('failed sign-ups split by group (SBC code / member)', row('BJ')?.signups.failedGroups.sbc_code === 1 && row('CM')?.signups.failedGroups.member === 2);
    check('connected today = live count (CM 3, BJ 1)', row('CM')?.connected === 3 && row('BJ')?.connected === 1, `CM ${row('CM')?.connected}`);
    check('activated = first pack only (CM 1, BJ 1; upgrade and add-on not counted)', row('CM')?.activated === 1 && row('BJ')?.activated === 1);
    check('unfinished payments by group, a payments-only country gets its row', row('CM')?.payments.groups.sbc_code === 1 && row('TG')?.payments.failed === 1);
    check('rows sorted by members connected', board.rows[0].country === 'CM');
    check(`board in under 500 ms (${ms} ms)`, ms < 500);

    const week = await dash.activityBoard({ range: '7d' }, now);
    const yRows = week.daily.find(d => d.day === yDay);
    check('7 days: yesterday’s closed attempts counted on their own day', (yRows?.started ?? 0) === 4 && (yRows?.failed ?? 0) === 3 && (yRows?.completed ?? 0) === 1, JSON.stringify(yRows));
    check('7 days: identity holds over the range', week.total.signups.started === week.total.signups.completed + week.total.signups.failed + week.total.signups.inProgress);

    const bj = await dash.activityBoard({ range: 'today', countries: ['BJ'] }, now);
    check('a country filter shows only those countries, total included', bj.rows.every(r => r.country === 'BJ') && bj.total.signups.started === row('BJ')?.signups.started);
    const app = await dash.activityBoard({ range: 'today', source: 'app' }, now);
    check('source filter: app sign-ups only', app.total.signups.started === 1 && app.total.connected === 2, `${app.total.signups.started}/${app.total.connected}`);

    const list = await sa.listSignupAttempts({ from: today, to: today, outcome: 'failed', group: 'member' });
    check('list behind "failed (member)" matches the number, contact masked', list.items.length === board.total.signups.failedGroups.member && list.items.every(i => !i.email || i.email.includes('***')));
    check('cleanCountries refuses junk', JSON.stringify(dash.cleanCountries('cm, BJ ,x1,,ZZZ')) === '["CM","BJ"]');

    await mongoose.connection.dropDatabase();
    await withRedis('test-flush', null, async r => { await r.flushdb(); return null; });
    await mongoose.disconnect();
    await closeRedis();
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
};

main().catch(e => { console.error(e); process.exit(1); });
