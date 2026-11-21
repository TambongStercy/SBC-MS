/**
 * Asserts the gateway side of Security plan Phase 9 (browser-only access,
 * log-only): signatures made exactly as the web app makes them (WebCrypto
 * ECDSA P-256, P1363) are counted valid; a copied token with no signature, a
 * stale or replayed request, a tampered path, a key bound to another token,
 * tool user-agents, Origin / Sec-Fetch-Site and exempt routes are recorded as
 * such; nothing is ever refused or delayed; counts are flushed to user-service.
 * user-service is a local stand-in; no Redis (in-memory nonces).
 *
 *   npx ts-node --transpile-only src/scripts/check-browser-checks.ts
 */
import crypto, { webcrypto } from 'crypto';
import http from 'http';
import { AddressInfo } from 'net';

process.env.JWT_SECRET = 'check-secret';
process.env.SERVICE_SECRET = 'check-service-secret';
delete process.env.REDIS_URL;

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (claims: object) => {
    const h = b64({ alg: 'HS256', typ: 'JWT' });
    const p = b64({ ...claims, exp: Math.floor(Date.now() / 1000) + 3600 });
    return `${h}.${p}.${crypto.createHmac('sha256', 'check-secret').update(`${h}.${p}`).digest('base64url')}`;
};
const U1 = '6afffd2affe32a63ea13c481';
const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const req = (method: string, url: string, headers: Record<string, string>) =>
    ({ method, originalUrl: url, headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])), socket: {} } as any);

/** Exactly what the web app's requestSigning.ts does. */
async function sign(privateKey: webcrypto.CryptoKey, method: string, url: string, body: string | null, t = Date.now(), nonce?: string) {
    const n = nonce ?? Buffer.from(webcrypto.getRandomValues(new Uint8Array(18))).toString('base64url');
    const b = body === null ? 'UNSIGNED' : crypto.createHash('sha256').update(body).digest('hex');
    const text = `v1\n${method}\n${url}\n${t}\n${n}\n${b}`;
    const sig = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, new TextEncoder().encode(text));
    return `v1;t=${t};n=${n};b=${b};s=${Buffer.from(sig).toString('base64url')}`;
}

