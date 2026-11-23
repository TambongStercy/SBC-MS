import mongoose, { Types } from 'mongoose';
import UserModel from '../database/models/user.model';
import SubscriptionModel from '../database/models/subscription.model';
import { notificationService } from '../services/clients/notification.service.client';
import { paymentService } from '../services/clients/payment.service.client';
import { userService } from '../services/user.service';
import {
    codeFreeAccess, confirmEmailVerification, correctUnverifiedEmail, needsEmailVerification, requestEmailVerification,
} from '../services/email-verification.service';

/**
 * Asserts "email verified after payment" (2026-11-23):
 *   - a member sign-up gets a session at once, no code sent, email unverified;
 *   - an annonceur sign-up, and SIGNUP_EMAIL_CODE=at_signup, keep the code;
 *   - sign-in with the password only while unpaid + unverified; a code once paid (or verified, or with money);
 *   - the profile says emailVerificationRequired once paid (accounts from EMAIL_VERIFY_GATE_SINCE only);
 *   - request → code to the account e-mail only; wrong code refused; right code verifies; a sign-in code
 *     (no purpose) does not count as this one and vice versa;
 *   - a mistyped address is corrected only with the password, only while unverified, never to a taken one.
 *
 * Needs a Mongo instance; uses its own database and drops it.
 *
 *   npx ts-node --transpile-only src/scripts/check-email-verify-after-payment.ts
 */
const DB = process.env.EMAIL_VERIFY_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_users_email_verify_check';
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};
const refusal = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e: any) { return e; } };

const sent: any[] = [];
(notificationService as any).sendOtp = async (p: any) => { sent.push(p); return true; };
(notificationService as any).sendWelcomeEmail = async () => true;
(notificationService as any).sendAccountEmail = async () => true;
(notificationService as any).sendPush = async () => true;
(paymentService as any).getUserTotalWithdrawals = async () => 0;
const fresh = async (id: string) => (await UserModel.findById(id).lean()) as any;
const lastCode = (purpose?: string) => [...sent].reverse().find(s => (purpose ? s.purpose === purpose : !s.purpose || s.purpose === 'register' || s.purpose === 'login'))?.code as string | undefined;
const pay = (userId: string) => SubscriptionModel.create({
    user: new Types.ObjectId(userId), subscriptionType: 'CLASSIQUE', category: 'registration', duration: 'lifetime',
    status: 'active', startDate: new Date(), endDate: new Date(Date.now() + 10 * 365 * 86400_000),
} as any);

