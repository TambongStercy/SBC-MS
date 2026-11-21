import { Types } from 'mongoose';
import { ActivityDayModel, IActivityDay, ISignupCounts } from '../database/models/activity-day.model';
import { SignupAttemptModel } from '../database/models/signup-attempt.model';
import { UserGeoDayModel } from '../database/models/user-geo-day.model';
import SubscriptionModel, { SubscriptionCategory, SubscriptionType } from '../database/models/subscription.model';
import UserModel from '../database/models/user.model';
import { doualaDay } from './activity-signals.service';
import { FailureGroup, SIGNUP_REASONS, reasonGroup } from './signup-attempts.service';
import { paymentService } from './clients/payment.service.client';
import { liveConnected } from './activity-hll.service';
import logger from '../utils/logger';

const log = logger.getLogger('ActivityDashboard');

/**
 * Security plan Phase 11: daily activity, per Douala day and country.
 *
 * The rollup (jobs/activity-rollup.job) writes activity_days; the admin page
 * and the support desk read only those documents (at most ~40 countries ×
 * 37 days), so loading never counts raw records.
 *   - Members connected: live today from a Redis HyperLogLog fed by the
 *     activity batches (PFADD, ~1 % error), exactly each night from
 *     user_geo_days (each member counted once, in the country of most of
 *     their requests that day, so country rows add up to the total).
 *   - Sign-ups: from signup_attempts, by the day the form was sent.
 *   - Activated: members whose first CLASSIQUE/CIBLE subscription started that day.
 *   - Payments unfinished: from payment-service, by failure group.
 */

export type Source = 'web' | 'app' | 'api';
const SOURCES: Source[] = ['web', 'app', 'api'];
const SRC_ALL = 'all';
const COUNTRY = /^[A-Z]{2}$/;

const emptySignups = (): ISignupCounts => ({ started: 0, completed: 0, failed: 0, inProgress: 0, reasons: {} });
const emptyPayments = () => ({ failed: 0, waiting: 0, abandoned: 0, groups: { sbc_code: 0, provider_api: 0, member: 0, unknown: 0 } });
const emptyConnected = (exact: boolean) => ({ all: 0, web: 0, app: 0, api: 0, exact });

/** Douala day bounds as instants. */
const dayStart = (day: string) => new Date(`${day}T00:00:00+01:00`);
const addDays = (day: string, n: number) => doualaDay(new Date(dayStart(day).getTime() + n * 86400_000 + 3600_000));

/** Exact count from user_geo_days: each member once, in their main country of the day. */
export async function exactConnected(day: string): Promise<Map<string, ReturnType<typeof emptyConnected>>> {
    const rows = await UserGeoDayModel.aggregate([
        { $match: { day } },
        { $sort: { userId: 1, requests: -1 } },
        {
            $group: {
                _id: '$userId',
                country: { $first: '$country' },
                web: { $max: { $cond: [{ $gt: ['$sources.web', 0] }, 1, 0] } },
                app: { $max: { $cond: [{ $gt: ['$sources.app', 0] }, 1, 0] } },
                api: { $max: { $cond: [{ $gt: ['$sources.api', 0] }, 1, 0] } },
            },
        },
        { $group: { _id: '$country', all: { $sum: 1 }, web: { $sum: '$web' }, app: { $sum: '$app' }, api: { $sum: '$api' } } },
    ]).allowDiskUse(true);
    return new Map(rows.map((x: any) => [COUNTRY.test(x._id) ? x._id : 'XX', { all: x.all, web: x.web, app: x.app, api: x.api, exact: true }]));
}

// ---- rollup ----------------------------------------------------------------

async function signupsFor(day: string): Promise<Map<string, IActivityDay['signups']>> {
    const rows = await SignupAttemptModel.aggregate([
        { $match: { day } },
        { $group: { _id: { country: '$country', source: '$source', outcome: '$outcome', reason: '$reason' }, n: { $sum: 1 } } },
    ]);
    const out = new Map<string, IActivityDay['signups']>();
    for (const r of rows as any[]) {
        const c = COUNTRY.test(r._id.country) ? r._id.country : 'XX';
        const s = (SOURCES as string[]).includes(r._id.source) ? (r._id.source as Source) : 'api';
        const doc = out.get(c) || { web: emptySignups(), app: emptySignups(), api: emptySignups() };
        const x = doc[s];
        x.started += r.n;
        if (r._id.outcome === 'completed') x.completed += r.n;
        else if (r._id.outcome === 'failed') {
            x.failed += r.n;
            const reason = r._id.reason || 'none';
            x.reasons[reason] = (x.reasons[reason] || 0) + r.n;
        } else x.inProgress += r.n;
        out.set(c, doc);
    }
    return out;
}

