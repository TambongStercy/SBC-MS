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
 * Part 2 (2026-11-22):
 *   - the body: `b` is compared with the SHA-256 of the bytes actually received
 *     (`body`: match / mismatch / unsigned / too_large / unknown / none). The
 *     proxies stream bodies, so the hash is taken from the same stream as it
 *     flows (`watchBody`), never buffered and never delaying it;
 *   - automation signals per member (invalid signature, replay, body mismatch,
 *     tool user-agent with a member token) go to the Phase 4 fraud engine every
 *     minute (`RISK_SERVICE_URL`), as one `automation_seen` event per member.
 * Payment and WhatsApp webhooks, SSO, partner API and the support desk/public
 * routes are exempt (their own checks).
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

/** Bodies above this are not hashed (`too_large`): uploads are signed UNSIGNED anyway. */
const MAX_BODY = 1_048_576;
const BODY_WAIT_MS = 30_000;
const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');

export type BodyOutcome = 'none' | 'match' | 'mismatch' | 'unsigned' | 'too_large' | 'unknown';
type BodyHash = { hex: string } | { tooLarge: true } | null;

/**
 * Hashes the request body as it streams to the proxy, without buffering it or
 * changing its flow. Installed BEFORE `next()`: the first consumer to add a
 * 'data' listener (express-http-proxy's pipe or raw-body) gets ours attached
 * in the same synchronous call, just before its own, so both see every chunk.
 * Resolves on 'end'; null when the body is never read, aborted, or slower than
 * BODY_WAIT_MS. Only for requests that carry a hex body hash to compare.
 */
export function watchBody(req: Request): Promise<BodyHash> | null {
    const raw = header(req, 'x-sbc-signature');
    const m = raw.match(/(?:^|;)b=([a-f0-9]{64})(?:;|$)/);
    if (!m) return null;
    const len = Number(header(req, 'content-length') || 0);
    const chunked = !!header(req, 'transfer-encoding');
    if (!chunked && !(len > 0)) return Promise.resolve({ hex: EMPTY_SHA256 });
    if (len > MAX_BODY) return Promise.resolve({ tooLarge: true });
    return new Promise<BodyHash>((resolve) => {
        const h = createHash('sha256');
        let size = 0;
        let over = false;
        let done = false;
        const finish = (v: BodyHash) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
        const timer = setTimeout(() => finish(null), BODY_WAIT_MS);
        timer.unref?.();
        const origOn = req.on;
        const stream = req as any;
        stream.on = function patched(this: any, ev: string | symbol, fn: (...a: any[]) => void) {
            if (ev === 'data') {
                delete stream.on; // once: the first consumer only (back to the prototype's method)
                try {
                    origOn.call(req, 'data', (c: Buffer | string) => {
                        if (over) return;
                        size += typeof c === 'string' ? Buffer.byteLength(c) : c.length;
                        if (size > MAX_BODY) { over = true; return; }
                        try { h.update(c); } catch { over = true; }
                    });
                    origOn.call(req, 'end', () => finish(over ? { tooLarge: true } : { hex: h.digest('hex') }));
                    origOn.call(req, 'aborted', () => finish(null));
                    origOn.call(req, 'error', () => finish(null));
                } catch { /* never in the request's way */ }
            }
            return origOn.call(this, ev, fn);
        };
        // nobody read it: put the method back once the request is over
        req.once?.('close', () => { if (Object.prototype.hasOwnProperty.call(stream, 'on')) delete stream.on; finish(null); });
    });
}

async function bodyOutcome(req: Request, watched: Promise<BodyHash> | null): Promise<BodyOutcome> {
    const raw = header(req, 'x-sbc-signature');
    if (/(?:^|;)b=UNSIGNED(?:;|$)/.test(raw)) return 'unsigned';
    const m = raw.match(/(?:^|;)b=([a-f0-9]{64})(?:;|$)/);
    if (!m || !watched) return 'none';
    const got = await watched;
    if (!got) return 'unknown';
    if ('tooLarge' in got) return 'too_large';
    return got.hex === m[1] ? 'match' : 'mismatch';
}

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
export async function checkSignature(req: Request, now = Date.now()): Promise<{ outcome: SigOutcome; role: string; userId?: string } | null> {
    const auth = header(req, 'authorization');
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (token && token === config.services.serviceSecret) return null; // service call: not a browser question
    if (!token) return { outcome: 'no_token', role: 'anon' };
    const claims = verifyToken(token, config.jwt.secret);
    if (!claims) return { outcome: 'bad_token', role: 'anon' };
    const role = ['user', 'tester'].includes(String(claims.role || 'user')) ? 'member' : 'staff';
    const userId = String(claims.userId || claims.id || '');
    const r = (outcome: SigOutcome) => ({ outcome, role, userId });

    const raw = header(req, 'x-sbc-signature');
    if (!raw) return r('missing');
    if (raw.startsWith('none')) return r('unsupported');
    const f: Record<string, string> = {};
    for (const part of raw.split(';')) { const i = part.indexOf('='); if (i > 0) f[part.slice(0, i)] = part.slice(i + 1); }
    if (!raw.startsWith('v1;') || !/^\d{13}$/.test(f.t || '') || !/^[A-Za-z0-9_-]{16,64}$/.test(f.n || '')
        || !/^([a-f0-9]{64}|UNSIGNED)$/.test(f.b || '') || !/^[A-Za-z0-9_-]{80,90}$/.test(f.s || '')) return r('malformed');
    if (Math.abs(now - Number(f.t)) > MAX_SKEW_MS) return r('stale');

    const tokenHash = createHash('sha256').update(token).digest('hex');
    const k = await keyFor(tokenHash);
    if (k === 'failed') return r('lookup_failed');
    if (!k.key) return r('no_key');
    const text = `v1\n${req.method.toUpperCase()}\n${req.originalUrl}\n${f.t}\n${f.n}\n${f.b}`;
    let ok = false;
    try { ok = verifySig('sha256', Buffer.from(text), { key: k.key, dsaEncoding: 'ieee-p1363' }, Buffer.from(f.s, 'base64url')); } catch { ok = false; }
    if (!ok) return r('bad_sig');
    if (!(await nonceIsNew(`${tokenHash.slice(0, 24)}:${f.n}`))) return r('replay');
    return r(k.late ? 'valid_late' : 'valid');
}

