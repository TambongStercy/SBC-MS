/**
 * Asserts the per-account limit on sign-in codes: at most one send per 60s and
 * five per rolling 20 minutes, claimed atomically, reusing a still-valid code.
 *
 * Why it exists: "Renvoyer" had no cooldown and the only limits were per IP, so
 * one person could trigger ~140 codes an hour. On 2026-09-26 that was 62,165 OTP
 * emails in six days, 56% sent while the previous code was still valid, and the
 * volume is what pushed the mail server into refusing us.
 *
 * The risk in the fix is the other direction — strangling a genuine user while
 * the mail server is unstable — so this also checks that a send is allowed again
 * exactly when the wait says it is, not later.
 *
 * Needs a Mongo instance. Uses its own database and drops it afterwards.
 *
 *   npx ts-node src/scripts/check-otp-throttle.ts
 */
import mongoose from 'mongoose';
import UserModel from '../database/models/user.model';
import { userRepository } from '../database/repositories/user.repository';
import {
    otpSendDecision,
    OTP_SEND_COOLDOWN_MS,
    OTP_SEND_WINDOW_MS,
    OTP_SEND_MAX_IN_WINDOW,
} from '../utils/otp.utils';
import { notificationService } from '../services/clients/notification.service.client';

const DB = process.env.OTP_THROTTLE_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_users_otp_throttle_check';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

const T0 = new Date('2026-09-26T12:00:00Z').getTime();
const at = (ms: number) => new Date(T0 + ms);
const SEC = 1000;
const MIN = 60 * SEC;

// Record every code we would have sent instead of calling notification-service.
const sent: Array<{ recipient: string; code: string; expireMinutes?: number }> = [];
(notificationService as any).sendOtp = async (d: any) => { sent.push(d); return true; };

let n = 0;
const makeUser = () => UserModel.create({
    name: `Test ${n}`,
    email: `otp-throttle-${n}@example.com`,
    phoneNumber: `2376${String(10000000 + n++).padStart(8, '0')}`,
    password: 'x-irrelevant-x',
    notificationPreference: 'email',
    region: 'x', country: 'CM', city: 'Douala',
});

