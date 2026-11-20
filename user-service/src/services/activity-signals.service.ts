import { Types } from 'mongoose';
import UserModel from '../database/models/user.model';
import { UserGeoDayModel } from '../database/models/user-geo-day.model';
import logger from '../utils/logger';

const log = logger.getLogger('ActivitySignals');

/**
 * Security plan Phase 1 — signals (country, network, device, activity days).
 *
 * The gateway aggregates authenticated requests in memory and sends them here
 * in batches (POST /users/internal/activity/batch). Nothing is kept for a member
 * who has not accepted the privacy policy that announces this collection:
 * `SIGNALS_POLICY_VERSION` (default 2026-12, the version still to be published),
 * compared with `consents.privacy.version` ('YYYY-MM' strings compare in order).
 */
export const SIGNALS_POLICY_VERSION = () => process.env.SIGNALS_POLICY_VERSION || '2026-12';
const RETENTION_DAYS = 180;
const MAX_LIST = 5;
const CONSENT_CACHE_MS = 10 * 60 * 1000;

export type SignalSource = 'web' | 'app' | 'api';

export interface ActivityRecord {
    userId: string;
    day: string; // YYYY-MM-DD (Douala)
    country: string;
    requests: number;
    logins?: number;
    sources: Partial<Record<SignalSource, number>>;
    asns?: number[];
    ipRanges?: string[];
    devices?: string[];
    noDevice?: number;
    firstAt: string | Date;
    lastAt: string | Date;
}

