/**
 * Admin filters (?country, ?from, ?to) on user-service's admin lists and stats,
 * and the country matching behind GET /users/internal/ids-by-country.
 *
 *   npx ts-node --swc src/scripts/check-admin-filters.ts
 *
 * Own database (dropped at the end); never touches dev data.
 */
import assert from 'assert';
import mongoose, { Types } from 'mongoose';
import UserModel from '../database/models/user.model';
import SubscriptionModel, { SubscriptionStatus, SubscriptionType } from '../database/models/subscription.model';
import PartnerModel from '../database/models/partner.model';
import LeaderboardBonusModel from '../database/models/leaderboard-bonus.model';
import { parseAdminFilters, AdminFilterError, dateMatch } from '../utils/admin-filters';
import { countryValuesFor, isoOfCountryValue, memberObjectIdsForCountry, resetCountryValuesCache } from '../utils/country-filter';
import { userService } from '../services/user.service';
import { partnerService } from '../services/partner.service';
import { leaderboardBonusService } from '../services/leaderboard-bonus.service';

const URI = process.env.CHECK_MONGO_URI || 'mongodb://127.0.0.1:27017/sbc_user_filters_check';

const throws400 = (q: Record<string, unknown>, re: RegExp) =>
    assert.throws(() => parseAdminFilters(q), (e: unknown) => e instanceof AdminFilterError && e.statusCode === 400 && re.test(e.message));

