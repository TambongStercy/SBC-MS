import PaymentIntentModel from '../database/models/PaymentIntent';
import { PaymentStatus } from '../database/interfaces/IPaymentIntent';
import PaymentAlertModel from '../database/models/PaymentAlert';
import { ARCHIVE_COLLECTION } from '../jobs/payin-archive.job';

/**
 * Security plan Phase 10 — payment conversion. Read-only figures for the admin
 * "Paiements" dashboard, computed from paymentintents over a date range
 * (index {createdAt}) and cached 10 minutes per query.
 *
 * Funnel steps per payment:
 *   created → page opened (metadata.pageOpenedAt, recorded since 2026-11-21)
 *   → method chosen (gateway set) → provider reached (provider reference)
 *   → paid (SUCCEEDED/CONFIRMED) → credited (creating service accepted it,
 *   metadata.creditedAt, recorded since 2026-11-21).
 */
const SUCCESS = [PaymentStatus.SUCCEEDED, PaymentStatus.CONFIRMED];
const FAILED = [PaymentStatus.FAILED, PaymentStatus.ERROR, PaymentStatus.EXPIRED, PaymentStatus.CANCELED];
const WAITING = [PaymentStatus.PENDING_PROVIDER, PaymentStatus.PROCESSING, PaymentStatus.WAITING_FOR_CRYPTO_DEPOSIT, PaymentStatus.PARTIALLY_PAID, PaymentStatus.REQUIRES_ACTION];
const CACHE_MS = 10 * 60 * 1000;
const HEAVY_PER_DAY = 20;
const MAX_RANGE_DAYS = 92;

export interface ConversionFilter { from?: string; to?: string; country?: string; gateway?: string }

const cache = new Map<string, { at: number; value: unknown }>();
const cached = async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T;
    const value = await fn();
    cache.set(key, { at: Date.now(), value });
    if (cache.size > 200) cache.delete(cache.keys().next().value as string);
    return value;
};

/** Range in Douala days (UTC+1): [from 00:00, to 24:00). Defaults to the last 7 days. */
export function range(f: ConversionFilter): { start: Date; end: Date; from: string; to: string } {
    const day = (d: Date) => new Date(d.getTime() + 3600_000).toISOString().slice(0, 10);
    const ok = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
    const to = ok(f.to) ? f.to! : day(new Date());
    let from = ok(f.from) ? f.from! : day(new Date(Date.now() - 6 * 86400_000));
    const start = new Date(`${from}T00:00:00+01:00`);
    const end = new Date(new Date(`${to}T00:00:00+01:00`).getTime() + 86400_000);
    if ((end.getTime() - start.getTime()) / 86400_000 > MAX_RANGE_DAYS) {
        from = day(new Date(end.getTime() - MAX_RANGE_DAYS * 86400_000));
        return { start: new Date(`${from}T00:00:00+01:00`), end, from, to };
    }
    return { start, end, from, to };
}

const match = (f: ConversionFilter) => {
    const { start, end } = range(f);
    const m: Record<string, unknown> = { createdAt: { $gte: start, $lt: end } };
    if (f.country) m.countryCode = f.country === 'none' ? { $in: [null, ''] } : f.country.toUpperCase();
    if (f.gateway) m.gateway = f.gateway;
    return m;
};

/** What was being paid, from the creating service's metadata. */
const productExpr = {
    $switch: {
        branches: [
            { case: { $regexMatch: { input: { $ifNull: ['$metadata.callbackPath', ''] }, regex: 'relance' } }, then: 'relance' },
            { case: { $ifNull: ['$metadata.campaignId', false] }, then: 'publicite' },
            { case: { $ifNull: ['$metadata.product', false] }, then: { $toLower: '$metadata.product' } },
            { case: { $ifNull: ['$metadata.planType', false] }, then: { $concat: ['abonnement-', { $toLower: '$metadata.planType' }] } },
            { case: { $eq: ['$metadata.paymentSource', 'sso_third_party'] }, then: 'sbc-live' },
        ],
        default: { $ifNull: ['$metadata.originatingService', 'autre'] },
    },
};

