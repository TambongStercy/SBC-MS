/**
 * Asserts utils/redis.ts (Security plan, performance rules 5 and 7): every key
 * is prefixed and expires, and Redis off, down or slow never breaks or holds
 * a caller: it gets its fallback, fast.
 *
 * Needs a Redis on 127.0.0.1:6379 (uses database 15 and flushes it).
 *
 *   npx ts-node src/scripts/check-redis-fail-open.ts
 */
export {};

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** A fresh copy of the module with these env values (it reads them at load). */
function load(env: Record<string, string | undefined>): typeof import('../utils/redis') {
    for (const [k, v] of Object.entries(env)) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    delete require.cache[require.resolve('../utils/redis')];
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('../utils/redis');
}

const timed = async <T>(fn: () => Promise<T>): Promise<[T, number]> => {
    const t = Date.now();
    const v = await fn();
    return [v, Date.now() - t];
};

const main = async () => {
    // --- off: REDIS_URL unset ---
    const off = load({ REDIS_URL: undefined, REDIS_KEY_PREFIX: undefined });
    check('without REDIS_URL Redis is off', !off.redisEnabled() && await off.redisHealth() === 'off');
    check('off: counters return null, claims null, reads null, writes false',
        await off.incrWindow('a', 60) === null && await off.claimOnce('a', 60) === null
        && await off.getJson('a') === null && await off.setJson('a', 1, 60) === false);

    // --- up ---
    const up = load({ REDIS_URL: 'redis://127.0.0.1:6379/15', REDIS_KEY_PREFIX: undefined });
    for (let i = 0; i < 40 && await up.redisHealth() !== 'up'; i++) await sleep(50);
    check('with REDIS_URL and a running Redis: up', await up.redisHealth() === 'up');
    await up.withRedis('flush', null, async r => { await r.flushdb(); return null; });

    check('keys carry the service prefix', up.rkey('x') === 'sbc:user:x');
    const counts = [await up.incrWindow('login:ip:1', 60), await up.incrWindow('login:ip:1', 60), await up.incrWindow('login:ip:1', 60)];
    check('incrWindow counts 1, 2, 3', counts.join(',') === '1,2,3', counts.join(','));
    const ttl = await up.withRedis('ttl', -9, r => r.ttl('sbc:user:login:ip:1'));
    check('the counter expires (TTL set on first hit, kept after)', ttl > 0 && ttl <= 60, `${ttl}s`);
    await up.withRedis('persist', null, async r => { await r.persist('sbc:user:login:ip:1'); return null; });
    await up.incrWindow('login:ip:1', 60);
    const ttl2 = await up.withRedis('ttl', -9, r => r.ttl('sbc:user:login:ip:1'));
    check('a counter that lost its TTL gets one back on the next hit', ttl2 > 0, `${ttl2}s`);

    check('claimOnce: true the first time, false after', await up.claimOnce('alert:u1', 30) === true && await up.claimOnce('alert:u1', 30) === false);
    await up.setJson('score:u1', { score: 42 }, 30);
    const got = await up.getJson<{ score: number }>('score:u1');
    check('setJson / getJson round trip', got?.score === 42);
    const noTtl = await up.withRedis('scan', [] as string[], async r => {
        const keys = await r.keys('sbc:user:*');
        const ttls = await Promise.all(keys.map(k => r.ttl(k)));
        return keys.filter((_, i) => ttls[i] < 0);
    });
    check('no key without a TTL', noTtl.length === 0, noTtl.join(' '));

    // A blocking pop on an empty list answers after 1 s: a slow Redis.
    const [slow, slowMs] = await timed(() => up.withRedis('slow', 'fallback', async r => { await r.blpop('sbc:user:never', 1); return 'redis'; }));
    check('a slow Redis gives the fallback after ~150 ms, not 1 s', slow === 'fallback' && slowMs >= 100 && slowMs < 400, `${slowMs} ms`);
    await sleep(1100);
    const [thrown, thrownMs] = await timed(() => up.withRedis('boom', 'fallback', async () => { throw new Error('boom'); }));
    check('an error inside a call gives the fallback, never throws', thrown === 'fallback' && thrownMs < 50);
    await up.withRedis('flush', null, async r => { await r.flushdb(); return null; });
    await up.closeRedis();

    // --- down: nothing listening ---
    const down = load({ REDIS_URL: 'redis://127.0.0.1:6390/0' });
    await sleep(300);
    const [c, ms] = await timed(() => down.incrWindow('x', 60));
    check('Redis down: incrWindow returns null at once (fail open)', c === null && ms < 50, `${ms} ms`);
    const [h, hms] = await timed(() => down.redisHealth());
    check('Redis down: health says down, fast', h === 'down' && hms < 50, `${hms} ms`);
    await down.closeRedis();

    console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
    process.exit(failures ? 1 : 0);
};

main().catch(e => { console.error(e); process.exit(1); });
