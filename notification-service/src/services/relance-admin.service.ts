import mongoose from 'mongoose';
import RelanceConfigModel from '../database/models/relance-config.model';
import RelanceTargetModel, { TargetStatus, ExitReason } from '../database/models/relance-target.model';
import CampaignModel from '../database/models/relance-campaign.model';
import RelancePackCreditModel from '../database/models/relance-pack-credit.model';
import { findPack } from '../config/relance-packs';
import { userServiceClient } from './clients/user.service.client';
import { AdminFilters, dateMatch } from '../utils/admin-filters';
import { memberIdSetForCountry } from '../utils/country-members';

/**
 * Read models for the admin Relance screens. Kept apart from the member-facing
 * controllers so the admin numbers say what they measure: "relance des nouveaux"
 * (targets with no campaignId) and "campagnes de relance" (campaignId set) are
 * counted separately, as they are different products.
 */

export interface Person { _id: string; name: string; phoneNumber?: string; email?: string }

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days are UTC, like the sender's daily allowance. */
const startOfUtcDay = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

/** Name and contact for each id, in one call to user-service. Unknown or deleted users are absent. */
export async function peopleById(ids: string[]): Promise<Record<string, Person>> {
    const unique = [...new Set(ids.filter(Boolean).map(String))];
    if (unique.length === 0) return {};
    const users = await userServiceClient.getBatchUserDetails(unique);
    const map: Record<string, Person> = {};
    for (const u of users) {
        map[String(u._id)] = { _id: String(u._id), name: u.name, phoneNumber: u.phoneNumber, email: u.email };
    }
    return map;
}

/*
 * Admin filters (?country, ?from, ?to) for the relance screens.
 *
 * Relance records have no country of their own: they belong to the parrain's
 * country (the owner's userId: RelanceConfig.userId, RelanceTarget.referrerUserId,
 * Campaign.userId, RelancePackCredit.userId — all ObjectIds). Rather than send the
 * ~50–70k member ids of a big country into every query, the parrains actually
 * present in the collection (a distinct on an indexed field: a few thousand at
 * most) are intersected in memory with the country's members, and only those go
 * into `$in`.
 */
type OwnerModel = { distinct(field: string): any };

/** `{ [field]: { $in: owners of that country } }`, or `{}` without a country. Throws CountryMembersUnavailableError. */
export async function ownerMatch(model: OwnerModel, field: string, f: AdminFilters): Promise<Record<string, unknown>> {
    if (!f.country) return {};
    const [members, owners] = await Promise.all([
        memberIdSetForCountry(f.country),
        model.distinct(field) as Promise<unknown[]>,
    ]);
    return { [field]: { $in: owners.filter(o => o != null && members.has(String(o))) } };
}

/**
 * A figure with its own window ("last 30 days", "today") keeps it; ?from/?to
 * narrow it further (the intersection), so a past range gives 0 for "today".
 */
export function windowMatch(field: string, since: Date, f: AdminFilters): Record<string, { $gte: Date; $lte?: Date }> {
    const from = f.from && f.from > since ? f.from : since;
    return { [field]: { $gte: from, ...(f.to ? { $lte: f.to } : {}) } };
}

async function countSends(since: Date, today: Date, f: AdminFilters = {}, owners: Record<string, unknown> = {}) {
    const sentAt = windowMatch('messagesDelivered.sentAt', since, f);
    const rows: Array<{ _id: { channel: string; status: string; today: boolean }; n: number }> = await RelanceTargetModel.aggregate([
        { $match: { ...owners, ...sentAt } },
        { $unwind: '$messagesDelivered' },
        { $match: sentAt },
        {
            $group: {
                _id: {
                    channel: { $ifNull: ['$messagesDelivered.channel', 'email'] },
                    status: '$messagesDelivered.status',
                    today: { $gte: ['$messagesDelivered.sentAt', today] },
                },
                n: { $sum: 1 },
            },
        },
    ]);
    const empty = () => ({ email: 0, sms: 0, failed: 0 });
    const out = { today: empty(), last7Days: empty() };
    for (const { _id, n } of rows) {
        const buckets = _id.today ? [out.today, out.last7Days] : [out.last7Days];
        for (const b of buckets) {
            if (_id.status !== 'delivered') b.failed += n;
            else if (_id.channel === 'sms') b.sms += n;
            else b.email += n;
        }
    }
    return out;
}

