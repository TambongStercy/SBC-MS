/**
 * Asserts the gateway's IP → country / network lookup (free ip-location-db files, 2026-11-22)
 * with hand-made files in the sapics format:
 *   - parsing: header row skipped, quoted organisation with commas, unsorted rows, IPv6,
 *     IPv4-mapped IPv6, gaps between ranges, range edges;
 *   - headers: X-SBC-ASN always ours (a client's value replaced or removed), X-SBC-Geo filled only
 *     when Cloudflare gave none or XX, T1 kept, a client's X-SBC-Geo-Source dropped, nothing
 *     touched before the files are loaded;
 *   - reload when the files change, refusal of a truncated file (previous tables kept);
 *   - speed: 500,000 rows loaded, 1,000,000 lookups.
 *
 *   npx ts-node --transpile-only src/scripts/check-ip-geo.ts
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

const write = (dir: string, files: Record<string, string>) => { for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), c); };

const main = async () => {
    const geo = await import('../services/ip-geo');
    const { ipGeo } = await import('../api/middleware/ip-geo.middleware');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipgeo-'));
    process.env.IPGEO_ALLOW_SMALL = '1';

    write(dir, {
        'user-country-ipv4.csv': 'ip_range_start,ip_range_end,country_code\n102.244.0.0,102.244.255.255,CM\n41.202.0.0,41.202.127.255,CM\n41.138.88.0,41.138.95.255,BJ\n8.8.8.0,8.8.8.255,US\n',
        'user-country-ipv6.csv': '2c0f:f8f0::,2c0f:f8f0:ffff:ffff:ffff:ffff:ffff:ffff,CM\n2001:4860::,2001:4860:ffff:ffff:ffff:ffff:ffff:ffff,US\n',
        'origin-asn-ipv4.csv': '41.202.0.0,41.202.127.255,15964,"CAMNET, Cameroon Telecommunications"\n8.8.8.0,8.8.8.255,15169,Google LLC\n102.244.0.0,102.244.255.255,37508,ORANGE-CM\n',
        'origin-asn-ipv6.csv': '2001:4860::,2001:4860:ffff:ffff:ffff:ffff:ffff:ffff,15169,Google LLC\n',
    });

    // ---- before loading: nothing touched ----
    const run = (headers: Record<string, string>, url = '/api/users/login') => {
        const req: any = { originalUrl: url, headers: { ...headers }, socket: { remoteAddress: '127.0.0.1' } };
        let called = false;
        ipGeo(req, {} as any, () => { called = true; });
        return { h: req.headers, called };
    };
    let r = run({ 'x-real-ip': '41.202.7.9', 'x-sbc-asn': '999', 'x-sbc-geo-source': 'ipdb' });
    check('not loaded: headers untouched (but a client X-SBC-Geo-Source dropped), request goes on', r.called && r.h['x-sbc-asn'] === '999' && !('x-sbc-geo-source' in r.h));
    check('not loaded: lookups answer nothing', geo.lookupIp('41.202.7.9').asn === null);

    // ---- load ----
    check('loads the four files', await geo.loadIpGeo(dir) && geo.ipGeoStats.rows.country4 === 4 && geo.ipGeoStats.rows.asn6 === 1, JSON.stringify(geo.ipGeoStats.rows));
    const cm = geo.lookupIp('41.202.7.9');
    check('IPv4 in an unsorted file: CM + ASN 15964 with its quoted name', cm.country === 'CM' && cm.asn === 15964 && cm.asnName === 'CAMNET, Cameroon Telecommunications', JSON.stringify(cm));
    check('range edges included', geo.lookupIp('41.202.0.0').country === 'CM' && geo.lookupIp('41.202.127.255').asn === 15964);
    check('just outside a range: unknown', geo.lookupIp('41.202.128.0').country === null && geo.lookupIp('41.202.128.0').asn === null);
    check('country known, network unknown', geo.lookupIp('41.138.90.1').country === 'BJ' && geo.lookupIp('41.138.90.1').asn === null);
    check('IPv6', geo.lookupIp('2001:4860:4860::8888').asn === 15169 && geo.lookupIp('2c0f:f8f0:1::5').country === 'CM');
    check('IPv4-mapped IPv6 → the IPv4 tables', geo.lookupIp('::ffff:102.244.3.4').asn === 37508);
    check('garbage → unknown, no throw', geo.lookupIp('not-an-ip').country === null && geo.lookupIp('').asn === null && geo.lookupIp('999.1.1.1').asn === null);

    // ---- headers ----
    r = run({ 'x-real-ip': '41.202.7.9', 'x-sbc-asn': '16509', 'x-sbc-geo': 'CM' });
    check('a client-sent ASN is replaced by ours', r.h['x-sbc-asn'] === '15964');
    r = run({ 'x-real-ip': '41.138.90.1', 'x-sbc-asn': '16509', 'x-sbc-geo': 'BJ' });
    check('address in no known network: the client ASN is removed', !('x-sbc-asn' in r.h));
    r = run({ 'x-real-ip': '102.244.3.4', 'x-sbc-geo': 'XX' });
    check('Cloudflare said XX: country filled from the files, marked ipdb', r.h['x-sbc-geo'] === 'CM' && r.h['x-sbc-geo-source'] === 'ipdb');
    r = run({ 'x-real-ip': '102.244.3.4' });
    check('no country header: filled', r.h['x-sbc-geo'] === 'CM');
    r = run({ 'x-real-ip': '102.244.3.4', 'x-sbc-geo': 'FR' });
    check('Cloudflare’s country wins over the files', r.h['x-sbc-geo'] === 'FR' && !('x-sbc-geo-source' in r.h));
    r = run({ 'x-real-ip': '102.244.3.4', 'x-sbc-geo': 'T1' });
    check('Tor (T1) kept', r.h['x-sbc-geo'] === 'T1');
    r = run({ 'x-real-ip': '102.244.3.4', 'x-sbc-asn': '1' }, '/health');
    check('outside /api: untouched', r.h['x-sbc-asn'] === '1');
    r = run({});
    check('no X-Real-IP: the socket address (local here) is used, nothing found, no throw', r.called);

    // ---- reload / refusal ----
    delete process.env.IPGEO_ALLOW_SMALL;
    fs.writeFileSync(path.join(dir, 'user-country-ipv4.csv'), '1.0.0.0,1.0.0.255,AU\n');
    await geo.loadIpGeo(dir);
    check('a truncated file is refused, previous tables kept', geo.lookupIp('41.202.7.9').country === 'CM' && /refusing/.test(geo.ipGeoStats.lastError ?? ''), geo.ipGeoStats.lastError ?? '');
    fs.rmSync(path.join(dir, 'origin-asn-ipv6.csv'));
    await geo.loadIpGeo(dir);
    check('a missing file: previous tables kept', geo.lookupIp('41.202.7.9').asn === 15964 && /missing/.test(geo.ipGeoStats.lastError ?? ''));

    // ---- scale ----
    const big = fs.mkdtempSync(path.join(os.tmpdir(), 'ipgeo-big-'));
    const N = 500_000;
    const ip4 = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
    const c = [], a = [];
    for (let i = 0; i < N; i++) {
        const s = 16_777_216 + i * 4096; // 1.0.0.0 onwards, 4096 addresses each
        c.push(`${ip4(s)},${ip4(s + 4095)},${['CM', 'BJ', 'TG', 'CI', 'SN'][i % 5]}`);
        a.push(`${ip4(s)},${ip4(s + 4095)},${10_000 + (i % 50_000)},AS ${i % 50_000}`);
    }
    write(big, { 'user-country-ipv4.csv': c.join('\n'), 'origin-asn-ipv4.csv': a.join('\n'), 'user-country-ipv6.csv': '', 'origin-asn-ipv6.csv': '' });
    const t0 = Date.now();
    await geo.loadIpGeo(big);
    const loadMs = Date.now() - t0;
    check('500,000 + 500,000 rows loaded', geo.ipGeoStats.rows.country4 === N && geo.ipGeoStats.rows.asn4 === N, `${loadMs} ms, heap ${Math.round(process.memoryUsage().heapUsed / 1e6)} MB`);
    const t1 = process.hrtime.bigint();
    let hits = 0;
    for (let i = 0; i < 1_000_000; i++) if (geo.lookupIp(ip4(16_777_216 + ((i * 7919) % (N * 4096)))).country) hits++;
    const us = Number(process.hrtime.bigint() - t1) / 1e3 / 1e6;
    check('1,000,000 lookups, all found, about a microsecond each', hits === 1_000_000 && us < 10, `${us.toFixed(2)} µs per lookup`);

    fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(big, { recursive: true, force: true });
    console.log(failures ? `\n${failures} FAILED` : '\nall passed');
    process.exit(failures ? 1 : 0);
};
main().catch(e => { console.error(e); process.exit(1); });
