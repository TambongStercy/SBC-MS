import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { authenticator } from 'otplib';
import config from '../config';
import { AdminAuthModel, AdminSessionModel } from '../database/models/admin-auth.model';
import UserModel from '../database/models/user.model';
import { notificationService } from '../services/clients/notification.service.client';

/**
 * Asserts the admin sign-in with an authenticator app (2026-11-19, "like the
 * support desk"): first sign-in through the emailed code and enrolment, codes
 * accepted once, backup codes single use, lockout, sessions (idle, revoked),
 * reset for a lost phone.
 *
 * Needs a Mongo instance; uses its own database and drops it.
 *
 *   npx ts-node src/scripts/check-admin-authenticator.ts
 */

const DB = process.env.ADMIN_AUTH_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_users_admin_auth_check';
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};
const refusal = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e: any) { return e; } };

const sentCodes: string[] = [];
const emails: { subject: string }[] = [];
(notificationService as any).sendOtp = async (p: any) => { sentCodes.push(p.code); return true; };
(notificationService as any).sendAccountEmail = async (p: any) => { emails.push(p); return true; };

const ctx = { ip: '203.0.113.7', userAgent: 'check-script' };
const codeAt = (secret: string, offsetSteps: number) => authenticator.clone({ epoch: Date.now() + offsetSteps * 30_000 }).generate(secret);

