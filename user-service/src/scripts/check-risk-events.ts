/**
 * Security plan Phase 4 part 2: user-service's events to risk-service (utils/risk-event.ts).
 * A local fake risk-service receives them; nothing else is contacted.
 *   - shape: type, userId, at, service secret, x-service-name;
 *   - alertContactChange: email/phone/momo/crypto → contact_change {kind}; authenticator_reset →
 *     authenticator_change {kind: reset};
 *   - a bad id sends nothing; RISK_EVENTS_DISABLED / KYC_HINTS_DISABLED / no URL send nothing;
 *   - a risk-service that never answers does not hold the caller (fire-and-forget, 1 s).
 *
 *   npx ts-node --transpile-only src/scripts/check-risk-events.ts
 */
import http from 'http';
import { AddressInfo } from 'net';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const ID = '6e2e00000000000000000e01';

async function main() {
    const got: { path: string; auth: string; from: string; body: any }[] = [];
    let hang = false;
    const srv = http.createServer((req, res) => {
        let raw = '';
        req.on('data', c => { raw += c; });
        req.on('end', () => {
            got.push({ path: req.url || '', auth: String(req.headers.authorization || ''), from: String(req.headers['x-service-name'] || ''), body: JSON.parse(raw || '{}') });
            if (hang) return; // never answers
            res.writeHead(202, { 'content-type': 'application/json' }).end('{"success":true}');
        });
    }).listen(0, '127.0.0.1');
    await new Promise(r => srv.once('listening', r));
    process.env.RISK_SERVICE_URL = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/`;
    delete process.env.RISK_EVENTS_DISABLED;
    delete process.env.KYC_HINTS_DISABLED;

    const { riskEvent } = await import('../utils/risk-event');
    const { alertContactChange } = await import('../services/contact-change-alert');
    const config = (await import('../config')).default;

    riskEvent('signup', ID, { ipRange: '41.202.7.0/24' });
    await wait(200);
    const e = got[0];
    check('signup: POST /api/risk/internal/events with the service secret', e?.path === '/api/risk/internal/events' && e.auth === `Bearer ${config.services.serviceSecret}` && e.from === 'user-service');
    check('body: type, userId, at, data', e?.body.type === 'signup' && e.body.userId === ID && !!Date.parse(e.body.at) && e.body.ipRange === '41.202.7.0/24');

    got.length = 0;
    for (const reason of ['email_change', 'phone_change', 'momo_change', 'crypto_change', 'authenticator_reset'] as const) {
        alertContactChange({ userId: ID, reason, newValue: reason === 'email_change' ? 'x@y.com' : '237690000000' });
    }
    await wait(300);
    const kinds = got.map(g => `${g.body.type}:${g.body.kind}`).sort();
    check('contact changes → contact_change {email, phone, momo, crypto}; authenticator reset → authenticator_change {reset}',
        JSON.stringify(kinds) === JSON.stringify(['authenticator_change:reset', 'contact_change:crypto', 'contact_change:email', 'contact_change:momo', 'contact_change:phone']), kinds.join(' '));

    got.length = 0;
    riskEvent('signup', 'not-an-id');
    process.env.RISK_EVENTS_DISABLED = 'true'; riskEvent('signup', ID); delete process.env.RISK_EVENTS_DISABLED;
    process.env.KYC_HINTS_DISABLED = 'true'; riskEvent('signup', ID); delete process.env.KYC_HINTS_DISABLED;
    const url = process.env.RISK_SERVICE_URL; process.env.RISK_SERVICE_URL = ''; riskEvent('signup', ID); process.env.RISK_SERVICE_URL = url;
    await wait(200);
    check('bad id, RISK_EVENTS_DISABLED, KYC_HINTS_DISABLED, no URL → nothing sent', got.length === 0, String(got.length));

    hang = true;
    const t0 = Date.now();
    riskEvent('dormant_reactivated', ID, { from: 'dormant' });
    check('fire-and-forget: returns at once even if risk-service never answers', Date.now() - t0 < 20);
    await wait(1300);
    check('the request was sent', got.some(g => g.body.type === 'dormant_reactivated'));

    srv.closeAllConnections?.();
    srv.close();
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
