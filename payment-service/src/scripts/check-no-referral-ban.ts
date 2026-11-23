/**
 * Asserts the no-referral withdrawal rule on payment-service's side (2026-11-23), through
 * assertWithdrawalsNotLocked, which every path that takes a member's money out calls:
 *   - NO_REFERRAL_BAN off → user-service is not asked;
 *   - log → asked; a would-be ban files a warning case and refuses nothing; user-service down → go on;
 *   - enforce → a ban refuses 403 code ACCOUNT_BANNED (the member app's contract) and files a
 *     critical `no_referral_withdrawal_ban` case (dedup per member + ban, French summary with the
 *     reasons, the amounts and the withdrawal); user-service down → 503, never paid blind;
 *   - the lock reason `account_banned` refuses member AND admin paths (403 ACCOUNT_BANNED), before
 *     anything else is asked;
 *   - admin paths never run the rule; drills pass dryRun and file nothing;
 *   - the controllers put `code` in the JSON body (same path as RISK_HOLD).
 * No database: user-service is stubbed, support is a local HTTP server.
 *
 *   npx ts-node --transpile-only src/scripts/check-no-referral-ban.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.PORT = process.env.PORT || '3003';
process.env.HOST = process.env.HOST || '0.0.0.0';
process.env.MONGODB_URI_PROD = process.env.MONGODB_URI_PROD || 'mongodb://127.0.0.1:27017/unused';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'check';
process.env.FEEXPAY_API_KEY = process.env.FEEXPAY_API_KEY || 'check';
process.env.FEEXPAY_SHOP_ID = process.env.FEEXPAY_SHOP_ID || 'check';
process.env.MONEYFUSION_API_URL = process.env.MONEYFUSION_API_URL || 'http://localhost/unused';
process.env.NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY || 'check';
process.env.PAYMENT_SERVICE_BASE_URL = process.env.PAYMENT_SERVICE_BASE_URL || 'http://localhost:3003';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
process.env.SERVICE_SECRET = process.env.SERVICE_SECRET || 'check';
process.env.USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost/unused';
process.env.ADVERTISING_SERVICE_URL = process.env.ADVERTISING_SERVICE_URL || 'http://localhost/unused';
process.env.TOMBOLA_SERVICE_URL = process.env.TOMBOLA_SERVICE_URL || 'http://localhost/unused';
process.env.NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost/unused';
process.env.PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL || 'http://localhost/unused';
process.env.LEDGER_TRIPLE_CHECK = 'off';
process.env.RISK_MODE = 'off';
import http from 'http';
import { AddressInfo } from 'net';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
    // A fake support-service: records every case.
    const cases: any[] = [];
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
            if (req.url === '/api/support/internal/cases') cases.push(JSON.parse(body));
            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, data: { caseId: 'c1', created: true } }));
        });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    process.env.SUPPORT_SERVICE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const paymentService = (await import('../services/payment.service')).default as any;
    const { userServiceClient } = await import('../services/clients/user.service.client');
    const U = '6b0000000000000000000a01';
    let lock: any = { locked: false };
    let asked: any[] = [];
    let answer: any = () => ({ mode: 'enforce', suspicious: false, banned: false, alreadyBanned: false, reasons: [], details: null, ban: null });
    (userServiceClient as any).getWithdrawalLock = async () => lock;
    (userServiceClient as any).withdrawalBanCheck = async (u: string, ctx: any) => { asked.push({ u, ctx }); const a = answer(); if (a instanceof Error) throw a; return a; };
    const run = async (audience: 'member' | 'admin' = 'member', attempt: any = {}) => {
        try { await paymentService.assertWithdrawalsNotLocked(U, audience, attempt); return null; } catch (e: any) { return e; }
    };
    const settle = () => sleep(150);
    const banned = {
        mode: 'enforce', suspicious: true, banned: true, alreadyBanned: false, reasons: ['unexplained_balance', 'commission_without_referrals'],
        details: { currency: 'XAF', a: 51000, b: 1000, commissionCredits: 1500, commissionCreditsUsd: 0, balances: [{ currency: 'XAF', a: 51000, b: 1000, diff: 50000, decidable: true, unexplained: true }] },
        ban: { at: '2026-11-23T10:00:00.000Z', reason: 'no_referral_withdrawal' },
    };

    process.env.NO_REFERRAL_BAN = 'off';
    check('off: user-service not asked, nothing refused', !(await run()) && asked.length === 0);

    process.env.NO_REFERRAL_BAN = 'log';
    answer = () => ({ ...banned, mode: 'log', banned: false, ban: null });
    let e = await run('member', { amount: 20000, currency: 'XAF', amountXaf: 20000 });
    await settle();
    check('log: a would-be ban refuses nothing', !e && asked.length === 1 && asked[0].ctx.amount === 20000 && asked[0].ctx.dryRun === false);
    check('log: a warning case is filed (no ring)', cases.length === 1 && cases[0].type === 'no_referral_withdrawal_ban' && cases[0].severity === 'warning' && /aurait été suspendu/.test(cases[0].summary), JSON.stringify(cases[0]));
    answer = () => new Error('ECONNREFUSED');
    check('log: user-service down → goes on', !(await run()));

    process.env.NO_REFERRAL_BAN = 'enforce';
    cases.length = 0; asked = [];
    answer = () => ({ mode: 'enforce', suspicious: false, banned: false, alreadyBanned: false, reasons: [], details: null, ban: null });
    check('enforce: explained money → passes', !(await run()) && asked.length === 1);
    answer = () => banned;
    e = await run('member', { amount: 20000, currency: 'XAF', amountXaf: 20000, transactionId: 'TX1' });
    await settle();
    check('enforce: banned → 403 code ACCOUNT_BANNED, French message', e?.statusCode === 403 && e?.code === 'ACCOUNT_BANNED' && /suspendu/.test(e?.message), e?.message);
    const c = cases[0];
    check('enforce: critical no_referral_withdrawal_ban case, deduped per member + ban',
        c?.type === 'no_referral_withdrawal_ban' && c?.severity === 'critical' && c?.dedupKey === `noref-ban:${U}:2026-11-23T10:00:00.000Z` && c?.subject?.userId === U && c?.subject?.transactionId === 'TX1' && c?.amount === 20000);
    check('enforce: the summary names the reasons, the amounts and the withdrawal',
        /sans aucun filleul/.test(c?.summary) && /solde 51000/.test(c?.summary) && /mouvements 1000/.test(c?.summary) && /1500 XAF/.test(c?.summary) && /20000 XAF/.test(c?.summary), c?.summary);
    answer = () => new Error('ECONNREFUSED');
    e = await run();
    check('enforce: user-service down → 503, never paid blind', e?.statusCode === 503);

    // Drills: dryRun, nothing filed.
    cases.length = 0; asked = [];
    answer = () => ({ ...banned, banned: false, ban: null });
    e = await run('member', { dryRun: true });
    await settle();
    check('drill (dryRun): asked with dryRun, never refused by the rule, no case', !e && asked[0]?.ctx?.dryRun === true && cases.length === 0);

    // Admin paths: the rule is never run, the ban lock refuses.
    asked = [];
    answer = () => banned;
    check('admin path: the rule is not run', !(await run('admin')) && asked.length === 0);
    lock = { locked: true, until: '9999-12-31T00:00:00.000Z', reason: 'account_banned' };
    e = await run('admin');
    check('account_banned lock: admin path refused 403 ACCOUNT_BANNED', e?.statusCode === 403 && e?.code === 'ACCOUNT_BANNED' && /suspension/.test(e?.message));
    e = await run('member');
    check('account_banned lock: member path refused 403 ACCOUNT_BANNED before anything else is asked', e?.statusCode === 403 && e?.code === 'ACCOUNT_BANNED' && asked.length === 0);
    lock = { locked: true, until: '2099-01-01T00:00:00.000Z', reason: 'email_change' };
    e = await run('member');
    check('another lock still answers as before (rule not asked)', e?.statusCode === 403 && !e?.code && asked.length === 0);
    lock = { locked: false };

    // The member entry points carry `code` into the JSON body.
    const ctl = (await import('../api/controllers/transaction.controller')).transactionController as any;
    const rq = (body: any) => ({ user, body, headers: {}, header: () => undefined, get: () => undefined, ip: '127.0.0.1' });
    const user = { userId: U, id: U, role: 'user', email: 'm@gmail.com' };
    const fakeRes = () => { const o: any = { statusCode: 200 }; o.status = (s: number) => { o.statusCode = s; return o; }; o.json = (b: any) => { o.body = b; return o; }; return o; };
    const origInit = paymentService.initiateWithdrawal;
    const origVerify = paymentService.verifyWithdrawal;
    const origPay = paymentService.processPayment;
    const refusal = async () => { await paymentService.assertWithdrawalsNotLocked(U, 'member'); };
    lock = { locked: true, until: '9999-12-31T00:00:00.000Z', reason: 'account_banned' };
    paymentService.initiateWithdrawal = refusal; paymentService.initiateCryptoWithdrawalWithOTP = refusal;
    paymentService.verifyWithdrawal = refusal; paymentService.processPayment = refusal;
    const contract = (r: any) => r.statusCode === 403 && r.body?.success === false && r.body?.code === 'ACCOUNT_BANNED' && typeof r.body?.message === 'string';
    let res = fakeRes();
    await ctl.initiateWithdrawal(rq({ amount: 5000, withdrawalType: 'mobile_money' }), res);
    check('POST /transactions/withdrawal/initiate → 403 { success:false, code:ACCOUNT_BANNED, message }', contract(res), JSON.stringify(res.body));
    res = fakeRes();
    await ctl.initiateWithdrawal(rq({ amount: 10, withdrawalType: 'crypto' }), res);
    check('crypto initiate → same contract', contract(res), JSON.stringify(res.body));
    res = fakeRes();
    await ctl.verifyWithdrawal(rq({ transactionId: 'TX1', verificationCode: '123456' }), res);
    check('POST /transactions/withdrawal/verify → same contract', contract(res), JSON.stringify(res.body));
    (userServiceClient as any).validateUser = async () => true;
    res = fakeRes();
    await ctl.processPayment(rq({ recipientId: '6b0000000000000000000a02', amount: 100, currency: 'XAF', description: 'x' }), res);
    check('POST /transactions/payment (transfer) → same contract', contract(res), JSON.stringify(res.body));
    paymentService.initiateWithdrawal = origInit; paymentService.verifyWithdrawal = origVerify; paymentService.processPayment = origPay;

    server.close();
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
};
main().catch((e) => { console.error(e); process.exit(1); });
