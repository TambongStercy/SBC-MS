/*
 * Security plan, Phase 0 item 6: the load-test baseline. PREPROD ONLY.
 *
 * Four member journeys, each its own k6 scenario at a constant arrival rate:
 *   browse    — signed-in pages: profile, wallet, history, filleuls, notifications, settings
 *   login     — the password step of sign-in (it emails a code: see README)
 *   deposit   — start a pack payment and open the payment page (no provider call)
 *   withdraw  — check the withdrawal limits (no withdrawal is created)
 *
 * Run once at 1x and once at 10x today's peak, and keep both summaries: every
 * later phase is compared with them (p95 per endpoint, error rate < 0.5% at 10x).
 *
 *   k6 run -e BASE_URL=https://preprod.sniperbuisnesscenter.com \
 *          -e JWT_SECRET=<preprod user-service JWT_SECRET> \
 *          -e USERS_FILE=./users.json -e MULT=1 \
 *          --summary-export=baseline-1x.json scripts/security-plan/k6/baseline.js
 *
 * Rates are requests per second at 1x (today's peak, from the nginx logs):
 * BROWSE_RPS, LOGIN_RPS, DEPOSIT_RPS, WITHDRAW_RPS; MULT multiplies them all.
 * SCENARIOS=browse,deposit runs only those. DURATION=5m by default.
 */

import http from 'k6/http';
import { check } from 'k6';
import { SharedArray } from 'k6/data';
import { mintToken } from './lib.js';

const BASE = (__ENV.BASE_URL || '').replace(/\/+$/, '');
if (!BASE) throw new Error('BASE_URL is required (preprod).');
// Never against production: this sends thousands of requests and starts payments.
if (/^https?:\/\/(www\.|admin\.)?sniperbuisnesscenter\.com/i.test(BASE)) {
    throw new Error(`Refusing to load-test production (${BASE}). Use preprod.`);
}
const API = `${BASE}/api`;
const SECRET = __ENV.JWT_SECRET || '';
const MULT = Number(__ENV.MULT || 1);
const DURATION = __ENV.DURATION || '5m';
const ONLY = (__ENV.SCENARIOS || 'browse,login,deposit,withdraw').split(',').map(s => s.trim());

/** [{ id, email, role? , password? }] from preprod (see README for the query). */
const users = new SharedArray('users', () => JSON.parse(open(__ENV.USERS_FILE || './users.json')));
const pick = () => users[Math.floor(Math.random() * users.length)];

const rate = (name, dflt) => Math.max(1, Math.round(Number(__ENV[name] || dflt) * MULT));
const scenario = (exec, rps) => ({
    executor: 'constant-arrival-rate',
    exec,
    rate: rps,
    timeUnit: '1s',
    duration: DURATION,
    preAllocatedVUs: Math.max(10, rps * 2),
    maxVUs: Math.max(50, rps * 10),
});

const all = {
    browse: scenario('browse', rate('BROWSE_RPS', 20)),
    login: scenario('login', rate('LOGIN_RPS', 2)),
    deposit: scenario('deposit', rate('DEPOSIT_RPS', 3)),
    withdraw: scenario('withdraw', rate('WITHDRAW_RPS', 1)),
};

export const options = {
    scenarios: Object.fromEntries(Object.entries(all).filter(([k]) => ONLY.includes(k))),
    thresholds: {
        // The plan's gate at 10x; at 1x it should pass with room to spare.
        http_req_failed: ['rate<0.005'],
        'http_req_duration{journey:browse}': ['p(95)<800'],
        'http_req_duration{journey:login}': ['p(95)<1500'],
        'http_req_duration{journey:deposit}': ['p(95)<1500'],
        'http_req_duration{journey:withdraw}': ['p(95)<1000'],
    },
    summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const authed = (u) => ({ headers: { Authorization: `Bearer ${mintToken(u, SECRET)}`, 'Content-Type': 'application/json' } });
const tag = (journey, endpoint) => ({ tags: { journey, endpoint } });
const merge = (a, b) => ({ ...a, ...b, headers: { ...(a.headers || {}), ...(b.headers || {}) } });
// Refusals the member can legitimately get (no pack, limit, lock) are not errors of the platform.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }, 400, 401, 403, 409, 429));

export function browse() {
    const u = pick();
    const o = authed(u);
    const get = (path, endpoint) => {
        const r = http.get(`${API}${path}`, merge(o, tag('browse', endpoint)));
        check(r, { [`${endpoint} answered`]: x => x.status > 0 && x.status < 500 });
    };
    get('/users/me', 'users/me');
    get('/wallet/me', 'wallet/me');
    get('/transactions/history?page=1&limit=10', 'transactions/history');
    get('/users/get-refered-users?page=1&limit=10', 'users/get-refered-users');
    get('/notifications/me', 'notifications/me');
    const s = http.get(`${API}/settings`, tag('browse', 'settings'));
    check(s, { 'settings answered': x => x.status === 200 });
}

export function login() {
    // Only accounts with a known test password (README): others would just be refused.
    const candidates = users.filter(u => u.password);
    if (!candidates.length) return;
    const u = candidates[Math.floor(Math.random() * candidates.length)];
    const r = http.post(`${API}/users/login`, JSON.stringify({ email: u.email, password: u.password }),
        { headers: { 'Content-Type': 'application/json' }, ...tag('login', 'users/login') });
    check(r, { 'login answered': x => x.status > 0 && x.status < 500 });
}

export function deposit() {
    const u = pick();
    const o = authed(u);
    const r = http.post(`${API}/subscriptions/purchase`, JSON.stringify({ planType: 'CLASSIQUE' }), merge(o, tag('deposit', 'subscriptions/purchase')));
    check(r, { 'purchase answered': x => x.status > 0 && x.status < 500 });
    let sessionId = '';
    try {
        const d = r.json('data') || {};
        sessionId = d.sessionId || (d.paymentIntent && d.paymentIntent.sessionId) || '';
        if (!sessionId && typeof d.paymentUrl === 'string') sessionId = (d.paymentUrl.match(/\/page\/([^/?#]+)/) || [])[1] || '';
    } catch (e) { /* refused: no pack to buy, already owned */ }
    if (!sessionId) return;
    const page = http.get(`${API}/payments/page/${sessionId}`, tag('deposit', 'payments/page'));
    check(page, { 'payment page served': x => x.status === 200 });
    const st = http.get(`${API}/payments/intents/${sessionId}/status`, tag('deposit', 'payments/intents/status'));
    check(st, { 'status answered': x => x.status > 0 && x.status < 500 });
}

export function withdraw() {
    const u = pick();
    const r = http.post(`${API}/users/withdrawal-limits/check`, JSON.stringify({ amount: 1000 }), merge(authed(u), tag('withdraw', 'users/withdrawal-limits/check')));
    check(r, { 'limits answered': x => x.status > 0 && x.status < 500 });
}
