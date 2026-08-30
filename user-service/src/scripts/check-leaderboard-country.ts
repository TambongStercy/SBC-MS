/** Admin per-country board check. */
import assert from 'assert';
import mongoose, { Types } from 'mongoose';
import ReferralModel from '../database/models/referral.model';
import UserModel from '../database/models/user.model';
import SubscriptionModel, { SubscriptionStatus, SubscriptionType } from '../database/models/subscription.model';
import { startOfCurrentMonthDouala } from '../database/repositories/referral.repository';
import { getLeaderboardByCountry, getLeaderboardForMonth } from '../services/leaderboard.service';

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
      await ReferralModel.collection.insertOne({ referrer: _id, referredUser: new Types.ObjectId(),
        referralLevel: 1, archived: false, createdAt: inMonth } as any);
    }
  };
  await mk('CM-big', 'CM', 50);
  await mk('CM-small', 'CM', 10);
  await mk('SN-top', 'SN', 30);
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

  console.log('OK  admin: global board, single-country filter, and per-country grouping all correct.');
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
})().catch(async e => { console.error('FAIL', e); await mongoose.disconnect(); process.exit(1); });
