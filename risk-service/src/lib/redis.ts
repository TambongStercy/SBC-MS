import Redis from 'ioredis';
import { config } from '../config';
import { childLogger } from './logger';

const log = childLogger('Redis');
let client: Redis | null = null;

/**
 * Optional: decisions are cached here for the payout pre-check (p95 under 20 ms).
 * Without REDIS_URL, or with Redis down, the decision is read from MongoDB.
 */
export function redis(): Redis | null {
    if (!config.redisUrl) return null;
    if (!client) {
        client = new Redis(config.redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: false, connectTimeout: 2000 });
        client.on('error', (e) => log.warn({ message: e.message }, 'redis error'));
    }
    return client;
}

export const rkey = (k: string) => `sbc:risk:${k}`;

export async function closeRedis(): Promise<void> {
    if (client) await client.quit().catch(() => undefined);
    client = null;
}

/** The client once connected (up to `ms`), else null: for writes that matter (cache clearing). */
export async function readyRedis(ms = 2000): Promise<Redis | null> {
    const r = redis();
    if (!r) return null;
    if (r.status === 'ready') return r;
    return new Promise((resolve) => {
        const t = setTimeout(() => { r.off('ready', on); resolve(null); }, ms);
        const on = () => { clearTimeout(t); resolve(r); };
        r.once('ready', on);
    });
}
