import { randomUUID } from 'crypto';
import axios from 'axios';
import mongoose, { Types } from 'mongoose';
import UserModel, { DormancyStatus } from '../database/models/user.model';
import WalletMovementModel from '../database/models/wallet-movement.model';
import { MemberAuthModel } from '../database/models/member-auth.model';
import { UserGeoDayModel } from '../database/models/user-geo-day.model';
import { SessionKeyModel } from '../database/models/session-key.model';
import { DormancyExportModel, DormancyReturnModel, DormancySnapshotModel } from '../database/models/dormancy.model';
import { dormancyConfig } from '../config/dormancy';
import config from '../config';
import { doualaDay } from './activity-signals.service';
import { countryCondition, isoOfCountryValue } from '../utils/country-filter';
import { openSupportCase } from './clients/support.service.client';
import logger from '../utils/logger';

const log = logger.getLogger('Dormancy');

/**
 * Security plan Phase 7: dormant accounts.
 *
 * Nightly pass (jobs/dormancy.job.ts): every account holding money in any of
 * the six balances gets `dormancy.status` from its last sign of life:
 *   active (< 90 days), inactive (90–180), dormant (180–365), long_dormant (365+)
 * plus its total in XAF, the "commissions but no sign-in" flag, its last
 * commission and withdrawal (wallet ledger), authenticator and fraud flags.
 * Then one snapshot (dormancy_snapshots) that the admin page reads.
 *
 * Last sign of life = the latest of: dormancy.lastSignInAt (every member
 * sign-in from this release), the issue time of the stored token (the last
 * sign-in before it, until a logout clears it), lastActiveAt / lastLoginAt
 * (Phase 1 signals, consenting members only), ipLastUpdated, createdAt.
 * Before this release the only dates are the token and ipLastUpdated (set at
 * sign-up), so the figures firm up as sign-ins accumulate: the hold stays in
 * log mode until they cover at least 30 days.
 *
 * Coming back: the first sign-in of a dormant / long_dormant account
 * (noteSignIn) makes it active again and, with DORMANCY_REACTIVATION_HOLD=on,
 * holds withdrawals 72 h (utils/withdrawal-lock.ts reads dormancy.holdUntil)
 * and opens a dormant_reactivation case when it comes with a new country, a
 * new device or a recent contact change. A contact change during the hold
 * opens one too (watchHolds).
 */

export const BALANCE_FIELDS = ['balance', 'usdBalance', 'activationBalance', 'advertisingBalance', 'eventOrganizerBalance', 'sbcLiveBalance'] as const;
export type BalanceField = typeof BALANCE_FIELDS[number];
export const DORMANT_SET: DormancyStatus[] = ['inactive', 'dormant', 'long_dormant'];
const CONTACT_REASONS = ['email_change', 'phone_change', 'momo_change', 'crypto_change'];
export const SIZE_BUCKETS = [
    { key: 'lt5k', label: '< 5 000', max: 5_000 },
    { key: '5k_50k', label: '5 000 – 50 000', max: 50_000 },
    { key: '50k_200k', label: '50 000 – 200 000', max: 200_000 },
    { key: 'gt200k', label: '> 200 000', max: Infinity },
] as const;

const DAY_MS = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;
const pos = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

// ---------------------------------------------------------------- pure parts

/** Issue time of a JWT (no signature check: it is our own stored token, read for its date only). */
export function tokenIssuedAt(token: unknown): Date | null {
    if (typeof token !== 'string') return null;
    const part = token.split('.')[1];
    if (!part) return null;
    try {
        const iat = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))?.iat;
        return Number.isFinite(iat) && iat > 0 ? new Date(iat * 1000) : null;
    } catch { return null; }
}

export function lastSignOfLife(u: any): { at: Date; basis: string } {
    const candidates: [string, unknown][] = [
        ['signin', u?.dormancy?.lastSignInAt],
        ['token', tokenIssuedAt(u?.token)],
        ['activity', u?.lastActiveAt],
        ['activity', u?.lastLoginAt],
        ['ip', u?.ipLastUpdated],
        ['created', u?.createdAt],
    ];
    let best: { at: Date; basis: string } = { at: new Date(0), basis: 'none' };
    for (const [basis, v] of candidates) {
        if (!v) continue;
        const d = new Date(v as any);
        if (!Number.isNaN(d.getTime()) && d > best.at) best = { at: d, basis };
    }
    return best;
}

export function statusFor(lastSeen: Date, now: Date, cfg = dormancyConfig()): DormancyStatus {
    const days = (now.getTime() - lastSeen.getTime()) / DAY_MS;
    if (days < cfg.inactiveDays) return 'active';
    if (days < cfg.dormantDays) return 'inactive';
    if (days < cfg.longDormantDays) return 'dormant';
    return 'long_dormant';
}

export function balancesOf(u: any): Record<BalanceField, number> {
    const out = {} as Record<BalanceField, number>;
    for (const f of BALANCE_FIELDS) out[f] = pos(u?.[f]);
    return out;
}

/** Everything the account holds, in XAF (USD at the configured rate). */
export function heldXafOf(b: Record<BalanceField, number>, xafPerUsd: number): number {
    return round2(b.balance + b.activationBalance + b.advertisingBalance + b.eventOrganizerBalance + b.sbcLiveBalance + b.usdBalance * xafPerUsd);
}