const counters = {
    attempts: { $sum: 1 },
    opened: { $sum: { $cond: [{ $ifNull: ['$metadata.pageOpenedAt', false] }, 1, 0] } },
    chosen: { $sum: { $cond: [{ $and: [{ $ne: ['$gateway', 'none'] }, { $ne: ['$gateway', null] }] }, 1, 0] } },
    reached: { $sum: { $cond: [{ $or: [{ $gt: [{ $strLenCP: { $ifNull: ['$gatewayPaymentId', ''] } }, 0] }, { $gt: [{ $strLenCP: { $ifNull: ['$gatewayCheckoutUrl', ''] } }, 0] }] }, 1, 0] } },
    succeeded: { $sum: { $cond: [{ $in: ['$status', SUCCESS] }, 1, 0] } },
    failed: { $sum: { $cond: [{ $in: ['$status', FAILED] }, 1, 0] } },
    waiting: { $sum: { $cond: [{ $in: ['$status', WAITING] }, 1, 0] } },
    credited: { $sum: { $cond: [{ $ifNull: ['$metadata.creditedAt', false] }, 1, 0] } },
};

const rate = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

export async function conversionSummary(f: ConversionFilter) {
    const r = range(f);
    return cached(`summary:${JSON.stringify({ ...f, from: r.from, to: r.to })}`, async () => {
        const [out] = await PaymentIntentModel.aggregate([
            { $match: match(f) },
            // Abandoned payments moved out after 7 days (jobs/payin-archive.job) still count.
            { $unionWith: { coll: ARCHIVE_COLLECTION, pipeline: [{ $match: match(f) }] } },
            { $addFields: { _product: productExpr, _country: { $ifNull: [{ $cond: [{ $eq: ['$countryCode', ''] }, null, '$countryCode'] }, 'none'] }, _source: { $ifNull: ['$metadata.clientSource', 'unknown'] }, _day: { $dateToString: { date: '$createdAt', format: '%Y-%m-%d', timezone: '+01:00' } } } },
            {
                $facet: {
                    totals: [{ $group: { _id: null, ...counters, members: { $addToSet: '$userId' }, payers: { $addToSet: { $cond: [{ $in: ['$status', SUCCESS] }, '$userId', '$$REMOVE'] } } } },
                        { $project: { _id: 0, attempts: 1, opened: 1, chosen: 1, reached: 1, succeeded: 1, failed: 1, waiting: 1, credited: 1, members: { $size: '$members' }, payingMembers: { $size: '$payers' } } }],
                    byGateway: [{ $group: { _id: '$gateway', ...counters } }, { $sort: { attempts: -1 } }],
                    byCountry: [{ $group: { _id: '$_country', ...counters } }, { $sort: { attempts: -1 } }, { $limit: 40 }],
                    byProduct: [{ $group: { _id: '$_product', ...counters } }, { $sort: { attempts: -1 } }, { $limit: 20 }],
                    // Web / installed app / other (X-SBC-Client of the member's request; 'unknown' before 2026-11-23).
                    bySource: [{ $group: { _id: '$_source', ...counters } }, { $sort: { attempts: -1 } }],
                    byCountryGateway: [{ $match: { gateway: { $ne: 'none' } } }, { $group: { _id: { country: '$_country', gateway: '$gateway' }, ...counters } }, { $sort: { attempts: -1 } }, { $limit: 60 }],
                    daily: [{ $group: { _id: '$_day', attempts: { $sum: 1 }, succeeded: counters.succeeded, failed: counters.failed } }, { $sort: { _id: 1 } }],
                    failureGroups: [{ $match: { status: { $in: FAILED } } }, { $group: { _id: { $ifNull: ['$failure.group', 'unknown'] }, count: { $sum: 1 } } }],
                    topCodes: [{ $match: { status: { $in: FAILED } } }, { $group: { _id: { group: { $ifNull: ['$failure.group', 'unknown'] }, code: { $ifNull: ['$failure.code', 'non_enregistre'] } }, count: { $sum: 1 }, message: { $last: '$failure.providerMessage' } } }, { $sort: { count: -1 } }, { $limit: 10 }],
                    stuck: [{ $match: { status: { $in: WAITING }, createdAt: { $lt: new Date(Date.now() - 24 * 3600_000) } } }, { $group: { _id: '$gateway', count: { $sum: 1 } } }, { $sort: { count: -1 } }],
                    // Plan item 6: members above 20 attempts in one day (for the fraud engine, Phase 4).
                    heavyRetriers: [{ $group: { _id: { u: '$userId', d: '$_day' }, n: { $sum: 1 } } }, { $match: { n: { $gt: HEAVY_PER_DAY } } },
                        { $group: { _id: '$_id.u', days: { $sum: 1 }, maxPerDay: { $max: '$n' }, attempts: { $sum: '$n' } } }, { $sort: { maxPerDay: -1 } },
                        { $group: { _id: null, members: { $sum: 1 }, top: { $push: { userId: '$_id', days: '$days', maxPerDay: '$maxPerDay', attempts: '$attempts' } } } },
                        { $project: { _id: 0, members: 1, top: { $slice: ['$top', 20] } } }],
                    timeToSuccess: [{ $match: { status: { $in: SUCCESS } } }, { $project: { s: { $divide: [{ $subtract: ['$updatedAt', '$createdAt'] }, 1000] } } }, { $sort: { s: 1 } }, { $group: { _id: null, all: { $push: '$s' } } }],
                },
            },
        ]).allowDiskUse(true);

        const totals = out.totals[0] || { attempts: 0, opened: 0, chosen: 0, reached: 0, succeeded: 0, failed: 0, waiting: 0, credited: 0, members: 0, payingMembers: 0 };
        const withRates = (rows: any[], key: string) => rows.map(x => ({ [key]: x._id, ...x, _id: undefined, successRate: rate(x.succeeded, x.attempts), successOfReached: rate(x.succeeded, x.reached) }));
        const times: number[] = out.timeToSuccess[0]?.all || [];
        return {
            range: { from: r.from, to: r.to },
            totals: { ...totals, attemptConversion: rate(totals.succeeded, totals.attempts), memberConversion: rate(totals.payingMembers, totals.members) },
            byGateway: withRates(out.byGateway, 'gateway'),
            byCountry: withRates(out.byCountry, 'country'),
            byProduct: withRates(out.byProduct, 'product'),
            bySource: withRates(out.bySource, 'source'),
            byCountryGateway: out.byCountryGateway.map((x: any) => ({ country: x._id.country, gateway: x._id.gateway, ...x, _id: undefined, successRate: rate(x.succeeded, x.attempts) })),
            daily: out.daily.map((x: any) => ({ day: x._id, attempts: x.attempts, succeeded: x.succeeded, failed: x.failed })),
            failureGroups: Object.fromEntries(out.failureGroups.map((x: any) => [x._id, x.count])),
            topCodes: out.topCodes.map((x: any) => ({ group: x._id.group, code: x._id.code, count: x.count, message: x.message ?? null })),
            stuckOver24h: out.stuck.map((x: any) => ({ gateway: x._id, count: x.count })),
            heavyRetriers: out.heavyRetriers[0] || { members: 0, top: [] },
            medianSecondsToSuccess: times.length ? Math.round(times[Math.floor(times.length / 2)]) : null,
            computedAt: new Date().toISOString(),
        };
    });
}

