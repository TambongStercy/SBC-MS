import { createHash, createPublicKey, verify as verifySig, KeyObject } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import config from '../../config';
import logger from '../../utils/logger';
import { claimOnce, getJson, setJson } from '../../utils/redis';
import { doualaDay } from './activity-signals.middleware';
import { verifyToken } from './admin-allowlist.middleware';

const log = logger.getLogger('BrowserChecks');

/**
 * Security plan Phase 9 — browser-only access, LOG-ONLY step.
 *
 * The web app signs every /api call with a key made at sign-in (WebCrypto
 * ECDSA P-256, private key non-extractable, kept in IndexedDB; public key bound
 * to the member token in user-service `session_keys`):
 *
 *   X-SBC-Signature: v1;t=<ms>;n=<nonce>;b=<sha256 hex of the body | UNSIGNED>;s=<base64url P1363 signature>
 *   signed text:     "v1\n<METHOD>\n<path?query as sent>\n<t>\n<n>\n<b>"
 *   (or `none;r=<reason>` from a browser without WebCrypto/IndexedDB)
 *
 * Each request is checked AFTER it is passed on (no added latency, nothing
 * refused) and counted per Douala day × route group × client × role × browser
 * × Android version × outcome, with the Origin / Sec-Fetch-Site / tool
 * user-agent results. Counts go to user-service `browser_check_days` every
 * minute. The plan's 14 log-only days decide enforcement (a later step).
 *
 * Not checked yet: that `b` matches the body actually sent (the proxies stream
 * bodies; it comes with enforcement). Payment and WhatsApp webhooks, SSO,
 * partner API and the support desk/public routes are exempt (their own checks).
 *
 * BROWSER_CHECKS=off (default) | log.
 */
export const browserChecksMode = (): 'off' | 'log' => (process.env.BROWSER_CHECKS === 'log' ? 'log' : 'off');

const EXEMPT = [/^\/api\/payments\/webhooks\//, /^\/api\/payouts\/webhooks\//, /^\/api\/webhook(\/|$)/, /^\/api\/sso(\/|$)/,
    /^\/api\/partners(\/|$)/, /^\/api\/support\/(desk|public|internal)(\/|$)/, /\/internal\//];
const TOOL_UA = /PostmanRuntime|^curl\/|python-requests|python-urllib|insomnia|^axios\/|node-fetch|^undici|Go-http-client|okhttp|^Wget|HTTPie|Apache-HttpClient|^Java\//i;
const SBC_HOST = /(^|\.)(sniperbuisnesscenter\.com|sniperbusinesscenter\.com)$|^localhost$|^127\.0\.0\.1$/;
const MAX_SKEW_MS = 60_000;
const FLUSH_MS = 60_000;
const HARD_CAP = 5_000;

export type SigOutcome = 'no_token' | 'bad_token' | 'missing' | 'unsupported' | 'malformed' | 'stale' | 'replay' | 'no_key' | 'lookup_failed' | 'bad_sig' | 'valid' | 'valid_late';

const header = (req: Request, name: string): string => {
    const v = req.headers[name];
    return typeof v === 'string' ? v : Array.isArray(v) ? v[0] ?? '' : '';
};

export function browserOf(ua: string): { browser: string; android: string } {
    const android = (ua.match(/Android (\d+)/) || [])[1] ?? (/(iPhone|iPad|iPod)/.test(ua) ? 'ios' : 'none');
    const browser = /; wv\)|\bwv\b/.test(ua) ? 'webview'
        : /SamsungBrowser/.test(ua) ? 'samsung'
        : /OPR\/|Opera/.test(ua) ? 'opera'
        : /Edg\//.test(ua) ? 'edge'
        : /UCBrowser/.test(ua) ? 'uc'
        : /Firefox\//.test(ua) ? 'firefox'
        : /CriOS|Chrome\//.test(ua) ? 'chrome'
        : /Safari\//.test(ua) ? 'safari'
        : TOOL_UA.test(ua) ? 'tool' : ua ? 'other' : 'none';
    return { browser, android };
}

