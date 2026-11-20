import Redis from 'ioredis';
import logger from './logger';

/**
 * Redis for hot counters: rate limits, daily dedupe, lockouts, risk scores
 * (Security plan, performance rule 5). Same file in user-service,
 * gateway-service and payment-service; keep them identical apart from SERVICE.
 *
 * Rules every caller gets for free:
 * - Fail open. Redis off (REDIS_URL unset), down, or slower than
 *   REDIS_COMMAND_TIMEOUT_MS (150 ms): the call returns the caller's fallback,
 *   never throws, never holds a member's request. Anything that pays money
 *   must not rely on Redis alone (rule 7: money fails closed).
 * - Every key carries the service prefix (`sbc:<service>:`, REDIS_KEY_PREFIX)
 *   and a TTL: there is no write without one.
 * - Commands are not queued while disconnected (enableOfflineQueue: false),
 *   so an outage costs nothing but the fallback.
 */

const SERVICE = 'user';
const log = logger.getLogger('Redis');

const URL = process.env.REDIS_URL || '';
const PREFIX = process.env.REDIS_KEY_PREFIX || `sbc:${SERVICE}:`;
const TIMEOUT_MS = Number(process.env.REDIS_COMMAND_TIMEOUT_MS || 150);

let client: Redis | null = null;
const lastWarn: Record<string, number> = {};

/** At most one warning a minute per label, so an outage does not flood the logs. */
function warn(label: string, message: string): void {
    const now = Date.now();
    if ((lastWarn[label] || 0) > now - 60_000) return;
    lastWarn[label] = now;
    log.warn(`${label}: ${message} (fail open)`);
}

export function redisEnabled(): boolean {
    return !!URL;
}

function getClient(): Redis | null {
    if (!URL) return null;
    if (!client) {
        client = new Redis(URL, {
            lazyConnect: false,
            enableOfflineQueue: false,
            maxRetriesPerRequest: 0,
            connectTimeout: 2000,
            commandTimeout: TIMEOUT_MS,
            // Keep trying in the background, at most every 5 s.
            retryStrategy: times => Math.min(times * 200, 5000),
        });
        client.on('error', err => warn('connection', err.message));
        client.on('ready', () => log.info(`Redis ready (prefix ${PREFIX})`));
    }
    return client;
}

/** The full key: service prefix + key. */
export const rkey = (key: string): string => `${PREFIX}${key}`;

/**
 * Runs `fn` against Redis, or returns `fallback` when Redis is off, not
 * connected, failing or slower than the timeout.
 */
export async function withRedis<T>(label: string, fallback: T, fn: (r: Redis) => Promise<T>): Promise<T> {
    const r = getClient();
    if (!r) return fallback;
    if (r.status !== 'ready') {
        warn(label, `not connected (${r.status})`);
        return fallback;
    }
    let timer: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            fn(r),
            new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(`timeout after ${TIMEOUT_MS} ms`)), TIMEOUT_MS); }),
        ]);
    } catch (err: any) {
        warn(label, err?.message || String(err));
        return fallback;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/**
 * Counts one event in a window: the key lives `ttlSeconds` from its first hit.
 * Returns the count, or null when Redis is unavailable (the caller decides
 * what "unknown" means: usually allow).
 */
export async function incrWindow(key: string, ttlSeconds: number): Promise<number | null> {
    return withRedis<number | null>('incrWindow', null, async r => {
        const k = rkey(key);
        const [[, count], [, ttl]] = (await r.multi().incr(k).ttl(k).exec()) as [[unknown, number], [unknown, number]];
        if (ttl < 0) await r.expire(k, ttlSeconds);
        return count;
    });
}

/**
 * Claims a key once for `ttlSeconds` (daily dedupe, "already alerted").
 * true = claimed now, false = already claimed, null = Redis unavailable.
 */
export async function claimOnce(key: string, ttlSeconds: number): Promise<boolean | null> {
    return withRedis<boolean | null>('claimOnce', null, async r =>
        (await r.set(rkey(key), '1', 'EX', ttlSeconds, 'NX')) === 'OK');
}

export async function setJson(key: string, value: unknown, ttlSeconds: number): Promise<boolean> {
    return withRedis('setJson', false, async r => (await r.set(rkey(key), JSON.stringify(value), 'EX', ttlSeconds)) === 'OK');
}

export async function getJson<T>(key: string): Promise<T | null> {
    return withRedis<T | null>('getJson', null, async r => {
        const raw = await r.get(rkey(key));
        return raw ? JSON.parse(raw) as T : null;
    });
}

/** For /health: 'off' (not configured), 'up', or 'down'. Never throws. */
export async function redisHealth(): Promise<'off' | 'up' | 'down'> {
    if (!URL) return 'off';
    return (await withRedis('health', false, async r => (await r.ping()) === 'PONG')) ? 'up' : 'down';
}

export async function closeRedis(): Promise<void> {
    if (!client) return;
    const c = client;
    client = null;
    try { await c.quit(); } catch { c.disconnect(); }
}
