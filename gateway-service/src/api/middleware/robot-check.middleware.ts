import { NextFunction, Request, Response } from 'express';
import { createChallenge, randomInt, verifySolution } from 'altcha-lib';
import { deriveKey } from 'altcha-lib/algorithms/sha';
import config from '../../config';
import logger from '../../utils/logger';
import { claimOnce } from '../../utils/redis';
import { doualaDay } from './activity-signals.middleware';
import { verifyToken } from './admin-allowlist.middleware';
import { browserOf, noteRobotAutomation, noteTorUse } from './browser-checks.middleware';

const log = logger.getLogger('RobotCheck');

/**
 * Security plan Phase 9 rule 3: an anti-robot check on the sensitive actions, verified on
 * the server. Turnstile needed a Cloudflare key; since 2026-11-22 (no paid or keyed
 * services) it is ALTCHA, self-hosted (altcha-lib, MIT): a proof of work.
 *
 *   GET /api/altcha/challenge          → a challenge signed with ALTCHA_HMAC_KEY (10 min)
 *   the browser finds the answer (Web Crypto, ~1 s on a phone) and sends it with the action:
 *   X-SBC-Altcha: base64(JSON {challenge, solution})
 *
 * The answer is checked with one HMAC (deterministic mode: the derived key is signed, so the
 * server never re-does the work) and accepted once (Redis SET NX, else this process's memory).
 *
 * ROBOT_CHECK=off (default) | log | enforce.
 *   log:     every protected action is counted by outcome (valid / missing / malformed /
 *            invalid / expired / replay), nothing refused. Counts go to user-service
 *            `robot_check_days` every minute; a signed-in member sending a forged or replayed
 *            answer feeds the fraud engine (`automation_seen`, as Phase 9's signature checks).
 *   enforce: anything but `valid` is refused with 403 ROBOT_CHECK_FAILED.
 * It proves the client did the work, not that a person is there: a headless browser or a
 * paid solver still passes. Rate limits stay.
 */
export type RobotMode = 'off' | 'log' | 'enforce';
export const robotCheckMode = (): RobotMode => {
    const m = String(process.env.ROBOT_CHECK || 'off').toLowerCase();
    return m === 'enforce' ? 'enforce' : m === 'log' ? 'log' : 'off';
};
const hmacKey = () => process.env.ALTCHA_HMAC_KEY || '';
export const robotCheckReady = () => hmacKey().length >= 32;
/** Work asked of the browser: the answer is a random counter in [min, max] (SHA-256, one round each). */
const counterRange = () => {
    const max = Math.min(Math.max(Number(process.env.ALTCHA_MAX_COUNTER) || 20_000, 1000), 2_000_000);
    return { min: Math.floor(max / 4), max };
};
const TTL_S = 600;

/** The protected actions: method + path → action name (counted per action). */
export const PROTECTED: { method: string; path: RegExp; action: string }[] = [
    { method: 'POST', path: /^\/api\/users\/login$/, action: 'login' },
    { method: 'POST', path: /^\/api\/users\/register$/, action: 'signup' },
    { method: 'POST', path: /^\/api\/users\/request-password-reset(-otp)?$/, action: 'password_reset' },
    { method: 'POST', path: /^\/api\/users\/request-change-email$/, action: 'contact_change' },
    { method: 'POST', path: /^\/api\/users\/request-change-phone$/, action: 'contact_change' },
    { method: 'POST', path: /^\/api\/users\/me\/momo\/change$/, action: 'payout_change' },
    { method: 'POST', path: /^\/api\/users\/crypto\/wallet\/change$/, action: 'payout_change' },
    { method: 'POST', path: /^\/api\/users\/me\/authenticator\/setup\/request$/, action: 'authenticator_setup' },
    { method: 'POST', path: /^\/api\/transactions\/withdrawal\/initiate$/, action: 'withdrawal' },
    { method: 'POST', path: /^\/api\/support\/desk\/auth\/login$/, action: 'desk_login' },
    { method: 'POST', path: /^\/api\/support\/public\/tickets$/, action: 'public_ticket' },
];

export function actionFor(method: string, url: string): string | null {
    const path = url.split('?')[0].replace(/\/+$/, '').toLowerCase();
    const m = method.toUpperCase();
    return PROTECTED.find(p => p.method === m && p.path.test(path))?.action ?? null;
}

// ---- challenges ----
export async function newChallenge() {
    const { min, max } = counterRange();
    return createChallenge({
        algorithm: 'SHA-256', cost: 1, counter: randomInt(min, max), deriveKey,
        hmacSignatureSecret: hmacKey(), hmacKeySignatureSecret: hmacKey() + ':key',
        expiresAt: Math.floor(Date.now() / 1000) + TTL_S,
    });
}

export const altchaChallenge = async (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!robotCheckReady() || robotCheckMode() === 'off') return res.status(204).end(); // the app then sends nothing
    try {
        return res.json(await newChallenge());
    } catch (e: any) {
        log.warn(`Challenge failed: ${e?.message ?? e}`);
        return res.status(503).json({ success: false, message: 'Vérification indisponible' });
    }
};

// ---- answers ----
export type RobotOutcome = 'valid' | 'missing' | 'malformed' | 'invalid' | 'expired' | 'replay';

const seen = new Map<string, number>();
async function firstUse(id: string): Promise<boolean> {
    const r = await claimOnce(`altcha:${id}`, TTL_S + 60);
    if (r !== null) return r;
    const now = Date.now();
    if (seen.size > 50_000) for (const [k, t] of seen) if (t < now) seen.delete(k);
    if ((seen.get(id) ?? 0) > now) return false;
    seen.set(id, now + (TTL_S + 60) * 1000);
    return true;
}

