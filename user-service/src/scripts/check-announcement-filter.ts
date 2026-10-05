/**
 * Asserts which members a targeted announcement reaches.
 *
 * Needs a Mongo instance; uses its own database.
 *   npx -y -p node@20 node -r ts-node/register src/scripts/check-announcement-filter.ts
 */
import mongoose, { Types } from 'mongoose';
import UserModel from '../database/models/user.model';
import SubscriptionModel from '../database/models/subscription.model';
import { userService } from '../services/user.service';

const DB = process.env.ANNOUNCE_FILTER_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_users_announce_filter_check';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

(async () => {
    await mongoose.connect(DB, { serverSelectionTimeoutMS: 3000 });
    await mongoose.connection.dropDatabase();
    const id = () => new Types.ObjectId();
    const u = {
        cmMalePaid: id(), cmFemale: id(), snMale: id(), cmLower: id(), cmBlocked: id(), cmDeleted: id(), cmExpired: id(),
    };
    await UserModel.collection.insertMany([
        { _id: u.cmMalePaid, country: 'CM', sex: 'male' },
        { _id: u.cmFemale, country: 'CM', sex: 'female' },
        { _id: u.snMale, country: 'SN', sex: 'male' },
        { _id: u.cmLower, country: 'cm', sex: 'male' },          // legacy lower-case code
        { _id: u.cmBlocked, country: 'CM', sex: 'male', blocked: true },
        { _id: u.cmDeleted, country: 'CM', sex: 'male', deleted: true },
        { _id: u.cmExpired, country: 'CM', sex: 'male' },
    ]);
    await SubscriptionModel.collection.insertMany([
        { user: u.cmMalePaid, subscriptionType: 'CLASSIQUE', status: 'active' },
        { user: u.snMale, subscriptionType: 'CIBLE', status: 'active' },
        { user: u.cmExpired, subscriptionType: 'CLASSIQUE', status: 'expired' },
        { user: u.cmFemale, subscriptionType: 'VISIBILITE_MAX', status: 'active' }, // not a registration
    ]);
    const all = Object.values(u).map(String);
    const run = async (filter: any) => (await userService.filterForAnnouncement(all, filter)).sort();
    const names = (ids: string[]) => ids.map(x => Object.entries(u).find(([, v]) => String(v) === x)![0]).sort();

    check('no filter: everyone except blocked and deleted',
        JSON.stringify(names(await run({}))) === JSON.stringify(['cmExpired', 'cmFemale', 'cmLower', 'cmMalePaid', 'snMale']), names(await run({})).join(','));
    check('Cameroon, whatever the code\'s case',
        JSON.stringify(names(await run({ countries: ['CM'] }))) === JSON.stringify(['cmExpired', 'cmFemale', 'cmLower', 'cmMalePaid']));
    check('subscribed = an active CLASSIQUE or CIBLE',
        JSON.stringify(names(await run({ subscription: 'subscribed' }))) === JSON.stringify(['cmMalePaid', 'snMale']));
    check('not subscribed includes expired and feature-only subscriptions',
        JSON.stringify(names(await run({ subscription: 'unsubscribed' }))) === JSON.stringify(['cmExpired', 'cmFemale', 'cmLower']));
    check('filters combine: Cameroonian women',
        JSON.stringify(names(await run({ countries: ['CM'], sex: 'female' }))) === JSON.stringify(['cmFemale']));
    check('only among the members given (those with push on)',
        (await userService.filterForAnnouncement([String(u.snMale)], { countries: ['CM'] })).length === 0);

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
})().catch(async err => { console.error(err); await mongoose.disconnect().catch(() => undefined); process.exit(1); });
