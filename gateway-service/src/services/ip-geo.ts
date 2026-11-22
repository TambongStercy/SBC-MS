import fs from 'fs';
import net from 'net';
import path from 'path';
import readline from 'readline';
import logger from '../utils/logger';

const log = logger.getLogger('IpGeo');

/**
 * IP → country and network (ASN) from free, keyless files (decided 2026-11-22: no paid or keyed
 * services; it replaces the GeoLite2 fallback, which needed a MaxMind key). The files are
 * sapics/ip-location-db's own datasets, public domain (PDDL), rebuilt daily:
 *   user-country-ipv4.csv / -ipv6.csv   ip_range_start,ip_range_end,country_code
 *   origin-asn-ipv4.csv / -ipv6.csv     ip_range_start,ip_range_end,asn,organisation
 * `scripts/security-plan/update-ip-geo.sh` downloads them (checksums verified) into
 * IPGEO_DIR every night; this module reloads them when they change (checked every 10 min).
 *
 * Kept in memory as sorted ranges (typed arrays, a few MB) and searched by bisection, so a
 * lookup costs microseconds and never touches the disk or the network. Until the files are
 * loaded (or when IPGEO_DIR is unset) every lookup answers nothing and callers keep what
 * they had.
 */
const FILES = {
    country4: 'user-country-ipv4.csv',
    country6: 'user-country-ipv6.csv',
    asn4: 'origin-asn-ipv4.csv',
    asn6: 'origin-asn-ipv6.csv',
} as const;
const RELOAD_CHECK_MS = 10 * 60_000;
// BigInt constants (the gateway compiles to ES2018: no `16n` literals)
const N0 = BigInt(0), N8 = BigInt(8), N16 = BigInt(16), N24 = BigInt(24), N32 = BigInt(32), N255 = BigInt(255), FFFF = BigInt(0xffff);

interface Table4 { start: Uint32Array; end: Uint32Array; value: Uint32Array; n: number }
interface Table6 { startHi: BigUint64Array; startLo: BigUint64Array; endHi: BigUint64Array; endLo: BigUint64Array; value: Uint32Array; n: number }
interface Tables { country4: Table4; country6: Table6; asn4: Table4; asn6: Table6; countries: string[]; names: Map<number, string>; loadedAt: Date; mtime: number }

let tables: Tables | null = null;
let loading: Promise<void> | null = null;
export const ipGeoStats = { loaded: false, loadedAt: null as string | null, rows: { country4: 0, country6: 0, asn4: 0, asn6: 0 }, lastError: null as string | null, lookups: 0, hits: 0 };

// ---------------------------------------------------------------- parsing

export function ipv4ToInt(ip: string): number | null {
    const p = ip.split('.');
    if (p.length !== 4) return null;
    let n = 0;
    for (const s of p) {
        if (!/^\d{1,3}$/.test(s)) return null;
        const v = Number(s);
        if (v > 255) return null;
        n = n * 256 + v;
    }
    return n >>> 0;
}

