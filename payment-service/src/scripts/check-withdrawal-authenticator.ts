/**
 * Asserts the withdrawal side of the member authenticator (Security plan
 * Phase 3): a member without an authenticator app cannot start a withdrawal
 * (MoMo or crypto), no code is e-mailed when the app confirms it, the
 * confirmation checks the app code through user-service (only for the
 * withdrawal's owner), MEMBER_AUTHENTICATOR_REQUIRED=false restores the
 * e-mailed code, and the old free-address crypto payout is closed.
 *
 * No database: user-service, notifications and the transaction store are stubbed.
 *
 *   npx ts-node src/scripts/check-withdrawal-authenticator.ts
 */

export {}; // a module, so its names do not clash with the other check scripts

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
process.env.WITHDRAWALS_ENABLED = 'true';
delete process.env.MEMBER_AUTHENTICATOR_REQUIRED;

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};
const refusal = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e: any) { return e; } };

const main = async () => {
    // Imported here: the env above must be set before config loads.
    const config = (await import('../config')).default;
    const paymentService = (await import('../services/payment.service')).default;
    const { userServiceClient } = await import('../services/clients/user.service.client');
    const notificationService = (await import('../services/clients/notification.service.client')).default;
    const transactionRepository = (await import('../database/repositories/transaction.repository')).default;
    const { TransactionStatus, TransactionType } = await import('../database/models/transaction.model');
    const { AppError } = await import('../utils/errors');

    let enabled = false;
    let userServiceDown = false;
    const verified: any[] = [];
    let verifyAnswer: { status: number; message: string } | null = null;
    const otpSent: any[] = [];
    const updates: any[] = [];
    (userServiceClient as any).getWithdrawalLock = async () => ({ locked: false });
    (userServiceClient as any).isAuthenticatorEnabled = async () => { if (userServiceDown) throw new Error('down'); return enabled; };
    (userServiceClient as any).verifyAuthenticatorCode = async (userId: string, code: string) => {
        verified.push({ userId, code });
        if (verifyAnswer) throw new AppError(verifyAnswer.message, verifyAnswer.status);
    };
    (userServiceClient as any).getUsdBalance = async () => { throw new Error('PAST_THE_CODE'); };
    (userServiceClient as any).getBalance = async () => { throw new Error('PAST_THE_CODE'); };
    (notificationService as any).sendVerificationOTP = async (p: any) => { otpSent.push(p); return true; };
    (transactionRepository as any).update = async (_id: any, u: any) => { updates.push(u); return u; };
    (transactionRepository as any).updateStatus = async (_id: any, status: any) => { updates.push({ status }); return null; };
    const pending = (userId = 'aaaaaaaaaaaaaaaaaaaaaaaa') => ({
        _id: 't1', transactionId: 'TX1', userId: { toString: () => userId }, type: TransactionType.WITHDRAWAL,
        status: TransactionStatus.PENDING_OTP_VERIFICATION, amount: 20, fee: 1, currency: 'USD',
        verificationCode: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', verificationExpiry: new Date(Date.now() + 600000),
        metadata: { cryptoWithdrawal: true, usdAmount: 20, cryptoAddress: 'T', cryptoCurrency: 'TRX' },
    });
    (transactionRepository as any).findByTransactionId = async () => pending();
    const U = 'aaaaaaaaaaaaaaaaaaaaaaaa';

    check('the requirement is on by default', config.memberAuthenticatorRequired === true);

    // --- starting a withdrawal ---
    let e = await refusal(() => paymentService.initiateWithdrawal(U, 5000));
    check('MoMo withdrawal without an authenticator → 403 AUTHENTICATOR_REQUIRED', e?.statusCode === 403 && e?.code === 'AUTHENTICATOR_REQUIRED', e?.message);
    e = await refusal(() => paymentService.initiateCryptoWithdrawalWithOTP(U, 20));
    check('crypto withdrawal without an authenticator → 403 AUTHENTICATOR_REQUIRED', e?.statusCode === 403 && e?.code === 'AUTHENTICATOR_REQUIRED', e?.message);
    userServiceDown = true;
    e = await refusal(() => paymentService.initiateWithdrawal(U, 5000));
    check('user-service unreachable → refused (503), fails closed', e?.statusCode === 503);
    userServiceDown = false;

    // --- no code e-mailed ---
    const sentBefore = otpSent.length;
    const r = await (paymentService as any).sendWithdrawalOTP('TX1');
    check('with the authenticator required, no withdrawal code is sent', otpSent.length === sentBefore && /^[0-9a-f]{32}$/.test(r.verificationCode), r.verificationCode);

    // --- confirming ---
    e = await refusal(() => paymentService.verifyWithdrawal('TX1', '123456', 'bbbbbbbbbbbbbbbbbbbbbbbb'));
    check('another member cannot confirm the withdrawal (404), no code checked', e?.statusCode === 404 && verified.length === 0, e?.message);
    updates.length = 0;
    verifyAnswer = { status: 400, message: 'Code incorrect.' };
    e = await refusal(() => paymentService.verifyWithdrawal('TX1', '000000', U));
    check('a wrong app code is refused with user-service’s answer, nothing processed',
        e?.statusCode === 400 && e?.message === 'Code incorrect.' && verified.length === 1 && verified[0].userId === U && updates.length === 0, e?.message);
    verifyAnswer = null;
    e = await refusal(() => paymentService.verifyWithdrawal('TX1', '123456', U));
    check('a right app code goes on to the balance check', /PAST_THE_CODE/.test(e?.message || '') && verified[1]?.code === '123456', e?.message);
    e = await refusal(() => paymentService.verifyWithdrawal('TX1', 'a1b2c3d4e5f60718293a4b5c6d7e8f90', U));
    check('the stored placeholder is not accepted as such: the app checks every code', verified.length === 3);

    // --- switch off: the e-mailed code again ---
    (config as any).memberAuthenticatorRequired = false;
    enabled = false;
    e = await refusal(() => paymentService.verifyWithdrawal('TX1', '999999', U));
    check('MEMBER_AUTHENTICATOR_REQUIRED=false: the stored code is compared again, the app is not asked',
        e?.message === 'Invalid verification code.' && verified.length === 3, e?.message);
    (config as any).memberAuthenticatorRequired = true;

    // --- the old crypto payout to any address ---
    e = await refusal(() => paymentService.createCryptoPayout(U, 20, 'TRX', 'TAnyAddressTypedInTheRequest000000', 'x'));
    check('the old crypto payout to an address from the request is closed (410)', e?.statusCode === 410, e?.message);

    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
};

main().catch(e => { console.error(e); process.exit(1); });