export const sizeBucket = (xaf: number) => SIZE_BUCKETS.find(s => xaf < s.max)!.key;

// ---------------------------------------------------------------- risk flags

/** Members the fraud engine scores require_code / hold. Null when it cannot be asked (flags kept as they were). */
async function riskFlags(userIds: string[]): Promise<Set<string> | null> {
    const base = (process.env.RISK_SERVICE_URL || '').replace(/\/$/, '');
    if (!base || !userIds.length) return null;
    try {
        const res = await axios.post(`${base}/api/risk/internal/members/flags`, { userIds }, {
            timeout: 5000,
            headers: { Authorization: `Bearer ${config.services.serviceSecret}`, 'x-service-name': 'user-service' },
        });
        const list: any[] = res.data?.data ?? [];
        return new Set(list.filter(r => r?.decision === 'hold' || r?.decision === 'require_code').map(r => String(r.userId)));
    } catch (err: any) {
        log.warn(`Risk flags unavailable (${err?.response?.status ?? err?.message}); fraud flags keep their last value`);
        return null;
    }
}

// ---------------------------------------------------------------- nightly pass

type Tot = { count: number; xaf: number; usd: number; xafEq: number };
const tot = (): Tot => ({ count: 0, xaf: 0, usd: 0, xafEq: 0 });
function add(t: Tot, b: Record<BalanceField, number>, xafEq: number) {
    t.count += 1;
    t.xaf += b.balance + b.activationBalance + b.advertisingBalance + b.eventOrganizerBalance + b.sbcLiveBalance;
    t.usd += b.usdBalance;
    t.xafEq += xafEq;
}
const roundTot = (t: Tot): Tot => ({ count: t.count, xaf: round2(t.xaf), usd: round2(t.usd), xafEq: round2(t.xafEq) });

const MONEY_FILTER = { $or: BALANCE_FIELDS.map(f => ({ [f]: { $gt: 0 } })) };
const PASS_FIELDS = ['_id', 'country', 'createdAt', 'lastActiveAt', 'lastLoginAt', 'ipLastUpdated', 'frozen', 'dormancy', ...BALANCE_FIELDS].join(' ') + ' +token';

export interface PassResult { runId: string; day: string; accounts: number; dormant: number; ms: number; checkOk: boolean }

let passRunning = false;

