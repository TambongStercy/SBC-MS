/**
 * Asserts Security plan Phase 2's withdrawal pre-check (payment-service side):
 * LEDGER_TRIPLE_CHECK off → nothing asked; log → never refuses, opens a case on a
 * difference; enforce → refuses a difference, a sync in progress (409, retry)
 * and an unreachable ledger (503, never paid blind); Blnk not configured → passes.
 * Runs through assertWithdrawalsNotLocked, which every withdrawal path calls.
 * No database: user-service and support are stubbed.
 *
 *   npx ts-node --transpile-only src/scripts/check-ledger-triple-check.ts
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
delete process.env.SUPPORT_SERVICE_URL;
export {};

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

const main = async () => {
    const paymentService = (await import('../services/payment.service')).default as any;
    const { userServiceClient } = await import('../services/clients/user.service.client');
    let asked = 0;
    let answer: any = () => ({ enabled: true, agree: true, reason: null });
    (userServiceClient as any).getWithdrawalLock = async () => ({ locked: false });
    (userServiceClient as any).getLedgerCheck = async (_u: string, currency: string) => { asked++; const a = answer(currency); if (a instanceof Error) throw a; return { currency, ...a }; };
    const run = async () => { try { await paymentService.assertWithdrawalsNotLocked('6b0000000000000000000001'); return null; } catch (e: any) { return e; } };

    process.env.LEDGER_TRIPLE_CHECK = 'off';
    answer = () => ({ enabled: true, agree: false, reason: 'a_differs_from_c', a: 10, b: 10, c: 5 });
    check('off: nothing asked, nothing refused', !(await run()) && asked === 0);

    process.env.LEDGER_TRIPLE_CHECK = 'log';
    check('log: a difference never refuses (shadow weeks)', !(await run()) && asked === 2);

    process.env.LEDGER_TRIPLE_CHECK = 'enforce';
    let e = await run();
    check('enforce: a difference refuses (409)', e?.statusCode === 409 && /vérification/.test(e.message), e?.message);
    answer = () => ({ enabled: true, agree: false, reason: 'sync_pending', pendingSync: 1 });
    e = await run();
    check('enforce: a sync in progress asks to retry in a minute', e?.statusCode === 409 && /minute/.test(e.message));
    answer = () => new Error('ECONNREFUSED');
    e = await run();
    check('enforce: ledger unreachable → refused (503), never paid blind', e?.statusCode === 503);
    answer = () => ({ enabled: false });
    check('enforce: Blnk not configured → passes', !(await run()));
    answer = (c: string) => (c === 'USD' ? { enabled: true, agree: false, reason: 'a_differs_from_b', a: 3, b: 2, c: 2 } : { enabled: true, agree: true, reason: null });
    check('enforce: a USD difference refuses too', (await run())?.statusCode === 409);
    answer = () => ({ enabled: true, agree: true, reason: null });
    check('enforce: all three agree → passes', !(await run()));

    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
};
main().catch(e => { console.error(e); process.exit(1); });