const main = async () => {
    // ---- The rule on its own ------------------------------------------------
    check('a first send is allowed', otpSendDecision([], at(0)).allowed);

    const one = otpSendDecision([at(0)], at(30 * SEC));
    check('a second tap inside 60s is refused with the time left',
        !one.allowed && one.retryAfterSeconds === 30, `${one.retryAfterSeconds}s`);

    check('allowed again at exactly 60s, not later',
        otpSendDecision([at(0)], at(60 * SEC)).allowed);

    const five = [0, 1, 2, 3, 4].map(i => at(i * 2 * MIN));   // 0,2,4,6,8 min
    const sixth = otpSendDecision(five, at(10 * MIN));
    check('a sixth send inside 20 minutes is refused',
        !sixth.allowed && sixth.retryAfterSeconds === 10 * 60,
        `wait ${sixth.retryAfterSeconds}s — until the first of the five leaves the window`);
    check('allowed again the moment the oldest send leaves the window',
        otpSendDecision(five, at(20 * MIN)).allowed);

    // ---- The atomic claim against real Mongo ---------------------------------
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();

    const u = await makeUser();
    const claims: boolean[] = [];
    for (let i = 0; i < 5; i++) claims.push(await userRepository.reserveOtpSend(u._id, at(i * 2 * MIN)));
    check('five sends two minutes apart are all claimed', claims.every(Boolean), claims.join(','));
    check('the sixth inside the window is refused by Mongo too',
        !(await userRepository.reserveOtpSend(u._id, at(10 * MIN))));
    check('and claimed once the window has moved on',
        await userRepository.reserveOtpSend(u._id, at(20 * MIN)));

    const stored = (await UserModel.findById(u._id).lean())!.otpSendLog!;
    check(`the log never holds more than ${OTP_SEND_MAX_IN_WINDOW} entries`,
        stored.length === OTP_SEND_MAX_IN_WINDOW, `${stored.length}`);

    // The whole point of doing it in one update: ten taps landing together.
    const racer = await makeUser();
    const burst = await Promise.all(
        Array.from({ length: 10 }, () => userRepository.reserveOtpSend(racer._id, at(0))),
    );
    check('ten simultaneous taps claim exactly one send',
        burst.filter(Boolean).length === 1, `${burst.filter(Boolean).length} claimed`);

    // Mongo and the reported wait must agree, or the countdown lies.
    const probe = await makeUser();
    await userRepository.reserveOtpSend(probe._id, at(0));
    const log = (await UserModel.findById(probe._id).lean())!.otpSendLog;
    const told = otpSendDecision(log, at(15 * SEC));
    check('the wait reported after a refusal matches what Mongo enforces',
        told.retryAfterSeconds === 45
        && !(await userRepository.reserveOtpSend(probe._id, at(59 * SEC)))
        && await userRepository.reserveOtpSend(probe._id, at(60 * SEC)),
        `told ${told.retryAfterSeconds}s`);

    // ---- The service: reuse, and what each path does when refused -----------
    // Imported late so the stubbed notification client above is the one it uses.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { userService } = require('../services/user.service');

    const reuser = await makeUser();
    sent.length = 0;
    const first = await (userService as any).issueAccountAccessOtp(await UserModel.findById(reuser._id));
    await UserModel.updateOne({ _id: reuser._id }, { $set: { otpSendLog: [new Date(Date.now() - 2 * MIN)] } });
    const second = await (userService as any).issueAccountAccessOtp(await UserModel.findById(reuser._id));
    check('a resend while the code is still valid sends the SAME code',
        first.sent && second.sent && sent.length === 2 && sent[0].code === sent[1].code,
        `${sent.map(s => s.code).join(' / ')}`);
    check('and says how long it really has left, not a fresh 10 minutes',
        (sent[1].expireMinutes ?? 10) <= 10);
    const codesStored = (await UserModel.findById(reuser._id).lean())!.otps.length;
    check('reusing did not mint another code', codesStored === 1, `${codesStored} stored`);

    const nearlyExpired = await makeUser();
    await UserModel.updateOne({ _id: nearlyExpired._id }, {
        $set: { otps: [{ code: 'OLDONE', expiration: new Date(Date.now() + 90 * SEC) }] },
    });
    sent.length = 0;
    await (userService as any).issueAccountAccessOtp(await UserModel.findById(nearlyExpired._id));
    check('a code with under 3 minutes left is replaced, not resent',
        sent.length === 1 && sent[0].code !== 'OLDONE', sent[0]?.code);

    const tapper = await makeUser();
    const fresh = await UserModel.findById(tapper._id);
    await (userService as any).issueAccountAccessOtp(fresh);
    sent.length = 0;
    const refused = await (userService as any).issueAccountAccessOtp(await UserModel.findById(tapper._id));
    check('an immediate second tap sends nothing and reports the wait',
        !refused.sent && sent.length === 0 && refused.retryAfterSeconds > 0 && refused.retryAfterSeconds <= 60,
        `retry in ${refused.retryAfterSeconds}s`);

    let resendError: any;
    try { await userService.resendOtp(tapper.email, 'login'); } catch (e) { resendError = e; }
    check('an explicit resend inside the cooldown is refused with 429',
        resendError?.statusCode === 429 && resendError?.retryAfterSeconds > 0,
        resendError?.message);

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();

    console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`);
    console.log(`(cooldown ${OTP_SEND_COOLDOWN_MS / SEC}s, window ${OTP_SEND_WINDOW_MS / MIN} min, max ${OTP_SEND_MAX_IN_WINDOW})`);
    process.exit(failures === 0 ? 0 : 1);
};

main().catch(async err => {
    console.error('Failed:', err);
    await mongoose.disconnect().catch(() => { });
    process.exit(1);
});
