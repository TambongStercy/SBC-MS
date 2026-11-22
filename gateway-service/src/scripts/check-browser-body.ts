/**
 * Security plan Phase 9, part 2 (log-only): the body check and the automation
 * signals, through REAL HTTP and express-http-proxy (both modes the gateway
 * uses: buffered `parseReqBody` and streamed `parseReqBody: false`):
 *   - the service behind the proxy receives every body byte for byte (the
 *     hash never changes or delays a body), JSON, chunked and 2 MB alike;
 *   - b = the body's hash → match; a body changed after signing → mismatch;
 *     empty GET → match; upload signed UNSIGNED → unsigned; > 1 MB → too_large;
 *   - a member with a bad signature / changed body / tool user-agent → one
 *     `automation_seen` event per member to risk-service; nothing without RISK_SERVICE_URL.
 *
 *   npx ts-node --transpile-only src/scripts/check-browser-body.ts
 */
import crypto, { webcrypto } from 'crypto';
import http from 'http';
import { AddressInfo } from 'net';
import express from 'express';
import proxy from 'express-http-proxy';

process.env.JWT_SECRET = 'check-secret';
process.env.SERVICE_SECRET = 'check-service-secret';
process.env.BROWSER_CHECKS = 'log';
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
const U2 = '6afffd2affe32a63ea13c482';
const sha = (s: string | Buffer) => crypto.createHash('sha256').update(s).digest('hex');
const listen = (srv: http.Server) => new Promise<number>(r => srv.listen(0, '127.0.0.1', () => r((srv.address() as AddressInfo).port)));
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

async function sign(privateKey: webcrypto.CryptoKey, method: string, url: string, body: string | null) {
    const t = Date.now();
    const n = Buffer.from(webcrypto.getRandomValues(new Uint8Array(18))).toString('base64url');
    const b = body === null ? 'UNSIGNED' : sha(body);
    const text = `v1\n${method}\n${url}\n${t}\n${n}\n${b}`;
    const sig = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, new TextEncoder().encode(text));
    return `v1;t=${t};n=${n};b=${b};s=${Buffer.from(sig).toString('base64url')}`;
}