/** One full pass. Safe to run again: each account is rewritten, accounts no longer holding money lose their status. */
export async function runDormancyPass(now: Date = new Date(), opts: { batch?: number } = {}): Promise<PassResult | null> {
    if (passRunning) return null;
    passRunning = true;
    const started = Date.now();
    const wallStart = new Date(started);
    try {
        const cfg = dormancyConfig();
        const runId = randomUUID();
        const day = doualaDay(now);
        const batchSize = opts.batch ?? 1000;
        const commissionSince = new Date(now.getTime() - cfg.commissionWindowDays * DAY_MS);

        const all = tot();
        const byStatus: Record<string, Tot> = Object.fromEntries((['active', ...DORMANT_SET] as string[]).map(s => [s, tot()]));
        const dorm = tot();
        const byBalance: Record<string, number> = Object.fromEntries(BALANCE_FIELDS.map(f => [f, 0]));
        const byCountry: Record<string, Tot> = {};
        const bySize: Record<string, Tot> = Object.fromEntries(SIZE_BUCKETS.map(s => [s.key, tot()]));
        const flags = { commissionsNoLogin: tot(), fraudFlag: tot(), checked: tot(), noAuthenticator: tot(), neverWithdrew: tot() };
        const basis: Record<string, number> = {};
        const belowMin = tot();

        const cursor = UserModel.find(MONEY_FILTER).select(PASS_FIELDS).lean().cursor({ batchSize });
        let batch: any[] = [];
        const flush = async () => {
            if (!batch.length) return;
            const ids = batch.map(u => u._id as Types.ObjectId);
            const idStrings = ids.map(String);
            const [moves, auths, risk] = await Promise.all([
                WalletMovementModel.aggregate([
                    { $match: { userId: { $in: ids }, status: 'APPLIED' } },
                    {
                        $group: {
                            _id: '$userId',
                            lastCommissionAt: { $max: { $cond: [{ $and: [{ $eq: ['$direction', 'CREDIT'] }, { $eq: ['$source', 'commission'] }] }, '$appliedAt', null] } },
                            lastWithdrawalAt: {
                                $max: {
                                    $cond: [{
                                        $and: [{ $eq: ['$direction', 'DEBIT'] }, {
                                            $or: [
                                                { $regexMatch: { input: '$source', regex: /^withdrawal/ } },
                                                { $regexMatch: { input: '$reference', regex: /^withdrawal:/ } },
                                            ],
                                        }],
                                    }, '$appliedAt', null],
                                },
                            },
                        },
                    },
                ]),
                MemberAuthModel.find({ userId: { $in: ids }, totpEnrolledAt: { $ne: null }, totpSecretEnc: { $ne: null } }, { userId: 1 }).lean(),
                riskFlags(idStrings),
            ]);
            const moveBy = new Map(moves.map((m: any) => [String(m._id), m]));
            const authSet = new Set(auths.map((a: any) => String(a.userId)));
            const ops: any[] = [];
            for (const u of batch) {
                const id = String(u._id);
                const seen = lastSignOfLife(u);
                const status = statusFor(seen.at, now, cfg);
                const b = balancesOf(u);
                const xafEq = heldXafOf(b, cfg.xafPerUsd);
                add(all, b, xafEq);
                // Under the minimum: part of the member total, never a status (the unset below clears an old one).
                if (xafEq < cfg.minXaf) { add(belowMin, b, xafEq); continue; }
                const mv = moveBy.get(id);
                const lastCommissionAt: Date | null = mv?.lastCommissionAt ?? null;
                const lastWithdrawalAt: Date | null = mv?.lastWithdrawalAt ?? null;
                const commissionsNoLogin = status !== 'active' && !!lastCommissionAt && lastCommissionAt >= commissionSince;
                const fraudFlag = !!u.frozen?.at || (risk ? risk.has(id) : !!u.dormancy?.fraudFlag);
                const authenticator = authSet.has(id);

                add(byStatus[status], b, xafEq);
                basis[seen.basis] = (basis[seen.basis] ?? 0) + 1;
                if (status !== 'active') {
                    add(dorm, b, xafEq);
                    for (const f of BALANCE_FIELDS) byBalance[f] += f === 'usdBalance' ? b[f] * cfg.xafPerUsd : b[f];
                    const cc = isoOfCountryValue(u.country) ?? 'XX';
                    add(byCountry[cc] ??= tot(), b, xafEq);
                    add(bySize[sizeBucket(xafEq)], b, xafEq);
                    if (commissionsNoLogin) add(flags.commissionsNoLogin, b, xafEq);
                    if (fraudFlag) add(flags.fraudFlag, b, xafEq);
                    if (u.dormancy?.checkedAt) add(flags.checked, b, xafEq);
                    if (!authenticator) add(flags.noAuthenticator, b, xafEq);
                    if (!lastWithdrawalAt) add(flags.neverWithdrew, b, xafEq);
                }
                ops.push({
                    updateOne: {
                        // A sign-in since the pass began wins: its account is already active.
                        filter: { _id: u._id, $nor: [{ 'dormancy.lastSignInAt': { $gte: wallStart } }] },
                        update: {
                            $set: {
                                'dormancy.status': status,
                                'dormancy.lastSeenAt': seen.at,
                                'dormancy.basis': seen.basis,
                                'dormancy.heldXaf': xafEq,
                                'dormancy.commissionsNoLogin': commissionsNoLogin,
                                'dormancy.lastCommissionAt': lastCommissionAt,
                                'dormancy.lastWithdrawalAt': lastWithdrawalAt,
                                'dormancy.authenticator': authenticator,
                                'dormancy.fraudFlag': fraudFlag,
                                'dormancy.computedAt': now,
                                'dormancy.runId': runId,
                            },
                        },
                    },
                });
            }
            // Raw collection: no soft-delete or casting hooks, and a member signing in meanwhile
            // only loses this night's status (the next pass sees the sign-in).
            if (ops.length) await UserModel.collection.bulkWrite(ops, { ordered: false });
            batch = [];
        };
        for await (const u of cursor) {
            batch.push(u);
            if (batch.length >= batchSize) await flush();
        }
        await flush();

        // Accounts that no longer hold money, hold less than the minimum, or were deleted leave the list. Sign-in date, check and hold stay.
        const stale = await UserModel.collection.updateMany(
            { 'dormancy.status': { $exists: true }, 'dormancy.runId': { $ne: runId }, $nor: [{ 'dormancy.lastSignInAt': { $gte: wallStart } }] },
            { $unset: { 'dormancy.status': '', 'dormancy.heldXaf': '', 'dormancy.runId': '', 'dormancy.commissionsNoLogin': '', 'dormancy.fraudFlag': '' } },
        );
        // Deleted accounts were not read (soft-delete hook) but may still carry this run's id from nowhere: none.
        // Deleted ones still holding money keep no status: the find above skipped them, the unset above cleared them.

        const countries = Object.entries(byCountry).sort((a, b) => b[1].xafEq - a[1].xafEq);
        const snapshot = {
            runId, at: now, durationMs: Date.now() - started,
            thresholds: { inactiveDays: cfg.inactiveDays, dormantDays: cfg.dormantDays, longDormantDays: cfg.longDormantDays, minXaf: cfg.minXaf },
            xafPerUsd: cfg.xafPerUsd,
            all: roundTot(all),
            belowMin: roundTot(belowMin),
            byStatus: Object.fromEntries(Object.entries(byStatus).map(([k, v]) => [k, roundTot(v)])),
            dormant: {
                ...roundTot(dorm),
                byBalance: Object.fromEntries(Object.entries(byBalance).map(([k, v]) => [k, round2(v)])),
                byCountry: countries.map(([country, t]) => ({ country, ...roundTot(t) })),
                bySize: SIZE_BUCKETS.map(s => ({ key: s.key, label: s.label, ...roundTot(bySize[s.key]) })),
                flags: Object.fromEntries(Object.entries(flags).map(([k, v]) => [k, roundTot(v)])),
                basis,
            },
        };
        const check = await checkCardAgainstList(runId, snapshot.dormant, wallStart);
        await DormancySnapshotModel.updateOne({ _id: day }, { $set: { ...snapshot, check } }, { upsert: true });
        resetDormancySummaryCache();
        if (!check.ok) log.error(`Dormancy check: card ${check.card.count} / ${check.card.xafEq} F ≠ list ${check.list.count} / ${check.list.xafEq} F (run ${runId})`);
        await clearOldExports(now);
        const r = { runId, day, accounts: all.count, dormant: dorm.count, ms: Date.now() - started, checkOk: check.ok };
        log.info(`Dormancy pass ${day}: ${r.accounts} accounts holding money (${belowMin.count} under ${cfg.minXaf} F), ${r.dormant} inactive 90+ days (${round2(dorm.xafEq)} F), ${stale.modifiedCount} left the list, ${r.ms} ms, check ${check.ok ? 'ok' : 'FAILED'}`);
        return r;
    } finally {
        passRunning = false;
    }
}

