import { redis, k } from './redis';

export interface HitResult { allowed: boolean; count: number; retryAfterSec: number }

/** Fixed-window counter in Redis, shared by every process. */
export async function hit(key: string, limit: number, windowSec: number): Promise<HitResult> {
    const rk = k(`rl:${key}`);
    const r = redis();
    const res = await r.multi().incr(rk).expire(rk, windowSec, 'NX').ttl(rk).exec();
    const count = Number(res?.[0]?.[1] ?? 0);
    const ttl = Number(res?.[2]?.[1] ?? windowSec);
    return { allowed: count <= limit, count, retryAfterSec: ttl > 0 ? ttl : windowSec };
}

/** Current count without incrementing. */
export async function peek(key: string): Promise<number> {
    return Number((await redis().get(k(`rl:${key}`))) || 0);
}

export async function reset(key: string): Promise<void> {
    await redis().del(k(`rl:${key}`));
}