export interface FailureListFilter extends ConversionFilter { group?: string; code?: string; cursor?: string; limit?: number }

/** Unfinished payments with their recorded reason, newest first, cursor-paginated (createdAt|_id). */
export async function failureList(f: FailureListFilter) {
    const limit = Math.min(Math.max(Number(f.limit) || 50, 1), 200);
    const m: Record<string, any> = { ...match(f), status: { $in: FAILED } };
    if (f.group) m['failure.group'] = f.group === 'unknown' ? { $in: [null, 'unknown'] } : f.group;
    if (f.code) m['failure.code'] = f.code;
    if (f.cursor) {
        const [at, id] = String(f.cursor).split('|');
        const d = new Date(at);
        if (!Number.isNaN(d.getTime()) && /^[a-f0-9]{24}$/i.test(id || '')) {
            m.$or = [{ createdAt: { $lt: d } }, { createdAt: d, _id: { $lt: id } }];
        }
    }
    const rows = await PaymentIntentModel.find(m)
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit + 1)
        .select('sessionId userId countryCode gateway operator amount currency status failure createdAt updatedAt reconcileAttempts metadata.planType metadata.product metadata.originatingService metadata.campaignId metadata.callbackPath')
        .lean();
    const page = rows.slice(0, limit);
    const last = page[page.length - 1] as any;
    return {
        items: page.map((x: any) => ({
            sessionId: x.sessionId, userId: x.userId, country: x.countryCode || null, gateway: x.gateway, operator: x.operator || null,
            amount: x.amount, currency: x.currency, status: x.status,
            product: /relance/.test(x.metadata?.callbackPath || '') ? 'relance' : x.metadata?.campaignId ? 'publicite' : (x.metadata?.product || x.metadata?.planType || x.metadata?.originatingService || 'autre'),
            group: x.failure?.group || 'unknown', code: x.failure?.code || null, message: x.failure?.providerMessage || null,
            providerCode: x.failure?.providerCode || null, step: x.failure?.step || null, requestId: x.failure?.requestId || null,
            checks: x.reconcileAttempts || 0, createdAt: x.createdAt, updatedAt: x.updatedAt,
        })),
        nextCursor: rows.length > limit && last ? `${new Date(last.createdAt).toISOString()}|${last._id}` : null,
    };
}