const main = async () => {
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();

    // Loaded after the stubs, with the key unset first.
    (config.adminAuth as any).totpEncKey = null;
    const svc = await import('../services/admin-auth.service');
    const noKey = await refusal(() => svc.login({ email: 'boss@gmail.com', password: 'Secret123!' }, ctx));
    check('without ADMIN_TOTP_ENC_KEY no admin can sign in (503)', noKey?.statusCode === 503, noKey?.message);
    (config.adminAuth as any).totpEncKey = crypto.randomBytes(32);

    const boss = await UserModel.create({ name: 'Boss', email: 'boss@gmail.com', phoneNumber: '237677000001', password: 'Secret123!', country: 'CM', referralCode: 'BOSS1', role: 'admin' } as any);
    await UserModel.create({ name: 'Membre', email: 'member@gmail.com', phoneNumber: '237677000002', password: 'Secret123!', country: 'CM', referralCode: 'MEMB1' } as any);
    const bossId = String(boss._id);

    // --- refusals look the same ---
    const wrong = await refusal(() => svc.login({ email: 'boss@gmail.com', password: 'nope' }, ctx));
    const unknown = await refusal(() => svc.login({ email: 'ghost@gmail.com', password: 'nope' }, ctx));
    const member = await refusal(() => svc.login({ email: 'member@gmail.com', password: 'Secret123!' }, ctx));
    check('wrong password, unknown email and member account give the same answer',
        wrong?.statusCode === 401 && unknown?.message === wrong?.message && member?.message === wrong?.message, wrong?.message);

    // --- first sign-in: emailed code, then enrolment ---
    const first = await svc.login({ email: 'Boss@Gmail.com ', password: 'Secret123!' }, ctx);
    check('first sign-in asks for the emailed code (no authenticator yet)', first.step === 'email' && sentCodes.length === 1, first.step);
    const badMail = await refusal(() => svc.verifyEmailCode({ challengeId: first.challengeId, code: 'ZZZZZZ' }, ctx));
    check('a wrong emailed code is refused', badMail?.statusCode === 401);
    const skip = await refusal(() => svc.enrollStart({ challengeId: first.challengeId }));
    check('enrolment cannot start before the emailed code', skip?.statusCode === 401);
    const toEnroll = await svc.verifyEmailCode({ challengeId: first.challengeId, code: sentCodes[0].toLowerCase() }, ctx);
    check('the emailed code (any case) opens the enrolment', toEnroll.step === 'enroll');
    const [e1, e2] = await Promise.all([svc.enrollStart({ challengeId: toEnroll.challengeId }), svc.enrollStart({ challengeId: toEnroll.challengeId })]);
    check('two enrolment starts at once show the same key', e1.secret === e2.secret && e1.qrDataUrl.startsWith('data:image/png'));
    const badEnroll = await refusal(() => svc.enrollConfirm({ challengeId: toEnroll.challengeId, code: '000000' }, ctx));
    check('enrolment refuses a wrong code', badEnroll?.statusCode === 401);
    const enrolled = await svc.enrollConfirm({ challengeId: toEnroll.challengeId, code: codeAt(e1.secret, 0) }, ctx);
    const claims = jwt.verify(enrolled.token, config.jwt.secret) as any;
    check('enrolment opens a session: token with the admin session id, 10 backup codes',
        claims.asid === enrolled.sessionId && claims.role === 'admin' && enrolled.backupCodes.length === 10);
    const stored = await AdminAuthModel.findOne({ userId: bossId }).lean();
    check('the secret is stored encrypted, backup codes only as hashes',
        !!stored?.totpSecretEnc && !stored.totpSecretEnc.includes(e1.secret) && !JSON.stringify(stored.backupCodes).includes(enrolled.backupCodes[0]));
    const userDoc = await UserModel.findById(bossId).lean();
    check('nothing about the authenticator is on the user document', !JSON.stringify(userDoc).includes('totp'));
    const replayEnroll = await refusal(() => svc.enrollConfirm({ challengeId: toEnroll.challengeId, code: codeAt(e1.secret, 0) }, ctx));
    check('the enrolment challenge is single use', replayEnroll?.statusCode === 401);

    // --- normal sign-in ---
    const second = await svc.login({ email: 'boss@gmail.com', password: 'Secret123!' }, ctx);
    check('next sign-in asks for the authenticator, no email sent', second.step === 'totp' && sentCodes.length === 1);
    const replay = await refusal(() => svc.completeTotp({ challengeId: second.challengeId, code: codeAt(e1.secret, 0) }, ctx));
    check('a code already used is refused (replay)', replay?.statusCode === 401);
    const ok = await svc.completeTotp({ challengeId: second.challengeId, code: codeAt(e1.secret, 1) }, ctx);
    check('the next code signs in', !!ok.token && ok.backupCodesRemaining === 10);
    check('known device: no new-device email', !emails.some(e => /nouvelle connexion/.test(e.subject)));
    const reuse = await refusal(() => svc.completeTotp({ challengeId: second.challengeId, code: codeAt(e1.secret, 1) }, ctx));
    check('the sign-in challenge is single use', reuse?.statusCode === 401);

    // --- backup codes ---
    const third = await svc.login({ email: 'boss@gmail.com', password: 'Secret123!' }, { ...ctx, ip: '198.51.100.9' });
    const viaBackup = await svc.completeTotp({ challengeId: third.challengeId, backupCode: enrolled.backupCodes[3].toLowerCase().replace(/-/g, ' ') }, { ...ctx, ip: '198.51.100.9' });
    check('a backup code signs in (any case, any separator), 9 left', !!viaBackup.token && viaBackup.backupCodesRemaining === 9);
    check('new device and backup code each email the admin',
        emails.some(e => /nouvelle connexion/.test(e.subject)) && emails.some(e => /code de secours/.test(e.subject)));
    const fourth = await svc.login({ email: 'boss@gmail.com', password: 'Secret123!' }, ctx);
    const usedBackup = await refusal(() => svc.completeTotp({ challengeId: fourth.challengeId, backupCode: enrolled.backupCodes[3] }, ctx));
    check('a backup code works once', usedBackup?.statusCode === 401);

    // --- sessions ---
    check('an open session is active', await svc.checkSession(bossId, ok.sessionId) === 'active');
    check('a session of another account is not accepted', await svc.checkSession(String(new mongoose.Types.ObjectId()), ok.sessionId) === 'missing');
    await AdminSessionModel.updateOne({ _id: ok.sessionId }, { $set: { lastActivityAt: new Date(Date.now() - 31 * 60 * 1000) } });
    check('30 min without activity ends the session', await svc.checkSession(bossId, ok.sessionId) === 'idle'
        && await svc.checkSession(bossId, ok.sessionId) === 'revoked');
    await AdminSessionModel.updateOne({ _id: viaBackup.sessionId }, { $set: { absoluteExpiresAt: new Date(Date.now() - 1000) } });
    check('a session ends after its maximum length whatever the activity', await svc.checkSession(bossId, viaBackup.sessionId) === 'expired');
    await svc.revokeSession(enrolled.sessionId, 'logout');
    check('sign-out ends the session', await svc.checkSession(bossId, enrolled.sessionId) === 'revoked');

    // --- regenerate backup codes ---
    const badRegen = await refusal(() => svc.regenerateBackupCodes(bossId, '000000'));
    // (as if 30 s had passed since the last sign-in: the current code is not used yet)
    await AdminAuthModel.updateOne({ userId: bossId }, { $set: { lastUsedStep: null } });
    const regen = await svc.regenerateBackupCodes(bossId, codeAt(e1.secret, 0));
    check('new backup codes need a current authenticator code', badRegen?.statusCode === 401 && regen.length === 10);

    // --- lockout ---
    emails.length = 0;
    await AdminAuthModel.updateOne({ userId: bossId }, { $set: { failures: 0, failuresSince: null } });
    for (let i = 0; i < 4; i++) await refusal(() => svc.login({ email: 'boss@gmail.com', password: 'bad' }, ctx));
    const fifth = await svc.login({ email: 'boss@gmail.com', password: 'Secret123!' }, ctx);
    await refusal(() => svc.completeTotp({ challengeId: fifth.challengeId, code: '123456' }, ctx));
    const locked = await refusal(() => svc.login({ email: 'boss@gmail.com', password: 'Secret123!' }, ctx));
    check('5 failures (password or code) lock the account, even with the right password', locked?.statusCode === 401);
    check('the lockout emails the admin', emails.some(e => /bloquée/.test(e.subject)));
    check('a locked account answers like any refusal', locked?.message === wrong?.message);

    // --- lost phone ---
    const sess = (await AdminSessionModel.countDocuments({ userId: bossId, revokedAt: null }));
    const reset = await svc.resetAuthenticator(bossId, 'other-super-admin');
    check('reset ends every open session', reset.sessionsEnded === sess && await AdminSessionModel.countDocuments({ userId: bossId, revokedAt: null }) === 0);
    const afterReset = await svc.login({ email: 'boss@gmail.com', password: 'Secret123!' }, ctx);
    check('after a reset the next sign-in goes back to the emailed code and a new enrolment', afterReset.step === 'email');

    const status = await svc.securityStatus([bossId]);
    check('team status: no authenticator after reset', status[bossId].authenticator === false);

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
    process.exit(failures ? 1 : 0);
};

main().catch(async e => { console.error(e); await mongoose.disconnect(); process.exit(1); });