const COUNTRY = /^[A-Z]{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DEVICE = /^[A-Za-z0-9-]{8,64}$/;
const RANGE = /^[0-9a-f.:/]{3,45}$/i;

/** The Douala calendar day of a date (UTC+1, no daylight saving). */
export const doualaDay = (d: Date = new Date()) => new Date(d.getTime() + 3600 * 1000).toISOString().slice(0, 10);

/** /24 for IPv4, /48 for IPv6: the network, never the full address. */
export function ipRange(ip: string | undefined | null): string | null {
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

const consentCache = new Map<string, { ok: boolean; at: number }>();

/** Which of these members accepted the policy announcing the collection. */
async function consenting(userIds: string[]): Promise<Set<string>> {
    const now = Date.now();
    const ok = new Set<string>();
    const unknown: string[] = [];
    for (const id of userIds) {
        const c = consentCache.get(id);
        if (c && now - c.at < CONSENT_CACHE_MS) { if (c.ok) ok.add(id); } else unknown.push(id);
    }
    if (unknown.length) {
        const rows = await UserModel.find(
            { _id: { $in: unknown.filter(Types.ObjectId.isValid).map(id => new Types.ObjectId(id)) }, 'consents.privacy.version': { $gte: SIGNALS_POLICY_VERSION() }, deleted: { $ne: true } },
            { _id: 1 },
        ).lean();
        const yes = new Set(rows.map(r => String(r._id)));
        for (const id of unknown) {
            consentCache.set(id, { ok: yes.has(id), at: now });
            if (yes.has(id)) ok.add(id);
        }
        if (consentCache.size > 200_000) consentCache.clear();
    }
    return ok;
}

/** Forget a member's cached consent (after they accept or withdraw it). */
export const forgetConsent = (userId: string) => consentCache.delete(String(userId));

const clean = (r: ActivityRecord): ActivityRecord | null => {
    if (!Types.ObjectId.isValid(r?.userId) || !DAY.test(r.day)) return null;
    const country = COUNTRY.test(String(r.country || '').toUpperCase()) ? String(r.country).toUpperCase() : 'XX';
    const num = (n: unknown) => (Number.isFinite(Number(n)) && Number(n) > 0 ? Math.min(Math.floor(Number(n)), 1_000_000) : 0);
    return {
        userId: r.userId, day: r.day, country,
        requests: num(r.requests), logins: num(r.logins), noDevice: num(r.noDevice),
        sources: { web: num(r.sources?.web), app: num(r.sources?.app), api: num(r.sources?.api) },
        asns: (r.asns || []).map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, MAX_LIST),
        ipRanges: (r.ipRanges || []).filter(x => typeof x === 'string' && RANGE.test(x)).slice(0, MAX_LIST),
        devices: (r.devices || []).filter(x => typeof x === 'string' && DEVICE.test(x)).slice(0, MAX_LIST),
        firstAt: new Date(r.firstAt), lastAt: new Date(r.lastAt),
    };
};

/**
 * Stores a batch: one upsert per member/day/country ($inc counters, capped
 * lists), and the member's lastActiveAt / geo.lastCountry. Unordered bulk
 * writes, so one bad row never blocks the others.
 */
export async function ingestActivityBatch(records: ActivityRecord[]): Promise<{ received: number; stored: number; skippedNoConsent: number }> {
    const rows = (Array.isArray(records) ? records : []).slice(0, 5000).map(clean).filter((r): r is ActivityRecord => !!r && (r.requests > 0 || (r.logins ?? 0) > 0));
    if (!rows.length) return { received: records?.length ?? 0, stored: 0, skippedNoConsent: 0 };
    const allowed = await consenting([...new Set(rows.map(r => r.userId))]);
    const kept = rows.filter(r => allowed.has(r.userId));

    if (kept.length) {
        await UserGeoDayModel.bulkWrite(kept.map(r => {
            const firstAt = new Date(r.firstAt);
            const lastAt = new Date(r.lastAt);
            return {
                updateOne: {
                    filter: { userId: new Types.ObjectId(r.userId), day: r.day, country: r.country },
                    update: [{
                        $set: {
                            requests: { $add: [{ $ifNull: ['$requests', 0] }, r.requests] },
                            logins: { $add: [{ $ifNull: ['$logins', 0] }, r.logins ?? 0] },
                            noDevice: { $add: [{ $ifNull: ['$noDevice', 0] }, r.noDevice ?? 0] },
                            'sources.web': { $add: [{ $ifNull: ['$sources.web', 0] }, r.sources.web ?? 0] },
                            'sources.app': { $add: [{ $ifNull: ['$sources.app', 0] }, r.sources.app ?? 0] },
                            'sources.api': { $add: [{ $ifNull: ['$sources.api', 0] }, r.sources.api ?? 0] },
                            asns: { $slice: [{ $setUnion: [{ $ifNull: ['$asns', []] }, r.asns ?? []] }, MAX_LIST] },
                            ipRanges: { $slice: [{ $setUnion: [{ $ifNull: ['$ipRanges', []] }, r.ipRanges ?? []] }, MAX_LIST] },
                            devices: { $slice: [{ $setUnion: [{ $ifNull: ['$devices', []] }, r.devices ?? []] }, MAX_LIST] },
                            firstAt: { $min: [{ $ifNull: ['$firstAt', firstAt] }, firstAt] },
                            lastAt: { $max: [{ $ifNull: ['$lastAt', lastAt] }, lastAt] },
                            expiresAt: { $ifNull: ['$expiresAt', new Date(new Date(`${r.day}T00:00:00Z`).getTime() + RETENTION_DAYS * 86400 * 1000)] },
                        },
                    }],
                    upsert: true,
                },
            };
        }), { ordered: false });

        // The member's latest activity and country: one write per member per batch.
        const latest = new Map<string, ActivityRecord>();
        for (const r of kept) {
            const cur = latest.get(r.userId);
            if (!cur || new Date(r.lastAt) > new Date(cur.lastAt)) latest.set(r.userId, r);
        }
        await UserModel.bulkWrite([...latest.values()].map(r => ({
            updateOne: {
                filter: { _id: new Types.ObjectId(r.userId) },
                update: [{
                    $set: {
                        lastActiveAt: { $max: [{ $ifNull: ['$lastActiveAt', new Date(0)] }, new Date(r.lastAt)] },
                        ...(r.country !== 'XX' ? (() => {
                            const newer = { $gte: [new Date(r.lastAt), { $ifNull: ['$geo.lastCountryAt', new Date(0)] }] };
                            return {
                                'geo.lastCountry': { $cond: [newer, r.country, '$geo.lastCountry'] },
                                'geo.lastCountryAt': { $cond: [newer, new Date(r.lastAt), '$geo.lastCountryAt'] },
                            };
                        })() : {}),
                        ...((r.logins ?? 0) > 0 ? { lastLoginAt: new Date(r.lastAt) } : {}),
                    },
                }],
            },
        })), { ordered: false });
    }
    if (rows.length !== kept.length) log.debug(`Activity batch: ${rows.length - kept.length} row(s) skipped (policy not accepted).`);
    return { received: records.length, stored: kept.length, skippedNoConsent: rows.length - kept.length };
}

/**
 * Nightly: each member's usual country = the one with the most active days over
 * the last 30 days, if they were active at least 5 days; `usualShare` = that
 * country's share of their active days. Members below 5 days get null.
 */
export async function recomputeUsualCountries(now: Date = new Date()): Promise<{ members: number }> {
    const since = doualaDay(new Date(now.getTime() - 30 * 86400 * 1000));
    const cursor = UserGeoDayModel.aggregate([
        { $match: { day: { $gte: since }, country: { $ne: 'XX' } } },
        { $group: { _id: { userId: '$userId', country: '$country' }, days: { $addToSet: '$day' } } },
        { $group: { _id: '$_id.userId', byCountry: { $push: { country: '$_id.country', days: { $size: '$days' } } } } },
    ]).allowDiskUse(true).cursor({ batchSize: 1000 });

    let batch: any[] = [];
    let members = 0;
    const flush = async () => {
        if (batch.length) await UserModel.bulkWrite(batch, { ordered: false });
        batch = [];
    };
    for await (const r of cursor) {
        const row = r as { _id: Types.ObjectId; byCountry: { country: string; days: number }[] };
        const total = row.byCountry.reduce((n, c) => n + c.days, 0);
        const top = row.byCountry.slice().sort((a, b) => b.days - a.days)[0];
        const usual = total >= 5 && top ? top.country : null;
        batch.push({
            updateOne: {
                filter: { _id: row._id },
                update: { $set: { 'geo.usualCountry': usual, 'geo.usualShare': usual ? Math.round((top.days / total) * 100) / 100 : null, 'geo.usualComputedAt': now } },
            },
        });
        members++;
        if (batch.length >= 1000) await flush();
    }
    await flush();
    log.info(`Usual countries recomputed for ${members} member(s).`);
    return { members };
}