const main = async () => {
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();
    delete process.env.SIGNUP_EMAIL_CODE;
    delete process.env.EMAIL_VERIFY_GATE_SINCE;

    const sponsor = await UserModel.create({
        name: 'Parrain', email: 'parrain@gmail.com', phoneNumber: '237677000001', password: 'Secret123!', country: 'CM', referralCode: 'PARRAIN1', isVerified: true,
    } as any);
    void sponsor;
    const form = (n: number, extra: object = {}) => ({
        name: `Nouveau ${n}`, email: `nouveau${n}@gmail.com`, phoneNumber: `23767700${String(1000 + n)}`, password: 'Secret123!',
        country: 'CM', referrerCode: 'PARRAIN1', consents: { privacy: true }, ...extra,
    });

    // --- sign-up: session at once, no code ---
    const before = sent.length;
    const r1: any = await userService.registerUser(form(1) as any);
    const u1: any = await UserModel.findById(r1.userId).select('+token').lean();
    check('member sign-up: a token at once, no code sent, email not verified',
        typeof r1.token === 'string' && r1.token.length > 20 && sent.length === before && u1.isVerified !== true && u1.token === r1.token,
        JSON.stringify({ token: typeof r1.token, sent: sent.length - before, verified: u1.isVerified, stored: u1.token === r1.token }));

    // --- annonceur keeps the code ---
    const r2: any = await userService.registerUser(form(2, { signupIntent: 'annonceur', referrerCode: undefined }) as any);
    check('annonceur sign-up: no token, a code is sent (as before)', !r2.token && sent.length === before + 1);

    // --- switch back ---
    process.env.SIGNUP_EMAIL_CODE = 'at_signup';
    const r3: any = await userService.registerUser(form(3) as any);
    check('SIGNUP_EMAIL_CODE=at_signup: code at sign-up again', !r3.token && sent.length === before + 2);
    delete process.env.SIGNUP_EMAIL_CODE;

    // --- sign-in while unpaid + unverified: password only ---
    const sentBeforeLogin = sent.length;
    const l1: any = await userService.loginUser('nouveau1@gmail.com', undefined, 'Secret123!');
    check('unpaid + unverified: sign-in with the password only (token, no code)', !!l1.token && l1.otpSent === false && sent.length === sentBeforeLogin);
    check('wrong password still refused', !!(await refusal(() => userService.loginUser('nouveau1@gmail.com', undefined, 'nope'))));

    // --- profile before paying: no gate ---
    let p1: any = await userService.getUserProfile(r1.userId);
    check('profile before paying: no verification asked', p1?.emailVerificationRequired === false, String(p1?.emailVerificationRequired));

    // --- paid: code at sign-in, gate on ---
    await pay(r1.userId);
    check('paid: no more code-free access', !(await codeFreeAccess(await fresh(r1.userId))));
    const l2: any = await userService.loginUser('nouveau1@gmail.com', undefined, 'Secret123!');
    check('paid: sign-in sends a code (no token)', !l2.token && sent.length > sentBeforeLogin);
    p1 = await userService.getUserProfile(r1.userId);
    check('paid + unverified: profile says emailVerificationRequired', p1?.emailVerificationRequired === true);

    // --- money also ends code-free access ---
    const r4: any = await userService.registerUser(form(4) as any);
    await UserModel.updateOne({ _id: r4.userId }, { $set: { balance: 500 } });
    check('a balance ends code-free access', !(await codeFreeAccess(await fresh(r4.userId))));

    // --- older accounts are not gated ---
    check('account created before EMAIL_VERIFY_GATE_SINCE: no gate', !needsEmailVerification({ isVerified: false, createdAt: new Date('2026-01-01') }, 1)
        && needsEmailVerification({ isVerified: false, createdAt: new Date() }, 1) && !needsEmailVerification({ isVerified: true, createdAt: new Date() }, 1));

    // --- request / confirm ---
    await UserModel.updateOne({ _id: r1.userId }, { $set: { otpSendLog: [] } }); // the sign-in code above started the 60 s wait
    const q1 = await requestEmailVerification(r1.userId);
    const v = [...sent].reverse().find(s => s.purpose === 'verifyEmail');
    check('request: code to the account e-mail, e-mail channel, masked answer',
        q1.sent && v?.recipient === 'nouveau1@gmail.com' && String(v?.channel).toLowerCase() === 'email' && q1.sentTo === 'no••••••@gmail.com', JSON.stringify(q1));
    const q2 = await requestEmailVerification(r1.userId);
    check('request again at once: throttled with a wait', !q2.sent && q2.retryAfterSeconds > 0);
    const signinCode = lastCode();
    const wrong = await refusal(() => confirmEmailVerification(r1.userId, '000000'));
    check('wrong code refused, still unverified', wrong?.statusCode === 400 && (await fresh(r1.userId)).isVerified !== true);
    if (signinCode && signinCode !== v.code) {
        const viaSignin = await refusal(() => confirmEmailVerification(r1.userId, signinCode));
        check('a sign-in code does not verify the e-mail here', viaSignin?.statusCode === 400);
    }
    await confirmEmailVerification(r1.userId, v.code);
    const u1v = await fresh(r1.userId);
    check('right code: email verified, code gone', u1v.isVerified === true && !(u1v.otps || []).some((o: any) => o.purpose === 'verifyEmail'));
    p1 = await userService.getUserProfile(r1.userId);
    check('verified: gate off', p1?.emailVerificationRequired === false);
    check('verified: request answers alreadyVerified', (await requestEmailVerification(r1.userId)).alreadyVerified);

    // --- correct a mistyped address ---
    const r5: any = await userService.registerUser(form(5, { email: 'nouveau5@gmial.com' }) as any).catch((e: any) => ({ error: e.message }));
    let id5: string;
    if (r5.error) {
        // the domain check refuses obvious typos at sign-up; simulate a wrong but valid address
        const r5b: any = await userService.registerUser(form(5, { email: 'wrong.address5@gmail.com' }) as any);
        id5 = r5b.userId;
    } else id5 = r5.userId;
    await pay(id5);
    const noPass = await refusal(() => correctUnverifiedEmail(id5, { email: 'right5@gmail.com', password: 'nope' }, e => userService.isValidEmailDomain(e)));
    check('correct: wrong password refused', noPass?.statusCode === 400);
    const taken = await refusal(() => correctUnverifiedEmail(id5, { email: 'parrain@gmail.com', password: 'Secret123!' }, e => userService.isValidEmailDomain(e)));
    check('correct: an address of another account refused', taken?.statusCode === 409);
    const bad = await refusal(() => correctUnverifiedEmail(id5, { email: 'x@unknown-domain.zz', password: 'Secret123!' }, e => userService.isValidEmailDomain(e)));
    check('correct: invalid domain refused', bad?.statusCode === 400);
    await UserModel.updateOne({ _id: id5 }, { $set: { otpSendLog: [] } });
    const c5 = await correctUnverifiedEmail(id5, { email: 'Right5@Gmail.com', password: 'Secret123!' }, e => userService.isValidEmailDomain(e));
    const v5 = [...sent].reverse().find(s => s.purpose === 'verifyEmail');
    check('correct: address saved (lower case), code sent to the new one',
        (await fresh(id5)).email === 'right5@gmail.com' && c5.sent && v5?.recipient === 'right5@gmail.com');
    await confirmEmailVerification(id5, v5.code);
    const again = await refusal(() => correctUnverifiedEmail(id5, { email: 'other5@gmail.com', password: 'Secret123!' }, e => userService.isValidEmailDomain(e)));
    check('correct: refused once verified (409, use the profile change)', again?.statusCode === 409 && (await fresh(id5)).email === 'right5@gmail.com');

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
};
main().catch(e => { console.error(e); process.exit(1); });
