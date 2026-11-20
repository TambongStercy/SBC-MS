/**
 * Asserts the gateway side of Security plan Phase 1 (signals): what a request
 * adds to the in-memory counts, what is ignored, that the middleware never
 * delays or breaks a request, and that a failed flush drops the batch.
 *
 *   npx ts-node src/scripts/check-activity-signals.ts
 */
import crypto from 'crypto';
import http from 'http';

process.env.JWT_SECRET = 'check-secret';
process.env.SERVICE_SECRET = 'check-service-secret';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (claims: object, secret = 'check-secret') => {
    const h = b64({ alg: 'HS256', typ: 'JWT' });
    const p = b64({ ...claims, exp: Math.floor(Date.now() / 1000) + 3600 });
    return `${h}.${p}.${crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`;
};
const U1 = '6afffd2affe32a63ea13c481';
const U2 = '6afffd2affe32a63ea13c482';
const req = (headers: Record<string, string>, url = '/api/users/me') => ({ headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])), originalUrl: url, socket: {} } as any);

const main = async () => {
    const m = await import('../api/middleware/activity-signals.middleware');
    const config = (await import('../config')).default;
    const buf = m._signalsBuffer;
    const t1 = token({ userId: U1, id: U1, role: 'user' });

    // --- off by default ---
    delete process.env.ACTIVITY_SIGNALS_ENABLED;
    let nexts = 0;
    m.activitySignals(req({ authorization: `Bearer ${t1}`, 'x-sbc-geo': 'CM' }), {} as any, () => { nexts++; });
    check('off unless ACTIVITY_SIGNALS_ENABLED=true (request passes, nothing counted)', nexts === 1 && buf.size === 0);
    process.env.ACTIVITY_SIGNALS_ENABLED = 'true';

    // --- counting ---
    const now = Date.UTC(2026, 10, 20, 23, 30); // 23:30 UTC = 00:30 the next day in Douala
    const h = { authorization: `Bearer ${t1}`, 'x-sbc-geo': 'cm', 'x-sbc-device': 'dev-1234-abcd', 'x-sbc-client': 'web', 'x-real-ip': '102.244.33.7', 'x-sbc-asn': '30992' };
    m.recordRequest(req(h), now);
    m.recordRequest(req({ ...h, 'x-real-ip': '102.244.33.200' }), now + 1000);
    m.recordRequest(req({ ...h, 'x-sbc-client': 'app', 'x-sbc-device': 'dev-9999-zzzz' }), now + 2000);
    const a = buf.get(`${U1}|2026-11-21|CM`);
    check('requests of a member are counted per Douala day and country', !!a && a.requests === 3, a ? `${a.day} ${a.country} ${a.requests}` : 'none');
    check('sources, devices, /24 ranges and ASN are kept (not full IPs)',
        !!a && a.sources.web === 2 && a.sources.app === 1 && a.devices.size === 2 && [...a.ipRanges].join() === '102.244.33.0/24' && [...a.asns].join() === '30992');

    m.recordRequest(req({ authorization: `Bearer ${t1}`, 'x-sbc-geo': 'FR' }), now);
    check('another country the same day is a separate record', buf.has(`${U1}|2026-11-21|FR`));
    m.recordRequest(req({ authorization: `Bearer ${t1}` }), now);
    const xx = buf.get(`${U1}|2026-11-21|XX`);
    check('no country header → XX; no device → counted as a signal', !!xx && xx.noDevice === 1);
    m.recordRequest(req({ authorization: `Bearer ${t1}`, 'x-sbc-geo': 'T1' }), now);
    check('Tor (T1) is recorded as unknown country', buf.get(`${U1}|2026-11-21|XX`)!.requests === 2);

    const size = buf.size;
    m.recordRequest(req({ 'x-sbc-geo': 'CM' }), now);
    m.recordRequest(req({ authorization: `Bearer ${config.services.serviceSecret}`, 'x-sbc-geo': 'CM' }), now);
    m.recordRequest(req({ authorization: `Bearer ${token({ userId: U2 }, 'wrong-secret')}`, 'x-sbc-geo': 'CM' }), now);
    m.recordRequest(req({ authorization: `Bearer ${t1}`, 'x-sbc-device': 'x'.repeat(200) }), now);
    check('anonymous, service-secret and badly signed requests are ignored', buf.size === size);
    check('an over-long device ID is not kept', ![...buf.get(`${U1}|2026-11-21|XX`)!.devices].some(d => d.length > 64));

    // --- lists are capped ---
    for (let i = 0; i < 20; i++) m.recordRequest(req({ authorization: `Bearer ${t1}`, 'x-sbc-geo': 'SN', 'x-real-ip': `41.82.${i}.1`, 'x-sbc-device': `device-${i}-abcdef` }), now);
    const sn = buf.get(`${U1}|2026-11-21|SN`)!;
    check('at most 5 ranges and 5 devices per record', sn.ipRanges.size === 5 && sn.devices.size === 5 && sn.requests === 20);

    // --- flush ---
    const got: any[] = [];
    let answer = 200;
    const server = http.createServer((rq, rs) => {
        let body = '';
        rq.on('data', c => { body += c; });
        rq.on('end', () => { got.push({ url: rq.url, auth: rq.headers.authorization, body: JSON.parse(body || '{}') }); rs.statusCode = answer; rs.end('{}'); });
    }).listen(0);
    const port = (server.address() as any).port;
    (config.services as any).userServiceUrl = `http://127.0.0.1:${port}`;
    const n = buf.size;
    await m.flushSignals();
    check('flush posts every record to user-service with the service secret, then empties the buffer',
        got.length === 1 && got[0].url === '/api/users/internal/activity/batch' && got[0].auth === 'Bearer check-service-secret' && got[0].body.records.length === n && buf.size === 0);
    const rec = got[0].body.records.find((r: any) => r.country === 'CM');
    check('the posted record carries the counts and lists', rec?.requests === 3 && rec.devices.length === 2 && rec.ipRanges[0] === '102.244.33.0/24');

    answer = 500;
    m.recordRequest(req(h), now);
    const droppedBefore = m.signalsStats.dropped;
    await m.flushSignals();
    check('when user-service fails, the batch is dropped (no retry pile-up)', buf.size === 0 && m.signalsStats.dropped === droppedBefore + 1);

    // --- the middleware never throws or waits ---
    nexts = 0;
    const t0 = Date.now();
    m.activitySignals({ headers: { authorization: 'Bearer a.b.c' }, originalUrl: '/api/x', socket: {} } as any, {} as any, () => { nexts++; });
    m.activitySignals({ headers: null, originalUrl: '/api/x' } as any, {} as any, () => { nexts++; });
    check('a malformed request still goes through, at once', nexts === 2 && Date.now() - t0 < 50);

    // --- speed ---
    const many = req(h);
    const t2 = process.hrtime.bigint();
    for (let i = 0; i < 20000; i++) m.recordRequest(many, now);
    const perReqUs = Number(process.hrtime.bigint() - t2) / 1000 / 20000;
    check('recording costs well under 0.1 ms per request', perReqUs < 100, `${perReqUs.toFixed(1)} µs`);

    server.close();
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
};

main().catch(e => { console.error(e); process.exit(1); });
