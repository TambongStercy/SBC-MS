/**
 * Asserts Security plan Phase 4, part 2 (live events) against local Mongo.
 * Test databases only (risk, users, payment), dropped before and after. Each
 * event rule fires on its scenario and stays silent on its legitimate twin:
 *   - events route: service secret, validation, network/device kept as HMACs only;
 *   - watcher: new withdrawals by _id cursor (first pass starts from now), paid
 *     payments in the last 24 h, each once;
 *   - contact change → withdrawal ≤ 72 h (30) vs 100 h before (nothing);
 *   - same day new device + new country + new number (40 + case) vs usual device
 *     and country, and vs a member with no history (nothing);
 *   - withdrawal from a hosting network (15) vs a mobile network (nothing);
 *   - signup burst under one sponsor from one network (sponsor 30, recruits 20,
 *     case) vs the same number of sign-ups from different networks (nothing);
 *   - live linking: a sponsor withdrawing to his recruit's number → the group is
 *     rescored with the look-back's rules (shared number + self-referral → hold);
 *   - two members paying with one number → linked group of 2, score 0;
 *   - dormant account back (15) + contact change withdrawal → require_code;
 *     the decision API lists live reasons;
 *   - live reasons expire; the weekly rebuild keeps live reasons and the
 *     structural ones it finds again; rebuild schedule;
 *   - a case is not resent to support while unchanged; KYC queued on signup.
 *
 *   npx ts-node --transpile-only src/scripts/check-live.ts
 */
import express from 'express';
import axios from 'axios';
import mongoose, { Types } from 'mongoose';
import { randomBytes } from 'crypto';
import { AddressInfo } from 'net';

const BASE = process.env.RISK_TEST_MONGO || 'mongodb://127.0.0.1:27017';
process.env.MONGODB_URI = `${BASE}/sbc_risk_live_test`;
process.env.SERVICE_SECRET = 'risk-check-secret-0123456789';
process.env.RISK_HASH_KEY = 'risk-check-hash-key';
process.env.SUPPORT_SERVICE_URL = 'http://127.0.0.1:9';
process.env.USERS_MONGODB_URI = `${BASE}/sbc_users_live_test`;
process.env.PAYMENT_MONGODB_URI = `${BASE}/sbc_payment_live_test`;
delete process.env.REDIS_URL;
delete process.env.RISK_LIVE_DISABLED;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};
const doualaDay = (d: Date) => new Date(d.getTime() + HOUR).toISOString().slice(0, 10);
const idAt = (d: Date) => new Types.ObjectId(Math.floor(d.getTime() / 1000).toString(16).padStart(8, '0') + randomBytes(8).toString('hex'));