/** The failure list as CSV (at most 5,000 rows), for the export button. */
export async function failureCsv(f: FailureListFilter): Promise<string> {
    const head = ['date', 'session', 'membre', 'pays', 'fournisseur', 'operateur', 'montant', 'devise', 'produit', 'statut', 'groupe', 'code', 'message', 'verifications'];
    const esc = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [head.join(';')];
    let cursor: string | null | undefined;
    for (let i = 0; i < 25; i++) {
        const page = await failureList({ ...f, cursor: cursor ?? undefined, limit: 200 });
        for (const x of page.items) lines.push([new Date(x.createdAt).toISOString(), x.sessionId, x.userId, x.country, x.gateway, x.operator, x.amount, x.currency, x.product, x.status, x.group, x.code, x.message, x.checks].map(esc).join(';'));
        cursor = page.nextCursor;
        if (!cursor) break;
    }
    return lines.join('\n');
}

/** Open payment alerts and the last 20 closed ones (jobs/payment-alerts.job). Not cached. */
export async function paymentAlerts() {
    const [open, recent] = await Promise.all([
        PaymentAlertModel.find({ open: true }).sort({ openedAt: -1 }).limit(50).lean(),
        PaymentAlertModel.find({ open: false }).sort({ resolvedAt: -1 }).limit(20).lean(),
    ]);
    const shape = (a: any) => ({ key: a.key, kind: a.kind, gateway: a.gateway ?? null, country: a.country ?? null, title: a.title, openedAt: a.openedAt, lastSeenAt: a.lastSeenAt, resolvedAt: a.resolvedAt ?? null, notified: !!a.notifiedAt });
    return { open: open.map(shape), recent: recent.map(shape) };
}

/**
 * Security plan Phase 11 (daily activity): unfinished payments per Douala day
 * and country, for user-service's activity rollup (it stores the result; the
 * dashboards never call this while loading). Failed ones by failure group,
 * plus those still with the provider and those never sent to one.
 */
export async function activityPayments(f: { from?: string; to?: string }) {
    const r = range({ from: f.from, to: f.to });
    const m = { createdAt: { $gte: r.start, $lt: r.end } };
    const rows = await PaymentIntentModel.aggregate([
        { $match: m },
        { $unionWith: { coll: ARCHIVE_COLLECTION, pipeline: [{ $match: m }] } },
        { $match: { status: { $nin: SUCCESS } } },
        {
            $group: {
                _id: {
                    day: { $dateToString: { date: '$createdAt', format: '%Y-%m-%d', timezone: '+01:00' } },
                    country: { $ifNull: [{ $cond: [{ $eq: ['$countryCode', ''] }, null, { $toUpper: '$countryCode' }] }, 'XX'] },
                },
                failed: { $sum: { $cond: [{ $in: ['$status', FAILED] }, 1, 0] } },
                sbc_code: { $sum: { $cond: [{ $and: [{ $in: ['$status', FAILED] }, { $eq: ['$failure.group', 'sbc_code'] }] }, 1, 0] } },
                provider_api: { $sum: { $cond: [{ $and: [{ $in: ['$status', FAILED] }, { $eq: ['$failure.group', 'provider_api'] }] }, 1, 0] } },
                member: { $sum: { $cond: [{ $and: [{ $in: ['$status', FAILED] }, { $eq: ['$failure.group', 'member'] }] }, 1, 0] } },
                waiting: { $sum: { $cond: [{ $in: ['$status', WAITING] }, 1, 0] } },
                abandoned: { $sum: { $cond: [{ $eq: ['$status', PaymentStatus.PENDING_USER_INPUT] }, 1, 0] } },
            },
        },
    ]).allowDiskUse(true);
    return {
        from: r.from,
        to: r.to,
        rows: rows.map((x: any) => ({
            day: x._id.day,
            country: x._id.country,
            failed: x.failed,
            groups: { sbc_code: x.sbc_code, provider_api: x.provider_api, member: x.member, unknown: x.failed - x.sbc_code - x.provider_api - x.member },
            waiting: x.waiting,
            abandoned: x.abandoned,
        })),
    };
}