const originClass = (origin: string): string => {
    if (!origin) return 'none';
    try { return SBC_HOST.test(new URL(origin).hostname) ? 'sbc' : 'other'; } catch { return 'other'; }
};

const groupOf = (path: string): string => {
    const seg = path.split('?')[0].split('/').filter(Boolean); // ['api', 'users', 'me', …]
    return (seg[1] || 'root').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30) || 'root';
};

// ---- session keys: memory → Redis → user-service ----
const keyCache = new Map<string, { key: KeyObject | null; late: boolean; until: number }>();
async function keyFor(tokenHash: string): Promise<{ key: KeyObject | null; late: boolean } | 'failed'> {
    const now = Date.now();
    const hit = keyCache.get(tokenHash);
    if (hit && hit.until > now) return hit;
    let data = await getJson<{ publicKey: string | null; late: boolean }>(`skey:${tokenHash}`);
    if (!data) {
        try {
            const r = await fetch(`${config.services.userServiceUrl}/api/users/internal/session-keys/${tokenHash}`, {
                headers: { Authorization: `Bearer ${config.services.serviceSecret}`, 'X-Service-Name': 'gateway-service' },
                signal: AbortSignal.timeout(2000),
            });
            if (r.status === 404) data = { publicKey: null, late: false };
            else if (!r.ok) return 'failed';
            else { const j: any = await r.json(); data = { publicKey: j?.data?.publicKey ?? null, late: !!j?.data?.late }; }
        } catch { return 'failed'; }
        await setJson(`skey:${tokenHash}`, data, data.publicKey ? 600 : 30);
    }
    let key: KeyObject | null = null;
    if (data.publicKey) { try { key = createPublicKey({ key: Buffer.from(data.publicKey, 'base64'), format: 'der', type: 'spki' }); } catch { key = null; } }
    if (keyCache.size > 20_000) keyCache.clear();
    keyCache.set(tokenHash, { key, late: data.late, until: now + (key ? 600_000 : 30_000) });
    return { key, late: data.late };
}

// nonces: Redis SET NX; without Redis, this process's memory
const localNonces = new Map<string, number>();
async function nonceIsNew(id: string): Promise<boolean> {
    const r = await claimOnce(`nonce:${id}`, 120);
    if (r !== null) return r;
    const now = Date.now();
    if (localNonces.size > 50_000) for (const [k, t] of localNonces) if (t < now) localNonces.delete(k);
    if ((localNonces.get(id) ?? 0) > now) return false;
    localNonces.set(id, now + 120_000);
    return true;
}

/** The signature outcome of one request (exported for the check script). */
export async function checkSignature(req: Request, now = Date.now()): Promise<{ outcome: SigOutcome; role: string } | null> {
    const auth = header(req, 'authorization');
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (token && token === config.services.serviceSecret) return null; // service call: not a browser question
    if (!token) return { outcome: 'no_token', role: 'anon' };
    const claims = verifyToken(token, config.jwt.secret);
    if (!claims) return { outcome: 'bad_token', role: 'anon' };
    const role = ['user', 'tester'].includes(String(claims.role || 'user')) ? 'member' : 'staff';

    const raw = header(req, 'x-sbc-signature');
    if (!raw) return { outcome: 'missing', role };
    if (raw.startsWith('none')) return { outcome: 'unsupported', role };
    const f: Record<string, string> = {};
    for (const part of raw.split(';')) { const i = part.indexOf('='); if (i > 0) f[part.slice(0, i)] = part.slice(i + 1); }
    if (!raw.startsWith('v1;') || !/^\d{13}$/.test(f.t || '') || !/^[A-Za-z0-9_-]{16,64}$/.test(f.n || '')
        || !/^([a-f0-9]{64}|UNSIGNED)$/.test(f.b || '') || !/^[A-Za-z0-9_-]{80,90}$/.test(f.s || '')) return { outcome: 'malformed', role };
    if (Math.abs(now - Number(f.t)) > MAX_SKEW_MS) return { outcome: 'stale', role };

    const tokenHash = createHash('sha256').update(token).digest('hex');
    const k = await keyFor(tokenHash);
    if (k === 'failed') return { outcome: 'lookup_failed', role };
    if (!k.key) return { outcome: 'no_key', role };
    const text = `v1\n${req.method.toUpperCase()}\n${req.originalUrl}\n${f.t}\n${f.n}\n${f.b}`;
    let ok = false;
    try { ok = verifySig('sha256', Buffer.from(text), { key: k.key, dsaEncoding: 'ieee-p1363' }, Buffer.from(f.s, 'base64url')); } catch { ok = false; }
    if (!ok) return { outcome: 'bad_sig', role };
    if (!(await nonceIsNew(`${tokenHash.slice(0, 24)}:${f.n}`))) return { outcome: 'replay', role };
    return { outcome: k.late ? 'valid_late' : 'valid', role };
}

