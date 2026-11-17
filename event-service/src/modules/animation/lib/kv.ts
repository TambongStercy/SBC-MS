import Redis from 'ioredis';
import { randomBytes } from 'crypto';
import config from '../../../config';
import logger from '../../../utils/logger';

const log = logger.getLogger('AnimationKV');

/**
 * Shared, fast state for the animation module: free-vote quotas, rate limits,
 * the rendered live boards, pub/sub to every instance's SSE clients, and the
 * job leader lock. MongoDB stays the source of truth; everything here can be
 * rebuilt from it.
 *
 * Redis when REDIS_URL is set. Otherwise an in-process store with the same
 * semantics, which is only correct for a single instance (and scripts).
 */
export interface QuotaKey {
    key: string;
    limit: number;
    /** Seconds until the counter resets; 0 = keep for the life of the challenge. */
    ttlSec: number;
}

export interface Kv {
    /** Claims one unit on every key, or none: returns the index of the first exhausted key, or -1. */
    claimQuota(keys: QuotaKey[]): Promise<number>;
    releaseQuota(keys: string[]): Promise<void>;
    getCounts(keys: string[]): Promise<number[]>;
    /** Fixed-window counter; returns the count including this hit. */
    hit(key: string, windowSec: number): Promise<number>;
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ttlSec?: number): Promise<void>;
    del(key: string): Promise<void>;
    /** Adds members to a set (e.g. boards waiting for a recompute). */
    sadd(key: string, ...members: string[]): Promise<void>;
    /** Returns and clears the set atomically. */
    spopAll(key: string): Promise<string[]>;
    publish(channel: string, message: string): Promise<void>;
    subscribe(channel: string, handler: (message: string) => void): Promise<() => Promise<void>>;
    /** Leader lock: true when this owner holds `name` for the next ttlMs. */
    acquireLock(name: string, owner: string, ttlMs: number): Promise<boolean>;
    readonly backend: 'redis' | 'memory';
}

const CLAIM_LUA = `
for i = 1, #KEYS do
  local v = tonumber(redis.call('GET', KEYS[i]) or '0')
  if v >= tonumber(ARGV[2 * i - 1]) then return i end
end
for i = 1, #KEYS do
  redis.call('INCR', KEYS[i])
  local ttl = tonumber(ARGV[2 * i])
  if ttl > 0 and redis.call('TTL', KEYS[i]) < 0 then redis.call('EXPIRE', KEYS[i], ttl) end
end
return 0`;

const LOCK_LUA = `
local cur = redis.call('GET', KEYS[1])
if cur == false or cur == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
  return 1
end
return 0`;

const SPOP_ALL_LUA = `
local m = redis.call('SMEMBERS', KEYS[1])
redis.call('DEL', KEYS[1])
return m`;

class RedisKv implements Kv {
    readonly backend = 'redis' as const;
    private cmd: Redis;
    private sub: Redis;
    private handlers = new Map<string, Set<(m: string) => void>>();

    constructor(url: string, private prefix: string) {
        this.cmd = new Redis(url, { keyPrefix: prefix, maxRetriesPerRequest: 3, enableOfflineQueue: true });
        // Subscriber connections can't run other commands; no keyPrefix for channels.
        this.sub = new Redis(url, { maxRetriesPerRequest: null });
        this.cmd.on('error', (e) => log.error(`Redis error: ${e.message}`));
        this.sub.on('error', (e) => log.error(`Redis subscriber error: ${e.message}`));
        this.sub.on('message', (channel, message) => {
            for (const h of this.handlers.get(channel) ?? []) {
                try { h(message); } catch (e) { log.error(`pub/sub handler failed: ${(e as Error).message}`); }
            }
        });
    }

