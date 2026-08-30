import {
    referralRepository,
    LeaderboardEntry,
    LeaderboardSnapshot,
    startOfCurrentMonthDouala,
    startOfNextMonthDouala,
} from '../database/repositories/referral.repository';
import logger from '../utils/logger';

const log = logger.getLogger('LeaderboardService');

const TTL_MS = 60 * 60 * 1000;        // the UI states "mis à jour chaque heure"
const STALE_MAX_MS = 6 * 60 * 60 * 1000;
const TOP_N = 10;

let cache: { data: LeaderboardSnapshot; at: number } | null = null;
let inFlight: Promise<LeaderboardSnapshot> | null = null;

/**
 * Recompute, with single-flight.
 *
 * Without the inFlight guard, every request arriving while the snapshot is
 * being rebuilt starts its OWN aggregation. Measured at 40k referrers /
 * 520k referrals a single run is ~674ms, so a burst of N requests at expiry
 * means N concurrent full index scans — the cache turns into a thundering herd
 * exactly when the site is busiest. Callers now share one promise.
 */
function refresh(): Promise<LeaderboardSnapshot> {
  if (inFlight) return inFlight;

  const started = Date.now();
  inFlight = referralRepository
    .getMonthlyAffiliateLeaderboard(TOP_N)
    .then((data) => {
      cache = { data, at: Date.now() };
      log.info(`Leaderboard recomputed in ${Date.now() - started}ms`);
      return data;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/**
 * Top affiliates for the current month.
 *
 * Serves stale-while-revalidate: once the snapshot is older than TTL it is
 * still returned immediately and the rebuild happens in the background, so no
 * user ever waits on the aggregation. Only a cold start (or a snapshot older
 * than STALE_MAX) blocks.
 *
 * ponytail: still a plain in-process cache holding ten objects. With N replicas
 * you get up to N snapshots, each at most an hour stale, which is what the UI
 * already promises. There is no Redis in user-service.
 *
 * The monthly reset needs no cron: the repository recomputes the month boundary
 * on every run, so the first rebuild after midnight on the 1st matches an empty
 * range. Nothing is materialised, so nothing needs resetting.
 */
async function getSnapshot(): Promise<LeaderboardSnapshot> {
  const age = cache ? Date.now() - cache.at : Infinity;

  if (cache && age < TTL_MS) return cache.data;

  if (cache && age < STALE_MAX_MS) {
    // Fire and forget. A failed background refresh must not reject the request
    // that happens to be holding a perfectly good stale snapshot.
    refresh().catch((err) => log.warn(`Background leaderboard refresh failed: ${err?.message}`));
    return cache.data;
  }

  return refresh();
}

/**
 * Build the first snapshot at boot so the first real visitor is not the one who
 * pays for the cold aggregation.
 */
export function warmLeaderboard(): void {
  refresh().catch((err) => log.warn(`Leaderboard warm-up failed: ${err?.message}`));
}

/** The shared top-N board. */
export async function getLeaderboard(): Promise<LeaderboardEntry[]> {
    return (await getSnapshot()).top;
}

export interface MyRank {
    rank: number;
    referralCount: number;
    /** How many referrers have at least one paid direct filleul this month. */
    totalRanked: number;
    /** True when the caller already appears in the top N. */
    inTop: boolean;
}

/**
 * The caller's own standing.
 *
 * Derived from the cached count distribution rather than a per-user
 * aggregation: re-running the group for every visitor is what would have made
 * "your rank" too expensive to ship. Here it is one indexed countDocuments plus
 * a scan of an in-memory number array.
 *
 * Ties share a rank — two people on 12 referrals are both 5th, matching how the
 * board itself sorts.
 */
export async function getMyRank(userId: string, topN: number = TOP_N): Promise<MyRank> {
    const [snapshot, referralCount] = await Promise.all([
        getSnapshot(),
        referralRepository.countMonthlyDirectReferrals(userId),
    ]);
    const rank = referralCount === 0
        ? snapshot.counts.length + 1
        : snapshot.counts.filter((c: number) => c > referralCount).length + 1;
    return {
        rank,
        referralCount,
        totalRanked: snapshot.counts.length,
        inTop: rank <= topN && referralCount > 0,
    };
}

/**
 * Admin-only: the board for an arbitrary month, uncached.
 *
 * Deliberately not cached — it is an admin lookup over an arbitrary window, so
 * caching it would mean an unbounded number of snapshots for a handful of
 * requests.
 */
export async function getLeaderboardForMonth(
    monthStart: Date,
    limit: number = TOP_N,
    country?: string,
): Promise<LeaderboardEntry[]> {
    const snapshot = await referralRepository.getMonthlyAffiliateLeaderboard(
        limit,
        monthStart,
        startOfNextMonthDouala(monthStart),
        country,
    );
    return snapshot.top;
}

/**
 * Admin-only: the top N for EVERY country that has a ranked affiliate in the
 * month, keyed by country code.
 *
 * Built from one snapshot rather than one query per country: the full eligible
 * list is already computed, so the per-country boards are a grouping of it.
 */
export async function getLeaderboardByCountry(
    monthStart: Date,
    limit: number = TOP_N,
): Promise<Record<string, LeaderboardEntry[]>> {
    const all = await referralRepository.getMonthlyAffiliateLeaderboard(
        // Hydrate deep enough that each country can fill its own top N.
        // ponytail: 1000 rows covers a realistic member base; raise it if a
        // country is ever truncated at exactly `limit`.
        1000,
        monthStart,
        startOfNextMonthDouala(monthStart),
    );
    const byCountry: Record<string, LeaderboardEntry[]> = {};
    for (const entry of all.top) {
        const key = (entry.country || 'INCONNU').toUpperCase();
        const bucket = (byCountry[key] ??= []);
        if (bucket.length < limit) {
            // Re-rank within the country: global ranks would read as gaps.
            bucket.push({ ...entry, rank: bucket.length + 1 });
        }
    }
    return byCountry;
}

/** Start of the current month, for callers that need the default window. */
export { startOfCurrentMonthDouala };

/** Drop the cached snapshot. Used by tests and the seed script. */
export function invalidateLeaderboardCache(): void {
  cache = null;
}
