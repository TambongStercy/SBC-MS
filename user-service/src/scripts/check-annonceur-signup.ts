import mongoose from 'mongoose';
import UserModel from '../database/models/user.model';
import ReferralModel from '../database/models/referral.model';
import { paymentService } from '../services/clients/payment.service.client';
import { notificationService } from '../services/clients/notification.service.client';
import { userService } from '../services/user.service';
import { userController } from '../api/controllers/user.controller';

/**
 * Asserts the advertiser sign-up (Rufus, 2026-11-13): someone who only wants
 * to run Ads Network campaigns can open an account without a parrain and
 * without buying an SBC pack, and relance never mails them.
 *
 * Needs a Mongo instance; uses its own database and drops it.
 *
 *   npx ts-node src/scripts/check-annonceur-signup.ts
 */

const DB = process.env.ANNONCEUR_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_users_annonceur_check';
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};
const refusal = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e: any) { return e; } };

(paymentService as any).processUserRegistrationForRecovery = async () => ({ restoredCount: 0, message: 'none' });
(notificationService as any).sendWelcomeEmail = async () => true;
(userService as any).issueAccountAccessOtp = async () => ({ sent: true });

let n = 0;
const form = (over: Record<string, unknown> = {}) => ({
    name: `Annonceur ${n}`, email: `a${n}@gmail.com`, phoneNumber: `23767720${String(n++).padStart(4, '0')}`,
    password: 'Secret123!', country: 'CM', ...over,
});
const fakeRes = () => {
    const r: any = { statusCode: 200, body: undefined };
    r.status = (c: number) => { r.statusCode = c; return r; };
    r.json = (b: any) => { r.body = b; return r; };
    return r;
};

const main = async () => {
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();
    await UserModel.syncIndexes();

    const parrain = await UserModel.create({ ...form(), referralCode: 'PARRAIN1' } as any);

    // Sign-up rules
    const member = await refusal(() => userService.registerUser(form() as any));
    check('a member sign-up without a code is still refused', /code de parrainage/.test(member?.message ?? ''), member?.message);

    const alone = await userService.registerUser(form({ signupIntent: 'annonceur' }) as any) as any;
    const aloneId = String(alone?.user?._id ?? alone?._id ?? alone?.userId ?? '');
    const aloneDoc = await UserModel.findOne({ email: `a${n - 1}@gmail.com` }).lean() as any;
    check('an advertiser signs up without a code', !!aloneDoc && aloneDoc.signupIntent === 'annonceur', aloneId);
    check('…and has no parrain', (await ReferralModel.countDocuments({ referredUser: aloneDoc?._id })) === 0);

    await userService.registerUser(form({ signupIntent: 'annonceur', referrerCode: 'PARRAIN1' }) as any);
    const linked = await UserModel.findOne({ email: `a${n - 1}@gmail.com` }).lean() as any;
    check('an advertiser from a member\'s link is placed under that member', (await ReferralModel.countDocuments({ referrer: parrain._id, referredUser: linked?._id, referralLevel: 1 })) === 1);

    await userService.registerUser(form({ signupIntent: 'admin', referrerCode: 'PARRAIN1' }) as any);
    const odd = await UserModel.findOne({ email: `a${n - 1}@gmail.com` }).lean() as any;
    check('any other signupIntent value is ignored', !!odd && odd.signupIntent === undefined && odd.role !== 'admin');

    const wrongCode = await refusal(() => userService.registerUser(form({ signupIntent: 'annonceur', referrerCode: 'NOPE' }) as any));
    check('an advertiser with a wrong code is refused (typo, not silently dropped)', !!wrongCode, wrongCode?.message);

    await userService.registerUser(form({ referrerCode: 'PARRAIN1' }) as any);
    const plainFilleul = await UserModel.findOne({ email: `a${n - 1}@gmail.com` }).lean() as any;

    // Relance never sees advertisers
    const res = fakeRes();
    await userController.getUnpaidReferrals({ params: { userId: String(parrain._id) }, query: {} } as any, res);
    const ids = (res.body?.data ?? []).map((u: any) => String(u._id));
    check('relance des nouveaux: the plain filleul is enrolled', ids.includes(String(plainFilleul?._id)), JSON.stringify(ids));
    check('relance des nouveaux: the advertiser is left out', !ids.includes(String(linked?._id)));

    const res2 = fakeRes();
    await userController.getReferralsForCampaign({ params: { userId: String(parrain._id) }, query: {} } as any, res2);
    const ids2 = (res2.body?.data ?? []).map((u: any) => String(u._id));
    check('campagnes de relance: the advertiser is left out', ids2.includes(String(plainFilleul?._id)) && !ids2.includes(String(linked?._id)), JSON.stringify(ids2));

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
};

main().catch(async err => { console.error(err); await mongoose.disconnect().catch(() => undefined); process.exit(1); });