(async () => {
    // --- parsing (no DB) ---
    assert.deepStrictEqual(parseAdminFilters({}), {}, 'nothing set = no filter');
    assert.deepStrictEqual(parseAdminFilters({ country: '', from: ' ', to: '' }), {}, 'empty = absent');
    assert.deepStrictEqual(parseAdminFilters({ country: 'ALL' }), {}, 'ALL = every country');
    assert.strictEqual(parseAdminFilters({ country: ' cm ' }).country, 'CM', 'any case, trimmed');
    throws400({ country: 'zz9' }, /Code pays invalide/);
    throws400({ country: 'Cameroun' }, /Code pays invalide/);
    throws400({ from: 'bad' }, /Date « from » invalide/);
    throws400({ to: '11/16/2026' }, /Date « to » invalide/);
    throws400({ from: '2026-03-01', to: '2026-01-01' }, /doit précéder/);
    const day = parseAdminFilters({ from: '2026-11-01', to: '2026-11-30' });
    assert.strictEqual(day.from!.toISOString(), '2026-11-01T00:00:00.000Z');
    assert.strictEqual(day.to!.toISOString(), '2026-11-30T23:59:59.999Z', 'a bare `to` is the end of that day');
    assert.strictEqual(parseAdminFilters({ to: '2026-11-30T10:00:00Z' }).to!.toISOString(), '2026-11-30T10:00:00.000Z', 'an instant is kept');
    assert.deepStrictEqual(dateMatch('createdAt', {}), {});

    assert.strictEqual(isoOfCountryValue('Congo-Brazzaville'), 'CG');
    assert.strictEqual(isoOfCountryValue('cameroun'), 'CM');
    assert.strictEqual(isoOfCountryValue('fr'), 'FR', 'any two-letter code, upper-cased');
    assert.strictEqual(isoOfCountryValue('Atlantis'), null);
    assert.strictEqual(isoOfCountryValue(null), null);

    // --- fixtures ---
    await mongoose.connect(URI, { autoIndex: false, autoCreate: false });
    await mongoose.connection.dropDatabase();
    resetCountryValuesCache();

    const jan = new Date('2026-01-15T12:00:00Z');
    const jun = new Date('2026-06-15T12:00:00Z');
    const mk = async (country: string | null, createdAt: Date, balance: number, extra: Record<string, unknown> = {}) => {
        const _id = new Types.ObjectId();
        await UserModel.collection.insertOne({
            _id, name: `u-${country}`, email: `${_id}@t.io`, phoneNumber: `${Date.now()}${Math.random()}`,
            password: 'x', country, deleted: false, blocked: false, balance, createdAt, ...extra,
        } as any);
        return _id;
    };
    const cmJan = await mk('CM', jan, 100);
    const cmLower = await mk('cm', jun, 10);
    const cmName = await mk('Cameroun', jun, 1);
    const cmDeleted = await mk('CM', jan, 1000, { deleted: true });
    const cg = await mk('Congo-Brazzaville', jan, 5);
    const cgCode = await mk('CG', jun, 7);
    const bj = await mk('BJ', jun, 50);
    await mk(null, jun, 3);

    const sub = (user: Types.ObjectId, type: SubscriptionType, startDate: Date) => SubscriptionModel.collection.insertOne({
        user, subscriptionType: type, status: SubscriptionStatus.ACTIVE, startDate,
        endDate: new Date(Date.now() + 365 * 864e5), createdAt: startDate,
    } as any);
    await sub(cmJan, SubscriptionType.CLASSIQUE, jan);
    await sub(cmName, SubscriptionType.CLASSIQUE, jun);
    await sub(cmLower, SubscriptionType.CIBLE, jun);
    await sub(bj, SubscriptionType.CLASSIQUE, jun);

    const partner = (user: Types.ObjectId, pack: string, createdAt: Date) => PartnerModel.collection.insertOne({
        user, pack, isActive: true, amount: 0, createdAt,
    } as any);
    await partner(cmJan, 'gold', jan);
    await partner(cmName, 'silver', jun);
    await partner(bj, 'silver', jun);

    // --- ids-by-country matching ---
    assert.deepStrictEqual(new Set(await countryValuesFor('cm')), new Set(['CM', 'cm', 'Cameroun']), 'every stored spelling of CM');
    const cmIds = (await memberObjectIdsForCountry('CM')).map(String).sort();
    assert.deepStrictEqual(cmIds, [cmJan, cmLower, cmName, cmDeleted].map(String).sort(), 'CM members, deleted included');
    assert.strictEqual((await userService.getUserIdsByCountry('CG')).length, 2, 'legacy name folds into CG');
    assert.strictEqual((await userService.getUserIdsByCountry('XX')).length, 0);

    // --- /users/admin/users ---
    const list = async (filters: Record<string, unknown>) =>
        (await userService.adminListUsers(filters as any, { page: 1, limit: 50 })).paginationInfo.totalCount;
    assert.strictEqual(await list({}), 7, 'all non-deleted');
    assert.strictEqual(await list({ country: 'CM' }), 3, 'CM, cm, Cameroun (deleted hidden as before)');
    assert.strictEqual(await list({ country: 'CG' }), 2);
    assert.strictEqual(await list({ createdFrom: '2026-06-01', createdTo: '2026-06-30T23:59:59Z' }), 5);
    assert.strictEqual(await list({ country: 'CM', createdFrom: '2026-06-01' }), 2);

    // --- /stats/user-summary ---
    assert.deepStrictEqual(await userService.adminGetUserSummaryStats({}), { totalUsers: 7, activeClassique: 3, activeCible: 1 });
    assert.deepStrictEqual(await userService.adminGetUserSummaryStats({ country: 'CM' }), { totalUsers: 3, activeClassique: 2, activeCible: 1 });
    assert.deepStrictEqual(
        await userService.adminGetUserSummaryStats({ country: 'CM', from: new Date('2026-06-01') }),
        { totalUsers: 2, activeClassique: 1, activeCible: 1 }, 'members by createdAt, subscriptions by startDate');

    // --- /stats/balance-by-country: legacy names folded, filtered ---
    const balances = await userService.getAggregatedBalanceByCountry({});
    assert.strictEqual(balances.find(b => b._id === 'CM')!.totalBalance, 111, 'CM + cm + Cameroun in one line; deleted excluded');
    assert.strictEqual(balances.find(b => b._id === 'CG')!.totalBalance, 12, 'Congo-Brazzaville folded into CG');
    assert.ok(!balances.some(b => b._id === 'Cameroun' || b._id === 'cm'));
    assert.deepStrictEqual(await userService.getAggregatedBalanceByCountry({ country: 'CG', from: new Date('2026-06-01') }), [{ _id: 'CG', totalBalance: 7 }]);

    // --- /stats/monthly-activity (subscriptions were never counted before: the match used `type`) ---
    const monthly = await userService.getMonthlyActivityStats(12, { country: 'CM', from: new Date('2026-01-01'), to: new Date('2026-06-30T23:59:59Z') });
    const janRow = monthly.find((m: any) => m.month === '2026-1');
    const junRow = monthly.find((m: any) => m.month === '2026-6');
    assert.strictEqual(monthly.length, 6, 'from/to set the window');
    assert.strictEqual(janRow.registered, 2, 'CM registrations in January (deleted counted, as before)');
    assert.strictEqual(junRow.registered, 2);
    // A subscription counts from the first month START it is active at (existing rule),
    // so the January CM sub counts from February and the June ones not yet.
    assert.strictEqual(janRow.classiqueActive, 0);
    assert.strictEqual(monthly.find((m: any) => m.month === '2026-2').classiqueActive, 1);
    assert.strictEqual(junRow.classiqueActive, 1);
    assert.strictEqual(junRow.cibleActive, 0);
    const bjMonthly = await userService.getMonthlyActivityStats(12, { country: 'BJ', from: new Date('2026-06-01'), to: new Date('2026-06-30T23:59:59Z') });
    assert.deepStrictEqual(bjMonthly, [{ month: '2026-6', registered: 1, classiqueActive: 0, cibleActive: 0 }]);

    // --- partners ---
    assert.strictEqual((await partnerService.adminListPartners(1, 50, {})).totalDocs, 3);
    assert.strictEqual((await partnerService.adminListPartners(1, 50, { country: 'CM' })).totalDocs, 2);
    assert.strictEqual((await partnerService.adminListPartners(1, 50, { country: 'CM', to: new Date('2026-02-01') })).totalDocs, 1);
    assert.deepStrictEqual(await partnerService.getPartnerSummaryStats({ country: 'CM' }),
        { totalActivePartners: 2, activeSilverPartners: 1, activeGoldPartners: 1 });
    assert.deepStrictEqual(await partnerService.getPartnerSummaryStats({ country: 'SN' }),
        { totalActivePartners: 0, activeSilverPartners: 0, activeGoldPartners: 0 });

    // --- leaderboard bonus ledger ---
    for (const [userId, at] of [[cmJan, jan], [bj, jun]] as const) {
        await LeaderboardBonusModel.collection.insertOne({ userId, month: '2026-05', amount: 1000, salesCount: 10, status: 'paid', createdAt: at } as any);
    }
    assert.strictEqual((await leaderboardBonusService.listBonuses('2026-05', 100, 0, {})).total, 2);
    assert.strictEqual((await leaderboardBonusService.listBonuses('2026-05', 100, 0, { country: 'cm'.toUpperCase() })).total, 1);
    assert.strictEqual((await leaderboardBonusService.listBonuses('2026-05', 100, 0, { from: new Date('2026-06-01') })).total, 1);

    console.log('OK  user-service admin filters: parsing/400s, country spellings + deleted members, users list, summary, balance-by-country folding, monthly activity, partners, leaderboard bonus.');
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    process.exit(0);
})().catch(async (e) => {
    console.error('FAIL', e);
    try { await mongoose.connection.dropDatabase(); } catch { /* ignore */ }
    await mongoose.disconnect();
    process.exit(1);
});