const main = async () => {
    const { config } = await import('../config');
    const { setSource } = await import('../lib/sources');
    const live = await import('../services/live.service');
    const { expireLiveReasons } = await import('../services/scoring');
    const { runLookback } = await import('./lookback');
    const { RiskMemberModel, RiskEventModel, IdentifierModel, KycQueueModel, RiskRunModel, RiskCaseSentModel } = await import('../database/models');
    const { createApp } = await import('../server');

    await mongoose.connect(config.mongoUri);
    const users = await mongoose.createConnection(config.sources.usersUri).asPromise();
    const payment = await mongoose.createConnection(config.sources.paymentUri).asPromise();
    await Promise.all([users.dropDatabase(), payment.dropDatabase(), mongoose.connection.dropDatabase()]);
    await Promise.all([RiskMemberModel.syncIndexes(), RiskEventModel.syncIndexes(), IdentifierModel.syncIndexes()]);
    setSource('users', users);
    setSource('payment', payment);

    const received: any[] = [];
    const fake = express().use(express.json()).post('/api/support/internal/cases', (req, res) => { received.push(req.body); res.status(201).json({ success: true }); }).listen(0);
    (config as any).supportUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
    const server = createApp().listen(0);
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const auth = { headers: { Authorization: `Bearer ${config.serviceSecret}`, 'x-service-name': 'user-service' } };

    const ids: Record<string, Types.ObjectId> = {};
    for (const k of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'S', 'T', 'Q']) ids[k] = new Types.ObjectId();
    const id = (k: string) => String(ids[k]);
    const recruitsS = Array.from({ length: 5 }, () => new Types.ObjectId());
    const recruitsT = Array.from({ length: 5 }, () => new Types.ObjectId());
    await users.collection('users').insertMany([
        ...Object.entries(ids).map(([k, _id]) => ({ _id, name: `Membre ${k}`, country: k === 'C' ? 'CM' : 'CM', momoNumber: k === 'Q' ? '237690009999' : null })),
        ...[...recruitsS, ...recruitsT].map(_id => ({ _id, name: 'Recrue', country: 'CM' })),
    ]);
    await users.collection('referrals').insertMany([
        { referrer: ids.H, referredUser: ids.I, referralLevel: 1 },
        ...recruitsS.map(r => ({ referrer: ids.S, referredUser: r, referralLevel: 1 })),
        ...recruitsT.map(r => ({ referrer: ids.T, referredUser: r, referralLevel: 1 })),
    ]);

    const now0 = new Date();
    const T0 = new Date(now0.getTime() - 60_000);
    const today = doualaDay(now0);
    // consented signals: 10 days of history in CM on device dev-old, then today
    const geo: any[] = [];
    for (const k of ['C', 'D']) {
        for (let d = 2; d <= 11; d++) geo.push({ userId: ids[k], day: doualaDay(new Date(now0.getTime() - d * DAY)), country: 'CM', devices: [`dev-old-${k}-1234`], asns: [30992] });
    }
    geo.push({ userId: ids.C, day: today, country: 'BJ', devices: ['dev-new-C-5678'], asns: [37136] });
    geo.push({ userId: ids.D, day: today, country: 'CM', devices: ['dev-old-D-1234'], asns: [30992] });
    geo.push({ userId: ids.E, day: today, country: 'BJ', devices: ['dev-new-E-5678'], asns: [37136] });
    geo.push({ userId: ids.F, day: today, country: 'CM', devices: [], asns: [16509] });
    geo.push({ userId: ids.G, day: today, country: 'CM', devices: [], asns: [30992] });
    await users.collection('user_geo_days').insertMany(geo);

    // ---- events route ----
    check('events without the service secret → 401', (await axios.post(`${url}/api/risk/internal/events`, { type: 'signup', userId: id('A') }, { validateStatus: () => true })).status === 401);
    check('unknown type → 400', (await axios.post(`${url}/api/risk/internal/events`, { type: 'withdrawal_requested', userId: id('A') }, { ...auth, validateStatus: () => true })).status === 400);
    check('contact_change without a kind → 400', (await axios.post(`${url}/api/risk/internal/events`, { type: 'contact_change', userId: id('A') }, { ...auth, validateStatus: () => true })).status === 400);

    // contact changes: A 10 h before its withdrawal, B 100 h before
    await axios.post(`${url}/api/risk/internal/events`, { type: 'contact_change', userId: id('A'), kind: 'momo', at: new Date(T0.getTime() - 10 * HOUR) }, auth);
    await axios.post(`${url}/api/risk/internal/events`, { type: 'contact_change', userId: id('B'), kind: 'email', at: new Date(T0.getTime() - 100 * HOUR) }, auth);
    await axios.post(`${url}/api/risk/internal/events`, { type: 'dormant_reactivated', userId: id('A'), from: 'dormant' }, auth);
    // sign-ups: S's five recruits from one network, T's from five
    for (const r of recruitsS) await axios.post(`${url}/api/risk/internal/events`, { type: 'signup', userId: String(r), ipRange: '41.202.7.0/24', userAgent: 'Mozilla/5.0 (Linux; Android 12)' }, auth);
    for (let i = 0; i < recruitsT.length; i++) await axios.post(`${url}/api/risk/internal/events`, { type: 'signup', userId: String(recruitsT[i]), ipRange: `102.244.${i}.0/24`, userAgent: 'Mozilla/5.0 (Linux; Android 12)' }, auth);
    const stored = await RiskEventModel.find({ type: 'signup' }).lean() as any[];
    check('signup events: network kept as an HMAC, never the range or user agent', stored.length === 10 && stored.every(e => /^[a-f0-9]{40}$/.test(e.data.net)) && !JSON.stringify(stored).includes('41.202') && !JSON.stringify(stored).includes('Android'));

    // ---- watcher ----
    check('watcher first pass: starts from now, records nothing', (await live.watchWithdrawals(T0)) === 0);
    const tx = (k: string, s: number, number: string | null, amount = 20000) => ({
        _id: idAt(new Date(T0.getTime() + s * 1000)), userId: ids[k], type: 'withdrawal', status: 'pending', amount, currency: 'XAF', createdAt: new Date(T0.getTime() + s * 1000),
        metadata: { accountInfo: number ? { fullMomoNumber: number } : {} },
    });
    await payment.collection('transactions').insertMany([
        tx('A', 1, '237670000001'), tx('B', 2, '237670000002'), tx('C', 3, '22997000003'), tx('D', 4, '237670000004'), tx('E', 5, '22997000005'),
        tx('F', 6, '237670000006'), tx('G', 7, '237670000007'),
        tx('I', 8, '237655000777', 30000), tx('H', 9, '+237 655 000 777', 40000),
        { _id: idAt(new Date(T0.getTime() + 10_000)), userId: ids.A, type: 'deposit', status: 'completed', amount: 500, currency: 'XAF', createdAt: new Date(T0.getTime() + 10_000) },
    ]);
    await payment.collection('paymentintents').insertMany([
        { userId: id('J'), status: 'SUCCEEDED', phoneNumber: '22961112233', createdAt: new Date(Date.now() - HOUR), updatedAt: new Date() },
        { userId: id('K'), status: 'SUCCEEDED', phoneNumber: '+229 61 11 22 33', createdAt: new Date(Date.now() - HOUR), updatedAt: new Date() },
        { userId: id('K'), status: 'FAILED', phoneNumber: '22960000000', createdAt: new Date(Date.now() - HOUR) },
    ]);
    const nW = await live.watchWithdrawals(new Date());
    check('watcher: 9 withdrawals recorded (the deposit ignored)', nW === 9, String(nW));
    check('watcher again: nothing new', (await live.watchWithdrawals(new Date())) === 0);
    check('payins: the 2 paid payments recorded, once', (await live.watchPayins()) === 2 && (await live.watchPayins()) === 0);
    const wdEvents = await RiskEventModel.find({ type: 'withdrawal_requested' }).lean() as any[];
    check('withdrawal events carry the number as an HMAC + 3-digit tail only', wdEvents.every(e => /^[a-f0-9]{40}$/.test(e.data.payout) && e.data.payoutTail.length === 3) && !JSON.stringify(wdEvents).includes('655000777'));

    // ---- process ----
    let total = 0;
    for (let i = 0; i < 5; i++) total += (await live.processEvents(100, new Date())).done;
    check('all events handled', total === 24 && (await RiskEventModel.countDocuments({ status: { $ne: 'done' } })) === 0, `${total}`);

    const mem = async (k: string) => RiskMemberModel.findOne({ userId: k.length === 24 ? k : id(k) }).lean() as any;
    const rules = (m: any) => [...(m?.reasons ?? []), ...(m?.liveReasons ?? [])].map((r: any) => r.rule).sort().join(',');
    const a = await mem('A');
    check('A: withdrawal 10 h after a MoMo change (30) + dormant back (15) → 45 require_code', a?.score === 45 && a?.decision === 'require_code', `${a?.score} ${rules(a)}`);
    check('B: contact change 100 h before → nothing', ((await mem('B'))?.score ?? 0) === 0);
    const c = await mem('C');
    check('C: new device + new country (BJ) + new number the same day → 40 require_code', c?.score === 40 && c?.liveReasons?.[0]?.rule === 'new_device_country_payout' && c.liveReasons[0].detail.includes('BJ'), rules(c));
    check('D: usual device and country → nothing', ((await mem('D'))?.score ?? 0) === 0);
    check('E: no history (new member) → nothing', ((await mem('E'))?.score ?? 0) === 0);
    check('F: withdrawal on a day seen from AWS → datacenter 15', (await mem('F'))?.score === 15);
    check('G: mobile network → nothing', ((await mem('G'))?.score ?? 0) === 0);
    const s = await mem('S');
    const sr = await Promise.all(recruitsS.map(r => mem(String(r))));
    check('S: 5 sign-ups from one network → sponsor 30, each recruit 20', s?.score === 30 && sr.every(m => m?.score === 20), `${s?.score} ${sr.map(m => m?.score)}`);
    const tr = await Promise.all(recruitsT.map(r => mem(String(r))));
    check('T: 5 sign-ups from 5 networks → nothing', ((await mem('T'))?.score ?? 0) === 0 && tr.every(m => (m?.score ?? 0) === 0));
    const h = await mem('H');
    check('H withdraws to his recruit I\'s number → group rescored: shared number + self-referral → 90 hold', h?.score === 90 && h?.decision === 'hold' && (await mem('I'))?.decision === 'hold', `${h?.score} ${rules(h)}`);
    const k = await mem('K');
    check('J and K paid with one number → linked group of 2, score 0', k?.groupSize === 2 && k?.score === 0 && (await mem('J'))?.groupSize === 2);
    check('KYC queued for the 10 sign-ups and both contact changes', (await KycQueueModel.countDocuments()) === 12, String(await KycQueueModel.countDocuments()));
    check('identifier index holds no full number', !JSON.stringify(await IdentifierModel.find().lean()).includes('655000777'));

    // cases
    await new Promise(r => setTimeout(r, 50));
    const types = received.map(x => `${x.type}:${x.alert}`).sort();
    check('cases sent live, alerting: new device (abnormal), signup burst, shared number, self-referral', received.length === 4 && received.every(x => x.alert === true) && received.some(x => x.type === 'abnormal_behavior' && x.subject.userId === id('C')) && received.some(x => x.dedupKey.startsWith('risk:signup_burst:') && x.details.accountCount === 5), types.join(' '));

    // a second withdrawal by H: group rescored again, cases unchanged → not resent
    await payment.collection('transactions').insertOne(tx('H', 20, '237655000777', 1000));
    const before = received.length;
    await live.recordEvent({ type: 'withdrawal_requested', userId: id('H'), key: 'wd:manual-h', data: { payout: (await RiskEventModel.findOne({ userId: id('H'), type: 'withdrawal_requested' }).lean() as any).data.payout, payoutTail: '777' } });
    await live.processEvents(100, new Date());
    check('unchanged cases are not resent to support', received.length === before && (await RiskCaseSentModel.countDocuments()) === 4);

    // ---- decision + member view ----
    const dec = (await axios.post(`${url}/api/risk/internal/decision`, { userId: id('A'), action: 'withdrawal' }, auth)).data.data;
    check('decision API: A require_code, live reasons listed', dec.decision === 'require_code' && dec.reasons.some((r: any) => r.rule === 'contact_change_withdrawal'));
    const view = (await axios.get(`${url}/api/risk/internal/members/${id('H')}`, auth)).data.data;
    check('member view: linked recruit, shared number by tail, recent events (types, tails)', view.linked.some((x: any) => x.userId === id('I')) && view.identifiers.length === 1 && view.identifiers[0].tail === '777' && view.events.some((e: any) => e.type === 'withdrawal_requested' && e.numberTail === '777'));
    const viewA = (await axios.get(`${url}/api/risk/internal/members/${id('A')}`, auth)).data.data;
    check('member view: live reasons with their expiry; own unshared number not listed', viewA.liveReasons.length === 2 && viewA.liveReasons.every((r: any) => r.expiresAt) && viewA.identifiers.length === 0);
    const st = (await axios.get(`${url}/api/risk/internal/live/status`, auth)).data.data;
    check('live status: on, nothing pending, counts by type', st.on === true && st.pending === 0 && st.last24h.signup === 10, JSON.stringify(st.last24h));

    // ---- expiry ----
    const n = await expireLiveReasons(new Date(Date.now() + 8 * DAY));
    const a8 = await mem('A');
    check('8 days later: 7-day reasons expire (A keeps the 30-day dormant 15 → allow; C back to 0)', n >= 3 && a8?.score === 15 && a8?.decision === 'allow' && (await mem('C'))?.score === 0, `${n} ${a8?.score}`);

    // ---- weekly rebuild ----
    const r = await runLookback({ usersUri: config.sources.usersUri, paymentUri: config.sources.paymentUri, since: null, apply: true, cases: true, kind: 'rebuild', log: () => undefined });
    const sAfter = await mem('S');
    check('rebuild keeps live reasons (S 30) and re-finds structural ones (H 90 hold)', sAfter?.score === 30 && (await mem('H'))?.score === 90 && r.runId?.startsWith('rebuild-'));
    check('rebuild stores every identifier (shared or not) and files nothing already sent', (await IdentifierModel.countDocuments()) >= 9 && received.length === before, `${await IdentifierModel.countDocuments()}`);
    const sunday = new Date(Date.UTC(2026, 10, 22, 0, 30)); // Sunday 01:30 Douala
    check('rebuild schedule: due Sunday 01:xx Douala only once a week', !(await live.rebuildDue(sunday)) && (await RiskRunModel.deleteMany({ kind: 'rebuild' })) && await live.rebuildDue(sunday) && !(await live.rebuildDue(new Date(sunday.getTime() + DAY))));

    server.close(); fake.close();
    await Promise.all([users.dropDatabase(), payment.dropDatabase(), mongoose.connection.dropDatabase()]);
    setSource('users', null); setSource('payment', null);
    await users.close(); await payment.close();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
};

main().catch(e => { console.error(e); process.exit(1); });