// ---- counts ----
interface Row { day: string; group: string; client: string; role: string; browser: string; android: string; signature: string; origin: string; fetchSite: string; body: BodyOutcome; tool: boolean; count: number }
const buffer = new Map<string, Row>();
export const browserCheckStats = { checked: 0, flushed: 0, dropped: 0 };
let timer: NodeJS.Timeout | null = null;
let flushing = false;

export async function recordBrowserCheck(req: Request, now = Date.now(), watched: Promise<BodyHash> | null = null): Promise<Row | null> {
    const path = req.originalUrl;
    if (!path.startsWith('/api/') || EXEMPT.some(r => r.test(path.split('?')[0]))) return null;
    const sig = await checkSignature(req, now);
    if (!sig) return null;
    const ua = header(req, 'user-agent');
    const { browser, android } = browserOf(ua);
    const client = header(req, 'x-sbc-client');
    const fetchSite = header(req, 'sec-fetch-site');
    // the body matters only once the signature holds (otherwise the request is refused anyway)
    const body: BodyOutcome = sig.outcome === 'valid' || sig.outcome === 'valid_late' ? await bodyOutcome(req, watched) : 'none';
    const row: Row = {
        day: doualaDay(now), group: groupOf(path), client: client === 'web' || client === 'app' ? client : 'none', role: sig.role,
        browser, android, signature: sig.outcome, origin: originClass(header(req, 'origin')),
        fetchSite: ['same-origin', 'same-site', 'cross-site', 'none'].includes(fetchSite) ? fetchSite : fetchSite ? 'other' : 'absent',
        body, tool: TOOL_UA.test(ua), count: 1,
    };
    const key = [row.day, row.group, row.client, row.role, row.browser, row.android, row.signature, row.origin, row.fetchSite, row.body, row.tool].join('|');
    const cur = buffer.get(key);
    if (cur) cur.count++;
    else if (buffer.size < HARD_CAP) buffer.set(key, row);
    else browserCheckStats.dropped++;
    browserCheckStats.checked++;
    if (row.role === 'member' && (row.signature === 'bad_sig' || row.signature === 'replay' || row.body === 'mismatch' || row.tool)) {
        log.warn(`Browser check ${row.signature}${row.body === 'mismatch' ? ' (body changed)' : ''}${row.tool ? ' (tool user-agent)' : ''} on ${req.method} ${path.split('?')[0]} [${browser}]`);
        noteAutomation(sig.userId, row);
    }
    return row;
}

// ---- automation signals per member → the fraud engine (plan item 8) ----
interface Seen { userId: string; day: string; badSig: number; replay: number; bodyMismatch: number; tool: number }
const automation = new Map<string, Seen>();
export const automationStats = { sent: 0, dropped: 0 };

function noteAutomation(userId: string | undefined, row: Row) {
    if (!userId || !/^[a-f0-9]{24}$/i.test(userId)) return;
    const k = `${userId}|${row.day}`;
    const e = automation.get(k) ?? { userId, day: row.day, badSig: 0, replay: 0, bodyMismatch: 0, tool: 0 };
    if (row.signature === 'bad_sig') e.badSig++;
    if (row.signature === 'replay') e.replay++;
    if (row.body === 'mismatch') e.bodyMismatch++;
    if (row.tool) e.tool++;
    if (automation.has(k) || automation.size < HARD_CAP) automation.set(k, e);
}

/** One `automation_seen` event per member seen this minute (fire-and-forget, 2 s each). */
export async function flushAutomation(): Promise<number> {
    if (!automation.size) return 0;
    const rows = [...automation.values()];
    automation.clear();
    const base = config.services.riskServiceUrl;
    if (!base) return 0;
    let sent = 0;
    for (const e of rows) {
        try {
            const r = await fetch(`${base}/api/risk/internal/events`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.services.serviceSecret}`, 'X-Service-Name': 'gateway-service' },
                body: JSON.stringify({ type: 'automation_seen', userId: e.userId, day: e.day, badSig: e.badSig, replay: e.replay, bodyMismatch: e.bodyMismatch, tool: e.tool }),
                signal: AbortSignal.timeout(2000),
            });
            if (r.ok) sent++; else automationStats.dropped++;
        } catch { automationStats.dropped++; }
    }
    automationStats.sent += sent;
    return sent;
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
    let watched: Promise<BodyHash> | null = null;
    if (browserChecksMode() !== 'off' && req.originalUrl.startsWith('/api/')) {
        try { watched = watchBody(req); } catch { watched = null; }
    }
    next();
    if (browserChecksMode() === 'off') return;
    const at = Date.now();
    setImmediate(() => { recordBrowserCheck(req, at, watched).catch(err => log.warn(`Browser check skipped: ${err?.message ?? err}`)); });
};

/** Periodic flush (no shutdown hook, like the activity signals: at most a minute of counts is lost). */
export function startBrowserChecksFlush(): void {
    if (timer) return;
    timer = setInterval(() => { void flushBrowserChecks(); void flushAutomation(); }, FLUSH_MS);
    timer.unref();
}

export const _browserChecksBuffer = buffer;
export const _automationBuffer = automation;