async function activatedFor(day: string): Promise<Map<string, number>> {
    const start = dayStart(day);
    const end = new Date(start.getTime() + 86400_000);
    const rows = await SubscriptionModel.aggregate([
        {
            $match: {
                _id: { $gte: Types.ObjectId.createFromTime(Math.floor(start.getTime() / 1000)), $lt: Types.ObjectId.createFromTime(Math.floor(end.getTime() / 1000)) },
                category: SubscriptionCategory.REGISTRATION,
                subscriptionType: { $in: [SubscriptionType.CLASSIQUE, SubscriptionType.CIBLE] },
            },
        },
        {
            $lookup: {
                from: SubscriptionModel.collection.name,
                let: { u: '$user', id: '$_id' },
                pipeline: [
                    { $match: { $expr: { $and: [{ $eq: ['$user', '$$u'] }, { $lt: ['$_id', '$$id'] }] } } },
                    { $match: { category: SubscriptionCategory.REGISTRATION } },
                    { $limit: 1 },
                    { $project: { _id: 1 } },
                ],
                as: 'earlier',
            },
        },
        { $match: { earlier: { $size: 0 } } },
        { $group: { _id: '$user' } },
        { $lookup: { from: UserModel.collection.name, let: { u: '$_id' }, pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$u'] } } }, { $project: { country: 1 } }], as: 'u' } },
        { $group: { _id: { $toUpper: { $ifNull: [{ $first: '$u.country' }, 'XX'] } }, n: { $sum: 1 } } },
    ]);
    const out = new Map<string, number>();
    for (const r of rows as any[]) {
        const c = COUNTRY.test(r._id) ? r._id : 'XX';
        out.set(c, (out.get(c) || 0) + r.n);
    }
    return out;
}

/** Writes one part of each country's document for a day; countries no longer present get zeros. */
async function writePart(day: string, part: 'signups' | 'connected' | 'activated' | 'payments', values: Map<string, unknown>, zero: unknown): Promise<void> {
    const now = new Date();
    const ops = [...values].map(([country, v]) => ({
        updateOne: { filter: { day, country }, update: { $set: { [part]: v, updatedAt: now } }, upsert: true },
    }));
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            if (ops.length) await ActivityDayModel.bulkWrite(ops, { ordered: false });
            break;
        } catch (err: any) {
            // Two rollups upserting the same new {day, country} at once: the retry updates it.
            if (attempt === 1 || !/E11000/.test(String(err?.message))) throw err;
        }
    }
    await ActivityDayModel.updateMany({ day, country: { $nin: [...values.keys()] }, [part]: { $exists: true } }, { $set: { [part]: zero, updatedAt: now } });
}

export interface RollupParts { signups?: boolean; connected?: boolean; activated?: boolean; payments?: boolean }

/**
 * Recomputes a day's figures. Today's connected members come from the
 * HyperLogLog when Redis is on, otherwise (and for past days) exactly.
 */