const main = async () => {
    // user-service stand-in: session keys + batch
    const keys = new Map<string, { publicKey: string; late: boolean }>();
    const batches: any[] = [];
    let lookups = 0;
    const us = http.createServer((rq, rs) => {
        let raw = '';
        rq.on('data', c => { raw += c; });
        rq.on('end', () => {
            if (rq.headers.authorization !== 'Bearer check-service-secret') { rs.writeHead(401).end(); return; }
            const m = rq.url!.match(/\/api\/users\/internal\/session-keys\/([a-f0-9]{64})$/);
            if (m) {
                lookups++;
                const k = keys.get(m[1]);
                rs.writeHead(k ? 200 : 404, { 'Content-Type': 'application/json' }).end(JSON.stringify(k ? { success: true, data: { ...k, userId: U1 } } : { success: false }));
                return;
            }
            if (rq.url === '/api/users/internal/browser-checks/batch') { batches.push(JSON.parse(raw)); rs.writeHead(200).end('{}'); return; }
            rs.writeHead(404).end();
        });
    }).listen(0);
    process.env.USER_SERVICE_URL = `http://127.0.0.1:${(us.address() as AddressInfo).port}`;

    const m = await import('../api/middleware/browser-checks.middleware');
    const buf = m._browserChecksBuffer;

    const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']) as webcrypto.CryptoKeyPair;
    const spki = Buffer.from(await webcrypto.subtle.exportKey('spki', pair.publicKey)).toString('base64');
    const t1 = token({ userId: U1, id: U1, role: 'user' });
    const tLate = token({ userId: U1, id: U1, role: 'user', x: 1 });
    const tNoKey = token({ userId: U1, id: U1, role: 'user', x: 2 });
    const hash = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
    keys.set(hash(t1), { publicKey: spki, late: false });
    keys.set(hash(tLate), { publicKey: spki, late: true });
    const browser = { 'user-agent': CHROME_ANDROID, origin: 'https://preprod.sniperbuisnesscenter.com', 'sec-fetch-site': 'same-origin', 'x-sbc-client': 'web' };
    const outcome = async (r: any) => (await m.recordBrowserCheck(r))?.signature ?? 'not-recorded';

    // --- off by default: passes, nothing recorded ---
    delete process.env.BROWSER_CHECKS;
    let nexts = 0;
    m.browserChecks(req('GET', '/api/users/me', { authorization: `Bearer ${t1}` }), {} as any, () => { nexts++; });
    await new Promise(r => setImmediate(r));
    check('off unless BROWSER_CHECKS=log (request passes, nothing counted)', nexts === 1 && buf.size === 0);

    process.env.BROWSER_CHECKS = 'log';
    const body = JSON.stringify({ amount: 5000 });
    const url = '/api/withdrawals/initiate?src=app';
    const h = await sign(pair.privateKey, 'POST', url, body);
    check('a request signed like the web app → valid', await outcome(req('POST', url, { ...browser, authorization: `Bearer ${t1}`, 'x-sbc-signature': h })) === 'valid');
    check('the same request again (same nonce) → replay', await outcome(req('POST', url, { ...browser, authorization: `Bearer ${t1}`, 'x-sbc-signature': h })) === 'replay');
    check('signature moved to another path → bad_sig', await outcome(req('POST', '/api/withdrawals/initiate?src=evil', { ...browser, authorization: `Bearer ${t1}`, 'x-sbc-signature': await sign(pair.privateKey, 'POST', url, body) })) === 'bad_sig');
    check('signed 2 min ago → stale', await outcome(req('GET', '/api/users/me', { ...browser, authorization: `Bearer ${t1}`, 'x-sbc-signature': await sign(pair.privateKey, 'GET', '/api/users/me', '', Date.now() - 120_000) })) === 'stale');
    check('token copied into Postman (no signature) → missing, tool flagged', await (async () => {
        const row = await m.recordBrowserCheck(req('GET', '/api/users/me', { authorization: `Bearer ${t1}`, 'user-agent': 'PostmanRuntime/7.39.0' }));
        return row?.signature === 'missing' && row.tool === true && row.origin === 'none' && row.fetchSite === 'absent' && row.browser === 'tool';
    })());
    const other = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']) as webcrypto.CryptoKeyPair;
    check('signed with another key → bad_sig', await outcome(req('GET', '/api/users/me', { ...browser, authorization: `Bearer ${t1}`, 'x-sbc-signature': await sign(other.privateKey, 'GET', '/api/users/me', '') })) === 'bad_sig');
    check('token with no key bound → no_key', await outcome(req('GET', '/api/users/me', { ...browser, authorization: `Bearer ${tNoKey}`, 'x-sbc-signature': await sign(pair.privateKey, 'GET', '/api/users/me', '') })) === 'no_key');
    check('key bound after sign-in → valid_late', await outcome(req('GET', '/api/users/me', { ...browser, authorization: `Bearer ${tLate}`, 'x-sbc-signature': await sign(pair.privateKey, 'GET', '/api/users/me', '') })) === 'valid_late');
    check('upload signed without its body → valid', await outcome(req('POST', '/api/settings/files/upload', { ...browser, authorization: `Bearer ${t1}`, 'x-sbc-signature': await sign(pair.privateKey, 'POST', '/api/settings/files/upload', null) })) === 'valid');
    check('old browser (`none;r=noidb`) → unsupported', await outcome(req('GET', '/api/users/me', { ...browser, authorization: `Bearer ${t1}`, 'x-sbc-signature': 'none;r=noidb' })) === 'unsupported');
    check('garbage header → malformed', await outcome(req('GET', '/api/users/me', { ...browser, authorization: `Bearer ${t1}`, 'x-sbc-signature': 'v1;t=1;n=x' })) === 'malformed');
    check('no token (sign-in page) → no_token; forged token → bad_token', await outcome(req('POST', '/api/users/login', browser)) === 'no_token'
        && await outcome(req('GET', '/api/users/me', { ...browser, authorization: 'Bearer a.b.c' })) === 'bad_token');
    check('service-secret calls and webhooks/SSO/partners/support desk are not recorded',
        await outcome(req('GET', '/api/users/me', { authorization: 'Bearer check-service-secret' })) === 'not-recorded'
        && await outcome(req('POST', '/api/payments/webhooks/feexpay', {})) === 'not-recorded'
        && await outcome(req('POST', '/api/sso/token', {})) === 'not-recorded'
        && await outcome(req('POST', '/api/support/desk/auth/login', {})) === 'not-recorded'
        && await outcome(req('GET', '/api/partners/x', {})) === 'not-recorded');
    const before = lookups;
    for (let i = 0; i < 5; i++) await outcome(req('GET', '/api/users/me', { ...browser, authorization: `Bearer ${t1}`, 'x-sbc-signature': await sign(pair.privateKey, 'GET', '/api/users/me', '') }));
    check('the key is looked up once, then cached', lookups === before, `${lookups - before} extra lookups`);
    check('admin/staff tokens are counted apart (role staff)', (await m.recordBrowserCheck(req('GET', '/api/users/admin/users', { ...browser, authorization: `Bearer ${token({ userId: U1, id: U1, role: 'admin' })}` })))?.role === 'staff');
    const row = await m.recordBrowserCheck(req('GET', '/api/users/me', { ...browser, authorization: `Bearer ${t1}`, 'x-sbc-signature': await sign(pair.privateKey, 'GET', '/api/users/me', '') }));
    check('browser family, Android version, Origin and Sec-Fetch-Site recorded', row?.browser === 'chrome' && row.android === '10' && row.origin === 'sbc' && row.fetchSite === 'same-origin' && row.group === 'users' && row.client === 'web');

    // --- the middleware never delays or refuses ---
    let passed = false;
    const t0 = Date.now();
    m.browserChecks(req('GET', '/api/users/me', { authorization: `Bearer ${t1}`, 'user-agent': 'curl/8.0' }), {} as any, () => { passed = true; });
    check('the middleware calls next() at once, even for a bad request', passed && Date.now() - t0 < 5);

    // --- flush ---
    await new Promise(r => setTimeout(r, 50));
    const n = buf.size;
    await m.flushBrowserChecks();
    const sent = batches[0]?.rows ?? [];
    check('flush sends the counts (no member id, no token) to user-service and empties the buffer',
        n > 0 && buf.size === 0 && sent.length === n && !JSON.stringify(sent).includes(U1) && !JSON.stringify(sent).includes(t1.slice(0, 20))
        && sent.find((r: any) => r.signature === 'valid' && r.group === 'users' && r.android === '10')?.count === 6, `${n} rows`);

    us.close();
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
};

main().catch(e => { console.error(e); process.exit(1); });
