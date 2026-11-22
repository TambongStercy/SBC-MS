import crypto from 'crypto';
import mongoose from 'mongoose';
import { authenticator } from 'otplib';
import config from '../config';
import { AdminAuthModel, AdminSessionModel } from '../database/models/admin-auth.model';
import UserModel from '../database/models/user.model';
import { notificationService } from '../services/clients/notification.service.client';

/**
 * Asserts the admin step-up before money actions (Security plan Phase 3 item 6): an admin token
 * alone moves no money; the admin's own authenticator code (once per code) or a backup code
 * (once, e-mailed) opens a window on that session only; wrong codes count towards the same
 * lockout as sign-in; an ended session is refused.
 *
 * Needs a Mongo instance; uses its own database and drops it.
 *
 *   npx ts-node --transpile-only src/scripts/check-admin-step-up.ts
 */
const DB = process.env.ADMIN_AUTH_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_users_admin_stepup_check';
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};
const refusal = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e: any) { return e; } };
const emails: { subject: string; body: string }[] = [];
(notificationService as any).sendAccountEmail = async (p: any) => { emails.push(p); return true; };
const sent: string[] = [];
(notificationService as any).sendOtp = async (p: any) => { sent.push(p.code); return true; };
const ctx = { ip: '203.0.113.9', userAgent: 'check-script' };
const codeAt = (secret: string, offsetSteps: number) => authenticator.clone({ epoch: Date.now() + offsetSteps * 30_000 }).generate(secret);

const main = async () => {
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();
    (config.adminAuth as any).totpEncKey = crypto.randomBytes(32);
    const svc = await import('../services/admin-auth.service');

    // an enrolled admin with a session, as the sign-in leaves them
    const boss = await UserModel.create({ name: 'Boss', email: 'boss@gmail.com', phoneNumber: '237677000001', password: 'Secret123!', country: 'CM', referralCode: 'BOSS1', role: 'admin' } as any);
    const userId = String(boss._id);
    const first = await svc.login({ email: 'boss@gmail.com', password: 'Secret123!' }, ctx);
    const toEnroll = await svc.verifyEmailCode({ challengeId: first.challengeId, code: sent.at(-1) }, ctx);
    const e = await svc.enrollStart({ challengeId: toEnroll.challengeId });
    const s = await svc.enrollConfirm({ challengeId: toEnroll.challengeId, code: codeAt(e.secret, -1) }, ctx);
    const sid = s.sessionId;
    const backup = s.backupCodes[0];

    let r: any = await refusal(() => svc.stepUp({ userId, sid, action: 'withdrawal_approve' }, ctx));
    check('no code and no window → 403 ADMIN_CODE_REQUIRED', r?.statusCode === 403 && r?.code === 'ADMIN_CODE_REQUIRED', r?.message);
    r = await refusal(() => svc.stepUp({ userId, sid, code: '000000', action: 'withdrawal_approve' }, ctx));
    check('wrong code → 403 ADMIN_CODE_INVALID, counted as a failure', r?.code === 'ADMIN_CODE_INVALID' && (await AdminAuthModel.findOne({ userId }).lean())?.failures === 1);
    const ok = await svc.stepUp({ userId, sid, code: codeAt(e.secret, 0), action: 'withdrawal_approve' }, ctx);
    const until = new Date(ok.until).getTime();
    check('own authenticator code → window of 10 min on this session', ok.method === 'totp' && Math.abs(until - Date.now() - 10 * 60_000) < 5000);
    const win = await svc.stepUp({ userId, sid, action: 'withdrawal_bulk_approve' }, ctx);
    check('inside the window: no new code needed', win.method === 'window');
    r = await refusal(() => svc.stepUp({ userId, sid, code: codeAt(e.secret, 0), action: 'x' }, ctx));
    check('the same code again → refused (used once)', r?.code === 'ADMIN_CODE_INVALID');

    // another session of the same admin has no window
    const other = await AdminSessionModel.create({ userId: boss._id, createdAt: new Date(), lastActivityAt: new Date(), absoluteExpiresAt: new Date(Date.now() + 3600_000), method: 'totp' });
    r = await refusal(() => svc.stepUp({ userId, sid: String(other._id), action: 'x' }, ctx));
    check('another session of the same admin: no window', r?.code === 'ADMIN_CODE_REQUIRED');
    r = await refusal(() => svc.stepUp({ userId: String(new mongoose.Types.ObjectId()), sid, action: 'x' }, ctx));
    check('a session id with another admin’s id → session ended (401)', r?.statusCode === 401 && r?.code === 'ADMIN_SESSION_ENDED');

    // backup code: once, e-mailed
    const b = await svc.stepUp({ userId, sid: String(other._id), backupCode: backup, action: 'payout_initiate' }, ctx);
    check('backup code → window, e-mail sent to the admin', b.method === 'backup_code' && emails.some(m => /code de secours/.test(m.subject) && /opération d’argent/.test(m.body)));
    await AdminSessionModel.updateOne({ _id: other._id }, { $set: { stepUpUntil: null } });
    r = await refusal(() => svc.stepUp({ userId, sid: String(other._id), backupCode: backup, action: 'x' }, ctx));
    check('the same backup code again → refused', r?.code === 'ADMIN_CODE_INVALID');

    // window ends
    await AdminSessionModel.updateOne({ _id: sid }, { $set: { stepUpUntil: new Date(Date.now() - 1000) } });
    r = await refusal(() => svc.stepUp({ userId, sid, action: 'x' }, ctx));
    check('after the window: a code is asked again', r?.code === 'ADMIN_CODE_REQUIRED');

    // ended session
    await svc.revokeSession(sid, 'logout');
    r = await refusal(() => svc.stepUp({ userId, sid, code: codeAt(e.secret, 1), action: 'x' }, ctx));
    check('signed-out session → 401 ADMIN_SESSION_ENDED, even with a good code', r?.statusCode === 401 && r?.code === 'ADMIN_SESSION_ENDED');

    // lockout shared with sign-in
    for (let i = 0; i < 4; i++) await refusal(() => svc.stepUp({ userId, sid: String(other._id), code: '111111', action: 'x' }, ctx));
    const locked = await AdminAuthModel.findOne({ userId }).lean();
    check('5 wrong codes (sign-in or step-up) lock the account', !!locked?.lockedUntil && locked.lockedUntil.getTime() > Date.now(), String(locked?.failures));
    r = await refusal(() => svc.stepUp({ userId, sid: String(other._id), code: codeAt(e.secret, 1), action: 'x' }, ctx));
    check('locked: even a good code is refused (ADMIN_CODE_LOCKED)', r?.code === 'ADMIN_CODE_LOCKED');
    check('the window lives on the session, nothing on the user document', !JSON.stringify(await UserModel.findById(userId).lean()).includes('stepUp'));

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} FAILED` : '\nall passed');
    process.exit(failures ? 1 : 0);
};
main().catch(e => { console.error(e); process.exit(1); });
