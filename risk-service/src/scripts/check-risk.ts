/**
 * Asserts Security plan Phase 4, part 1 (risk-service) against local Mongo
 * (+ Redis when REDIS_URL is set). Test databases only, dropped before and after:
 *   - rules: shared withdrawal number in a referral tree, self-referral in a
 *     linked group, multi-account group, quick withdrawal; hubs link nothing;
 *     a disabled rule scores nothing; thresholds;
 *   - look-back end to end from fake user/payment databases (read-only), with
 *     --apply writing scores, identifiers (hashed, tail only) and cases;
 *   - a second run clears a member who is no longer flagged;
 *   - decision API: secret required, unknown member = allow, held member = hold,
 *     each question logged; member view lists linked accounts;
 *   - case outbox: support down → queued, support back → delivered once.
 *
 *   npx ts-node --transpile-only src/scripts/check-risk.ts
 */
import express from 'express';
import axios from 'axios';
import mongoose, { Types } from 'mongoose';
import { AddressInfo } from 'net';

const BASE = process.env.RISK_TEST_MONGO || 'mongodb://127.0.0.1:27017';
process.env.MONGODB_URI = `${BASE}/sbc_risk_test`;
process.env.SERVICE_SECRET = 'risk-check-secret-0123456789';
process.env.RISK_HASH_KEY = 'risk-check-hash-key';
process.env.SUPPORT_SERVICE_URL = 'http://127.0.0.1:9';
const USERS = `${BASE}/sbc_users_risk_test`;
const PAYMENT = `${BASE}/sbc_payment_risk_test`;

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

