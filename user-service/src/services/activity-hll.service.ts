import { redisEnabled, rkey, withRedis } from '../utils/redis';

/**
 * Security plan Phase 11: live count of connected members per Douala day,
 * country and source (Redis HyperLogLog, about 12 KB per key, ~1 % error).
 * Fed by the activity batch ingest for the members it stores; read by the
 * activity rollup. Kept apart from the dashboard service so the ingest does
 * not import it. Fail open: without Redis nothing is counted live and the
 * rollup counts user_geo_days exactly instead.
 */
export type Source = 'web' | 'app' | 'api';
const SOURCES: Source[] = ['web', 'app', 'api'];
const SRC_ALL = 'all';
const HLL_TTL_S = 3 * 86400;
const COUNTRY = /^[A-Z]{2}$/;

export interface ConnectedCounts { all: number; web: number; app: number; api: number; exact: boolean }

const hllKey = (day: string, country: string, src: string) => rkey(`act:hll:${day}:${country}:${src}`);
const countriesKey = (day: string) => rkey(`act:countries:${day}`);

/** Called by the activity batch ingest for the rows it stored (consenting members). */
export async function trackConnected(rows: { userId: string; day: string; country: string; sources: Partial<Record<Source, number>> }[]): Promise<void> {
    if (!rows.length || !redisEnabled()) return;
    await withRedis('activity-hll', null, async r => {
        const p = r.pipeline();
        const touched = new Set<string>();
        for (const row of rows) {
            const c = COUNTRY.test(row.country) ? row.country : 'XX';
            p.pfadd(hllKey(row.day, c, SRC_ALL), row.userId);
            for (const s of SOURCES) if ((row.sources?.[s] ?? 0) > 0) p.pfadd(hllKey(row.day, c, s), row.userId);
            p.sadd(countriesKey(row.day), c);
            touched.add(`${row.day}|${c}`);
        }
        for (const t of touched) {
            const [day, c] = t.split('|');
            for (const s of [SRC_ALL, ...SOURCES]) p.expire(hllKey(day, c, s), HLL_TTL_S);
            p.expire(countriesKey(day), HLL_TTL_S);
        }
        await p.exec();
        return null;
    });
}

export async function liveConnected(day: string): Promise<Map<string, ConnectedCounts> | null> {
    if (!redisEnabled()) return null;
    return withRedis('activity-hll-count', null as Map<string, ConnectedCounts> | null, async r => {
        const countries = await r.smembers(countriesKey(day));
        const out = new Map<string, ConnectedCounts>();
        if (!countries.length) return out;
        const p = r.pipeline();
        for (const c of countries) for (const s of [SRC_ALL, ...SOURCES]) p.pfcount(hllKey(day, c, s));
        const res = (await p.exec()) || [];
        countries.forEach((c, i) => {
            const n = (k: number) => Number(res[i * 4 + k]?.[1] ?? 0);
            out.set(c, { all: n(0), web: n(1), app: n(2), api: n(3), exact: false });
        });
        return out;
    });
}

