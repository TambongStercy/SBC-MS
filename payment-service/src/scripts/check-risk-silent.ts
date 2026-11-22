/**
 * Asserts Security plan Phase 4's payout hook (payment-service side), through
 * assertWithdrawalsNotLocked, which every withdrawal path calls:
 *   RISK_MODE off → risk-service never asked; silent → asked with the service
 *   secret, a `hold` answer is logged and refuses nothing; risk-service slow
 *   (300 ms) or down → the withdrawal goes on after ~100 ms.
 * No database: user-service is stubbed, risk-service is a local fake.
 *
 *   npx ts-node --transpile-only src/scripts/check-risk-silent.ts
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
import { AddressInfo } from 'net';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

const main = async () => {
    const paymentService = (await import('../services/payment.service')).default as any;
    const { userServiceClient } = await import('../services/clients/user.service.client');
    (userServiceClient as any).getWithdrawalLock = async () => ({ locked: false });

    const asked: { auth?: string; body: any }[] = [];
    let delayMs = 0;
    let answer: any = { decision: 'hold', score: 90, reasons: [{ rule: 'shared_payout_number', points: 40, detail: 'Numéro partagé' }] };
    const fake = http.createServer((req, res) => {
        let raw = '';
        req.on('data', c => { raw += c; });
        req.on('end', () => {
            asked.push({ auth: req.headers.authorization, body: JSON.parse(raw || '{}') });
            setTimeout(() => {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, data: answer }));
            }, delayMs);
        });
    }).listen(0);
    process.env.RISK_SERVICE_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
    const run = async (audience: 'member' | 'admin' = 'member') => {
        const t0 = Date.now();
        try { await paymentService.assertWithdrawalsNotLocked('6b0000000000000000000001', audience); return { err: null, ms: Date.now() - t0 }; } catch (e: any) { return { err: e, ms: Date.now() - t0 }; }
    };

    process.env.RISK_MODE = 'off';
    let r = await run();
    check('off: risk-service never asked, nothing refused', !r.err && asked.length === 0);

    process.env.RISK_MODE = 'silent';
    r = await run();
    check('silent: asked with the service secret, `hold` refuses nothing', !r.err && asked.length === 1 && asked[0].auth === 'Bearer check-risk-secret' && asked[0].body.action === 'withdrawal' && asked[0].body.userId === '6b0000000000000000000001');
    r = await run('admin');
    check('silent: admin approval asks as withdrawal_admin', !r.err && asked[1]?.body.action === 'withdrawal_admin');

    delayMs = 300;
    r = await run();
    check('silent: risk-service slow (300 ms) → goes on after ~100 ms', !r.err && r.ms < 250, `${r.ms} ms`);

    // ---- enforce (decided 2026-11-22): a held member cannot take money out ----
    delayMs = 0;
    process.env.RISK_MODE = 'enforce';
    const n0 = asked.length;
    r = await run();
    check('enforce: hold → member refused (403, RISK_HOLD), told to send ID + selfie', r.err?.statusCode === 403 && r.err?.code === 'RISK_HOLD' && /vérification de sécurité/.test(r.err.message) && /selfie/.test(r.err.message) && asked[n0]?.body.enforced === true, r.err?.message);
    r = await run('admin');
    check('enforce: hold → admin approval refused too, says how to release', r.err?.statusCode === 403 && /libérer/.test(r.err.message), r.err?.message);
    answer = { decision: 'require_code', score: 45, reasons: [] };
    r = await run();
    check('enforce: require_code passes (the app code is already asked)', !r.err);
    answer = { decision: 'allow', score: 90, reasons: [], released: true };
    r = await run();
    check('enforce: released by support (allow) passes', !r.err);
    delayMs = 2000;
    r = await run();
    check('enforce: risk-service too slow → refused 503 (never paid blind)', r.err?.statusCode === 503, `${r.ms} ms`);
    process.env.RISK_FAIL_OPEN = 'true';
    r = await run();
    check('enforce: RISK_FAIL_OPEN=true → goes on when risk-service is slow', !r.err);
    delete process.env.RISK_FAIL_OPEN;
    process.env.RISK_MODE = 'silent';

    fake.close();
    process.env.RISK_SERVICE_URL = 'http://127.0.0.1:9';
    r = await run();
    check('silent: risk-service down → goes on', !r.err);
    process.env.RISK_MODE = 'enforce';
    r = await run();
    check('enforce: risk-service down → refused 503', r.err?.statusCode === 503);

    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
};

main().catch(e => { console.error(e); process.exit(1); });
