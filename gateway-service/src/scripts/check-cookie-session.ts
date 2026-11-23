import express from 'express';
import proxy from 'express-http-proxy';
import http from 'http';
import { AddressInfo } from 'net';
import { cookieSession, originAllowed } from '../api/middleware/cookie-session.middleware';

/**
 * Security plan Phase 9: the gateway side of member cookie sessions.
 *   - an `sbc_at` cookie without Authorization becomes `Authorization: Bearer …` for the services
 *     (checked through a real express-http-proxy hop);
 *   - cookie mutations need X-CSRF-Token = the sbc_csrf cookie and an Origin of our own host;
 *   - a Bearer request is left alone; WEB_BEARER=refuse refuses our own web app's Bearer (not
 *     partners, not the adopt call); the desk is untouched; a client cannot fake `x-sbc-auth`.
 *
 *   npx ts-node --transpile-only src/scripts/check-cookie-session.ts
 */
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

const memberJwt = (claims: Record<string, unknown>) =>
    `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

async function main() {
    // Upstream: echoes what a service would see.
    const upstream = express();
    upstream.all('*', (req, res) => res.json({ auth: req.headers.authorization ?? null, via: req.headers['x-sbc-auth'] ?? null, method: req.method }));
    const up = http.createServer(upstream).listen(0);
    const upPort = (up.address() as AddressInfo).port;

    const gw = express();
    gw.use(cookieSession);
    gw.use('/api', proxy(`http://127.0.0.1:${upPort}`, { parseReqBody: false, proxyReqPathResolver: req => req.originalUrl }));
    const g = http.createServer(gw).listen(0);
    const base = `http://127.0.0.1:${(g.address() as AddressInfo).port}`;
    const host = new URL(base).host;

    const call = async (path: string, init: { method?: string; headers?: Record<string, string> } = {}) => {
        const r = await fetch(base + path, { method: init.method ?? 'GET', headers: init.headers, body: init.method && init.method !== 'GET' ? '{}' : undefined });
        let body: any = null; try { body = await r.json(); } catch { /* */ }
        return { status: r.status, body };
    };
    const at = 'access.token.value';
    const csrf = 'csrf-secret-value-0123456789abcdef';
    const cookie = `sbc_at=${at}; sbc_csrf=${csrf}`;

    let r = await call('/api/users/me', { headers: { cookie } });
    check('GET with the cookie: services see Authorization: Bearer <cookie>', r.status === 200 && r.body?.auth === `Bearer ${at}` && r.body?.via === 'cookie', JSON.stringify(r.body));

    r = await call('/api/users/me', { method: 'PUT', headers: { cookie, 'content-type': 'application/json' } });
    check('mutation without the CSRF header: 403 CSRF_FAILED', r.status === 403 && r.body?.code === 'CSRF_FAILED');

    r = await call('/api/users/me', { method: 'PUT', headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': 'wrong' } });
    check('mutation with a wrong CSRF value: 403', r.status === 403);

    r = await call('/api/users/me', { method: 'PUT', headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': csrf, origin: base } });
    check('mutation with CSRF + own Origin: passes with the bearer', r.status === 200 && r.body?.auth === `Bearer ${at}`);

    r = await call('/api/users/me', { method: 'PUT', headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': csrf, origin: 'https://evil.example' } });
    check('mutation from another Origin: 403 even with the CSRF value', r.status === 403);

    r = await call('/api/users/session/refresh', { method: 'POST', headers: { cookie: `sbc_rt=r; sbc_csrf=${csrf}`, 'content-type': 'application/json' } });
    check('refresh (refresh cookie only) needs the CSRF header too', r.status === 403);
    r = await call('/api/users/session/refresh', { method: 'POST', headers: { cookie: `sbc_rt=r; sbc_csrf=${csrf}`, 'content-type': 'application/json', 'x-csrf-token': csrf } });
    check('refresh with CSRF passes, no bearer invented', r.status === 200 && r.body?.auth === null);

    r = await call('/api/users/login', { method: 'POST', headers: { cookie, 'content-type': 'application/json' } });
    check('sign-in with a stale cookie: no CSRF asked', r.status === 200);
    r = await call('/api/users/logout', { method: 'POST', headers: { cookie, 'content-type': 'application/json' } });
    check('…but the authenticated logout still needs it', r.status === 403);

    r = await call('/api/users/me', { headers: { cookie, authorization: 'Bearer old-token' } });
    check('Bearer + cookie: the Bearer wins, untouched', r.body?.auth === 'Bearer old-token' && r.body?.via === null);

    r = await call('/api/users/me', { method: 'PUT', headers: { authorization: 'Bearer old-token', 'content-type': 'application/json' } });
    check('Bearer mutation: no CSRF asked (not ambient)', r.status === 200);

    r = await call('/api/users/me', { headers: { 'x-sbc-auth': 'cookie', authorization: 'Bearer x' } });
    check('a client cannot claim x-sbc-auth: cookie', r.body?.via === null);

    r = await call('/api/support/desk/tickets', { method: 'POST', headers: { cookie, 'content-type': 'application/json' } });
    check('support desk untouched (own cookies and CSRF)', r.status === 200 && r.body?.auth === null);

    r = await call('/api/payments/webhooks/x', { method: 'POST', headers: { 'content-type': 'application/json' } });
    check('no cookie, no header: passes as before (webhooks, public)', r.status === 200 && r.body?.auth === null);

    // WEB_BEARER
    const member = memberJwt({ userId: 'u1', role: 'user' });
    const web = { authorization: `Bearer ${member}`, 'sec-fetch-site': 'same-origin', 'x-sbc-client': 'web' };
    process.env.WEB_BEARER = 'allow';
    r = await call('/api/users/me', { headers: web });
    check('WEB_BEARER=allow: the old web app keeps working', r.status === 200);
    process.env.WEB_BEARER = 'refuse';
    r = await call('/api/users/me', { headers: web });
    check('WEB_BEARER=refuse: our web app Bearer → 401 SESSION_UPGRADE_REQUIRED', r.status === 401 && r.body?.code === 'SESSION_UPGRADE_REQUIRED');
    r = await call('/api/users/session/adopt', { method: 'POST', headers: { ...web, 'content-type': 'application/json' } });
    check('WEB_BEARER=refuse: the adopt call still passes', r.status === 200);
    r = await call('/api/sso/userinfo', { headers: { authorization: `Bearer ${member}` } });
    check('WEB_BEARER=refuse: partners / SSO clients (not same-origin) still pass', r.status === 200);
    r = await call('/api/users/admin/users', { headers: { ...web, authorization: `Bearer ${memberJwt({ userId: 'a', role: 'admin', asid: 's' })}` } });
    check('WEB_BEARER=refuse: admin tokens untouched', r.status === 200);
    delete process.env.WEB_BEARER;

    // origin helper
    const req = (h: Record<string, string>) => ({ headers: h } as any);
    check('origin: absent ok, own host ok, null refused, other refused',
        originAllowed(req({ host })) && originAllowed(req({ host, origin: base })) && !originAllowed(req({ host, origin: 'null' })) && !originAllowed(req({ host, origin: 'https://x.y' })));
    process.env.SESSION_ALLOWED_ORIGINS = 'https://app.sniperbuisnesscenter.com';
    check('origin: SESSION_ALLOWED_ORIGINS', originAllowed(req({ host, origin: 'https://app.sniperbuisnesscenter.com' })));
    delete process.env.SESSION_ALLOWED_ORIGINS;

    g.close(); up.close();
    console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
