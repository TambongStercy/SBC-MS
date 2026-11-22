import crypto from 'crypto';
import mongoose from 'mongoose';
import { authenticator } from 'otplib';
import UserModel from '../database/models/user.model';
import { MemberAuthModel } from '../database/models/member-auth.model';
import { notificationService } from '../services/clients/notification.service.client';
import { userService } from '../services/user.service';
import { memberAuthService } from '../services/member-auth.service';
import { computeAdoption, adoptionHistory } from '../services/authenticator-adoption.service';

/**
 * Security plan Phase 3, part 2 (local Mongo, own database, dropped):
 *   - a member WITH the app gives its code to change the email, the phone
 *     (and cannot change it through the plain profile save), and to reset the
 *     password; the reset token survives a missing code; a resend needs none;
 *   - a member WITHOUT the app changes nothing about it (no code asked);
 *   - the lock after setup is off by default, then never shortens a longer lock;
 *   - a risky setup (another country, recent MoMo change) is recorded for review;
 *   - setup routes: 5 a minute per member (with Redis; skipped without it);
 *   - adoption among members above 5,000 F.
 *
 *   npx ts-node --transpile-only src/scripts/check-authenticator-part2.ts
 */
const DB = process.env.MEMBER_AUTH_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_users_auth_part2_check';
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};
const refusal = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e: any) { return e; } };
const sent: any[] = [];
(notificationService as any).sendOtp = async (p: any) => { sent.push(p); return true; };
(notificationService as any).sendAccountEmail = async () => true;
(notificationService as any).sendPush = async () => true;
const fresh = async (id: string) => (await UserModel.findById(id).lean()) as any;
const appCode = (secret: string, offset = 0) => authenticator.clone({ epoch: Date.now() + offset * 30000 }).generate(secret);

let lastBackup: string[] = [];
async function enrol(id: string): Promise<string> {
    await memberAuthService.requestSetup(id, { password: 'Secret123!' });
    const start = await memberAuthService.startSetup(id, { code: sent[sent.length - 1].code });
    lastBackup = (await memberAuthService.confirmSetup(id, { code: appCode(start.secret, -1) })).backupCodes;
    return start.secret;
}