/**
 * The headline card (added up during the pass) against the list's own query
 * over the stored fields. They must agree exactly, except for members who came
 * back during the pass: they left the list after being counted in the card.
 */
async function checkCardAgainstList(runId: string, card: Tot, since: Date) {
    const [r] = await UserModel.collection.aggregate([
        { $match: { 'dormancy.status': { $in: DORMANT_SET }, 'dormancy.runId': runId, deleted: { $ne: true } } },
        { $group: { _id: null, count: { $sum: 1 }, xafEq: { $sum: '$dormancy.heldXaf' } } },
    ]).toArray();
    const list = { count: r?.count ?? 0, xafEq: round2(r?.xafEq ?? 0) };
    const cameBack = await UserModel.collection.countDocuments({ 'dormancy.lastSignInAt': { $gte: since }, 'dormancy.runId': { $ne: runId } });
    const gap = card.count - list.count;
    const ok = gap === 0 ? Math.abs(card.xafEq - list.xafEq) < 1 : gap > 0 && gap <= cameBack && list.xafEq <= card.xafEq + 1;
    return { ok, card: { count: card.count, xafEq: round2(card.xafEq) }, list, cameBackDuringPass: cameBack, at: new Date() };
}

// ---------------------------------------------------------------- admin: summary

let summaryCache: { at: number; data: any } | null = null;
export const resetDormancySummaryCache = () => { summaryCache = null; };

export async function dormancySummary(now: Date = new Date()) {
    if (summaryCache && Date.now() - summaryCache.at < 60_000) return summaryCache.data;
    const latest: any = await DormancySnapshotModel.findOne({}).sort({ _id: -1 }).lean();
    if (!latest) return { ready: false }; // not cached: the first pass shows as soon as it ends
    const monthAgo = doualaDay(new Date(new Date(`${latest._id}T12:00:00Z`).getTime() - 30 * DAY_MS));
    const [previous, first, trend] = await Promise.all([
        DormancySnapshotModel.findOne({ _id: { $lte: monthAgo } }).sort({ _id: -1 }).select('_id dormant.count dormant.xafEq all.xafEq').lean(),
        DormancySnapshotModel.findOne({}).sort({ _id: 1 }).select('_id').lean(),
        DormancySnapshotModel.aggregate([
            { $sort: { _id: 1 } },
            { $group: { _id: { $substrBytes: ['$_id', 0, 7] }, day: { $last: '$_id' }, count: { $last: '$dormant.count' }, xafEq: { $last: '$dormant.xafEq' }, allXafEq: { $last: '$all.xafEq' } } },
            { $sort: { _id: -1 } },
            { $limit: 12 },
            { $sort: { _id: 1 } },
        ]),
    ]);
    const cfg = dormancyConfig();
    const since = (first as any)?._id ?? latest._id;
    const sinceDays = Math.round((new Date(`${latest._id}T00:00:00Z`).getTime() - new Date(`${since}T00:00:00Z`).getTime()) / DAY_MS);
    const data = {
        ready: true,
        day: latest._id,
        at: latest.at,
        thresholds: latest.thresholds,
        xafPerUsd: latest.xafPerUsd,
        all: latest.all,
        belowMin: latest.belowMin ?? null,
        byStatus: latest.byStatus,
        dormant: latest.dormant,
        share: latest.all?.xafEq ? round2((latest.dormant?.xafEq ?? 0) / latest.all.xafEq) : 0,
        previous: previous ? { day: (previous as any)._id, count: (previous as any).dormant?.count ?? 0, xafEq: (previous as any).dormant?.xafEq ?? 0 } : null,
        trend: trend.map((t: any) => ({ month: t._id, day: t.day, count: t.count ?? 0, xafEq: t.xafEq ?? 0, allXafEq: t.allXafEq ?? 0 })),
        check: latest.check,
        reliability: { since, days: sinceDays, holdMode: cfg.holdMode, holdHours: cfg.holdHours },
    };
    summaryCache = { at: Date.now(), data };
    return data;
}

// ---------------------------------------------------------------- admin: list

export interface DormantFilters {
    status?: DormancyStatus | null;
    country?: string | null;
    minXaf?: number | null;
    authenticator?: boolean | null;
    withdrawal?: 'never' | 'over_90d' | 'within_90d' | null;
    fraud?: boolean | null;
    checked?: boolean | null;
    commissionsNoLogin?: boolean | null;
}

const STATUS_RE = /^(inactive|dormant|long_dormant)$/;
const yesNo = (v: unknown): boolean | null => (v === 'yes' || v === 'true' ? true : v === 'no' || v === 'false' ? false : null);