export async function rollupDay(day: string, parts: RollupParts = { signups: true, connected: true, activated: true, payments: true }, now: Date = new Date()): Promise<void> {
    const today = doualaDay(now);
    if (parts.signups) await writePart(day, 'signups', await signupsFor(day), { web: emptySignups(), app: emptySignups(), api: emptySignups() });
    if (parts.connected) {
        // An empty live count (Redis just restarted, keys expired) falls back to the exact one.
        const live = day === today ? await liveConnected(day) : null;
        const useLive = !!live && live.size > 0;
        await writePart(day, 'connected', useLive ? live! : await exactConnected(day), emptyConnected(!useLive));
    }
    if (parts.activated) await writePart(day, 'activated', await activatedFor(day), 0);
    if (parts.payments) {
        const res = await paymentService.getActivityPayments(day, day);
        if (res) {
            const m = new Map<string, unknown>();
            for (const r of res.rows) {
                if (r.day !== day) continue;
                const c = COUNTRY.test(r.country) ? r.country : 'XX';
                const cur = (m.get(c) as ReturnType<typeof emptyPayments>) || emptyPayments();
                cur.failed += r.failed; cur.waiting += r.waiting; cur.abandoned += r.abandoned;
                for (const g of ['sbc_code', 'provider_api', 'member', 'unknown'] as const) cur.groups[g] += Number(r.groups?.[g] || 0);
                m.set(c, cur);
            }
            await writePart(day, 'payments', m, emptyPayments());
        }
    }
    boardCache.clear();
}

// ---- the board -------------------------------------------------------------

export type Range = 'today' | '7d' | '30d';
export interface BoardQuery { range?: Range; countries?: string[] | null; source?: Source | null }

interface Figures {
    connected: number;
    started: number; completed: number; failed: number; inProgress: number;
    failedGroups: Record<FailureGroup, number>;
    reasons: Record<string, number>;
    activated: number;
    payments: { failed: number; waiting: number; abandoned: number; groups: Record<FailureGroup, number> };
}

const zeroFigures = (): Figures => ({
    connected: 0, started: 0, completed: 0, failed: 0, inProgress: 0,
    failedGroups: { sbc_code: 0, provider_api: 0, member: 0, unknown: 0 }, reasons: {},
    activated: 0, payments: { failed: 0, waiting: 0, abandoned: 0, groups: { sbc_code: 0, provider_api: 0, member: 0, unknown: 0 } },
});

function addDoc(f: Figures, d: any, source: Source | null): void {
    const conn = d.connected || {};
    f.connected += Number(source ? conn[source] : conn.all) || 0;
    const sig = d.signups || {};
    for (const s of source ? [source] : SOURCES) {
        const x: ISignupCounts | undefined = sig[s];
        if (!x) continue;
        f.started += x.started || 0; f.completed += x.completed || 0; f.failed += x.failed || 0; f.inProgress += x.inProgress || 0;
        for (const [reason, n] of Object.entries(x.reasons || {})) {
            f.reasons[reason] = (f.reasons[reason] || 0) + n;
            f.failedGroups[reasonGroup(reason)] += n;
        }
    }
    f.activated += Number(d.activated) || 0;
    const p = d.payments || {};
    f.payments.failed += p.failed || 0; f.payments.waiting += p.waiting || 0; f.payments.abandoned += p.abandoned || 0;
    for (const g of ['sbc_code', 'provider_api', 'member', 'unknown'] as FailureGroup[]) f.payments.groups[g] += Number(p.groups?.[g] || 0);
}

function addFigures(a: Figures, b: Figures): void {
    a.connected += b.connected; a.started += b.started; a.completed += b.completed; a.failed += b.failed; a.inProgress += b.inProgress;
    a.activated += b.activated;
    for (const g of Object.keys(a.failedGroups) as FailureGroup[]) { a.failedGroups[g] += b.failedGroups[g]; a.payments.groups[g] += b.payments.groups[g]; }
    for (const [r, n] of Object.entries(b.reasons)) a.reasons[r] = (a.reasons[r] || 0) + n;
    a.payments.failed += b.payments.failed; a.payments.waiting += b.payments.waiting; a.payments.abandoned += b.payments.abandoned;
}

/** Change of the period's daily average against the 7 days before it, in %; null without a base. */
const trend = (cur: number, curDays: number, prev: number) => {
    const base = prev / 7;
    if (base <= 0) return null;
    return Math.round(((cur / curDays - base) / base) * 1000) / 10;
};

const boardCache = new Map<string, { at: number; value: unknown }>();
const BOARD_CACHE_MS = 30_000;

export function cleanCountries(input: unknown): string[] | null {
    const list = (Array.isArray(input) ? input : String(input || '').split(','))
        .map(x => String(x).trim().toUpperCase())
        .filter(x => COUNTRY.test(x));
    return list.length ? [...new Set(list)].slice(0, 60) : null;
}