const main = async () => {
    process.env.MEMBER_TOTP_ENC_KEY = crypto.randomBytes(32).toString('base64');
    delete process.env.AUTHENTICATOR_SETUP_LOCK_HOURS;
    delete process.env.SUPPORT_SERVICE_URL;
    delete process.env.RISK_SERVICE_URL;
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();
    const mk = (n: number, extra: Record<string, unknown> = {}) => UserModel.create({
        name: `Membre ${n}`, email: `m${n}@gmail.com`, phoneNumber: `23767700${1000 + n}`, password: 'Secret123!', country: 'CM', referralCode: `P2X${n}`, ...extra,
    } as any);
    const withApp = String((await mk(1, { balance: 12000 }))._id);
    const noApp = String((await mk(2, { balance: 9000 }))._id);

    // --- without the app: nothing asked ---
    await userService.requestChangeEmailOtp(noApp, 'nouveau2@gmail.com', 'Secret123!');
    check('no app: email change asks no app code', sent[sent.length - 1]?.recipient === 'nouveau2@gmail.com');
    await userService.requestChangePhoneOtp(noApp, '237690002222');
    check('no app: phone change asks no app code', sent[sent.length - 1]?.purpose === 'changePhone');
    const r0 = await userService.updateUserProfile(noApp, { phoneNumber: '237690003333' } as any);
    check('no app: the profile save still changes the phone (locked 48 h, as before)', !!r0 && (await fresh(noApp)).withdrawalLockReason === 'phone_change');

    // --- with the app ---
    const secret = await enrol(withApp);
    const backup = lastBackup;
    check('the lock after setup is off by default', !(await fresh(withApp)).withdrawalsLockedUntil);
    const before = sent.length;
    const e1 = await refusal(() => userService.requestChangeEmailOtp(withApp, 'nouveau1@gmail.com', 'Secret123!'));
    check('email change without the app code → 403 AUTHENTICATOR_CODE_REQUIRED, no code sent', e1?.statusCode === 403 && e1?.code === 'AUTHENTICATOR_CODE_REQUIRED' && sent.length === before);
    const e2 = await refusal(() => userService.requestChangeEmailOtp(withApp, 'nouveau1@gmail.com', 'Secret123!', '000000'));
    check('… with a wrong code → 400, no code sent', e2?.statusCode === 400 && sent.length === before);
    await userService.requestChangeEmailOtp(withApp, 'nouveau1@gmail.com', 'Secret123!', appCode(secret));
    check('… with the app code → the code goes to the new address', sent[sent.length - 1]?.recipient === 'nouveau1@gmail.com');
    await userService.requestChangeEmailOtp(withApp, 'nouveau1@gmail.com');
    check('« Renvoyer » for the same address needs no app code', sent[sent.length - 1]?.recipient === 'nouveau1@gmail.com');

    const p1 = await refusal(() => userService.requestChangePhoneOtp(withApp, '237690004444'));
    check('phone change without the app code → 403 AUTHENTICATOR_CODE_REQUIRED', p1?.code === 'AUTHENTICATOR_CODE_REQUIRED');
    await userService.requestChangePhoneOtp(withApp, '237690004444', appCode(secret, 1));
    check('… with the app code → code sent', sent[sent.length - 1]?.purpose === 'changePhone');
    await userService.requestChangePhoneOtp(withApp, '237690004444');
    check('… resend for the same number needs none', sent[sent.length - 1]?.purpose === 'changePhone');
    const p2 = await refusal(() => userService.updateUserProfile(withApp, { phoneNumber: '237690005555' } as any));
    check('profile save with a new phone → 409 PHONE_CHANGE_NEEDS_CODE, nothing saved', p2?.code === 'PHONE_CHANGE_NEEDS_CODE' && (await fresh(withApp)).phoneNumber === '237677001001');
    const same = await userService.updateUserProfile(withApp, { phoneNumber: '237677001001', city: 'Douala' } as any);
    check('profile save resending the same phone still works', (same as any)?.city === 'Douala' || (await fresh(withApp)).city === 'Douala');

    // password reset: token kept until the app code comes
    await UserModel.updateOne({ _id: withApp }, { $set: { passwordResetToken: 'tok-123', passwordResetTokenExpiration: new Date(Date.now() + 600_000) } });
    const r1 = await refusal(() => userService.resetPassword('m1@gmail.com', 'NewSecret456!', undefined, 'tok-123'));
    check('password reset without the app code → 403, token kept', r1?.code === 'AUTHENTICATOR_CODE_REQUIRED' && (await fresh(withApp)).passwordResetToken === 'tok-123');
    await userService.resetPassword('m1@gmail.com', 'NewSecret456!', undefined, 'tok-123', backup[0]);
    check('… with a backup code → reset, token spent', !(await fresh(withApp)).passwordResetToken);

    // --- setup lock (when set) never shortens a longer lock; review of a risky setup ---
    process.env.AUTHENTICATOR_SETUP_LOCK_HOURS = '24';
    const risky = String((await mk(3, { geo: { lastCountry: 'FR' }, withdrawalsLockedUntil: new Date(Date.now() + 40 * 3_600_000), withdrawalLockReason: 'momo_change' }))._id);
    await enrol(risky);
    const rk = await fresh(risky);
    check('a 40 h MoMo lock is not shortened to 24 h by the setup', rk.withdrawalLockReason === 'momo_change' && new Date(rk.withdrawalsLockedUntil).getTime() > Date.now() + 39 * 3_600_000);
    const plain = String((await mk(4))._id);
    await enrol(plain);
    const pl = await fresh(plain);
    check('AUTHENTICATOR_SETUP_LOCK_HOURS=24 → withdrawals locked 24 h, reason authenticator_setup', pl.withdrawalLockReason === 'authenticator_setup' && Math.abs(new Date(pl.withdrawalsLockedUntil).getTime() - Date.now() - 24 * 3_600_000) < 60_000);
    delete process.env.AUTHENTICATOR_SETUP_LOCK_HOURS;
    await new Promise(r => setTimeout(r, 300));
    const rev = (await MemberAuthModel.findOne({ userId: risky }).lean() as any)?.setupReview;
    check('risky setup recorded for review: other country (FR) + recent MoMo change', !!rev && rev.reasons.includes('other_country:FR') && rev.reasons.includes('recent_momo_change'), JSON.stringify(rev?.reasons));
    check('an ordinary setup is not sent to review', !(await MemberAuthModel.findOne({ userId: plain }).lean() as any)?.setupReview);

    // --- rate limit (needs Redis) ---
    if (process.env.REDIS_URL) {
        const lim = String((await mk(5))._id);
        let refused: any = null;
        for (let i = 0; i < 7 && !refused; i++) refused = await refusal(() => memberAuthService.requestSetup(lim, { password: 'Secret123!' }));
        check('setup: the 6th request in a minute → 429', refused?.statusCode === 429, refused?.message);
    } else console.log('SKIP  setup rate limit (no REDIS_URL)');

    // --- adoption ---
    const a = await computeAdoption();
    check('adoption: 1 of 2 members above 5,000 F set it up (50 %), 3 in all', a.withBalance === 2 && a.enrolledWithBalance === 1 && a.share === 0.5 && a.enrolledTotal === 3, JSON.stringify(a));
    check('adoption history lists today', (await adoptionHistory(7)).days.length === 1);

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
};
main().catch(e => { console.error(e); process.exit(1); });
