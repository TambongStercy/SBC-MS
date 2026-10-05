/**
 * Asserts the admin member search: phone digits, escaped text, ids, sign-up dates.
 *
 * Needs a Mongo instance; uses its own database.
 *   npx -y -p node@20 node -r ts-node/register src/scripts/check-admin-user-search.ts
 */
import mongoose, { Types } from 'mongoose';
import UserModel from '../database/models/user.model';
import SubscriptionModel from '../database/models/subscription.model';
import PartnerModel from '../database/models/partner.model';
import ReferralModel from '../database/models/referral.model';
import { userService } from '../services/user.service';

const DB = process.env.ADMIN_SEARCH_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_users_admin_search_check';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

(async () => {
    await mongoose.connect(DB, { serverSelectionTimeoutMS: 3000 });
    await mongoose.connection.dropDatabase();
    const jamie = new Types.ObjectId(), paul = new Types.ObjectId(), old = new Types.ObjectId();
    await UserModel.collection.insertMany([
        { _id: jamie, name: 'Mireille Tchana', email: 'mireille1990@example.com', phoneNumber: '237690001990', createdAt: new Date('2026-10-04T08:00:00Z') },
        { _id: paul, name: 'Paul (Douala)', email: 'paul@example.com', phoneNumber: '237677123456', createdAt: new Date('2026-10-04T09:00:00Z') },
        { _id: old, name: 'Ancien', email: 'old@example.com', phoneNumber: '242061234567', createdAt: new Date('2025-01-01T00:00:00Z') },
    ]);
    const ids = async (filters: Record<string, string>) =>
        (await userService.adminListUsers(filters, { page: 1, limit: 50 })).users.map(u => String(u._id)).sort();

    check('phone with spaces finds the member', (await ids({ search: '677 12 34 56' })).join() === [paul.toString()].join());
    check('phone with + and country code', (await ids({ search: '+237 690 00 19 90' })).join() === [jamie.toString()].join());
    check('Congo number with its leading 0', (await ids({ search: '06 123 45 67' })).join() === [old.toString()].join());
    check('a "(" no longer breaks the search', (await ids({ search: 'Paul (' })).join() === [paul.toString()].join());
    check('digits inside an email do not match phones', (await ids({ search: 'mireille1990' })).join() === [jamie.toString()].join());
    check('database id finds the member', (await ids({ search: old.toString() })).join() === [old.toString()].join());
    const today = await ids({ createdFrom: '2026-10-04T00:00:00Z' });
    check('signed up from today', today.join() === [jamie.toString(), paul.toString()].sort().join(), today.join());
    const before = await ids({ createdTo: '2026-01-01T00:00:00Z' });
    check('signed up before a date', before.join() === [old.toString()].join());
    check('an invalid date is ignored', (await ids({ createdFrom: 'nonsense' })).length === 3);

    // --- subscription and partner filters ---
    await SubscriptionModel.collection.insertMany([
        { user: jamie, subscriptionType: 'CLASSIQUE', status: 'active', startDate: new Date(), endDate: new Date(Date.now() + 1e10) },
        { user: paul, subscriptionType: 'CIBLE', status: 'active', startDate: new Date(), endDate: new Date(Date.now() + 1e10) },
        { user: old, subscriptionType: 'CLASSIQUE', status: 'expired', startDate: new Date(), endDate: new Date() },
    ]);
    await PartnerModel.collection.insertMany([
        { user: paul, pack: 'gold', isActive: true },
        { user: old, pack: 'silver', isActive: false },
    ]);
    check('subscription classique', (await ids({ subscription: 'classique' })).join() === [jamie.toString()].join());
    check('subscription cible', (await ids({ subscription: 'cible' })).join() === [paul.toString()].join());
    check('subscribed (either)', (await ids({ subscription: 'any' })).join() === [jamie.toString(), paul.toString()].sort().join());
    check('not subscribed (expired counts as none)', (await ids({ subscription: 'none' })).join() === [old.toString()].join());
    check('active partners only', (await ids({ partner: 'any' })).join() === [paul.toString()].join());
    check('partner AND subscription intersect', (await ids({ partner: 'gold', subscription: 'classique' })).length === 0);
    check('filters combine with search', (await ids({ subscription: 'any', search: 'Paul' })).join() === [paul.toString()].join());

    // --- the id search the payment lists use ---
    await UserModel.collection.updateOne({ _id: old }, { $set: { blocked: true, isVerified: false } });
    const sid = async (t: string) => (await userService.findUserIdsBySearchTerm(t)).map(String).sort();
    check('payment search: exact member id', (await sid(old.toString())).join() === [old.toString()].join());
    check('payment search: blocked member still found', (await sid('Ancien')).join() === [old.toString()].join());
    check('payment search: phone digits', (await sid('+237 677 12 34 56')).join() === [paul.toString()].join());
    check('payment search: "(" does not throw', (await sid('Paul (')).join() === [paul.toString()].join());

    // --- member page: deleted members open, referrer shown ---
    await ReferralModel.collection.insertOne({ referrer: jamie, referredUser: paul, referralLevel: 1, archived: false, createdAt: new Date() });
    await UserModel.collection.updateOne({ _id: old }, { $set: { deleted: true } });
    const deleted = await userService.adminGetUserById(old.toString());
    check('deleted member can be opened', !!deleted && (deleted as any).deleted === true);
    const withRef = await userService.adminGetUserById(paul.toString()) as any;
    check('referrer is shown', withRef?.referrer?.name === 'Mireille Tchana', withRef?.referrer?.name);
    const refs = await userService.getReferredUsersInfoPaginated(jamie.toString(), 1, undefined, 1, 20);
    check("member's filleuls listed", refs.referredUsers.length === 1 && String(refs.referredUsers[0]._id) === paul.toString(), String(refs.totalCount));

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} FAILED` : '\nall passed');
    process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