export async function checkAnswer(raw: string): Promise<RobotOutcome> {
    if (!raw) return 'missing';
    let payload: any;
    try {
        if (raw.length > 4096) return 'malformed';
        payload = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    } catch { return 'malformed'; }
    const challenge = payload?.challenge;
    const solution = payload?.solution;
    if (!challenge?.parameters || typeof challenge.signature !== 'string' || typeof solution?.derivedKey !== 'string'
        || challenge.parameters.algorithm !== 'SHA-256' || Number(challenge.parameters.cost) !== 1) return 'malformed';
    let r;
    try {
        r = await verifySolution({ challenge, solution, deriveKey, hmacSignatureSecret: hmacKey(), hmacKeySignatureSecret: hmacKey() + ':key' });
    } catch { return 'malformed'; }
    if (r.expired) return 'expired';
    if (!r.verified) return 'invalid';
    return (await firstUse(challenge.signature)) ? 'valid' : 'replay';
}

// ---- counts ----
interface Row { day: string; action: string; outcome: RobotOutcome; client: string; browser: string; android: string; signedIn: boolean; count: number }
const buffer = new Map<string, Row>();
export const robotStats = { checked: 0, refused: 0, flushed: 0, dropped: 0 };
const HARD_CAP = 5_000;

const header = (req: Request, name: string): string => {
    const v = req.headers[name];
    return typeof v === 'string' ? v : Array.isArray(v) ? v[0] ?? '' : '';
};

function count(req: Request, action: string, outcome: RobotOutcome, userId: string | null) {
    const { browser, android } = browserOf(header(req, 'user-agent'));
    const client = header(req, 'x-sbc-client');
    const row: Row = { day: doualaDay(Date.now()), action, outcome, client: client === 'web' || client === 'app' ? client : 'none', browser, android, signedIn: !!userId, count: 1 };
    const key = [row.day, row.action, row.outcome, row.client, row.browser, row.android, row.signedIn].join('|');
    const cur = buffer.get(key);
    if (cur) cur.count++;
    else if (buffer.size < HARD_CAP) buffer.set(key, row);
    else robotStats.dropped++;
    robotStats.checked++;
    if (userId && (outcome === 'invalid' || outcome === 'replay')) {
        log.warn(`Robot check ${outcome} on ${action} [${browser}]`);
        noteRobotAutomation(userId, row.day);
    }
}

export async function flushRobotChecks(): Promise<void> {
    if (!buffer.size) return;
    const rows = [...buffer.values()];
    buffer.clear();
    try {
        const r = await fetch(`${config.services.userServiceUrl}/api/users/internal/robot-checks/batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.services.serviceSecret}`, 'X-Service-Name': 'gateway-service' },
            body: JSON.stringify({ rows }),
            signal: AbortSignal.timeout(10_000),
        });
        if (!r.ok) throw new Error(`user-service answered ${r.status}`);
        robotStats.flushed += rows.length;
    } catch (err: any) {
        robotStats.dropped += rows.length;
        log.warn(`Robot checks: ${rows.length} row(s) dropped (${err?.message ?? err}).`);
    }
}

let timer: NodeJS.Timeout | null = null;
export function startRobotChecksFlush(): void {
    if (timer) return;
    timer = setInterval(() => { void flushRobotChecks(); }, 60_000);
    timer.unref();
}

const memberOf = (req: Request): string | null => {
    const auth = header(req, 'authorization');
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token || token === config.services.serviceSecret) return null;
    const c = verifyToken(token, config.jwt.secret);
    const id = String(c?.userId || c?.id || '');
    return /^[a-f0-9]{24}$/i.test(id) ? id : null;
};

/** Checks the answer on protected actions; refuses only in enforce mode. */
export const robotCheck = async (req: Request, res: Response, next: NextFunction) => {
    const mode = robotCheckMode();
    if (mode === 'off' || !robotCheckReady()) return next();
    const action = actionFor(req.method, req.originalUrl);
    if (!action) return next();
    let outcome: RobotOutcome = 'malformed';
    try { outcome = await checkAnswer(header(req, 'x-sbc-altcha')); } catch { outcome = 'malformed'; }
    try { count(req, action, outcome, memberOf(req)); } catch { /* counting never blocks */ }
    if (mode === 'enforce' && outcome !== 'valid') {
        robotStats.refused++;
        return res.status(403).json({ success: false, code: 'ROBOT_CHECK_FAILED', message: 'La vérification de sécurité a échoué. Rechargez la page puis réessayez.' });
    }
    return next();
};

export const _robotBuffer = buffer;


/**
 * Security plan Phase 4 (2026-11-22): a member doing a protected action (the same list: sign-in,
 * withdrawal, payout or contact change, authenticator setup…) through Tor goes to the fraud engine
 * (rule tor_network). Cloudflare marks Tor exit nodes with the country T1, which ipGeo keeps.
 * Always on, whatever ROBOT_CHECK says; no I/O on the request (the feed flushes every minute).
 */
export const torSignal = (req: Request, _res: Response, next: NextFunction) => {
    try {
        if (header(req, 'x-sbc-geo').trim().toUpperCase() === 'T1' && actionFor(req.method, req.originalUrl)) {
            const userId = memberOf(req);
            if (userId) noteTorUse(userId, doualaDay(Date.now()));
        }
    } catch { /* a signal never blocks */ }
    next();
};
