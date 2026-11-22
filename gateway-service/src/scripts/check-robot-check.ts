/**
 * Asserts the gateway's anti-robot check (Security plan Phase 9 rule 3, ALTCHA, 2026-11-22),
 * over real HTTP: the challenge route, answers solved exactly as the web app solves them
 * (altcha-lib solveChallenge, SHA-256), and every outcome:
 *   - off / no key: no challenge (204), nothing checked;
 *   - log: valid / missing / malformed / forged / expired / replayed are counted per action,
 *     nothing refused; unprotected routes are not checked; a signed-in member's forged or
 *     replayed answer goes to the fraud-engine feed; counts are flushed to user-service;
 *   - enforce: anything but a valid answer → 403 ROBOT_CHECK_FAILED, a valid one passes once.
 * user-service is a local stand-in; no Redis (in-memory replay store).
 *
 *   npx ts-node --transpile-only src/scripts/check-robot-check.ts
 */
import crypto from 'crypto';
import http from 'http';
import express from 'express';
import { AddressInfo } from 'net';

process.env.JWT_SECRET = 'check-secret';
process.env.SERVICE_SECRET = 'check-service-secret';
delete process.env.REDIS_URL;
delete process.env.RISK_SERVICE_URL;

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

const main = async () => {
    // user-service stand-in: receives the counts
    const received: any[] = [];
    const us = http.createServer((req, res) => {
        let raw = '';
        req.on('data', c => { raw += c; });
        req.on('end', () => {
            if (req.url === '/api/users/internal/robot-checks/batch' && req.headers.authorization === 'Bearer check-service-secret') received.push(...JSON.parse(raw).rows);
            res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"success":true}');
        });
    }).listen(0);
    process.env.USER_SERVICE_URL = `http://127.0.0.1:${(us.address() as AddressInfo).port}`;

    const rc = await import('../api/middleware/robot-check.middleware');
    const bc = await import('../api/middleware/browser-checks.middleware');
    const altcha = await import('altcha-lib');
    const { deriveKey } = await import('altcha-lib/algorithms/sha');

    const app = express();
    app.get('/api/altcha/challenge', rc.altchaChallenge);
    app.use(rc.robotCheck);
    app.use((_req, res) => { res.json({ reached: true }); }); // stands for the proxied service
    const srv = app.listen(0);
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const post = (path: string, headers: Record<string, string> = {}) => fetch(`${base}${path}`, { method: 'POST', headers: { 'User-Agent': CHROME_ANDROID, 'X-SBC-Client': 'web', ...headers }, body: '{}' });
    /** What the web app does: fetch a challenge, solve it, send it base64-encoded. */
    const solve = async () => {
        const c = await (await fetch(`${base}/api/altcha/challenge`)).json() as any;
        const t0 = Date.now();
        const s = await altcha.solveChallenge({ challenge: c, deriveKey });
        return { header: Buffer.from(JSON.stringify({ challenge: c, solution: s })).toString('base64'), ms: Date.now() - t0, challenge: c, solution: s };
    };

    // ---- off ----
    process.env.ROBOT_CHECK = 'off';
    process.env.ALTCHA_HMAC_KEY = 'a'.repeat(48);
    check('off: no challenge (204), the app sends nothing', (await fetch(`${base}/api/altcha/challenge`)).status === 204);
    check('off: protected action not checked', (await post('/api/users/login')).status === 200 && rc.robotStats.checked === 0);
    process.env.ROBOT_CHECK = 'log';
    process.env.ALTCHA_HMAC_KEY = 'short';
    check('no key (or < 32 chars): no challenge, nothing checked', (await fetch(`${base}/api/altcha/challenge`)).status === 204 && (await post('/api/users/login')).status === 200 && rc.robotStats.checked === 0);
    process.env.ALTCHA_HMAC_KEY = 'a'.repeat(48);

    // ---- routes ----
    check('protected actions matched (case, trailing slash, query)', rc.actionFor('POST', '/api/users/Login/?x=1') === 'login' && rc.actionFor('POST', '/api/transactions/withdrawal/initiate') === 'withdrawal'
        && rc.actionFor('POST', '/api/support/public/tickets') === 'public_ticket' && rc.actionFor('GET', '/api/users/login') === null && rc.actionFor('POST', '/api/users/verify-otp') === null);
    const ch = await fetch(`${base}/api/altcha/challenge`);
    const cj: any = await ch.json();
    check('challenge: signed, 10 min, not cacheable, no answer inside', ch.headers.get('cache-control') === 'no-store' && typeof cj.signature === 'string'
        && cj.parameters.expiresAt - Date.now() / 1000 > 590 && !('counter' in cj.parameters) && cj.parameters.keyPrefix.length === 32);

    // ---- log ----
    const s1 = await solve();
    check('solving takes well under a second in Node', s1.ms < 1000, `${s1.ms} ms`);
    let r = await post('/api/users/login', { 'X-SBC-Altcha': s1.header });
    check('log: valid answer → passes', r.status === 200);
    r = await post('/api/users/login', { 'X-SBC-Altcha': s1.header });
    check('log: the same answer again (replay) → still passes, counted replay', r.status === 200);
    check('log: missing → passes', (await post('/api/users/register')).status === 200);
    check('log: malformed → passes', (await post('/api/users/register', { 'X-SBC-Altcha': 'not-base64-json' })).status === 200);
    const s2 = await solve();
    const flip = s2.solution!.derivedKey.slice(0, -1) + (s2.solution!.derivedKey.endsWith('0') ? '1' : '0');
    const forged = Buffer.from(JSON.stringify({ challenge: s2.challenge, solution: { ...s2.solution, derivedKey: flip } })).toString('base64');
    const member = { Authorization: `Bearer ${token({ userId: U1, role: 'user' })}` };
    check('log: forged answer from a member → passes', (await post('/api/transactions/withdrawal/initiate', { 'X-SBC-Altcha': forged, ...member })).status === 200);
    const prefixOnly = Buffer.from(JSON.stringify({ challenge: s2.challenge, solution: { counter: 0, derivedKey: s2.challenge.parameters.keyPrefix } })).toString('base64');
    await post('/api/users/me/momo/change', { 'X-SBC-Altcha': prefixOnly, ...member });
    const expired = await altcha.createChallenge({ algorithm: 'SHA-256', cost: 1, counter: 50, deriveKey, hmacSignatureSecret: 'a'.repeat(48), hmacKeySignatureSecret: `${'a'.repeat(48)}:key`, expiresAt: Math.floor(Date.now() / 1000) - 5 });
    const se = await altcha.solveChallenge({ challenge: expired, deriveKey });
    await post('/api/users/request-change-email', { 'X-SBC-Altcha': Buffer.from(JSON.stringify({ challenge: expired, solution: se })).toString('base64') });
    const otherKey = await altcha.createChallenge({ algorithm: 'SHA-256', cost: 1, counter: 50, deriveKey, hmacSignatureSecret: 'b'.repeat(48), hmacKeySignatureSecret: `${'b'.repeat(48)}:key`, expiresAt: Math.floor(Date.now() / 1000) + 60 });
    const so = await altcha.solveChallenge({ challenge: otherKey, deriveKey });
    await post('/api/users/request-change-email', { 'X-SBC-Altcha': Buffer.from(JSON.stringify({ challenge: otherKey, solution: so })).toString('base64') });
    check('unprotected route not checked', (await post('/api/users/verify-otp')).status === 200);

    const rows = [...rc._robotBuffer.values()];
    const n = (action: string, outcome: string) => rows.filter(x => x.action === action && x.outcome === outcome).reduce((s, x) => s + x.count, 0);
    check('counted: login valid 1 + replay 1, signup missing 1 + malformed 1', n('login', 'valid') === 1 && n('login', 'replay') === 1 && n('signup', 'missing') === 1 && n('signup', 'malformed') === 1, JSON.stringify(rows.map(x => [x.action, x.outcome, x.count])));
    check('counted: withdrawal + payout change forged = invalid, signed in', n('withdrawal', 'invalid') === 1 && n('payout_change', 'invalid') === 1 && rows.find(x => x.action === 'withdrawal')?.signedIn === true);
    check('counted: expired, and an answer signed with another key = invalid', n('contact_change', 'expired') === 1 && n('contact_change', 'invalid') === 1);
    check('rows carry browser, Android version, client; no member id', rows[0].browser === 'chrome' && rows[0].android === '10' && rows[0].client === 'web' && !JSON.stringify(rows).includes(U1));
    const auto = [...bc._automationBuffer.values()].find(x => x.userId === U1);
    check('member forged answers → fraud-engine feed (robot: 2)', auto?.robot === 2);
    await rc.flushRobotChecks();
    check('flushed to user-service with the service secret, buffer emptied', received.length === rows.length && rc._robotBuffer.size === 0);

    // ---- enforce ----
    process.env.ROBOT_CHECK = 'enforce';
    r = await post('/api/users/login');
    const body: any = await r.json();
    check('enforce: missing → 403 ROBOT_CHECK_FAILED, French message', r.status === 403 && body.code === 'ROBOT_CHECK_FAILED' && /vérification/.test(body.message));
    check('enforce: forged → 403', (await post('/api/users/login', { 'X-SBC-Altcha': forged })).status === 403);
    const s3 = await solve();
    check('enforce: valid → passes', (await post('/api/users/register', { 'X-SBC-Altcha': s3.header })).status === 200);
    check('enforce: same answer reused → 403', (await post('/api/users/register', { 'X-SBC-Altcha': s3.header })).status === 403);
    check('enforce: unprotected route untouched', (await post('/api/users/verify-otp')).status === 200);

    srv.close(); us.close();
    console.log(failures ? `\n${failures} FAILED` : '\nall passed');
    process.exit(failures ? 1 : 0);
};
main().catch(e => { console.error(e); process.exit(1); });
