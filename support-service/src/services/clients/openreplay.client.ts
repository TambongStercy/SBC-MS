import config from '../../config';
import logger from '../../utils/logger';

/**
 * Self-hosted OpenReplay (replay.sniperbusinesscenter.com, secondary server), read with a
 * dedicated OpenReplay member account (OPENREPLAY_API_EMAIL / _PASSWORD): never an agent's.
 * The community edition has no API keys for sessions, so this signs in like the dashboard
 * and keeps the token (renewed on a 401 or after 12 h).
 *
 * - recorded sessions of a member: POST /v2/api/{project}/sessions/search, filter `user_id`
 *   (the camelCase `userId` filter breaks on ClickHouse 26 in v1.28.0);
 * - live sessions of a member: GET /api/{project}/assist/sessions?userID= (capital ID: `userId`
 *   is silently ignored and returns nothing, checked on preprod 2026-11-23).
 */

const log = logger.getLogger('OpenReplay');
const TOKEN_TTL_MS = 12 * 3600 * 1000;
let token: { jwt: string; at: number } | null = null;

export const openReplayApiEnabled = () => Boolean(
    config.openreplay.dashboardUrl && config.openreplay.projectId && config.openreplay.apiEmail && config.openreplay.apiPassword,
);

async function call(method: 'GET' | 'POST', path: string, body?: unknown, jwt?: string): Promise<{ status: number; json: any }> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), config.openreplay.timeoutMs);
    try {
        const res = await fetch(`${config.openreplay.dashboardUrl}${path}`, {
            method,
            headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: ctl.signal,
        });
        let json: any = null;
        try { json = await res.json(); } catch { json = null; }
        return { status: res.status, json };
    } finally {
        clearTimeout(timer);
    }
}

async function signIn(): Promise<string> {
    const r = await call('POST', '/api/login', { email: config.openreplay.apiEmail, password: config.openreplay.apiPassword });
    const jwt = r.json?.jwt;
    if (typeof jwt !== 'string' || !jwt) {
        log.warn(`OpenReplay sign-in refused (HTTP ${r.status}).`);
        throw new Error('OPENREPLAY_SIGNIN_FAILED');
    }
    token = { jwt, at: Date.now() };
    return jwt;
}

async function authed(method: 'GET' | 'POST', path: string, body?: unknown): Promise<any> {
    let jwt = token && Date.now() - token.at < TOKEN_TTL_MS ? token.jwt : await signIn();
    let r = await call(method, path, body, jwt);
    if (r.status === 401 || r.status === 403) {
        jwt = await signIn();
        r = await call(method, path, body, jwt);
    }
    if (r.status >= 400 || r.json?.errors) {
        log.warn(`OpenReplay ${method} ${path.split('?')[0]} → HTTP ${r.status}`);
        throw new Error('OPENREPLAY_REQUEST_FAILED');
    }
    return r.json?.data;
}

export type ReplaySession = {
    sessionId: string;
    startedAt: string | null;
    durationMs: number | null;
    pages: number | null;
    device: string | null;
    live: boolean;
};

const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function present(s: any, live: boolean): ReplaySession | null {
    const id = str(s?.sessionId ?? s?.sessionID);
    if (!id || !/^\d{1,30}$/.test(id)) return null;
    const ts = num(s?.startTs ?? s?.timestamp);
    return {
        sessionId: id,
        startedAt: ts ? new Date(ts).toISOString() : null,
        durationMs: num(s?.duration),
        pages: num(s?.pagesCount),
        device: [s?.userOs, s?.userBrowser, s?.userDeviceType].filter((x: unknown) => typeof x === 'string' && x).join(' · ') || null,
        live,
    };
}

/** The member's recordings of the last `days` days, newest first. */
export async function recordedSessions(userId: string, days = 30, limit = 20): Promise<ReplaySession[]> {
    const now = Date.now();
    const data = await authed('POST', `/v2/api/${config.openreplay.projectId}/sessions/search`, {
        startTimestamp: now - days * 86400_000, endTimestamp: now,
        filters: [{ name: 'user_id', value: [userId], operator: 'is', isEvent: false }],
        sort: 'startTs', order: 'desc', limit, page: 1,
    });
    return (Array.isArray(data?.sessions) ? data.sessions : []).map((s: any) => present(s, false)).filter(Boolean) as ReplaySession[];
}

/** The member's sessions open right now (the app is on screen). */
export async function liveSessions(userId: string): Promise<ReplaySession[]> {
    const data = await authed('GET', `/api/${config.openreplay.projectId}/assist/sessions?userID=${encodeURIComponent(userId)}`);
    return (Array.isArray(data?.sessions) ? data.sessions : []).map((s: any) => present(s, true)).filter(Boolean) as ReplaySession[];
}

/** Dashboard links: a recording, or the live view (where the agent asks for control). */
export const recordingUrl = (sessionId: string) => `${config.openreplay.dashboardUrl}/${config.openreplay.projectId}/session/${sessionId}`;
export const liveUrl = (sessionId: string) => `${config.openreplay.dashboardUrl}/${config.openreplay.projectId}/assist/${sessionId}`;

/** For tests. */
export function resetOpenReplayTokenForTests(): void { token = null; }