const main = async () => {
    const { analyse, RULE_POINTS } = await import('../services/analysis');
    const { phoneKey } = await import('../services/identity');
    const { runLookback } = await import('./lookback');
    const { RiskMemberModel, IdentifierModel, RiskRunModel } = await import('../database/models');
    const { DecisionLogModel } = await import('../services/decision.service');
    const { SupportCaseOutbox, flushOutbox } = await import('../services/support.client');
    const { config } = await import('../config');
    const { createApp } = await import('../server');
    const { closeRedis } = await import('../lib/redis');

    // ---- pure rules ----
    check('phoneKey: +237 6 99 00 11 22 and 699001122 are the same number', phoneKey('+237 6 99 00 11 22') === phoneKey('699001122') && phoneKey('12') === null);
    const t = (min: number) => new Date(Date.UTC(2026, 9, 1, 10, min));
    const cfg = { hubThreshold: 50, thresholds: { requireCode: 40, hold: 70 }, disabledRules: new Set<string>() };
    const hubAccounts = Array.from({ length: 60 }, (_, i) => `hub${i}`);
    const facts = () => ({
        identifiers: [
            { kind: 'payout_number' as const, value: '699000001', userId: 'A' },
            { kind: 'payout_number' as const, value: '699000001', userId: 'B' },
            { kind: 'payin_number' as const, value: '677000002', userId: 'C' },
            { kind: 'payin_number' as const, value: '677000002', userId: 'D' },
            { kind: 'profile_momo' as const, value: '677000002', userId: 'E' },
            { kind: 'profile_momo' as const, value: '677000003', userId: 'E' },
            ...hubAccounts.map(u => ({ kind: 'payin_number' as const, value: '600000000', userId: u })),
            { kind: 'payout_number' as const, value: '655000009', userId: 'X' },
            { kind: 'payout_number' as const, value: '655000009', userId: 'Y' },
        ],
        referrals: [{ referrer: 'A', referred: 'B', level: 1 }, { referrer: 'hub0', referred: 'hub1', level: 1 }],
        withdrawals: [
            { userId: 'A', amount: 60000, at: t(30), completed: true },
            { userId: 'B', amount: 50000, at: t(40), completed: true },
            { userId: 'F', amount: 4500, at: t(10), completed: true },
        ],
        commissions: [{ userId: 'F', amount: 5000, at: t(0) }],
        countries: new Map([['A', 'CM'], ['B', 'CM'], ['C', 'BJ']]),
    });
    const r = analyse(facts(), cfg);
    const m = (id: string) => r.members.find(x => x.userId === id);
    check('A and B: shared withdrawal number in their referral tree (40) + self-referral (50) → hold', m('A')?.score === 90 && m('A')?.decision === 'hold' && m('B')?.decision === 'hold', JSON.stringify(m('A')?.reasons.map(x => x.rule)));
    check('C, D (paid with it) and E (profile MoMo) linked by one number → multi_account 20 → allow', m('C')?.score === RULE_POINTS.multi_account && m('E')?.groupSize === 3 && m('C')?.decision === 'allow');
    check('a number shared by 60 accounts is a hub and links nothing (sponsor + recruit there are not flagged)', !m('hub0') && r.stats.hubs === 1);
    check('X and Y share a number but are not related: grouped, no rule, allow', m('X')?.score === 0 && m('X')?.groupSize === 2);
    check('F withdrew 90% of a commission 10 min later → quick_withdrawal 10', m('F')?.score === 10 && m('F')?.reasons[0].rule === 'quick_withdrawal');
    const sharedCase = r.cases.find(c => c.type === 'shared_payout_number');
    check('shared-number case: critical (110,000 F), subject = biggest withdrawer, country, no full number', sharedCase?.severity === 'critical' && sharedCase.amount === 110000 && sharedCase.subject.userId === 'A' && sharedCase.country === 'CM' && !JSON.stringify(sharedCase).includes('699000001'));
    check('cases: shared number, self-referral, multi-account (F has 1 quick withdrawal: no case)', r.stats.casesByType.shared_payout_number === 1 && r.stats.casesByType.self_referral === 1 && r.stats.casesByType.multi_account === 1 && !r.stats.casesByType.abnormal_behavior, JSON.stringify(r.stats.casesByType));
    check('identifiers stored hashed with a 3-digit tail', r.identifiers.every(i => /^[a-f0-9]{40}$/.test(i.hash) && i.tail.length === 3));
    const off = analyse(facts(), { ...cfg, disabledRules: new Set(['self_referral']) });
    check('RISK_DISABLED_RULES=self_referral → A scores 40 → require_code', off.members.find(x => x.userId === 'A')?.score === 40 && off.members.find(x => x.userId === 'A')?.decision === 'require_code');

    // ---- look-back end to end ----
    const users = await mongoose.createConnection(USERS).asPromise();
    const payment = await mongoose.createConnection(PAYMENT).asPromise();
    await mongoose.connect(config.mongoUri);
    await Promise.all([users.dropDatabase(), payment.dropDatabase(), mongoose.connection.dropDatabase()]);
    const [p, f, g, h] = [new Types.ObjectId(), new Types.ObjectId(), new Types.ObjectId(), new Types.ObjectId()];
    await users.collection('users').insertMany([
        { _id: p, name: 'Parrain', country: 'cm', momoNumber: '237690000001' },
        { _id: f, name: 'Filleul', country: 'CM', momoNumber: '670000002' },
        { _id: g, name: 'Autre', country: 'BJ' },
        { _id: h, name: 'Sans lien', country: 'CI' },
    ]);
    await users.collection('referrals').insertMany([{ referrer: p, referredUser: f, referralLevel: 1, archived: false }, { referrer: p, referredUser: g, referralLevel: 1, archived: false }]);
    await payment.collection('transactions').insertMany([
        { userId: p, type: 'withdrawal', status: 'completed', amount: 30000, currency: 'XAF', createdAt: t(0), metadata: { accountInfo: { fullMomoNumber: '+237 699 11 22 33' } } },
        { userId: f, type: 'withdrawal', status: 'completed', amount: 20000, currency: 'XAF', createdAt: t(5), metadata: { accountInfo: { fullMomoNumber: '237699112233' } } },
        { userId: g, type: 'withdrawal', status: 'failed', amount: 10, currency: 'USD', createdAt: t(5), metadata: { accountInfo: { fullMomoNumber: '22961000000' } } },
        { userId: p, type: 'deposit', status: 'completed', amount: 1000, currency: 'XAF', createdAt: t(0), paymentProvider: { metadata: { sourceUserId: String(f) } } },
    ]);
    await payment.collection('paymentintents').insertMany([{ userId: String(h), status: 'SUCCEEDED', phoneNumber: '22961000000' }, { userId: String(g), status: 'SUCCEEDED', phoneNumber: '22961000000' }]);
    const before = await users.collection('users').countDocuments() + await payment.collection('transactions').countDocuments();

    const quiet = () => undefined;
    const dry = await runLookback({ usersUri: USERS, paymentUri: PAYMENT, since: null, apply: false, cases: true, log: quiet });
    check('dry run: finds the shared number between parrain and filleul, writes nothing', dry.result.stats.sharedPayoutNumbers === 1 && (await RiskMemberModel.countDocuments()) === 0);
    const run1 = await runLookback({ usersUri: USERS, paymentUri: PAYMENT, since: null, apply: true, cases: true, log: quiet });
    const pm = await RiskMemberModel.findOne({ userId: String(p) }).lean() as any;
    check('--apply: parrain scored 90 (hold), country upper-cased', pm?.score === 90 && pm?.decision === 'hold' && pm?.country === 'CM', `${pm?.score} ${pm?.country}`);
    check('G (failed withdrawal) and H linked by the number that paid: grouped, allow', (await RiskMemberModel.findOne({ userId: String(g) }).lean() as any)?.groupSize === 2);
    const idents = await IdentifierModel.find().lean() as any[];
    check('identifiers in the risk DB (every one, shared or not) carry no full number', idents.filter(i => i.count >= 2).length === 2 && !JSON.stringify(idents).includes('699112233') && idents.some(i => i.tail === '233'));
    check('source databases untouched', before === await users.collection('users').countDocuments() + await payment.collection('transactions').countDocuments());
    check('support down → cases queued in the outbox', (run1.sent as any)?.queued === 2 && (await SupportCaseOutbox.countDocuments({ deliveredAt: null })) === 2, JSON.stringify(run1.sent));

    // ---- decision API ----
    const server = createApp().listen(0);
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const auth = { headers: { Authorization: `Bearer ${config.serviceSecret}`, 'x-service-name': 'check' } };
    const noAuth = await axios.post(`${url}/api/risk/internal/decision`, { userId: String(p), action: 'withdrawal' }, { validateStatus: () => true });
    check('decision without the service secret → 401', noAuth.status === 401);
    const held = (await axios.post(`${url}/api/risk/internal/decision`, { userId: String(p), action: 'withdrawal', amount: 5000, currency: 'XAF' }, auth)).data.data;
    check('parrain → hold, with reasons', held.decision === 'hold' && held.reasons.some((x: any) => x.rule === 'shared_payout_number'));
    const unknown = (await axios.post(`${url}/api/risk/internal/decision`, { userId: String(new Types.ObjectId()), action: 'withdrawal' }, auth)).data.data;
    check('never-scored member → allow, score 0', unknown.decision === 'allow' && unknown.score === 0);
    await new Promise(res => setTimeout(res, 100));
    check('each question logged in decisionlogs', (await DecisionLogModel.countDocuments({ caller: 'check' })) === 2 && !!(await DecisionLogModel.findOne({ userId: String(p), decision: 'hold', amount: 5000 })));
    const view = (await axios.get(`${url}/api/risk/internal/members/${p}`, auth)).data.data;
    check('member view: linked filleul, shared number by tail only', view.linked.some((x: any) => x.userId === String(f)) && view.identifiers.some((i: any) => i.tail === '233' && i.kind === 'phone' && i.uses.includes('payout_number')));
    check('/health answers 200', (await axios.get(`${url}/health`)).status === 200);
    const flags = (await axios.post(`${url}/api/risk/internal/members/flags`, { userIds: [String(p), String(f), 'not-an-id'] }, auth)).data.data;
    check('flags (Phase 7): only members not simply allowed, by id', flags.length >= 1 && flags.every((x: any) => x.decision !== 'allow') && flags.some((x: any) => x.userId === String(p) && x.decision === 'hold'), JSON.stringify(flags));
    check('flags without the service secret → 401', (await axios.post(`${url}/api/risk/internal/members/flags`, { userIds: [String(p)] }, { validateStatus: () => true })).status === 401);

    // ---- second run: the filleul's withdrawal number changes → no longer flagged ----
    await payment.collection('transactions').updateOne({ userId: f, type: 'withdrawal' }, { $set: { 'metadata.accountInfo.fullMomoNumber': '237655555555' } });
    await runLookback({ usersUri: USERS, paymentUri: PAYMENT, since: null, apply: false, cases: false, log: quiet });
    await runLookback({ usersUri: USERS, paymentUri: PAYMENT, since: null, apply: true, cases: false, log: quiet });
    const again = (await axios.post(`${url}/api/risk/internal/decision`, { userId: String(p), action: 'withdrawal' }, auth)).data.data;
    check('second run: parrain cleared → allow (cache dropped too)', again.decision === 'allow' && again.score === 0, JSON.stringify(again));
    check('two runs recorded', (await RiskRunModel.countDocuments()) === 2);

    // ---- outbox: support comes back ----
    const received: any[] = [];
    const fake = express().use(express.json()).post('/api/support/internal/cases', (req, res) => { received.push({ auth: req.header('authorization'), body: req.body }); res.status(201).json({ success: true }); }).listen(0);
    (config as any).supportUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
    await SupportCaseOutbox.updateMany({}, { $set: { nextAt: new Date(0) } });
    const delivered = await flushOutbox();
    await flushOutbox();
    check('support back → both queued cases delivered once, with the service secret, alert: false', delivered === 2 && received.length === 2 && received.every(x => x.auth === `Bearer ${config.serviceSecret}`) && received.some(x => x.body.type === 'shared_payout_number' && x.body.country === 'CM') && received.every(x => x.body.alert === false));

    server.close(); fake.close();
    await Promise.all([users.dropDatabase(), payment.dropDatabase(), mongoose.connection.dropDatabase()]);
    await users.close(); await payment.close();
    await mongoose.disconnect(); await closeRedis();
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
};

main().catch(e => { console.error(e); process.exit(1); });
