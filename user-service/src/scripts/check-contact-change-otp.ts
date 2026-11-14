import mongoose from 'mongoose';
import UserModel from '../database/models/user.model';
import { notificationService } from '../services/clients/notification.service.client';
import { userService } from '../services/user.service';

/**
 * Asserts the email and phone change codes (2026-11-14). Until then the web
 * page called a route that did not exist, so no code ever reached the new
 * address; people typed the sign-in code the page triggered by "checking the
 * password", and the confirm step accepted any code on the account.
 *
 * Now: the request checks the password itself, the code is bound to its
 * purpose and to the new address or number, and sign-in/reset ignore it.
 *
 * Needs a Mongo instance; uses its own database and drops it.
 *
 *   npx ts-node src/scripts/check-contact-change-otp.ts
 */

const DB = process.env.CONTACT_CHANGE_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_users_contact_change_check';
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};
const refusal = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e: any) { return e; } };

const sent: any[] = [];
(notificationService as any).sendOtp = async (p: any) => { sent.push(p); return true; };
const lastCode = () => sent[sent.length - 1]?.code as string;

const main = async () => {
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();

    const u = await UserModel.create({ name: 'Membre', email: 'old.address@gmail.com', phoneNumber: '237677001122', password: 'Secret123!', country: 'CM', referralCode: 'MEMB1' } as any);
    await UserModel.create({ name: 'Autre', email: 'taken.address@gmail.com', phoneNumber: '237677003344', password: 'x', country: 'CM', referralCode: 'AUTRE1' } as any);
    const id = String(u._id);

    // Request
    const noPass = await refusal(() => userService.requestChangeEmailOtp(id, 'new.address@gmail.com'));
    check('request without the password is refused', noPass?.statusCode === 400 && sent.length === 0, noPass?.message);
    const badPass = await refusal(() => userService.requestChangeEmailOtp(id, 'new.address@gmail.com', 'wrong'));
    check('request with a wrong password is refused, nothing sent', badPass?.statusCode === 400 && sent.length === 0);
    const taken = await refusal(() => userService.requestChangeEmailOtp(id, 'Taken.Address@gmail.com', 'Secret123!'));
    check('an address used by another account is refused at request (any case)', taken?.statusCode === 409, taken?.message);

    await userService.requestChangeEmailOtp(id, '  New.Address@Gmail.com ', 'Secret123!');
    const mail = sent[sent.length - 1];
    check('the code goes to the NEW address, lowercased', mail?.recipient === 'new.address@gmail.com' && String(mail?.channel).toLowerCase() === 'email', mail?.recipient);
    const changeCode = lastCode();
    const stored = ((await UserModel.findById(id).lean()) as any).otps.find((o: any) => o.code === changeCode);
    check('the stored code is bound to changeEmail and the new address', stored?.purpose === 'changeEmail' && stored?.target === 'new.address@gmail.com');

    // A sign-in code cannot confirm the change, and the change code cannot sign in
    const signIn = await userService.generateAndStoreOtp(id, 'otps');
    const viaSignIn = await refusal(() => userService.confirmChangeEmail(id, 'new.address@gmail.com', signIn));
    check('a sign-in code does not confirm the email change', viaSignIn?.statusCode === 400, viaSignIn?.message);
    const login = await userService.validateOtp(id, 'otps', changeCode);
    check('the email-change code does not sign in', login?.isValid === false);
    const otherAddress = await refusal(() => userService.confirmChangeEmail(id, 'someone.else@gmail.com', changeCode));
    check('the code does not confirm a different address', otherAddress?.statusCode === 400);

    // "Renvoyer le code": no password while a code for that address is live
    const before = sent.length;
    await userService.requestChangeEmailOtp(id, 'new.address@gmail.com');
    check('resend for the same address works without the password', sent.length === before + 1 && sent[sent.length - 1].recipient === 'new.address@gmail.com');
    const resendOther = await refusal(() => userService.requestChangeEmailOtp(id, 'other.address@gmail.com'));
    check('…but not for another address', resendOther?.statusCode === 400 && sent.length === before + 1);

    // Control: the sign-in code itself still signs in (this clears every code)
    const signInOk = await userService.validateOtp(id, 'otps', signIn);
    check('control: a sign-in code still signs in', signInOk.isValid === true);

    // Confirm (typed in capitals, as phone keyboards do)
    await userService.requestChangeEmailOtp(id, 'new.address@gmail.com', 'Secret123!');
    await userService.confirmChangeEmail(id, 'New.Address@gmail.com', lastCode().toUpperCase());
    const after = (await UserModel.findById(id).lean()) as any;
    check('the right code changes the email', after.email === 'new.address@gmail.com');
    check('…and locks withdrawals (48 h rule)', !!after.withdrawalsLockedUntil && after.withdrawalLockReason === 'email_change');

    // Phone change: bound the same way
    sent.length = 0;
    await userService.requestChangePhoneOtp(id, '237699887766');
    const phoneCode = lastCode();
    const signIn2 = await userService.generateAndStoreOtp(id, 'otps');
    const viaSignIn2 = await refusal(() => userService.confirmChangePhone(id, '237699887766', signIn2));
    check('a sign-in code does not confirm the phone change', viaSignIn2?.statusCode === 400, viaSignIn2?.message);
    await userService.confirmChangePhone(id, '237699887766', phoneCode);
    const afterPhone = (await UserModel.findById(id).lean()) as any;
    check('the phone-change code changes the number', String(afterPhone.phoneNumber).endsWith('699887766'), afterPhone.phoneNumber);

    // The "resend the still-valid code" path never resends a change code as a sign-in code
    await UserModel.updateOne({ _id: id }, { $set: { otps: [], otpSendLog: [] } });
    await userService.requestChangeEmailOtp(id, 'third.address@gmail.com', 'Secret123!');
    const thirdCode = lastCode();
    sent.length = 0;
    await (userService as any).issueAccountAccessOtp(await UserModel.findById(id), {}).catch(() => undefined);
    check('sign-in resend does not reuse the change code', sent.length > 0 && sent.every(p => p.code !== thirdCode), JSON.stringify(sent.map(p => p.recipient)));

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
};

main().catch(async err => { console.error(err); await mongoose.disconnect().catch(() => undefined); process.exit(1); });
