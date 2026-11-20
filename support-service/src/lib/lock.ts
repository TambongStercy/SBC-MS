import crypto from 'crypto';
import { redis, k } from './redis';

/**
 * Redis lock (SET NX PX + compare-and-delete). Used so only one process runs
 * a scheduled job, and to serialise an agent's own "next task" requests.
 */
export async function acquireLock(name: string, ttlMs: number): Promise<string | null> {
    const token = crypto.randomBytes(12).toString('hex');
    const ok = await redis().set(k(`lock:${name}`), token, 'PX', ttlMs, 'NX');
    return ok === 'OK' ? token : null;
}

const RELEASE = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

export async function releaseLock(name: string, token: string): Promise<void> {
    await redis().eval(RELEASE, 1, k(`lock:${name}`), token);
}

/** Runs fn under the lock; returns undefined when another holder has it. */
export async function withLock<T>(name: string, ttlMs: number, fn: () => Promise<T>): Promise<T | undefined> {
    const token = await acquireLock(name, ttlMs);
    if (!token) return undefined;
    try {
        return await fn();
    } finally {
        await releaseLock(name, token).catch(() => undefined);
    }
}

/** Waits (polling) for the lock up to waitMs, then runs fn. Throws if it never gets it. */
export async function withLockWait<T>(name: string, ttlMs: number, waitMs: number, fn: () => Promise<T>): Promise<T> {
    const deadline = Date.now() + waitMs;
    for (;;) {
        const token = await acquireLock(name, ttlMs);
        if (token) {
            try { return await fn(); } finally { await releaseLock(name, token).catch(() => undefined); }
        }
        if (Date.now() > deadline) throw new Error(`lock ${name} busy`);
        await new Promise((r) => setTimeout(r, 25 + Math.random() * 50));
    }
}
