import mongoose from 'mongoose';
import UserModel from '../database/models/user.model';
import { notificationService } from '../services/clients/notification.service.client';
import { userService } from '../services/user.service';

/**
 * Asserts Security plan Phase 0, items 1 and 2 (2026-11-19):
 * - the Mobile Money number that receives withdrawals changes only with the
 *   password and a code sent to the account email; replacing a number locks
 *   withdrawals and alerts the account email; `PUT /me` cannot change it;
 * - members cannot change their country through `PUT /me` (support does).
 *
 * Needs a Mongo instance; uses its own database and drops it.
 *
 *   npx ts-node src/scripts/check-momo-and-country-lock.ts
 */

const DB = process.env.MOMO_LOCK_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_users_momo_lock_check';
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
const lastCode = () => sent[sent.length - 1]?.code as string;
const fresh = async (id: string) => (await UserModel.findById(id).lean()) as any;

const main = async () => {
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();

    const u = await UserModel.create({
        name: 'Membre', email: 'owner@gmail.com', phoneNumber: '237677001122', password: 'Secret123!', country: 'CM',
        referralCode: 'MEMB1', momoNumber: '237677001122', momoOperator: 'MTN_MOMO_CMR',
    } as any);
    const n = await UserModel.create({
        name: 'Nouveau', email: 'newbie@gmail.com', phoneNumber: '237677005566', password: 'Secret123!', country: 'CM', referralCode: 'NEW1',
    } as any);
    const id = String(u._id);
    const newId = String(n._id);

    // --- PUT /me: country and MoMo ---
    await userService.updateUserProfile(id, { country: 'SN', city: 'Douala' } as any);
    let doc = await fresh(id);
    check('PUT /me with a country leaves the country unchanged (other fields saved)', doc.country === 'CM' && doc.city === 'Douala', doc.country);

    await userService.updateUserProfile(id, { momoNumber: '677001122', momoOperator: 'mtn_momo_cmr', name: 'Membre B' } as any);
    doc = await fresh(id);
    check('PUT /me resending the same MoMo (other format, any case) saves the rest', doc.name === 'Membre B' && doc.momoNumber === '237677001122');
    await userService.updateUserProfile(id, { momoNumber: '', momoOperator: '' } as any);
    doc = await fresh(id);
    check('PUT /me with blank MoMo fields changes nothing', doc.momoNumber === '237677001122' && doc.momoOperator === 'MTN_MOMO_CMR');

    const viaPut = await refusal(() => userService.updateUserProfile(id, { momoNumber: '237699998877' } as any));
    doc = await fresh(id);
    check('PUT /me with another MoMo number is refused (409 MOMO_CHANGE_NEEDS_CODE), nothing saved',
        viaPut?.statusCode === 409 && viaPut?.code === 'MOMO_CHANGE_NEEDS_CODE' && doc.momoNumber === '237677001122', viaPut?.message);
    const opPut = await refusal(() => userService.updateUserProfile(id, { momoOperator: 'ORANGE_CMR' } as any));
    check('PUT /me with another operator is refused too', opPut?.code === 'MOMO_CHANGE_NEEDS_CODE');
    const firstPut = await refusal(() => userService.updateUserProfile(newId, { momoNumber: '237699990000', momoOperator: 'ORANGE_CMR' } as any));
    check('PUT /me cannot set a first MoMo number either', firstPut?.code === 'MOMO_CHANGE_NEEDS_CODE');

    // --- request ---
    const noPass = await refusal(() => userService.requestMomoChange(id, { momoNumber: '699998877', momoOperator: 'ORANGE_CMR' }));
    check('request without the password is refused, nothing sent', noPass?.statusCode === 400 && sent.length === 0, noPass?.message);
    const badPass = await refusal(() => userService.requestMomoChange(id, { momoNumber: '699998877', momoOperator: 'ORANGE_CMR', password: 'nope' }));
    check('request with a wrong password is refused, nothing sent', badPass?.statusCode === 400 && sent.length === 0);
    const badOp = await refusal(() => userService.requestMomoChange(id, { momoNumber: '699998877', momoOperator: 'orange cm!', password: 'Secret123!' }));
    check('a malformed operator is refused', badOp?.statusCode === 400);
    const same = await refusal(() => userService.requestMomoChange(id, { momoNumber: '+237 677 00 11 22', momoOperator: 'MTN_MOMO_CMR', password: 'Secret123!' }));
    check('requesting the current details is refused', same?.statusCode === 400, same?.message);

    const res = await userService.requestMomoChange(id, { momoNumber: '6 99 99 88 77', momoOperator: 'orange_cmr', password: 'Secret123!' });
    const mail = sent[sent.length - 1];
    check('the code goes to the ACCOUNT email, never to the new number',
        mail?.recipient === 'owner@gmail.com' && String(mail?.channel).toLowerCase() === 'email' && res.sentTo.includes('@'), mail?.recipient);
    const code = lastCode();
    const stored = (await fresh(id)).otps.find((o: any) => o.code === code);
    check('the code is bound to changeMomo and to this number + operator', stored?.purpose === 'changeMomo' && stored?.target === '237699998877|ORANGE_CMR', stored?.target);
    const login = await userService.validateOtp(id, 'otps', code);
    check('the MoMo code does not sign in', login?.isValid === false);

    // --- confirm ---
    const signIn = await userService.generateAndStoreOtp(id, 'otps');
    const viaSignIn = await refusal(() => userService.confirmMomoChange(id, { momoNumber: '699998877', momoOperator: 'ORANGE_CMR', code: signIn }));
    check('a sign-in code does not confirm the change', viaSignIn?.statusCode === 400);
    const otherNumber = await refusal(() => userService.confirmMomoChange(id, { momoNumber: '699990000', momoOperator: 'ORANGE_CMR', code }));
    check('the code does not confirm another number', otherNumber?.statusCode === 400);
    const otherOp = await refusal(() => userService.confirmMomoChange(id, { momoNumber: '699998877', momoOperator: 'MTN_MOMO_CMR', code }));
    check('the code does not confirm another operator', otherOp?.statusCode === 400);
    check('nothing changed before a valid confirm, no lock', (await fresh(id)).momoNumber === '237677001122' && !(await fresh(id)).withdrawalsLockedUntil);

    const resend = await userService.requestMomoChange(id, { momoNumber: '699998877', momoOperator: 'ORANGE_CMR' });
    check('resend without the password works while a code for the same details is live', !!resend.sentTo);
    const code2 = lastCode();

    const before = Date.now();
    const done = await userService.confirmMomoChange(id, { momoNumber: '+237699998877', momoOperator: 'ORANGE_CMR', code: code2.toLowerCase() });
    doc = await fresh(id);
    const hours = doc.withdrawalsLockedUntil ? (new Date(doc.withdrawalsLockedUntil).getTime() - before) / 3600000 : 0;
    check('a valid code (any case) changes the number and operator', doc.momoNumber === '237699998877' && doc.momoOperator === 'ORANGE_CMR');
    check('replacing a number locks withdrawals for 48 h with reason momo_change',
        doc.withdrawalLockReason === 'momo_change' && hours > 47.9 && hours <= 48.01 && done.withdrawalsLockedUntil !== null, `${hours.toFixed(2)} h`);
    check('the alert goes to the account email', alerts.some(a => a.email === 'owner@gmail.com' && /Mobile Money/.test(a.subject)));
    const replay = await refusal(() => userService.confirmMomoChange(id, { momoNumber: '699998877', momoOperator: 'ORANGE_CMR', code: code2 }));
    check('the code works once', replay?.statusCode === 400);
    const lockView = await userService.getWithdrawalLock(id);
    check('payment-service sees the lock (GET withdrawal-lock)', lockView?.locked === true && lockView.reason === 'momo_change');

    // --- first number: code, no lock ---
    alerts.length = 0;
    await userService.requestMomoChange(newId, { momoNumber: '699990000', momoOperator: 'ORANGE_CMR', password: 'Secret123!' });
    await userService.confirmMomoChange(newId, { momoNumber: '699990000', momoOperator: 'ORANGE_CMR', code: lastCode() });
    doc = await fresh(newId);
    check('a first MoMo number is saved with the code, without a lock or alert',
        doc.momoNumber === '237699990000' && !doc.withdrawalsLockedUntil && alerts.length === 0);

    // --- admin edit ---
    alerts.length = 0;
    await UserModel.updateOne({ _id: newId }, { $unset: { withdrawalsLockedUntil: 1, withdrawalLockReason: 1 } });
    await userService.adminUpdateUser(newId, { momoNumber: '237699990000', momoOperator: 'ORANGE_CMR', city: 'Yaoundé' } as any);
    doc = await fresh(newId);
    check('an admin save with the same MoMo does not lock', !doc.withdrawalsLockedUntil && doc.city === 'Yaoundé');
    await userService.adminUpdateUser(newId, { momoNumber: '237655554444', momoOperator: 'MTN_MOMO_CMR' } as any);
    doc = await fresh(newId);
    check('an admin replacing the MoMo number locks and alerts', doc.withdrawalLockReason === 'momo_change' && alerts.length === 1);

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
    process.exit(failures ? 1 : 0);
};

main().catch(async e => { console.error(e); await mongoose.disconnect(); process.exit(1); });
