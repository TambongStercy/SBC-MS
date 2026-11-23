import crypto from 'crypto';
import mongoose from 'mongoose';
import { authenticator } from 'otplib';
import UserModel from '../database/models/user.model';
import { MemberAuthModel } from '../database/models/member-auth.model';
import { notificationService } from '../services/clients/notification.service.client';
import { userService } from '../services/user.service';
import { memberAuthService } from '../services/member-auth.service';

/**
 * Asserts the member authenticator (Security plan Phase 3): setup (password →
 * code to the account's own e-mail → QR → first code → 10 backup codes), and
 * that changing the MoMo number or the crypto wallet needs the password + an
 * app code (or a backup code), each accepted once, with lockouts after 5 wrong
 * codes. Also the support reset (72 h withdrawal lock).
 *
 * Needs a Mongo instance; uses its own database and drops it.
 *
 *   npx ts-node src/scripts/check-member-authenticator.ts
 */

const DB = process.env.MEMBER_AUTH_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_users_member_auth_check';
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};
const refusal = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e: any) { return e; } };

const sent: any[] = [];
const alerts: any[] = [];
(notificationService as any).sendOtp = async (p: any) => { sent.push(p); return true; };
(notificationService as any).sendAccountEmail = async (p: any) => { alerts.push(p); return true; };
(notificationService as any).sendPush = async () => true;
const fresh = async (id: string) => (await UserModel.findById(id).lean()) as any;
/** The app's code `offset` steps from now (30 s each). */
const appCode = (secret: string, offset = 0) => authenticator.clone({ epoch: Date.now() + offset * 30000 }).generate(secret);

const TRX = 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8';