/** Query string → filters (anything unknown is ignored). */
export function parseDormantFilters(q: Record<string, unknown>): DormantFilters {
    const s = (k: string) => (typeof q[k] === 'string' ? (q[k] as string).trim() : '');
    const min = Number(s('minXaf'));
    const w = s('withdrawal');
    return {
        status: STATUS_RE.test(s('status')) ? (s('status') as DormancyStatus) : null,
        country: /^[A-Za-z]{2}$/.test(s('country')) ? s('country').toUpperCase() : null,
        minXaf: Number.isFinite(min) && min > 0 ? min : null,
        authenticator: yesNo(s('authenticator')),
        withdrawal: w === 'never' || w === 'over_90d' || w === 'within_90d' ? w : null,
        fraud: yesNo(s('fraud')),
        checked: yesNo(s('checked')),
        commissionsNoLogin: yesNo(s('commissionsNoLogin')),
    };
}

async function matchFor(f: DormantFilters, now: Date = new Date()): Promise<Record<string, any>> {
    const m: Record<string, any> = { 'dormancy.status': f.status ? f.status : { $in: DORMANT_SET } };
    if (f.country) m.country = f.country === 'XX' ? { $in: [null, ''] } : await countryCondition(f.country);
    if (f.minXaf) m['dormancy.heldXaf'] = { $gte: f.minXaf };
    if (f.authenticator !== null && f.authenticator !== undefined) m['dormancy.authenticator'] = f.authenticator;
    if (f.fraud !== null && f.fraud !== undefined) m['dormancy.fraudFlag'] = f.fraud;
    if (f.checked !== null && f.checked !== undefined) m['dormancy.checkedAt'] = f.checked ? { $ne: null } : null;
    if (f.commissionsNoLogin) m['dormancy.commissionsNoLogin'] = true;
    const d90 = new Date(now.getTime() - 90 * DAY_MS);
    if (f.withdrawal === 'never') m['dormancy.lastWithdrawalAt'] = null;
    if (f.withdrawal === 'over_90d') m['dormancy.lastWithdrawalAt'] = { $lt: d90 };
    if (f.withdrawal === 'within_90d') m['dormancy.lastWithdrawalAt'] = { $gte: d90 };
    return m;
}

const ROW_FIELDS = ['_id', 'name', 'email', 'phoneNumber', 'country', 'frozen', 'debt', 'dormancy', ...BALANCE_FIELDS].join(' ');

export function rowOf(u: any) {
    const d = u.dormancy ?? {};
    return {
        _id: String(u._id),
        name: u.name ?? '',
        email: u.email ?? '',
        phoneNumber: u.phoneNumber ?? '',
        country: isoOfCountryValue(u.country) ?? (u.country || ''),
        status: d.status ?? null,
        lastSeenAt: d.lastSeenAt ?? null,
        basis: d.basis ?? null,
        balances: balancesOf(u),
        debt: pos(u.debt),
        heldXaf: d.heldXaf ?? 0,
        commissionsNoLogin: !!d.commissionsNoLogin,
        lastCommissionAt: d.lastCommissionAt ?? null,
        lastWithdrawalAt: d.lastWithdrawalAt ?? null,
        authenticator: !!d.authenticator,
        fraudFlag: !!d.fraudFlag,
        frozen: !!u.frozen?.at,
        checkedAt: d.checkedAt ?? null,
        checkedBy: d.checkedBy ?? null,
        checkedNote: d.checkedNote ?? null,
        reactivatedAt: d.reactivatedAt ?? null,
        holdUntil: d.holdUntil ?? null,
    };
}

const encodeCursor = (xaf: number, id: string) => Buffer.from(`${xaf}:${id}`).toString('base64url');
function decodeCursor(c: string | null | undefined): { xaf: number; id: Types.ObjectId } | null {
    if (!c) return null;
    try {
        const [x, id] = Buffer.from(c, 'base64url').toString('utf8').split(':');
        const xaf = Number(x);
        return Number.isFinite(xaf) && Types.ObjectId.isValid(id) ? { xaf, id: new Types.ObjectId(id) } : null;
    } catch { return null; }
}

/** Biggest first, cursor pagination (no skip). The first page also carries the filtered totals. */
export async function listDormant(f: DormantFilters, opts: { cursor?: string | null; limit?: number } = {}) {
    const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
    const base = await matchFor(f);
    const after = decodeCursor(opts.cursor);
    const match = after
        ? { $and: [base, { $or: [{ 'dormancy.heldXaf': { $lt: after.xaf } }, { 'dormancy.heldXaf': after.xaf, _id: { $lt: after.id } }] }] }
        : base;
    const docs: any[] = await UserModel.find(match).select(ROW_FIELDS).sort({ 'dormancy.heldXaf': -1, _id: -1 }).limit(limit + 1).lean();
    const more = docs.length > limit;
    const page = docs.slice(0, limit);
    const last = page[page.length - 1];
    let totals: { count: number; xafEq: number } | undefined;
    if (!after) {
        const [t] = await UserModel.collection.aggregate([
            { $match: { ...base, deleted: { $ne: true } } },
            { $group: { _id: null, count: { $sum: 1 }, xafEq: { $sum: '$dormancy.heldXaf' } } },
        ]).toArray();
        totals = { count: t?.count ?? 0, xafEq: round2(t?.xafEq ?? 0) };
    }
    return { items: page.map(rowOf), nextCursor: more && last ? encodeCursor(last.dormancy?.heldXaf ?? 0, String(last._id)) : null, totals };
}