/** An IPv6 address as two 64-bit halves. IPv4-mapped (::ffff:a.b.c.d) included. */
export function ipv6ToHalves(ip: string): [bigint, bigint] | null {
    if (net.isIPv6(ip) === false) return null;
    let s = ip.toLowerCase();
    const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
    if (v4) {
        const n = ipv4ToInt(v4[1]);
        if (n === null) return null;
        s = s.slice(0, -v4[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
    }
    const [head, tail] = s.split('::');
    const h = head ? head.split(':') : [];
    const t = tail !== undefined ? (tail ? tail.split(':') : []) : [];
    const groups = tail !== undefined ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
    if (groups.length !== 8) return null;
    let hi = N0, lo = N0;
    for (let i = 0; i < 8; i++) {
        const g = BigInt(parseInt(groups[i] || '0', 16));
        if (i < 4) hi = (hi << N16) | g; else lo = (lo << N16) | g;
    }
    return [hi, lo];
}

/** Splits one CSV line (quoted fields allowed: the ASN organisation may hold commas). */
function splitCsv(line: string): string[] {
    if (!line.includes('"')) return line.split(',');
    const out: string[] = [];
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
        else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
    }
    out.push(cur);
    return out;
}

class Grow4 {
    start = new Uint32Array(1 << 16); end = new Uint32Array(1 << 16); value = new Uint32Array(1 << 16); n = 0;
    push(s: number, e: number, v: number) {
        if (this.n === this.start.length) {
            const g = (a: Uint32Array) => { const b = new Uint32Array(a.length * 2); b.set(a); return b; };
            this.start = g(this.start); this.end = g(this.end); this.value = g(this.value);
        }
        this.start[this.n] = s; this.end[this.n] = e; this.value[this.n] = v; this.n++;
    }
    done(): Table4 { return sortTable4({ start: this.start.slice(0, this.n), end: this.end.slice(0, this.n), value: this.value.slice(0, this.n), n: this.n }); }
}
class Grow6 {
    rows: [bigint, bigint, bigint, bigint, number][] = [];
    push(s: [bigint, bigint], e: [bigint, bigint], v: number) { this.rows.push([s[0], s[1], e[0], e[1], v]); }
    done(): Table6 {
        const r = this.rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
        const t: Table6 = { startHi: new BigUint64Array(r.length), startLo: new BigUint64Array(r.length), endHi: new BigUint64Array(r.length), endLo: new BigUint64Array(r.length), value: new Uint32Array(r.length), n: r.length };
        r.forEach((x, i) => { t.startHi[i] = x[0]; t.startLo[i] = x[1]; t.endHi[i] = x[2]; t.endLo[i] = x[3]; t.value[i] = x[4]; });
        return t;
    }
}
function sortTable4(t: Table4): Table4 {
    let sorted = true;
    for (let i = 1; i < t.n; i++) if (t.start[i] < t.start[i - 1]) { sorted = false; break; }
    if (sorted) return t;
    const idx = Array.from({ length: t.n }, (_, i) => i).sort((a, b) => t.start[a] - t.start[b]);
    return { start: Uint32Array.from(idx, i => t.start[i]), end: Uint32Array.from(idx, i => t.end[i]), value: Uint32Array.from(idx, i => t.value[i]), n: t.n };
}

async function readRows(file: string, onRow: (f: string[]) => void): Promise<void> {
    const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of rl) {
        if (!line || line.charCodeAt(0) === 35 /* # */) continue;
        onRow(splitCsv(line.trim()));
    }
}

async function loadAll(dir: string): Promise<Tables> {
    const countries: string[] = [];
    const cIndex = new Map<string, number>();
    const cid = (c: string) => { let i = cIndex.get(c); if (i === undefined) { i = countries.length; countries.push(c); cIndex.set(c, i); } return i; };
    const names = new Map<number, string>();
    const c4 = new Grow4(), a4 = new Grow4(), c6 = new Grow6(), a6 = new Grow6();

    await readRows(path.join(dir, FILES.country4), f => {
        const s = ipv4ToInt(f[0]), e = ipv4ToInt(f[1]), c = (f[2] || '').trim().toUpperCase();
        if (s !== null && e !== null && /^[A-Z]{2}$/.test(c)) c4.push(s, e, cid(c)); // header and bad lines skipped
    });
    await readRows(path.join(dir, FILES.asn4), f => {
        const s = ipv4ToInt(f[0]), e = ipv4ToInt(f[1]), a = Number(f[2]);
        if (s !== null && e !== null && Number.isInteger(a) && a > 0) { a4.push(s, e, a); if (f[3] && !names.has(a)) names.set(a, f[3].slice(0, 80)); }
    });
    await readRows(path.join(dir, FILES.country6), f => {
        const s = ipv6ToHalves(f[0]), e = ipv6ToHalves(f[1]), c = (f[2] || '').trim().toUpperCase();
        if (s && e && /^[A-Z]{2}$/.test(c)) c6.push(s, e, cid(c));
    });
    await readRows(path.join(dir, FILES.asn6), f => {
        const s = ipv6ToHalves(f[0]), e = ipv6ToHalves(f[1]), a = Number(f[2]);
        if (s && e && Number.isInteger(a) && a > 0) { a6.push(s, e, a); if (f[3] && !names.has(a)) names.set(a, f[3].slice(0, 80)); }
    });
    return { country4: c4.done(), country6: c6.done(), asn4: a4.done(), asn6: a6.done(), countries, names, loadedAt: new Date(), mtime: newestMtime(dir) };
}

function newestMtime(dir: string): number {
    let m = 0;
    for (const f of Object.values(FILES)) {
        try { m = Math.max(m, fs.statSync(path.join(dir, f)).mtimeMs); } catch { return -1; }
    }
    return m;
}