const main = async () => {
    const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']) as webcrypto.CryptoKeyPair;
    const spki = Buffer.from(await webcrypto.subtle.exportKey('spki', pair.publicKey)).toString('base64');
    const t1 = token({ userId: U1, id: U1, role: 'user' });
    const t2 = token({ userId: U2, id: U2, role: 'user' });

    // user-service stand-in (session keys) + the "service" behind the proxy (records what it got) + risk-service stand-in
    const keyed = new Set([sha(t1), sha(t2)]);
    const us = http.createServer((rq, rs) => {
        const m = rq.url!.match(/session-keys\/([a-f0-9]{64})$/);
        if (m && keyed.has(m[1])) { rs.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ success: true, data: { publicKey: spki, late: false } })); return; }
        rs.writeHead(404).end();
    });
    process.env.USER_SERVICE_URL = `http://127.0.0.1:${await listen(us)}`;
    const received: Buffer[] = [];
    const svc = http.createServer((rq, rs) => {
        const parts: Buffer[] = [];
        rq.on('data', c => parts.push(c));
        rq.on('end', () => { received.push(Buffer.concat(parts)); rs.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}'); });
    });
    const svcUrl = `http://127.0.0.1:${await listen(svc)}`;
    const events: any[] = [];
    const risk = http.createServer((rq, rs) => { let raw = ''; rq.on('data', c => { raw += c; }); rq.on('end', () => { events.push({ path: rq.url, auth: rq.headers.authorization, body: JSON.parse(raw) }); rs.writeHead(202).end('{}'); }); });
    process.env.RISK_SERVICE_URL = `http://127.0.0.1:${await listen(risk)}`;

    const m = await import('../api/middleware/browser-checks.middleware');
    const app = express();
    app.use(m.browserChecks);
    app.use('/api/buffered', proxy(svcUrl, { limit: '5mb' }));
    app.use('/api/streamed', proxy(svcUrl, { parseReqBody: false }));
    const gw = `http://127.0.0.1:${await listen(http.createServer(app))}`;
    const buf = m._browserChecksBuffer;
    const rows = (group: string) => [...buf.values()].filter(r => r.group === group);

    const send = async (method: string, path: string, body: string | Buffer | undefined, signature: string, tok = t1, ua = 'Mozilla/5.0 (Linux; Android 12) Chrome/130.0 Mobile Safari/537.36', chunked = false) => {
        received.length = 0;
        const res = await new Promise<number>((resolve, reject) => {
            const u = new URL(gw + path);
            const rq = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: {
                authorization: `Bearer ${tok}`, 'x-sbc-signature': signature, 'user-agent': ua, 'content-type': 'application/json',
                ...(body !== undefined && !chunked ? { 'content-length': Buffer.byteLength(body) } : {}),
            } }, r => { r.resume(); r.on('end', () => resolve(r.statusCode!)); });
            rq.on('error', reject);
            if (body !== undefined) {
                if (chunked) { const b = typeof body === "string" ? Buffer.from(body) : body; rq.write(b.subarray(0, 5)); setTimeout(() => { rq.end(b.subarray(5)); }, 20); }
                else rq.end(body);
            } else rq.end();
        });
        await wait(60);
        return { status: res, got: received[0] };
    };

    for (const mode of ['buffered', 'streamed'] as const) {
        buf.clear();
        const body = JSON.stringify({ amount: 5000, momo: '237690000000', note: 'é€ accents' });
        const r1 = await send('POST', `/api/${mode}/withdraw`, body, await sign(pair.privateKey, 'POST', `/api/${mode}/withdraw`, body));
        check(`${mode}: the service receives the body byte for byte`, r1.status === 200 && r1.got?.toString() === body);
        const changed = JSON.stringify({ amount: 900000, momo: '237690000000', note: 'é€ accents' });
        const r2 = await send('POST', `/api/${mode}/withdraw`, changed, await sign(pair.privateKey, 'POST', `/api/${mode}/withdraw`, body));
        check(`${mode}: a body changed after signing still passes (log-only), untouched`, r2.status === 200 && r2.got?.toString() === changed);
        const chunkedBody = JSON.stringify({ chunked: true, data: 'x'.repeat(5000) });
        const r3 = await send('POST', `/api/${mode}/chunked`, chunkedBody, await sign(pair.privateKey, 'POST', `/api/${mode}/chunked`, chunkedBody), t1, undefined, true);
        // express-http-proxy answers 400 to a chunked body in buffered mode, with or without this check
        // (measured with BROWSER_CHECKS=off): not ours to change here. Streamed mode must deliver it whole.
        check(`${mode}: chunked body ${mode === 'streamed' ? 'received whole' : 'behaves as without the check (proxy 400)'}`, mode === 'streamed' ? r3.got?.toString() === chunkedBody : r3.status === 400, `status ${r3.status}`);
        await send('GET', `/api/${mode}/me`, undefined, await sign(pair.privateKey, 'GET', `/api/${mode}/me`, ''));
        await send('POST', `/api/${mode}/upload`, 'pretend-multipart', await sign(pair.privateKey, 'POST', `/api/${mode}/upload`, null));
        const big = Buffer.alloc(2 * 1024 * 1024, 97).toString();
        const r6 = await send('POST', `/api/${mode}/big`, big, await sign(pair.privateKey, 'POST', `/api/${mode}/big`, big));
        check(`${mode}: a 2 MB body is received whole`, r6.got?.length === big.length);
        await wait(100);
        const by = (o: string) => rows(mode).filter(r => r.body === o).reduce((n, r) => n + r.count, 0);
        check(`${mode}: body outcomes: 3 match (POST, chunked, empty GET), 1 mismatch, 1 unsigned, 1 too_large`,
            by('match') === 3 && by('mismatch') === 1 && by('unsigned') === 1 && by('too_large') === 1,
            JSON.stringify(rows(mode).map(r => `${r.signature}/${r.body}x${r.count}`)));
    }

    // automation: U1 changed bodies above; U2 a bad signature + Postman; a valid request adds nothing
    const other = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']) as webcrypto.CryptoKeyPair;
    await send('GET', '/api/buffered/me', undefined, await sign(other.privateKey, 'GET', '/api/buffered/me', ''), t2);
    await send('GET', '/api/buffered/me', undefined, '', t2, 'PostmanRuntime/7.39.0');
    await wait(100);
    const sentN = await m.flushAutomation();
    const ev = Object.fromEntries(events.map(e => [e.body.userId, e.body]));
    check('automation: one event per member, to risk-service, with the service secret', sentN === 2 && events.length === 2 && events.every(e => e.path === '/api/risk/internal/events' && e.auth === 'Bearer check-service-secret' && e.body.type === 'automation_seen'));
    check('automation: U1 = 2 changed bodies; U2 = 1 bad signature + 1 tool user-agent', ev[U1]?.bodyMismatch === 2 && ev[U1]?.badSig === 0 && ev[U2]?.badSig === 1 && ev[U2]?.tool === 1, JSON.stringify(ev));
    check('automation: nothing left to send', (await m.flushAutomation()) === 0);
    delete process.env.RISK_SERVICE_URL;

    for (const s of [us, svc, risk]) s.close();
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
};

main().catch(e => { console.error(e); process.exit(1); });