// ---------------------------------------------------------------- admin: actions

export class DormancyActionError extends Error { constructor(message: string, public status = 400) { super(message); } }

export async function markChecked(userId: string, adminId: string, note: string | null) {
    if (!Types.ObjectId.isValid(userId)) throw new DormancyActionError('Membre inconnu', 404);
    const r = await UserModel.updateOne(
        { _id: userId, 'dormancy.status': { $in: DORMANT_SET } },
        { $set: { 'dormancy.checkedAt': new Date(), 'dormancy.checkedBy': adminId, 'dormancy.checkedNote': note ? note.slice(0, 500) : null } },
    );
    if (!r.matchedCount) throw new DormancyActionError('Ce compte n’est pas dans la liste des comptes dormants', 404);
    resetDormancySummaryCache();
    log.info(`Dormant account ${userId} marked checked by admin ${adminId}`);
}

/**
 * The admin cannot freeze money: support does, after an approval (Phase 5).
 * This files the request as a case in support's « Fraude » queue.
 */
export async function requestFreeze(userId: string, adminId: string, reason: string) {
    if (!Types.ObjectId.isValid(userId)) throw new DormancyActionError('Membre inconnu', 404);
    if (reason.trim().length < 10) throw new DormancyActionError('Indiquez la raison (10 caractères au moins)');
    const u: any = await UserModel.findById(userId).select('country frozen dormancy').lean();
    if (!DORMANT_SET.includes(u?.dormancy?.status)) throw new DormancyActionError('Ce compte n’est pas dans la liste des comptes dormants', 404);
    if (u.frozen?.at) throw new DormancyActionError('L’argent de ce compte est déjà gelé', 409);
    const result = await openSupportCase({
        type: 'dormant_review',
        dedupKey: `dormant:freeze:${userId}:${doualaDay()}`,
        severity: 'warning',
        subject: { userId },
        summary: `Gel demandé depuis l’admin « Comptes dormants » (compte ${u.dormancy.status}, ${Math.round(u.dormancy.heldXaf ?? 0)} F)`,
        details: { requestedBy: adminId, reason: reason.trim().slice(0, 1000), status: u.dormancy.status, lastSeenAt: u.dormancy.lastSeenAt, heldXaf: u.dormancy.heldXaf },
        country: isoOfCountryValue(u.country) ?? undefined,
        amount: u.dormancy.heldXaf ?? 0,
    });
    log.info(`Freeze of dormant account ${userId} requested by admin ${adminId} (case ${result?.caseId ?? 'queued/logged'})`);
    return { caseId: result?.caseId ?? null, queued: !result };
}

// ---------------------------------------------------------------- coming back

const CC = /^[A-Z]{2}$/;
const hours = (n: number) => n * 3_600_000;

/**
 * Every member sign-in. Records the date; the first sign-in of a dormant /
 * long_dormant account also makes it active again (one atomic claim, so two
 * parallel sign-ins do it once) and, with the hold on, holds withdrawals.
 * Never throws: a failure here must not stop a sign-in.
 */
export async function noteSignIn(userId: string, ctx: { country?: string | null; deviceId?: string | null } = {}, now: Date = new Date()): Promise<void> {
    try {
        if (!Types.ObjectId.isValid(userId)) return;
        const cfg = dormancyConfig();
        if (cfg.holdMode === 'off') {
            await UserModel.updateOne({ _id: userId }, { $set: { 'dormancy.lastSignInAt': now } });
            return;
        }
        const holdUntil = cfg.holdMode === 'on' ? new Date(now.getTime() + hours(cfg.holdHours)) : null;
        const prev: any = await UserModel.findOneAndUpdate(
            { _id: userId, 'dormancy.status': { $in: ['dormant', 'long_dormant'] } },
            {
                $set: {
                    'dormancy.lastSignInAt': now, 'dormancy.status': 'active', 'dormancy.lastSeenAt': now, 'dormancy.basis': 'signin',
                    'dormancy.reactivatedAt': now,
                    ...(holdUntil ? { 'dormancy.holdUntil': holdUntil } : {}),
                },
            },
            { new: false, projection: { country: 1, ipCountry: 1, geo: 1, dormancy: 1, withdrawalsLockedUntil: 1, withdrawalLockReason: 1 } },
        ).lean();
        if (!prev) {
            await UserModel.updateOne({ _id: userId }, { $set: { 'dormancy.lastSignInAt': now } });
            return;
        }
        await UserModel.updateOne({ _id: userId }, { $set: { 'dormancy.reactivatedFrom': prev.dormancy.status } });
        resetDormancySummaryCache();

        const signals = await returnSignals(userId, prev, ctx, now);
        const combined = signals.newCountry || signals.newDevice === true || !!signals.contactChange;
        const openCase = cfg.holdMode === 'on' && combined;
        await DormancyReturnModel.create({
            userId: new Types.ObjectId(userId), at: now, from: prev.dormancy.status, lastSeenAt: prev.dormancy.lastSeenAt,
            heldXaf: prev.dormancy.heldXaf ?? 0, mode: cfg.holdMode, held: !!holdUntil, holdUntil, signals, caseOpened: openCase,
        });
        log.warn(`Dormant account ${userId} came back (${prev.dormancy.status}, ${Math.round(prev.dormancy.heldXaf ?? 0)} F): ${holdUntil ? `withdrawals held until ${holdUntil.toISOString()}` : 'log mode, nothing held'}${combined ? `, with ${describe(signals)}` : ''}`);
        if (openCase) await openReturnCase(userId, prev, signals, holdUntil, now, 'signin');
    } catch (err: any) {
        log.error(`noteSignIn ${userId} failed: ${err?.message ?? err}`);
    }
}