export async function activityBoard(q: BoardQuery, now: Date = new Date()) {
    const range: Range = q.range === '7d' || q.range === '30d' ? q.range : 'today';
    const source = q.source && (SOURCES as string[]).includes(q.source) ? q.source : null;
    const countries = q.countries?.length ? q.countries : null;
    const key = JSON.stringify({ range, source, countries, d: doualaDay(now) });
    const hit = boardCache.get(key);
    if (hit && Date.now() - hit.at < BOARD_CACHE_MS) return hit.value as Awaited<ReturnType<typeof computeBoard>>;
    const value = await computeBoard(range, source, countries, now);
    boardCache.set(key, { at: Date.now(), value });
    if (boardCache.size > 300) boardCache.delete(boardCache.keys().next().value as string);
    return value;
}

async function computeBoard(range: Range, source: Source | null, countries: string[] | null, now: Date) {
    const to = doualaDay(now);
    const nDays = range === 'today' ? 1 : range === '7d' ? 7 : 30;
    const from = addDays(to, -(nDays - 1));
    const prevFrom = addDays(from, -7);
    const prevTo = addDays(from, -1);

    const filter: Record<string, unknown> = { day: { $gte: prevFrom, $lte: to } };
    if (countries) filter.country = { $in: countries };
    const docs = await ActivityDayModel.find(filter, { _id: 0 }).lean();

    const cur = new Map<string, Figures>();
    const prev = new Map<string, Figures>();
    const daily = new Map<string, Figures>();
    let updatedAt: Date | null = null;
    let connectedExact = true;
    for (const d of docs as any[]) {
        const target = d.day >= from ? cur : d.day <= prevTo ? prev : null;
        if (!target) continue;
        const f = target.get(d.country) || zeroFigures();
        addDoc(f, d, source);
        target.set(d.country, f);
        const day = daily.get(d.day) || zeroFigures();
        addDoc(day, d, source);
        daily.set(d.day, day);
        if (d.day >= from) {
            if (!updatedAt || new Date(d.updatedAt) > updatedAt) updatedAt = new Date(d.updatedAt);
            if (d.connected && d.connected.exact === false) connectedExact = false;
        }
    }

    const shape = (country: string, f: Figures, p: Figures | undefined) => ({
        country,
        connected: Math.round(f.connected / nDays),
        connectedTrend: trend(f.connected, nDays, p?.connected ?? 0),
        signups: { started: f.started, completed: f.completed, failed: f.failed, inProgress: f.inProgress, failedGroups: f.failedGroups, reasons: f.reasons },
        completedTrend: trend(f.completed, nDays, p?.completed ?? 0),
        activated: f.activated,
        activatedTrend: trend(f.activated, nDays, p?.activated ?? 0),
        payments: f.payments,
    });

    const rows = [...cur].map(([c, f]) => shape(c, f, prev.get(c)))
        .sort((a, b) => b.connected - a.connected || b.signups.started - a.signups.started || a.country.localeCompare(b.country));
    const totalCur = zeroFigures();
    for (const f of cur.values()) addFigures(totalCur, f);
    const totalPrev = zeroFigures();
    for (const f of prev.values()) addFigures(totalPrev, f);

    const days: string[] = [];
    for (let d = prevFrom; d <= to; d = addDays(d, 1)) days.push(d);

    return {
        range: { key: range, from, to, days: nDays, previous: { from: prevFrom, to: prevTo } },
        source,
        countries,
        rows,
        total: shape('ALL', totalCur, totalPrev),
        daily: days.map(day => {
            const f = daily.get(day) || zeroFigures();
            return { day, current: day >= from, connected: f.connected, started: f.started, completed: f.completed, failed: f.failed, activated: f.activated, paymentsFailed: f.payments.failed };
        }),
        reasons: Object.entries(SIGNUP_REASONS).map(([code, v]) => ({ code, group: v.group, label: v.label })),
        connectedExact,
        connectedCollecting: !!(await UserGeoDayModel.exists({ day: { $gte: addDays(to, -1) } })),
        updatedAt,
        computedAt: now,
        notes: {
            connected: range === 'today' ? 'Membres distincts aujourd’hui' : 'Moyenne par jour de membres distincts',
            paymentsSource: 'Les paiements ne distinguent pas encore web et app : le filtre web/app ne s’y applique pas.',
        },
    };
}

