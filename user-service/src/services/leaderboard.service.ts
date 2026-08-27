import { referralRepository, LeaderboardEntry } from '../database/repositories/referral.repository';
import logger from '../utils/logger';

const log = logger.getLogger('LeaderboardService');

const TTL_MS = 60 * 60 * 1000;        // the UI states "mis à jour chaque heure"
const STALE_MAX_MS = 6 * 60 * 60 * 1000;
const TOP_N = 10;

let cache: { data: LeaderboardEntry[]; at: number } | null = null;
let inFlight: Promise<LeaderboardEntry[]> | null = null;

/**
 * Recompute, with single-flight.
 *
 * Without the inFlight guard, every request arriving while the snapshot is
 * being rebuilt starts its OWN aggregation. Measured at 40k referrers /
 * 520k referrals a single run is ~674ms, so a burst of N requests at expiry
 * means N concurrent full index scans — the cache turns into a thundering herd
 * exactly when the site is busiest. Callers now share one promise.
 */
function refresh(): Promise<LeaderboardEntry[]> {
  if (inFlight) return inFlight;

  const started = Date.now();
  inFlight = referralRepository
    .getMonthlyAffiliateLeaderboard(TOP_N)
    .then((data) => {
      cache = { data, at: Date.now() };
      log.info(`Leaderboard recomputed: ${data.length} entries in ${Date.now() - started}ms`);
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
export async function getLeaderboard(): Promise<LeaderboardEntry[]> {
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

/** Drop the cached snapshot. Used by tests and the seed script. */
export function invalidateLeaderboardCache(): void {
  cache = null;
}
