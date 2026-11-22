/**
 * Asserts the admin money-action guard (Security plan Phase 3 item 6) over real HTTP through the
 * real routers, with user-service faked and the controllers stubbed (no money logic runs):
 *   - every money route (admin withdrawal from a member's balance, direct payout, payouts
 *     initiate/test, approve, bulk approve, manual complete) refuses without the admin's code
 *     (403 ADMIN_CODE_REQUIRED) and passes with it; the code is removed from the body before the
 *     controller sees it; reject / manual fail are not guarded;
 *   - a token without an admin session (no `asid`) is refused before user-service is asked;
 *   - a wrong code keeps user-service's 403 ADMIN_CODE_INVALID; user-service down → 503;
 *   - ADMIN_STEPUP_REQUIRED=false turns it off.
 *
 *   npx ts-node --transpile-only src/scripts/check-admin-step-up.ts
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
process.env.SERVICE_SECRET = 'check-risk-secret';
process.env.USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost/unused';
process.env.ADVERTISING_SERVICE_URL = process.env.ADVERTISING_SERVICE_URL || 'http://localhost/unused';
process.env.TOMBOLA_SERVICE_URL = process.env.TOMBOLA_SERVICE_URL || 'http://localhost/unused';
process.env.NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost/unused';
process.env.PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL || 'http://localhost/unused';
process.env.LEDGER_TRIPLE_CHECK = 'off';
delete process.env.SUPPORT_SERVICE_URL;
import http from 'http';
import express from 'express';
import jwt from 'jsonwebtoken';
import { AddressInfo } from 'net';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

const main = async () => {
    // ---- fake user-service: the step-up answers ----
    const asked: any[] = [];
    let mode: 'ok' | 'invalid' | 'down' = 'ok';
    const us = http.createServer((req, res) => {
        let raw = '';
        req.on('data', c => { raw += c; });
        req.on('end', () => {
            const body = JSON.parse(raw || '{}');
            asked.push({ url: req.url, auth: req.headers.authorization, body });
            if (mode === 'down') { res.writeHead(502); return res.end(); }
            const code = body.code || body.backupCode;
            res.writeHead(code === '123456' || code === 'aaaa-bbbb' || (!code && mode === 'ok' && body.sid === 'windowed') ? 200 : 403, { 'Content-Type': 'application/json' });
            if (code === '123456' || code === 'aaaa-bbbb') return res.end(JSON.stringify({ success: true, data: { until: new Date(Date.now() + 600_000).toISOString(), method: body.backupCode ? 'backup_code' : 'totp' } }));
            if (!code && body.sid === 'windowed') return res.end(JSON.stringify({ success: true, data: { until: new Date(Date.now() + 300_000).toISOString(), method: 'window' } }));
            res.end(JSON.stringify(code ? { success: false, code: 'ADMIN_CODE_INVALID', message: 'Code incorrect ou déjà utilisé.' } : { success: false, code: 'ADMIN_CODE_REQUIRED', message: 'Confirmez avec le code de votre application d’authentification.' }));
        });
    }).listen(0);
    process.env.USER_SERVICE_URL = `http://127.0.0.1:${(us.address() as AddressInfo).port}/api`;

    const { userServiceClient } = await import('../services/clients/user.service.client');
    (userServiceClient as any).baseUrl = process.env.USER_SERVICE_URL;

    // ---- controllers stubbed: they only report what reached them ----
    const reached: { name: string; body: any }[] = [];
    const stub = (o: any, names: string[]) => { for (const n of names) o[n] = (req: any, res: any) => { reached.push({ name: n, body: { ...req.body } }); res.json({ success: true }); }; };
    stub((await import('../api/controllers/withdrawal.controller')).withdrawalController, ['initiateAdminUserWithdrawal', 'initiateAdminDirectPayout']);
    stub((await import('../api/controllers/payout.controller')).payoutController, ['initiatePayout', 'testPayout']);
    stub((await import('../api/controllers/withdrawal-approval.controller')).withdrawalApprovalController, ['bulkApproveWithdrawals', 'approveWithdrawal', 'rejectWithdrawal', 'manualCompleteMoneyFusionWithdrawal', 'manualFailMoneyFusionWithdrawal']);

    const app = express();
    app.use(express.json());
    app.use('/withdrawals', (await import('../api/routes/withdrawal.routes')).default);
    app.use('/payouts', (await import('../api/routes/payout.routes')).default);
    app.use('/admin/withdrawals', (await import('../api/routes/withdrawal-approval.routes')).default);
    const srv = app.listen(0);
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const { default: config } = await import('../config');
    const token = (claims: object) => jwt.sign({ userId: '6b00000000000000000000aa', id: '6b00000000000000000000aa', role: 'admin', ...claims }, config.jwt.secret, { expiresIn: '1h' });
    const admin = token({ asid: '6b00000000000000000000ff' });
    const post = async (path: string, body: object, t = admin) => {
        const r = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: JSON.stringify(body) });
        return { status: r.status, body: await r.json().catch(() => ({})) as any };
    };

    const MONEY: [string, object][] = [
        ['/withdrawals/admin/user', { userId: '6b0000000000000000000001', amount: 5000, phoneNumber: '237670000001', countryCode: 'CM' }],
        ['/withdrawals/admin/direct', { amount: 5000, phoneNumber: '237670000001', countryCode: 'CM', recipientName: 'X' }],
        ['/payouts/initiate', { amount: 1000 }],
        ['/payouts/test', {}],
        ['/admin/withdrawals/bulk-approve', { transactionIds: ['t1', 't2'] }],
        ['/admin/withdrawals/t1/approve', {}],
        ['/admin/withdrawals/t1/manual-complete', { reason: 'vu sur le tableau MF' }],
    ];

    // ---- without a code ----
    let all = true;
    for (const [path, body] of MONEY) {
        const r = await post(path, body);
        if (r.status !== 403 || r.body.code !== 'ADMIN_CODE_REQUIRED') { all = false; console.log('   ', path, r.status, r.body.code); }
    }
    check('every money route without a code → 403 ADMIN_CODE_REQUIRED, controller never reached', all && reached.length === 0);
    check('user-service asked with the service secret, the admin id, the session and the action',
        asked.length === MONEY.length && asked.every(a => a.url === '/api/users/internal/admin-step-up' && a.auth === 'Bearer check-risk-secret' && a.body.userId === '6b00000000000000000000aa' && a.body.sid === '6b00000000000000000000ff')
        && asked.map(a => a.body.action).join() === 'admin_user_withdrawal,admin_direct_payout,payout_initiate,payout_test,withdrawal_bulk_approve,withdrawal_approve,withdrawal_manual_complete');

    // ---- with the code ----
    all = true;
    for (const [path, body] of MONEY) {
        const r = await post(path, { ...body, adminCode: '123456' });
        if (r.status !== 200) { all = false; console.log('   ', path, r.status, r.body); }
    }
    check('every money route with the admin’s code → reaches the controller', all && reached.length === MONEY.length, `${reached.length}`);
    check('the code never reaches the controller (removed from the body)', reached.every(x => !('adminCode' in x.body) && !('adminBackupCode' in x.body)) && reached[0].body.amount === 5000);
    const bk = await post('/admin/withdrawals/t2/approve', { adminBackupCode: 'aaaa-bbbb' });
    check('a backup code works too', bk.status === 200 && asked.at(-1)?.body.backupCode === 'aaaa-bbbb');
    const win = await post('/admin/withdrawals/t3/approve', {}, token({ asid: 'windowed' }));
    check('inside the 10-minute window: no code needed', win.status === 200);

    // ---- not guarded ----
    const n0 = asked.length;
    const rej = await post('/admin/withdrawals/t1/reject', { reason: 'non' });
    check('reject is not guarded (moves no money)', rej.status === 200 && asked.length === n0);

    // ---- refusals ----
    const bad = await post('/admin/withdrawals/t1/approve', { adminCode: '000000' });
    check('wrong code → 403 ADMIN_CODE_INVALID passed through', bad.status === 403 && bad.body.code === 'ADMIN_CODE_INVALID');
    const n1 = asked.length;
    const noSession = await post('/withdrawals/admin/direct', { adminCode: '123456', amount: 1 }, token({}));
    check('admin token without an admin session (no asid) → 403, user-service not even asked', noSession.status === 403 && noSession.body.code === 'ADMIN_CODE_REQUIRED' && asked.length === n1);
    mode = 'down';
    const down = await post('/admin/withdrawals/t1/approve', { adminCode: '123456' });
    check('user-service down → 503 (never paid unconfirmed)', down.status === 503);
    mode = 'ok';

    // ---- kill switch ----
    process.env.ADMIN_STEPUP_REQUIRED = 'false';
    const off = await post('/admin/withdrawals/t9/approve', {});
    check('ADMIN_STEPUP_REQUIRED=false → no code asked', off.status === 200);
    delete process.env.ADMIN_STEPUP_REQUIRED;

    srv.close(); us.close();
    console.log(failures ? `\n${failures} FAILED` : '\nall passed');
    process.exit(failures ? 1 : 0);
};
main().catch(e => { console.error(e); process.exit(1); });