// ---- lists behind the numbers ---------------------------------------------

export interface ListQuery { from: string; to: string; country?: string | null; countries?: string[] | null; cursor?: string | null; limit?: number }

/** Members connected (consenting members only, as user_geo_days). */
export async function listConnected(q: ListQuery & { source?: Source | null }) {
    const filter: Record<string, unknown> = { day: { $gte: q.from, $lte: q.to } };
    if (q.country) filter.country = q.country;
    else if (q.countries?.length) filter.country = { $in: q.countries };
    if (q.source) filter[`sources.${q.source}`] = { $gt: 0 };
    if (q.cursor && Types.ObjectId.isValid(q.cursor)) filter._id = { $lt: new Types.ObjectId(q.cursor) };
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
    const rows = await UserGeoDayModel.find(filter, { userId: 1, day: 1, country: 1, requests: 1, logins: 1, sources: 1, firstAt: 1, lastAt: 1 }).sort({ _id: -1 }).limit(limit + 1).lean();
    const users = await UserModel.find({ _id: { $in: rows.map(r => r.userId) } }, { name: 1, country: 1 }).lean();
    const byId = new Map(users.map(u => [String(u._id), u]));
    const items = rows.slice(0, limit).map(r => ({
        id: String(r._id), userId: String(r.userId), name: byId.get(String(r.userId))?.name ?? null,
        declaredCountry: (byId.get(String(r.userId)) as any)?.country ?? null,
        day: r.day, country: r.country, requests: r.requests, logins: r.logins, sources: r.sources, firstAt: r.firstAt, lastAt: r.lastAt,
    }));
    return { items, nextCursor: rows.length > limit ? items[items.length - 1].id : null };
}

/** Members activated (first CLASSIQUE/CIBLE subscription) in the period. */
export async function listActivated(q: ListQuery) {
    const start = dayStart(q.from);
    const end = new Date(dayStart(q.to).getTime() + 86400_000);
    const idFilter: Record<string, unknown> = {
        $gte: Types.ObjectId.createFromTime(Math.floor(start.getTime() / 1000)),
        $lt: Types.ObjectId.createFromTime(Math.floor(end.getTime() / 1000)),
    };
    if (q.cursor && Types.ObjectId.isValid(q.cursor)) idFilter.$lt = new Types.ObjectId(q.cursor);
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
    const wanted = q.country ? [q.country] : q.countries?.length ? q.countries : null;
    const rows = await SubscriptionModel.aggregate([
        { $match: { _id: idFilter, category: SubscriptionCategory.REGISTRATION, subscriptionType: { $in: [SubscriptionType.CLASSIQUE, SubscriptionType.CIBLE] } } },
        { $sort: { _id: -1 } },
        {
            $lookup: {
                from: SubscriptionModel.collection.name,
                let: { u: '$user', id: '$_id' },
                pipeline: [{ $match: { $expr: { $and: [{ $eq: ['$user', '$$u'] }, { $lt: ['$_id', '$$id'] }] } } }, { $match: { category: SubscriptionCategory.REGISTRATION } }, { $limit: 1 }, { $project: { _id: 1 } }],
                as: 'earlier',
            },
        },
        { $match: { earlier: { $size: 0 } } },
        { $lookup: { from: UserModel.collection.name, let: { u: '$user' }, pipeline: [{ $match: { $expr: { $eq: ['$_id', '$$u'] } } }, { $project: { name: 1, country: 1 } }], as: 'u' } },
        { $addFields: { _country: { $toUpper: { $ifNull: [{ $first: '$u.country' }, 'XX'] } } } },
        ...(wanted ? [{ $match: { _country: { $in: wanted } } }] : []),
        { $limit: limit + 1 },
    ]);
    const items = rows.slice(0, limit).map((r: any) => ({
        id: String(r._id), userId: String(r.user), name: r.u?.[0]?.name ?? null, country: r._country,
        subscriptionType: r.subscriptionType, startedAt: r.startDate, createdAt: r.createdAt,
    }));
    return { items, nextCursor: rows.length > limit ? items[items.length - 1].id : null };
}

export { log as activityLog };