// ---- counts ----
interface Row { day: string; group: string; client: string; role: string; browser: string; android: string; signature: string; origin: string; fetchSite: string; tool: boolean; count: number }
const buffer = new Map<string, Row>();
export const browserCheckStats = { checked: 0, flushed: 0, dropped: 0 };
let timer: NodeJS.Timeout | null = null;
let flushing = false;

export async function recordBrowserCheck(req: Request, now = Date.now()): Promise<Row | null> {
    const path = req.originalUrl;
    if (!path.startsWith('/api/') || EXEMPT.some(r => r.test(path.split('?')[0]))) return null;
    const sig = await checkSignature(req, now);
    if (!sig) return null;
    const ua = header(req, 'user-agent');
    const { browser, android } = browserOf(ua);
    const client = header(req, 'x-sbc-client');
    const fetchSite = header(req, 'sec-fetch-site');
    const row: Row = {
        day: doualaDay(now), group: groupOf(path), client: client === 'web' || client === 'app' ? client : 'none', role: sig.role,
        browser, android, signature: sig.outcome, origin: originClass(header(req, 'origin')),
        fetchSite: ['same-origin', 'same-site', 'cross-site', 'none'].includes(fetchSite) ? fetchSite : fetchSite ? 'other' : 'absent',
        tool: TOOL_UA.test(ua), count: 1,
    };
    const key = [row.day, row.group, row.client, row.role, row.browser, row.android, row.signature, row.origin, row.fetchSite, row.tool].join('|');
    const cur = buffer.get(key);
    if (cur) cur.count++;
    else if (buffer.size < HARD_CAP) buffer.set(key, row);
    else browserCheckStats.dropped++;
    browserCheckStats.checked++;
    if (row.role === 'member' && (row.signature === 'bad_sig' || row.signature === 'replay' || row.tool)) {
        log.warn(`Browser check ${row.signature}${row.tool ? ' (tool user-agent)' : ''} on ${req.method} ${path.split('?')[0]} [${browser}]`);
    }
    return row;
}

export async function flushBrowserChecks(): Promise<void> {
    if (flushing || buffer.size === 0) return;
    flushing = true;
    const rows = [...buffer.values()];
    buffer.clear();
    try {
        const r = await fetch(`${config.services.userServiceUrl}/api/users/internal/browser-checks/batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.services.serviceSecret}`, 'X-Service-Name': 'gateway-service' },
            body: JSON.stringify({ rows }),
            signal: AbortSignal.timeout(10_000),
        });
        if (!r.ok) throw new Error(`user-service answered ${r.status}`);
        browserCheckStats.flushed += rows.length;
    } catch (err: any) {
        browserCheckStats.dropped += rows.length;
        log.warn(`Browser checks: ${rows.length} row(s) dropped (${err?.message ?? err}).`);
    } finally {
        flushing = false;
    }
}

export const browserChecks = (req: Request, _res: Response, next: NextFunction) => {
    next();
    if (browserChecksMode() === 'off') return;
    setImmediate(() => { recordBrowserCheck(req).catch(err => log.warn(`Browser check skipped: ${err?.message ?? err}`)); });
};

/** Periodic flush (no shutdown hook, like the activity signals: at most a minute of counts is lost). */
export function startBrowserChecksFlush(): void {
    if (timer) return;
    timer = setInterval(() => void flushBrowserChecks(), FLUSH_MS);
    timer.unref();
}

export const _browserChecksBuffer = buffer;