    async claimQuota(keys: QuotaKey[]): Promise<number> {
        if (!keys.length) return -1;
        const args = keys.flatMap((k) => [String(k.limit), String(k.ttlSec)]);
        const res = await this.cmd.eval(CLAIM_LUA, keys.length, ...keys.map((k) => k.key), ...args) as number;
        return res === 0 ? -1 : res - 1;
    }
    async releaseQuota(keys: string[]): Promise<void> {
        if (!keys.length) return;
        const p = this.cmd.pipeline();
        for (const k of keys) p.decr(k);
        await p.exec();
    }
    async getCounts(keys: string[]): Promise<number[]> {
        if (!keys.length) return [];
        const vals = await this.cmd.mget(...keys);
        return vals.map((v) => Number(v ?? 0));
    }
    async hit(key: string, windowSec: number): Promise<number> {
        const res = await this.cmd.multi().incr(key).expire(key, windowSec, 'NX').exec();
        return Number(res?.[0]?.[1] ?? 0);
    }
    async get(key: string) { return this.cmd.get(key); }
    async set(key: string, value: string, ttlSec?: number) {
        if (ttlSec) await this.cmd.set(key, value, 'EX', ttlSec);
        else await this.cmd.set(key, value);
    }
    async del(key: string) { await this.cmd.del(key); }
    async sadd(key: string, ...members: string[]) { if (members.length) await this.cmd.sadd(key, ...members); }
    async spopAll(key: string) { return (await this.cmd.eval(SPOP_ALL_LUA, 1, key)) as string[]; }
    async publish(channel: string, message: string) { await this.cmd.publish(this.prefix + channel, message); }
    async subscribe(channel: string, handler: (m: string) => void) {
        const full = this.prefix + channel;
        let set = this.handlers.get(full);
        if (!set) {
            set = new Set();
            this.handlers.set(full, set);
            await this.sub.subscribe(full);
        }
        set.add(handler);
        return async () => {
            const s = this.handlers.get(full);
            if (!s) return;
            s.delete(handler);
            if (!s.size) {
                this.handlers.delete(full);
                await this.sub.unsubscribe(full).catch(() => undefined);
            }
        };
    }
    async acquireLock(name: string, owner: string, ttlMs: number) {
        return (await this.cmd.eval(LOCK_LUA, 1, `lock:${name}`, owner, String(ttlMs))) === 1;
    }
}

class MemoryKv implements Kv {
    readonly backend = 'memory' as const;
    private values = new Map<string, { v: string; exp: number }>();
    private sets = new Map<string, Set<string>>();
    private handlers = new Map<string, Set<(m: string) => void>>();

    private read(key: string): string | null {
        const e = this.values.get(key);
        if (!e) return null;
        if (e.exp && e.exp < Date.now()) { this.values.delete(key); return null; }
        return e.v;
    }
    private write(key: string, v: string, ttlSec?: number, keepTtl = false) {
        const prev = this.values.get(key);
        const exp = ttlSec ? Date.now() + ttlSec * 1000 : keepTtl && prev ? prev.exp : 0;
        this.values.set(key, { v, exp });
    }
    async claimQuota(keys: QuotaKey[]) {
        for (let i = 0; i < keys.length; i++) {
            if (Number(this.read(keys[i].key) ?? 0) >= keys[i].limit) return i;
        }
        for (const k of keys) {
            const had = this.read(k.key) !== null;
            this.write(k.key, String(Number(this.read(k.key) ?? 0) + 1), had ? undefined : k.ttlSec || undefined, had);
        }
        return -1;
    }
    async releaseQuota(keys: string[]) {
        for (const k of keys) this.write(k, String(Number(this.read(k) ?? 0) - 1), undefined, true);
    }
    async getCounts(keys: string[]) { return keys.map((k) => Number(this.read(k) ?? 0)); }
    async hit(key: string, windowSec: number) {
        const had = this.read(key) !== null;
        const n = Number(this.read(key) ?? 0) + 1;
        this.write(key, String(n), had ? undefined : windowSec, had);
        return n;
    }
    async get(key: string) { return this.read(key); }
    async set(key: string, value: string, ttlSec?: number) { this.write(key, value, ttlSec); }
    async del(key: string) { this.values.delete(key); }
    async sadd(key: string, ...members: string[]) {
        const s = this.sets.get(key) ?? new Set<string>();
        members.forEach((m) => s.add(m));
        this.sets.set(key, s);
    }
    async spopAll(key: string) {
        const s = this.sets.get(key);
        this.sets.delete(key);
        return s ? [...s] : [];
    }
    async publish(channel: string, message: string) {
        for (const h of this.handlers.get(channel) ?? []) setImmediate(() => h(message));
    }
    async subscribe(channel: string, handler: (m: string) => void) {
        const s = this.handlers.get(channel) ?? new Set();
        s.add(handler);
        this.handlers.set(channel, s);
        return async () => { s.delete(handler); };
    }
    async acquireLock(name: string, owner: string, ttlMs: number) {
        const cur = this.read(`lock:${name}`);
        if (cur === null || cur === owner) {
            this.values.set(`lock:${name}`, { v: owner, exp: Date.now() + ttlMs });
            return true;
        }
        return false;
    }
}

let instance: Kv | null = null;

export const kv = (): Kv => {
    if (!instance) {
        if (config.redis.url) {
            instance = new RedisKv(config.redis.url, config.redis.keyPrefix);
            log.info('Animation state on Redis.');
        } else {
            instance = new MemoryKv();
            log.warn('REDIS_URL not set: animation state is in-process — correct for ONE instance only.');
        }
    }
    return instance;
};

/** Test hook: swap the backend (scripts run several "instances" against one store). */
export const setKv = (k: Kv) => { instance = k; };
export const createMemoryKv = (): Kv => new MemoryKv();

/** This process's identity for leader locks. */
export const INSTANCE_ID = `${process.pid}-${randomBytes(4).toString('hex')}`;