async function packSales(since: Date | undefined, f: AdminFilters, owners: Record<string, unknown>) {
    const when = since ? windowMatch('creditedAt', since, f) : dateMatch('creditedAt', f);
    const rows: Array<{ _id: string; n: number }> = await RelancePackCreditModel.aggregate([
        { $match: { ...owners, ...when } },
        { $group: { _id: '$packId', n: { $sum: 1 } } },
    ]);
    let count = 0;
    let amountXAF = 0;
    for (const { _id, n } of rows) {
        count += n;
        amountXAF += (findPack(_id)?.priceXAF ?? 0) * n;
    }
    return { count, amountXAF };
}

/**
 * Filters: country = the parrain's, everywhere. Dates:
 * - "active" targets (nouveaux and campaigns): `enteredLoopAt` in range;
 * - figures with a window (today, 7 days, 30 days): window ∩ range, on
 *   `enteredLoopAt` / `exitedLoopAt` / `messagesDelivered.sentAt` / `creditedAt`;
 * - campaigns by status: campaign `createdAt`; packs total: `creditedAt`;
 * - credits left: balances right now, country only (a balance has no date).
 */
export async function adminOverview(now: Date = new Date(), f: AdminFilters = {}) {
    const today = startOfUtcDay(now);
    const since30 = new Date(now.getTime() - 30 * DAY_MS);
    const since7 = new Date(now.getTime() - 7 * DAY_MS);
    // `campaignId: null` matches both a missing field and an explicit null.
    const nouveaux = { campaignId: null };
    const [tOwners, cOwners, kOwners, pOwners] = await Promise.all([
        ownerMatch(RelanceTargetModel, 'referrerUserId', f),
        ownerMatch(RelanceConfigModel, 'userId', f),
        ownerMatch(CampaignModel, 'userId', f),
        ownerMatch(RelancePackCreditModel, 'userId', f),
    ]);
    const entered = dateMatch('enteredLoopAt', f);

    const [
        active, enrolledToday, paid30, finished30,
        statusRows, campaignTargetsActive,
        sends, balances, packsAll, packs30,
    ] = await Promise.all([
        RelanceTargetModel.countDocuments({ ...nouveaux, ...tOwners, status: TargetStatus.ACTIVE, ...entered }),
        RelanceTargetModel.countDocuments({ ...nouveaux, ...tOwners, ...windowMatch('enteredLoopAt', today, f) }),
        RelanceTargetModel.countDocuments({ ...nouveaux, ...tOwners, exitReason: ExitReason.PAID, ...windowMatch('exitedLoopAt', since30, f) }),
        RelanceTargetModel.countDocuments({ ...nouveaux, ...tOwners, exitReason: ExitReason.COMPLETED_7_DAYS, ...windowMatch('exitedLoopAt', since30, f) }),
        CampaignModel.aggregate([{ $match: { ...kOwners, ...dateMatch('createdAt', f) } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
        RelanceTargetModel.countDocuments({ campaignId: { $ne: null }, ...tOwners, status: TargetStatus.ACTIVE, ...entered }),
        countSends(since7, today, f, tOwners),
        RelanceConfigModel.aggregate([
            { $match: cOwners },
            {
                $group: {
                    _id: null,
                    email: { $sum: { $ifNull: ['$emailBalance', 0] } },
                    sms: { $sum: { $ifNull: ['$smsBalance', 0] } },
                    withCredits: { $sum: { $cond: [{ $or: [{ $gt: ['$emailBalance', 0] }, { $gt: ['$smsBalance', 0] }] }, 1, 0] } },
                },
            },
        ]),
        packSales(undefined, f, pOwners),
        packSales(since30, f, pOwners),
    ]);

    const byStatus: Record<string, number> = {};
    for (const r of statusRows as Array<{ _id: string; n: number }>) byStatus[r._id] = r.n;
    const b = (balances as any[])[0] ?? { email: 0, sms: 0, withCredits: 0 };

    return {
        nouveaux: { active, enrolledToday, paidLast30Days: paid30, finishedLast30Days: finished30 },
        campaigns: { byStatus, activeTargets: campaignTargetsActive },
        sends,
        credits: { emailLeft: b.email, smsLeft: b.sms, parrainsWithCredits: b.withCredits },
        packs: { total: packsAll, last30Days: packs30 },
    };
}

/**
 * Filters: country = the parrain's (config owner); dates = config `createdAt`
 * (when the parrain first set relance up). The per-parrain figures (in loop,
 * packs) stay whole: they describe the listed parrain.
 */
export async function adminParrains(
    opts: { page: number; limit: number; withCredits: boolean; userId?: string; filters?: AdminFilters },
    now: Date = new Date(),
) {
    const today = startOfUtcDay(now);
    const f = opts.filters ?? {};
    const query: Record<string, unknown> = { ...dateMatch('createdAt', f) };
    if (opts.withCredits) query.$or = [{ emailBalance: { $gt: 0 } }, { smsBalance: { $gt: 0 } }];
    const owners = await ownerMatch(RelanceConfigModel, 'userId', f);
    if (owners.userId) query.userId = owners.userId;
    if (opts.userId) {
        if (!mongoose.isValidObjectId(opts.userId)) return { parrains: [], total: 0, page: opts.page, totalPages: 0 };
        const id = new mongoose.Types.ObjectId(opts.userId);
        // With a country too, the parrain must also be of that country.
        query.userId = owners.userId ? { $in: ((owners.userId as { $in: unknown[] }).$in).filter(o => id.equals(o as any)) } : id;
    }

    const [configs, total] = await Promise.all([
        RelanceConfigModel.find(query)
            .select('userId enabled enrollmentPaused sendingPaused smsEnabled emailBalance smsBalance messagesSentToday lastResetDate updatedAt')
            .sort({ updatedAt: -1 })
            .skip((opts.page - 1) * opts.limit)
            .limit(opts.limit)
            .lean(),
        RelanceConfigModel.countDocuments(query),
    ]);

    const ids = configs.map(c => c.userId);
    const [people, targetRows, packRows] = await Promise.all([
        peopleById(ids.map(String)),
        RelanceTargetModel.aggregate([
            { $match: { referrerUserId: { $in: ids }, status: TargetStatus.ACTIVE } },
            { $group: { _id: { user: '$referrerUserId', campaign: { $cond: [{ $ifNull: ['$campaignId', false] }, true, false] } }, n: { $sum: 1 } } },
        ]),
        RelancePackCreditModel.aggregate([
            { $match: { userId: { $in: ids } } },
            { $group: { _id: '$userId', n: { $sum: 1 }, last: { $max: '$creditedAt' } } },
        ]),
    ]);

    const inLoop: Record<string, { nouveaux: number; campaigns: number }> = {};
    for (const r of targetRows as Array<{ _id: { user: unknown; campaign: boolean }; n: number }>) {
        const k = String(r._id.user);
        inLoop[k] ??= { nouveaux: 0, campaigns: 0 };
        if (r._id.campaign) inLoop[k].campaigns += r.n; else inLoop[k].nouveaux += r.n;
    }
    const packs: Record<string, { count: number; lastAt: Date }> = {};
    for (const r of packRows as Array<{ _id: unknown; n: number; last: Date }>) packs[String(r._id)] = { count: r.n, lastAt: r.last };

    return {
        parrains: configs.map(c => {
            const id = String(c.userId);
            return {
                userId: id,
                user: people[id] ?? null,
                enabled: c.enabled,
                enrollmentPaused: c.enrollmentPaused,
                sendingPaused: c.sendingPaused,
                smsEnabled: !!c.smsEnabled,
                emailBalance: c.emailBalance ?? 0,
                smsBalance: c.smsBalance ?? 0,
                // The sender only zeroes the count when it next runs for this parrain.
                emailsSentToday: c.lastResetDate && c.lastResetDate >= today ? (c.messagesSentToday ?? 0) : 0,
                inLoop: inLoop[id] ?? { nouveaux: 0, campaigns: 0 },
                packs: packs[id] ?? { count: 0, lastAt: null },
            };
        }),
        total,
        page: opts.page,
        totalPages: Math.ceil(total / opts.limit),
    };
}
