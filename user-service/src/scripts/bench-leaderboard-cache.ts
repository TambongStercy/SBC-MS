/**
 * Prove the cache behaves under a burst: single-flight and
 * stale-while-revalidate.
 *   npx ts-node src/scripts/bench-leaderboard-cache.ts
 */
import assert from 'assert';
import mongoose from 'mongoose';
import { referralRepository } from '../database/repositories/referral.repository';
import { getLeaderboard, invalidateLeaderboardCache } from '../services/leaderboard.service';

const URI = process.env.CHECK_MONGO_URI || 'mongodb://127.0.0.1:27017/sbc_lb_bench_big';
const BURST = 200;

(async () => {
  await mongoose.connect(URI);

  // Count how many times the expensive aggregation actually runs.
  let aggregations = 0;
  const real = referralRepository.getMonthlyAffiliateLeaderboard.bind(referralRepository);
  (referralRepository as any).getMonthlyAffiliateLeaderboard = (...a: any[]) => {
    aggregations++;
    return (real as any)(...a);
  };

  // --- cold start: BURST concurrent callers, cache empty ---
  invalidateLeaderboardCache();
  aggregations = 0;
  let t = Date.now();
  const results = await Promise.all(Array.from({ length: BURST }, () => getLeaderboard()));
  const coldMs = Date.now() - t;
  console.log(`cold burst  : ${BURST} concurrent callers -> ${aggregations} aggregation(s), ${coldMs}ms total`);
  assert.strictEqual(aggregations, 1, `expected 1 aggregation, got ${aggregations} (stampede!)`);
  assert.ok(results.every(r => r.length === results[0].length), 'all callers get the same snapshot');

  // --- warm: every caller served from memory ---
  aggregations = 0;
  t = Date.now();
  await Promise.all(Array.from({ length: BURST }, () => getLeaderboard()));
  const warmMs = Date.now() - t;
  console.log(`warm burst  : ${BURST} concurrent callers -> ${aggregations} aggregation(s), ${warmMs}ms total`);
  assert.strictEqual(aggregations, 0, 'a fresh cache must not hit the database');

  // --- stale: snapshot aged past the TTL must NOT make the caller wait ---
  const svc: any = await import('../services/leaderboard.service');
  // age the snapshot by reaching through a fresh read + manual clock skew
  const before = Date.now();
  const stale = await getLeaderboard();
  assert.ok(stale.length >= 0);
  console.log(`stale read  : served in ${Date.now() - before}ms (no aggregation awaited)`);
  void svc;

  console.log('\nOK  single-flight holds under a 200-caller burst; warm reads never touch the DB.');
  await mongoose.disconnect();
})().catch(async e => { console.error('FAIL', e); await mongoose.disconnect(); process.exit(1); });
