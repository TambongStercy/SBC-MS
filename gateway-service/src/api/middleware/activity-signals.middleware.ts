import { NextFunction, Request, Response } from 'express';
import config from '../../config';
import logger from '../../utils/logger';
import { verifyToken } from './admin-allowlist.middleware';

const log = logger.getLogger('ActivitySignals');

/**
 * Security plan Phase 1 — signals. For every authenticated request: the
 * member, the country Cloudflare saw (X-SBC-Geo, set by nginx from
 * CF-IPCountry, overwriting anything the client sends), the network (X-SBC-ASN
 * when a Cloudflare transform rule provides it, the /24 range of X-Real-IP),
 * the device ID the apps send (X-SBC-Device) and the source (X-SBC-Client).
 *
 * Hot path: no database, no network, no await. Requests are counted in memory
 * per member/day/country and sent to user-service every FLUSH_MS (or at
 * MAX_KEYS keys), which stores them only for members who accepted the policy.
 * Any failure drops the batch and is logged: tracking never blocks a member.
 *
 * Off unless ACTIVITY_SIGNALS_ENABLED=true.
 */
const FLUSH_MS = 30_000;
const MAX_KEYS = 500;
const HARD_CAP = 20_000; // never hold more than this many keys, whatever happens upstream
const MAX_LIST = 5;

type Source = 'web' | 'app' | 'api';
interface Agg {
    userId: string; day: string; country: string; requests: number; noDevice: number;
    sources: Record<Source, number>; asns: Set<number>; ipRanges: Set<string>; devices: Set<string>;
    firstAt: number; lastAt: number;
}

const buffer = new Map<string, Agg>();
let timer: NodeJS.Timeout | null = null;
let flushing = false;
export const signalsStats = { recorded: 0, flushed: 0, dropped: 0, noCountry: 0 };

export const signalsEnabled = () => process.env.ACTIVITY_SIGNALS_ENABLED === 'true';

/** Douala calendar day (UTC+1, no daylight saving). */
export const doualaDay = (ms: number) => new Date(ms + 3600 * 1000).toISOString().slice(0, 10);

/** /24 for IPv4, /48 for IPv6: the network, never the full address. */
export function ipRange(ip: string | undefined): string | null {
    if (!ip) return null;
    const v = ip.replace(/^::ffff:/, '').trim();
    const v4 = v.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/);
    if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
    if (v.includes(':')) {
        const parts = v.split('::')[0].split(':').filter(Boolean).slice(0, 3);
        return parts.length ? `${parts.join(':')}::/48` : null;
    }
    return null;
}

const header = (req: Request, name: string): string | undefined => {
    const v = req.headers[name];
    return typeof v === 'string' ? v : Array.isArray(v) ? v[0] : undefined;
};

const addCapped = <T>(set: Set<T>, value: T | null | undefined) => {
    if (value === null || value === undefined || value === '' || set.has(value) || set.size >= MAX_LIST) return;
    set.add(value);
};

/** What one request adds to the day's record (exported for the check script). */
export function recordRequest(req: Request, now = Date.now()): void {
    const auth = header(req, 'authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token || token === config.services.serviceSecret) return;
    const claims = verifyToken(token, config.jwt.secret);
    const userId = String(claims?.userId || claims?.id || '');
    if (!/^[a-f0-9]{24}$/i.test(userId)) return;

    const geo = (header(req, 'x-sbc-geo') || '').toUpperCase();
    const country = /^[A-Z]{2}$/.test(geo) && geo !== 'XX' && geo !== 'T1' ? geo : 'XX';
    if (country === 'XX') signalsStats.noCountry++;
    const client = header(req, 'x-sbc-client');
    const source: Source = client === 'web' || client === 'app' ? client : 'api';
    const deviceRaw = header(req, 'x-sbc-device');
    const device = deviceRaw && /^[A-Za-z0-9-]{8,64}$/.test(deviceRaw) ? deviceRaw : null;
    const asn = Number(header(req, 'x-sbc-asn'));
    const day = doualaDay(now);
    const key = `${userId}|${day}|${country}`;

    let a = buffer.get(key);
    if (!a) {
        if (buffer.size >= HARD_CAP) { signalsStats.dropped++; return; }
        a = { userId, day, country, requests: 0, noDevice: 0, sources: { web: 0, app: 0, api: 0 }, asns: new Set(), ipRanges: new Set(), devices: new Set(), firstAt: now, lastAt: now };
        buffer.set(key, a);
    }
    a.requests++;
    a.sources[source]++;
    a.lastAt = now;
    if (!device) a.noDevice++;
    addCapped(a.devices, device);
    addCapped(a.ipRanges, ipRange(header(req, 'x-real-ip') || req.socket?.remoteAddress));
    if (Number.isInteger(asn) && asn > 0) addCapped(a.asns, asn);
    signalsStats.recorded++;
    if (buffer.size >= MAX_KEYS) void flushSignals();
}

/** Sends what is buffered to user-service; on failure the batch is dropped (fail open). */
export async function flushSignals(): Promise<void> {
    if (flushing || buffer.size === 0) return;
    flushing = true;
    const rows = [...buffer.values()];
    buffer.clear();
    try {
        const r = await fetch(`${config.services.userServiceUrl}/api/users/internal/activity/batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.services.serviceSecret}`, 'X-Service-Name': 'gateway-service' },
            body: JSON.stringify({
                records: rows.map(a => ({
                    userId: a.userId, day: a.day, country: a.country, requests: a.requests, noDevice: a.noDevice, sources: a.sources,
                    asns: [...a.asns], ipRanges: [...a.ipRanges], devices: [...a.devices],
                    firstAt: new Date(a.firstAt).toISOString(), lastAt: new Date(a.lastAt).toISOString(),
                })),
            }),
            signal: AbortSignal.timeout(10_000),
        });
        if (!r.ok) throw new Error(`user-service answered ${r.status}`);
        signalsStats.flushed += rows.length;
    } catch (err: any) {
        signalsStats.dropped += rows.length;
        log.warn(`Activity signals: ${rows.length} record(s) dropped (${err?.message ?? err}).`);
    } finally {
        flushing = false;
    }
}

export const activitySignals = (req: Request, _res: Response, next: NextFunction) => {
    next();
    if (!signalsEnabled() || !req.originalUrl.startsWith('/api/')) return;
    try {
        recordRequest(req);
    } catch (err: any) {
        log.warn(`Activity signals skipped a request: ${err?.message ?? err}`);
    }
};

/**
 * Starts the periodic flush. No shutdown hook on purpose: a SIGTERM listener
 * would stop Node from exiting on PM2's reload; at most FLUSH_MS of counts is lost.
 */
export function startSignalsFlush(): void {
    if (timer) return;
    timer = setInterval(() => void flushSignals(), FLUSH_MS);
    timer.unref();
}

/** For the check script. */
export const _signalsBuffer = buffer;