// ---------------------------------------------------------------- lookup

function find4(t: Table4, ip: number): number {
    let lo = 0, hi = t.n - 1, at = -1;
    while (lo <= hi) { const mid = (lo + hi) >>> 1; if (t.start[mid] <= ip) { at = mid; lo = mid + 1; } else hi = mid - 1; }
    return at >= 0 && ip <= t.end[at] ? at : -1;
}
function find6(t: Table6, h: bigint, l: bigint): number {
    let lo = 0, hi = t.n - 1, at = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        const sh = t.startHi[mid], sl = t.startLo[mid];
        if (sh < h || (sh === h && sl <= l)) { at = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (at < 0) return -1;
    const eh = t.endHi[at], el = t.endLo[at];
    return h < eh || (h === eh && l <= el) ? at : -1;
}

export interface IpGeo { country: string | null; asn: number | null; asnName: string | null }

/** Country and network of an address; nulls when unknown or the files are not loaded. */
export function lookupIp(ip: string | null | undefined): IpGeo {
    const out: IpGeo = { country: null, asn: null, asnName: null };
    const t = tables;
    if (!t || !ip) return out;
    ipGeoStats.lookups++;
    const v4 = ipv4ToInt(ip);
    if (v4 !== null) {
        const c = find4(t.country4, v4); if (c >= 0) out.country = t.countries[t.country4.value[c]];
        const a = find4(t.asn4, v4); if (a >= 0) out.asn = t.asn4.value[a];
    } else {
        const v6 = ipv6ToHalves(ip);
        if (!v6) return out;
        const mapped = v6[0] === N0 && (v6[1] >> N32) === FFFF; // ::ffff:a.b.c.d
        if (mapped) return lookupIp([N24, N16, N8, N0].map(sh => Number((v6[1] >> sh) & N255)).join('.'));
        const c = find6(t.country6, v6[0], v6[1]); if (c >= 0) out.country = t.countries[t.country6.value[c]];
        const a = find6(t.asn6, v6[0], v6[1]); if (a >= 0) out.asn = t.asn6.value[a];
    }
    if (out.asn) out.asnName = t.names.get(out.asn) ?? null;
    if (out.country || out.asn) ipGeoStats.hits++;
    return out;
}

// ---------------------------------------------------------------- loading

export const ipGeoDir = () => process.env.IPGEO_DIR || '';

/** Loads (or reloads) the files from IPGEO_DIR; keeps the previous tables on any failure. */
export async function loadIpGeo(dir = ipGeoDir()): Promise<boolean> {
    if (!dir) return false;
    if (loading) { await loading; return !!tables; }
    loading = (async () => {
        const t0 = Date.now();
        try {
            const m = newestMtime(dir);
            if (m < 0) throw new Error(`files missing in ${dir}`);
            const t = await loadAll(dir);
            if (t.country4.n < 1000 && !process.env.IPGEO_ALLOW_SMALL) throw new Error(`only ${t.country4.n} IPv4 country rows: refusing a truncated file`);
            tables = t;
            Object.assign(ipGeoStats, { loaded: true, loadedAt: t.loadedAt.toISOString(), lastError: null, rows: { country4: t.country4.n, country6: t.country6.n, asn4: t.asn4.n, asn6: t.asn6.n } });
            log.info(`IP files loaded in ${Date.now() - t0} ms: ${JSON.stringify(ipGeoStats.rows)}`);
        } catch (e: any) {
            ipGeoStats.lastError = String(e?.message ?? e).slice(0, 200);
            log.warn(`IP files not loaded (${ipGeoStats.lastError}); ${tables ? 'keeping the previous ones' : 'lookups answer nothing'}`);
        }
    })();
    try { await loading; } finally { loading = null; }
    return !!tables;
}

let timer: NodeJS.Timeout | null = null;
/** Loads at start (in the background), then reloads when the files' mtime changes. */
export function startIpGeo(): void {
    const dir = ipGeoDir();
    if (!dir || timer) return;
    void loadIpGeo(dir);
    timer = setInterval(() => {
        const m = newestMtime(dir);
        if (m > 0 && (!tables || m !== tables.mtime)) void loadIpGeo(dir);
    }, RELOAD_CHECK_MS);
    timer.unref();
}

export function _resetIpGeo() { tables = null; if (timer) clearInterval(timer); timer = null; }