const CHANGE_FR: Record<string, string> = {
    email_change: 'changement d’e-mail', phone_change: 'changement de téléphone', momo_change: 'changement de numéro Mobile Money', crypto_change: 'changement de portefeuille crypto',
};
/** In French: support agents read it in the case summary. */
const describe = (s: { newCountry: boolean; country: string | null; newDevice: boolean | null; contactChange: string | null; contactChangeDuringHold?: boolean }) =>
    [s.newCountry ? `un nouveau pays (${s.country})` : '', s.newDevice ? 'un nouvel appareil' : '',
        s.contactChange ? `${CHANGE_FR[s.contactChange] ?? s.contactChange}${s.contactChangeDuringHold ? ' pendant la retenue' : ' peu avant'}` : '']
        .filter(Boolean).join(', ');

/** When the last contact change happened, from the timed lock it set (lock end − lock length). */
function contactChangeAt(u: any): Date | null {
    if (!CONTACT_REASONS.includes(u?.withdrawalLockReason) || !u?.withdrawalsLockedUntil) return null;
    return new Date(new Date(u.withdrawalsLockedUntil).getTime() - hours(config.withdrawal.lockHoursAfterContactChange));
}

async function returnSignals(userId: string, prev: any, ctx: { country?: string | null; deviceId?: string | null }, now: Date) {
    const cfg = dormancyConfig();
    const country = typeof ctx.country === 'string' && CC.test(ctx.country.toUpperCase()) && !['XX', 'T1'].includes(ctx.country.toUpperCase()) ? ctx.country.toUpperCase() : null;
    const known = new Set([isoOfCountryValue(prev.country), prev.geo?.usualCountry, prev.geo?.lastCountry, typeof prev.ipCountry === 'string' ? prev.ipCountry.toUpperCase() : null].filter(Boolean));
    const newCountry = !!country && known.size > 0 && !known.has(country);

    let newDevice: boolean | null = null;
    const deviceId = typeof ctx.deviceId === 'string' && ctx.deviceId.length <= 100 ? ctx.deviceId : null;
    if (deviceId) {
        const oid = new Types.ObjectId(userId);
        const [days, keys] = await Promise.all([
            UserGeoDayModel.distinct('devices', { userId: oid }),
            SessionKeyModel.distinct('deviceId', { userId: oid, deviceId: { $ne: null } }),
        ]);
        const devices = new Set([...days, ...keys].map(String));
        newDevice = devices.size ? !devices.has(deviceId) : null;
    }
    const changed = contactChangeAt(prev);
    const contactChange = changed && changed >= new Date(now.getTime() - cfg.contactChangeWindowDays * DAY_MS) ? String(prev.withdrawalLockReason) : null;
    return { newCountry, country, newDevice, contactChange, contactChangeDuringHold: false };
}

async function openReturnCase(userId: string, prev: any, signals: any, holdUntil: Date | null, now: Date, why: 'signin' | 'contact') {
    const held = prev.dormancy?.heldXaf ?? 0;
    await openSupportCase({
        type: 'dormant_reactivation',
        dedupKey: `dormant:return:${userId}:${doualaDay(new Date(prev.dormancy?.reactivatedAt ?? now))}${why === 'contact' ? ':contact' : ''}`,
        severity: held >= 200_000 ? 'critical' : 'warning',
        subject: { userId },
        summary: `Compte ${(prev.dormancy?.reactivatedFrom ?? prev.dormancy?.status) === 'long_dormant' ? 'inactif depuis plus d’un an' : 'dormant'} revenu avec ${describe(signals) || 'un signal'} (${Math.round(held)} F)`,
        details: { from: prev.dormancy?.reactivatedFrom ?? prev.dormancy?.status, lastSeenAt: prev.dormancy?.lastSeenAt, heldXaf: held, holdUntil, signals },
        country: isoOfCountryValue(prev.country) ?? undefined,
        amount: held,
    });
}

/**
 * Every 10 minutes: a contact change (email, phone, MoMo, crypto) made while
 * the return hold runs opens the case too. The partial index on holdUntil
 * keeps this to the few accounts being held.
 */
export async function watchHolds(now: Date = new Date()): Promise<number> {
    if (dormancyConfig().holdMode !== 'on') return 0;
    const held: any[] = await UserModel.find({ 'dormancy.holdUntil': { $gt: now }, withdrawalLockReason: { $in: CONTACT_REASONS } })
        .select('country dormancy withdrawalsLockedUntil withdrawalLockReason').lean();
    let opened = 0;
    for (const u of held) {
        const changed = contactChangeAt(u);
        if (!changed || !u.dormancy?.reactivatedAt || changed < new Date(u.dormancy.reactivatedAt)) continue;
        const r = await DormancyReturnModel.findOneAndUpdate(
            { userId: u._id, at: u.dormancy.reactivatedAt, 'signals.contactChangeDuringHold': false },
            { $set: { 'signals.contactChange': u.withdrawalLockReason, 'signals.contactChangeDuringHold': true, caseOpened: true } },
        );
        if (!r) continue; // already reported (or no return row)
        const signals = { newCountry: false, country: null, newDevice: null, contactChange: String(u.withdrawalLockReason), contactChangeDuringHold: true };
        await openReturnCase(String(u._id), u, signals, u.dormancy.holdUntil, now, 'contact');
        opened += 1;
    }
    return opened;
}

