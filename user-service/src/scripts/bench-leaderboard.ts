/**
 * Benchmark the monthly leaderboard aggregation at realistic scale.
 *   npx ts-node src/scripts/bench-leaderboard.ts [referrers] [referralsPerReferrer]
 */
import mongoose, { Types } from 'mongoose';
import ReferralModel from '../database/models/referral.model';
import UserModel from '../database/models/user.model';
import SubscriptionModel, { SubscriptionStatus, SubscriptionType } from '../database/models/subscription.model';
import { referralRepository } from '../database/repositories/referral.repository';

const URI = process.env.CHECK_MONGO_URI || 'mongodb://127.0.0.1:27017/sbc_leaderboard_bench';
const REFERRERS = Number(process.argv[2] || 5000);
const PER = Number(process.argv[3] || 20);

(async () => {
  await mongoose.connect(URI);
  const existing = await ReferralModel.collection.estimatedDocumentCount();

  if (existing < REFERRERS * PER * 0.9) {
    console.log(`seeding ${REFERRERS} referrers x ${PER} referrals ...`);
    await Promise.all([
      ReferralModel.collection.deleteMany({}),
      UserModel.collection.deleteMany({}),
      SubscriptionModel.collection.deleteMany({}),
    ]);
    const now = Date.now();
    const monthStart = new Date(now - 20 * 864e5);
    for (let batch = 0; batch < REFERRERS; batch += 500) {
      const users: any[] = [], subs: any[] = [], refs: any[] = [];
      for (let i = batch; i < Math.min(batch + 500, REFERRERS); i++) {
        const _id = new Types.ObjectId();
        users.push({ _id, name: `User ${i}`, email: `u${i}@t.io`, phoneNumber: `70${i}`,
          password: 'x', country: 'CM', city: 'Douala', deleted: false, blocked: false });
        subs.push({ user: _id, subscriptionType: SubscriptionType.CLASSIQUE,
          status: SubscriptionStatus.ACTIVE, startDate: monthStart,
          endDate: new Date(now + 30 * 864e5) });
        // skew the counts so the ranking is non-trivial
        const n = 1 + ((i * 7919) % PER);
        for (let k = 0; k < n; k++) {
          refs.push({ referrer: _id, referredUser: new Types.ObjectId(),
            referralLevel: (k % 3) + 1, archived: false,
            createdAt: new Date(monthStart.getTime() + (k % 19) * 864e5) });
        }
      }
      await UserModel.collection.insertMany(users, { ordered: false });
      await SubscriptionModel.collection.insertMany(subs, { ordered: false });
      await ReferralModel.collection.insertMany(refs, { ordered: false });
    }
    await ReferralModel.syncIndexes();
    await SubscriptionModel.syncIndexes();
  }

  const refCount = await ReferralModel.collection.estimatedDocumentCount();
  const userCount = await UserModel.collection.estimatedDocumentCount();
  console.log(`\ndataset: ${userCount.toLocaleString()} users, ${refCount.toLocaleString()} referrals\n`);

  const times: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t = Date.now();
    const { top: rows } = await referralRepository.getMonthlyAffiliateLeaderboard(10);
    const ms = Date.now() - t;
    times.push(ms);
    if (i === 0) console.log(`  top3: ${rows.slice(0, 3).map(r => `${r.name}=${r.referralCount}`).join(', ')}`);
  }
  times.sort((a, b) => a - b);
  console.log(`\n  runs(ms): ${times.join(', ')}`);
  console.log(`  median:   ${times[2]} ms\n`);

  await mongoose.disconnect();
})().catch(async e => { console.error('FAIL', e); await mongoose.disconnect(); process.exit(1); });