const main = async () => {
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();

    const u = await UserModel.create({
        name: 'Membre', email: 'owner@gmail.com', phoneNumber: '237677001122', password: 'Secret123!', country: 'CM',
        referralCode: 'AUTH1', momoNumber: '237677001122', momoOperator: 'MTN_MOMO_CMR',
    } as any);
    const id = String(u._id);

    // --- not configured ---
    delete process.env.MEMBER_TOTP_ENC_KEY;
    const noKey = await refusal(() => memberAuthService.requestSetup(id, { password: 'Secret123!' }));
    check('without MEMBER_TOTP_ENC_KEY, setup answers 503', noKey?.statusCode === 503, noKey?.message);
    process.env.MEMBER_TOTP_ENC_KEY = crypto.randomBytes(32).toString('base64');

    // --- no authenticator: changes refused ---
    const noAuthMomo = await refusal(() => userService.changeMomo(id, { momoNumber: '699998877', momoOperator: 'ORANGE_CMR', password: 'Secret123!', code: '123456' }));
    check('MoMo change without an authenticator → 403 AUTHENTICATOR_REQUIRED, nothing saved',
        noAuthMomo?.statusCode === 403 && noAuthMomo?.code === 'AUTHENTICATOR_REQUIRED' && (await fresh(id)).momoNumber === '237677001122', noAuthMomo?.message);
    const noAuthCrypto = await refusal(() => userService.changeCryptoWallet(id, { cryptoWalletAddress: TRX, cryptoWalletCurrency: 'TRX', password: 'Secret123!', code: '123456' }));
    check('crypto wallet change without an authenticator → 403 AUTHENTICATOR_REQUIRED', noAuthCrypto?.code === 'AUTHENTICATOR_REQUIRED');
    const noAuthVerify = await refusal(() => memberAuthService.verifyCode(id, '123456', 'withdrawal'));
    check('a withdrawal code check without an authenticator → AUTHENTICATOR_REQUIRED', noAuthVerify?.code === 'AUTHENTICATOR_REQUIRED');
    check('status says not enabled', (await memberAuthService.status(id)).enabled === false);

    // --- setup ---
    const badPass = await refusal(() => memberAuthService.requestSetup(id, { password: 'nope' }));
    check('setup with a wrong password is refused, nothing sent', badPass?.statusCode === 400 && sent.length === 0);
    const req1 = await memberAuthService.requestSetup(id, { password: 'Secret123!' });
    const mail = sent[sent.length - 1];
    check('setup sends a code to the ACCOUNT e-mail, masked in the answer, purpose setupAuthenticator',
        mail?.recipient === 'owner@gmail.com' && mail?.purpose === 'setupAuthenticator' && req1.sentTo === 'ow***@gmail.com', req1.sentTo);
    const wrongStart = await refusal(() => memberAuthService.startSetup(id, { code: 'ZZZZZZ' }));
    check('a wrong e-mail code does not start the setup', wrongStart?.statusCode === 400);
    const signInCode = await userService.generateAndStoreOtp(id, 'otps', 10);
    const viaSignIn = await refusal(() => memberAuthService.startSetup(id, { code: signInCode }));
    check('a sign-in code does not start the setup', viaSignIn?.statusCode === 400);
    await memberAuthService.requestSetup(id, {}); // resend without password while a code is live
    const start = await memberAuthService.startSetup(id, { code: sent[sent.length - 1].code.toLowerCase() });
    check('the right e-mail code (any case) gives a QR code and the secret',
        start.qrDataUrl.startsWith('data:image/png;base64,') && /^[A-Z2-7]{32}$/.test(start.secret) && start.otpauthUrl.includes('issuer=SBC'), start.otpauthUrl);
    const stored = await MemberAuthModel.findOne({ userId: u._id }).lean();
    check('the pending secret is stored encrypted, not in clear', !!stored?.pendingSecretEnc && !stored.pendingSecretEnc.includes(start.secret));
    const wrongConfirm = await refusal(() => memberAuthService.confirmSetup(id, { code: '000000' }));
    check('a wrong first code does not turn it on', wrongConfirm?.statusCode === 400 && !(await memberAuthService.isEnabled(id)));
    const confirmed = await memberAuthService.confirmSetup(id, { code: appCode(start.secret) });
    check('the first app code turns it on and returns 10 backup codes',
        confirmed.backupCodes.length === 10 && confirmed.backupCodes.every(c => /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(c)) && await memberAuthService.isEnabled(id));
    check('the member is told by e-mail', alerts.some(a => a.email === 'owner@gmail.com' && /authentification activée/.test(a.subject)));
    const again = await refusal(() => memberAuthService.requestSetup(id, { password: 'Secret123!' }));
    check('a second setup is refused while one is on (409)', again?.statusCode === 409);
    const st = await memberAuthService.status(id);
    check('status: enabled, 10 backup codes', st.enabled && st.backupCodesRemaining === 10);

    // --- MoMo change ---
    const momoBadPass = await refusal(() => userService.changeMomo(id, { momoNumber: '699998877', momoOperator: 'ORANGE_CMR', password: 'nope', code: appCode(start.secret, 1) }));
    check('MoMo change with a wrong password is refused', momoBadPass?.statusCode === 400 && /Mot de passe/.test(momoBadPass?.message));
    const momoBadCode = await refusal(() => userService.changeMomo(id, { momoNumber: '699998877', momoOperator: 'ORANGE_CMR', password: 'Secret123!', code: '000000' }));
    check('MoMo change with a wrong app code is refused, nothing saved',
        momoBadCode?.statusCode === 400 && (await fresh(id)).momoNumber === '237677001122');
    const code1 = appCode(start.secret, 1);
    const momo = await userService.changeMomo(id, { momoNumber: '699998877', momoOperator: 'ORANGE_CMR', password: 'Secret123!', code: code1 });
    let doc = await fresh(id);
    check('password + app code change the number', doc.momoNumber === '237699998877' && doc.momoOperator === 'ORANGE_CMR' && momo.momoNumber === '237699998877');
    check('replacing a number locks withdrawals (momo_change) and alerts the e-mail',
        doc.withdrawalLockReason === 'momo_change' && !!momo.withdrawalsLockedUntil && alerts.some(a => /Mobile Money/.test(a.subject)));
    check('no e-mail code was sent for the change', !sent.some(s => s.purpose === 'changeMomo'));
    const replay = await refusal(() => userService.changeMomo(id, { momoNumber: '699990000', momoOperator: 'ORANGE_CMR', password: 'Secret123!', code: code1 }));
    check('the same app code is refused a second time, saying to wait for the next one, not counted as a failure',
        replay?.statusCode === 400 && /déjà servi/.test(replay?.message) && (await fresh(id)).momoNumber === '237699998877'
        && (await MemberAuthModel.findOne({ userId: u._id }).lean())!.failures === 0, replay?.message);

    // --- a number saved without its operator: completing it locks nothing (2026-11-23) ---
    await UserModel.updateOne({ _id: u._id }, { $set: { momoOperator: '' }, $unset: { withdrawalsLockedUntil: 1, withdrawalLockReason: 1 } });
    await MemberAuthModel.updateOne({ userId: u._id }, { $set: { lastUsedStep: null } }); // a minute later
    const alertsBefore = alerts.length;
    const opOnly = await userService.changeMomo(id, { momoNumber: '699998877', momoOperator: 'ORANGE_CMR', password: 'Secret123!', code: appCode(start.secret) });
    doc = await fresh(id);
    check('adding the missing operator to the same number: saved, no lock, no alert',
        doc.momoOperator === 'ORANGE_CMR' && doc.momoNumber === '237699998877' && opOnly.withdrawalsLockedUntil === null
        && !doc.withdrawalLockReason && alerts.length === alertsBefore);
    const { momoChangeLocks } = await import('../utils/momo');
    check('lock rule: first number no, operator added no, new number yes, operator replaced yes',
        !momoChangeLocks({ momoNumber: null, momoOperator: null }, '237699998877', 'CM')
        && !momoChangeLocks({ momoNumber: '237699998877', momoOperator: '' }, '699998877', 'CM')
        && !momoChangeLocks({ momoNumber: '237699998877', momoOperator: null }, '+237 6 99 99 88 77', 'CM')
        && momoChangeLocks({ momoNumber: '237699998877', momoOperator: '' }, '237699990000', 'CM')
        && momoChangeLocks({ momoNumber: '237699998877', momoOperator: 'MTN_MOMO_CMR' }, '237699998877', 'CM'));

    // --- crypto wallet, with a backup code ---
    const backup = confirmed.backupCodes[0];
    const crypto1 = await userService.changeCryptoWallet(id, { cryptoWalletAddress: TRX, cryptoWalletCurrency: 'trx', password: 'Secret123!', code: backup.toLowerCase().replace(/-/g, ' ') });
    doc = await fresh(id);
    check('a backup code (any case/spacing) sets a first crypto wallet, without a new lock',
        doc.cryptoWalletAddress === TRX && crypto1.withdrawalsLockedUntil === null);
    check('using a backup code alerts the e-mail with what is left', alerts.some(a => /code de secours/.test(a.subject) && /9/.test(a.body)));
    const backupAgain = await refusal(() => memberAuthService.verifyCode(id, backup, 'withdrawal'));
    check('a backup code works once', backupAgain?.statusCode === 400);
    check('9 backup codes left', (await memberAuthService.status(id)).backupCodesRemaining === 9);

    // --- withdrawal check (what payment-service calls) ---
    await MemberAuthModel.updateOne({ userId: u._id }, { $set: { lastUsedStep: null } }); // a minute later
    const w = await memberAuthService.verifyCode(id, appCode(start.secret), 'withdrawal');
    check('a fresh app code confirms a withdrawal', w.method === 'totp');

    // --- lockout ---
    await MemberAuthModel.updateOne({ userId: u._id }, { $set: { failures: 0, failuresSince: null } });
    const errs: any[] = [];
    for (let i = 0; i < 5; i++) errs.push(await refusal(() => memberAuthService.verifyCode(id, '000000', 'withdrawal')));
    check('the 5th wrong code locks the checks (429)', errs.slice(0, 4).every(e => e?.statusCode === 400) && errs[4]?.statusCode === 429, errs[4]?.message);
    const whileLocked = await refusal(() => memberAuthService.verifyCode(id, appCode(start.secret), 'withdrawal'));
    check('while locked even a right code is refused', whileLocked?.statusCode === 429);
    const lockedDoc = await MemberAuthModel.findOne({ userId: u._id }).lean();
    const mins = (new Date(lockedDoc!.lockedUntil!).getTime() - Date.now()) / 60000;
    check('first lock lasts 15 min and the member is alerted', mins > 14 && mins <= 15 && alerts.some(a => /bloqués/.test(a.subject)), mins.toFixed(1));

    // --- support reset ---
    await UserModel.updateOne({ _id: u._id }, { $unset: { withdrawalsLockedUntil: 1, withdrawalLockReason: 1 } });
    const reset = await memberAuthService.resetBySupport(id, 'check script');
    doc = await fresh(id);
    const hours = (new Date(reset.withdrawalsLockedUntil).getTime() - Date.now()) / 3600000;
    check('support reset removes the authenticator and locks withdrawals 72 h (authenticator_reset)',
        !(await memberAuthService.isEnabled(id)) && doc.withdrawalLockReason === 'authenticator_reset' && hours > 71.9 && hours <= 72, hours.toFixed(2));
    const afterReset = await refusal(() => memberAuthService.verifyCode(id, appCode(start.secret, 3), 'withdrawal'));
    check('after a reset the old app no longer works', afterReset?.code === 'AUTHENTICATOR_REQUIRED');

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
};

main().catch(async e => { console.error(e); await mongoose.disconnect().catch(() => undefined); process.exit(1); });
