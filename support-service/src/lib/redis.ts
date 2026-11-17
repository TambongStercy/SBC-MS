import Redis from 'ioredis';
import config from '../config';
import logger from '../utils/logger';

const log = logger.getLogger('Redis');

let client: Redis | null = null;

/** Shared Redis client. Keys are prefixed with config.redis.keyPrefix through k(). */
export function redis(): Redis {
    if (!client) {
        client = new Redis(config.redis.url, { maxRetriesPerRequest: 2, enableReadyCheck: true, lazyConnect: false });
        client.on('error', (err) => log.warn('Redis error', { message: err.message }));
    }
    return client;
}

export const k = (key: string): string => `${config.redis.keyPrefix}${key}`;

export async function closeRedis(): Promise<void> {
    if (client) {
        const c = client;
        client = null;
        try { await c.quit(); } catch { c.disconnect(); }
    }
}
