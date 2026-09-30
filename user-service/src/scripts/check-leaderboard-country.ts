/** Per-country boards (admin filters, "Classement par pays") and "Top de mes filleuls". */
import assert from 'assert';
import mongoose, { Types } from 'mongoose';
import ReferralModel from '../database/models/referral.model';
import UserModel from '../database/models/user.model';
import SubscriptionModel, { SubscriptionStatus, SubscriptionType } from '../database/models/subscription.model';
import { startOfCurrentMonthDouala, normalizeCountry } from '../database/repositories/referral.repository';
import {
  getLeaderboardByCountry,
  getLeaderboardForMonth,
  getCountryBoard,
  getMyFilleulsBoard,
  invalidateLeaderboardCache,
} from '../services/leaderboard.service';

const URI = process.env.CHECK_MONGO_URI || 'mongodb://127.0.0.1:27017/sbc_lb_country_check';

(async () => {
  await mongoose.connect(URI);
  await Promise.all([
    ReferralModel.collection.deleteMany({}),
    UserModel.collection.deleteMany({}),
    SubscriptionModel.collection.deleteMany({}),
  ]);
  const inMonth = new Date(startOfCurrentMonthDouala().getTime() + 60_000);
  const mk = async (name: string, country: string, n: number) => {
    const _id = new Types.ObjectId();
    await UserModel.collection.insertOne({ _id, name, email: `${_id}@t.io`,
      phoneNumber: `${Date.now()}${Math.random()}`, password: 'x', country, city: 'x',
      deleted: false, blocked: false } as any);
    await SubscriptionModel.collection.insertOne({ user: _id, subscriptionType: SubscriptionType.CLASSIQUE,
      status: SubscriptionStatus.ACTIVE, startDate: inMonth, endDate: new Date(Date.now() + 30 * 864e5) } as any);
    for (let i = 0; i < n; i++) {
      const filleul = new Types.ObjectId();
      await ReferralModel.collection.insertOne({ referrer: _id, referredUser: filleul,
        referralLevel: 1, archived: false, createdAt: inMonth } as any);
      // Only filleuls who PAID inside the month are ranked.
      await SubscriptionModel.collection.insertOne({ user: filleul, subscriptionType: SubscriptionType.CLASSIQUE,
        status: SubscriptionStatus.ACTIVE, startDate: inMonth, createdAt: inMonth,
        endDate: new Date(Date.now() + 30 * 864e5) } as any);
    }
    return _id;
  };
  const cmBig = await mk('CM-big', 'CM', 50);
  await mk('CM-small', 'CM', 10);
  const snTop = await mk('SN-top', 'SN', 30);
  await mk('CI-top', 'CI', 20);

  const ms = startOfCurrentMonthDouala();
  const global = await getLeaderboardForMonth(ms, 10);
  assert.deepStrictEqual(global.map(e => e.name), ['CM-big', 'SN-top', 'CI-top', 'CM-small'], 'global order');

  const cm = await getLeaderboardForMonth(ms, 10, 'CM');
  assert.deepStrictEqual(cm.map(e => e.name), ['CM-big', 'CM-small'], 'CM only');
  assert.deepStrictEqual(cm.map(e => e.rank), [1, 2], 'ranks are re-numbered within the country');

  const grouped = await getLeaderboardByCountry(ms, 10);
  assert.deepStrictEqual(Object.keys(grouped).sort(), ['CI', 'CM', 'SN'], 'a bucket per country');
  assert.deepStrictEqual(grouped.CM.map(e => e.name), ['CM-big', 'CM-small']);
  assert.deepStrictEqual(grouped.SN.map(e => e.rank), [1], 'SN top is rank 1 in its own board');

  // --- Member "Classement par pays" ---
  assert.strictEqual(normalizeCountry(' cm '), 'CM', 'ISO-2 is trimmed and upper-cased');
  assert.strictEqual(normalizeCountry('Congo-Brazzaville'), 'CG', 'legacy name folds into its code');
  assert.strictEqual(normalizeCountry('Atlantis'), null, 'unknown names are not a country');
  assert.strictEqual(normalizeCountry(undefined), null);

  await mk('CG-legacy', 'Congo-Brazzaville', 5);
  await mk('Stateless', '', 40); // ranked globally, but belongs to no country

  invalidateLeaderboardCache();
  const board = await getCountryBoard();
  assert.deepStrictEqual(
    board.countries.map(c => [c.country, c.referralCount, c.affiliates, c.rank]),
    [['CM', 60, 2, 1], ['SN', 30, 1, 2], ['CI', 20, 1, 3], ['CG', 5, 1, 4]],
    'countries ranked by summed paid filleuls, legacy name folded, no-country excluded',
  );
  assert.deepStrictEqual(Object.keys(board.byCountry).sort(), ['CG', 'CI', 'CM', 'SN'], 'a top board per ranked country');
  assert.deepStrictEqual(board.byCountry.CM.map(e => [e.name, e.rank]), [['CM-big', 1], ['CM-small', 2]], 'CM re-ranked from 1');
  assert.deepStrictEqual(board.byCountry.CG.map(e => e.name), ['CG-legacy']);
  assert.strictEqual(await getCountryBoard(), board, 'second call is served from the cache');

  // --- "Top de mes filleuls" ---
  // A sponsor whose direct filleuls are SN-top (30) and CM-big (50), inserted in
  // the "wrong" order to prove the board ranks rather than echoing insert order.
  const sponsor = new Types.ObjectId();
  for (const filleul of [snTop, cmBig]) {
    await ReferralModel.collection.insertOne({ referrer: sponsor, referredUser: filleul,
      referralLevel: 1, archived: false, createdAt: inMonth } as any);
  }
  invalidateLeaderboardCache();
  const mine = await getMyFilleulsBoard(sponsor.toString());
  assert.deepStrictEqual(mine.top.map(e => [e.name, e.referralCount, e.rank]), [['CM-big', 50, 1], ['SN-top', 30, 2]], 'sponsor sees their filleuls ranked');
  assert.strictEqual(mine.totalRanked, 2);
  const nobody = await getMyFilleulsBoard(new Types.ObjectId().toString());
  assert.deepStrictEqual(nobody, { top: [], totalRanked: 0 }, 'a sponsor with no ranked filleuls gets an empty board');

  console.log('OK  admin filters + country board + top de mes filleuls: totals, order, aliases, exclusions, re-ranking and cache.');
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
})().catch(async e => { console.error('FAIL', e); await mongoose.disconnect(); process.exit(1); });