// ---------------------------------------------------------------- CSV export (background)

const CSV_HEADER = ['id', 'nom', 'email', 'telephone', 'pays', 'statut', 'derniere_activite', 'source_date', 'total_xaf', ...BALANCE_FIELDS,
    'dette', 'commissions_sans_connexion', 'derniere_commission', 'dernier_retrait', 'authentificateur', 'signal_fraude', 'gele', 'verifie_le', 'verifie_par'];
const csvCell = (v: unknown) => {
    if (v === null || v === undefined) return '';
    let s = v instanceof Date ? v.toISOString() : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // no formulas when opened in a spreadsheet
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvLine = (r: ReturnType<typeof rowOf>) => [r._id, r.name, r.email, r.phoneNumber, r.country, r.status, r.lastSeenAt, r.basis, r.heldXaf,
    ...BALANCE_FIELDS.map(f => r.balances[f]), r.debt, r.commissionsNoLogin ? 'oui' : 'non', r.lastCommissionAt, r.lastWithdrawalAt,
    r.authenticator ? 'oui' : 'non', r.fraudFlag ? 'oui' : 'non', r.frozen ? 'oui' : 'non', r.checkedAt, r.checkedBy].map(csvCell).join(',');

const bucket = () => new mongoose.mongo.GridFSBucket(mongoose.connection.db!, { bucketName: 'dormancy_exports' });

/** Starts an export and answers at once; the file is built in the background (one at a time per admin). */
export async function startExport(f: DormantFilters, adminId: string): Promise<{ id: string }> {
    const running = await DormancyExportModel.countDocuments({ createdBy: adminId, status: 'running', createdAt: { $gt: new Date(Date.now() - hours(1)) } });
    if (running) throw new DormancyActionError('Un export est déjà en cours', 409);
    const doc = await DormancyExportModel.create({ filters: f, createdBy: adminId });
    setImmediate(() => { void buildExport(String(doc._id), f); });
    return { id: String(doc._id) };
}

async function buildExport(id: string, f: DormantFilters): Promise<void> {
    const fileName = `comptes-dormants-${doualaDay()}-${id.slice(-6)}.csv`;
    try {
        const upload = bucket().openUploadStream(fileName, { metadata: { exportId: id } });
        const write = (s: string) => new Promise<void>((resolve, reject) => {
            if (upload.write(s)) resolve(); else upload.once('drain', resolve);
            upload.once('error', reject);
        });
        await write(`﻿${CSV_HEADER.join(',')}\n`);
        const cursor = UserModel.find(await matchFor(f)).select(ROW_FIELDS).sort({ 'dormancy.heldXaf': -1, _id: -1 }).lean().cursor({ batchSize: 500 });
        let rows = 0;
        let chunk = '';
        for await (const u of cursor) {
            chunk += `${csvLine(rowOf(u))}\n`;
            rows += 1;
            if (rows % 500 === 0) {
                await write(chunk);
                chunk = '';
                await new Promise(r => setImmediate(r)); // let requests through between chunks
            }
        }
        if (chunk) await write(chunk);
        await new Promise<void>((resolve, reject) => upload.end((err?: unknown) => (err ? reject(err) : resolve())));
        await DormancyExportModel.updateOne({ _id: id }, { $set: { status: 'done', rows, fileId: upload.id, fileName, finishedAt: new Date() } });
        log.info(`Dormant accounts export ${id}: ${rows} rows`);
    } catch (err: any) {
        log.error(`Dormant accounts export ${id} failed: ${err?.message ?? err}`);
        await DormancyExportModel.updateOne({ _id: id }, { $set: { status: 'failed', error: String(err?.message ?? err).slice(0, 300), finishedAt: new Date() } });
    }
}

export async function exportStatus(id: string) {
    if (!Types.ObjectId.isValid(id)) return null;
    const d: any = await DormancyExportModel.findById(id).lean();
    return d ? { id: String(d._id), status: d.status, rows: d.rows, fileName: d.fileName, error: d.error, createdAt: d.createdAt, finishedAt: d.finishedAt, createdBy: d.createdBy } : null;
}

export async function openExportFile(id: string) {
    const d: any = Types.ObjectId.isValid(id) ? await DormancyExportModel.findById(id).lean() : null;
    if (!d || d.status !== 'done' || !d.fileId) return null;
    return { fileName: d.fileName as string, stream: bucket().openDownloadStream(d.fileId) };
}

/** Exports hold personal data: the file and its row go after 24 h. */
export async function clearOldExports(now: Date = new Date()): Promise<number> {
    const old: any[] = await DormancyExportModel.find({ createdAt: { $lt: new Date(now.getTime() - hours(24)) } }).lean();
    for (const d of old) {
        if (d.fileId) { try { await bucket().delete(d.fileId); } catch { /* already gone */ } }
        await DormancyExportModel.deleteOne({ _id: d._id });
    }
    return old.length;
}
