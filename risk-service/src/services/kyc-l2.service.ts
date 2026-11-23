import { randomUUID } from 'crypto';
import { Types } from 'mongoose';
import { config } from '../config';
import { KycL2QueueModel, KycL2RequestModel, RiskMemberModel } from '../database/models';
import { sourceCollection } from '../lib/sources';
import { childLogger } from '../lib/logger';
import { callSecondary, kycReady } from './kyc.service';

/**
 * Security plan Phase 8, KYC level 2 (2026-11-23), main-server side: which members the
 * secondary server looks up (Holehe sign-up checks + Gravatar on their e-mail address).
 * Only members the fraud engine flags, never a backfill:
 *   - score at require_code or hold (sweep every 10 min: `score_require_code` / `score_hold`);
 *   - a risky authenticator setup (user-service's review found a reason: `auth_setup_review`);
 *   - a dormant account back (`dormant_reactivated`);
 *   - a contact change by a member already flagged (`contact_change_flagged`).
 * A member is asked about once per KYC_L2_RECHECK_DAYS (90); a changed e-mail drops the old
 * result on the secondary first. The address is read here (read-only) only at send time and
 * never stored on the main server. While KYC_L2_ONLY_EMAILS is set (same list as the
 * secondary's), any other address is skipped here and never sent. The secondary decides the rest:
 * its mode (off|log), its own copy of the allowlist, its daily cap and pacing.
 */
const log = childLogger('KycL2');
const DAY = 86_400_000;
export type L2Trigger = 'score_require_code' | 'score_hold' | 'auth_setup_review' | 'dormant_reactivated' | 'contact_change_flagged' | 'manual';
const isId = (s: string) => /^[a-f0-9]{24}$/i.test(s);

export const l2Ready = () => kycReady() && !config.kycL2.disabled;

/**
 * Requests that still count as "asked recently". A member skipped because of the allowlist is not
 * asked again while it is set (no daily loop), and becomes eligible again as soon as it is emptied.
 */
const recentFilter = (now: Date) => (config.kycL2.onlyEmails.size
    ? { retryAt: { $gt: now } }
    : { retryAt: { $gt: now }, outcome: { $ne: 'skipped_allowlist' } });

/** Queues members for a lookup, unless asked about recently (`force` skips that, for `manual`). */
export async function l2Request(userIds: string[], trigger: L2Trigger, now: Date = new Date(), force = false): Promise<number> {
    let ids = [...new Set(userIds.filter(isId))];
    if (!ids.length || config.kycL2.disabled) return 0;
    if (!force) {
        const recent = new Set((await KycL2RequestModel.find({ _id: { $in: ids }, ...recentFilter(now) }, { _id: 1 }).lean() as any[]).map(r => String(r._id)));
        ids = ids.filter(id => !recent.has(id));
    }
    if (!ids.length) return 0;
    await KycL2QueueModel.bulkWrite(ids.map(_id => ({
        updateOne: {
            filter: { _id },
            // a waiting forget is kept: it is sent first, then the check
            update: { $setOnInsert: { action: 'check', enqueuedAt: now, attempts: 0 }, $set: { trigger, nextAt: now, lastError: null } },
            upsert: true,
        },
    })) as any, { ordered: false });
    return ids.length;
}

/** The member's e-mail changed: the secondary drops the old result; asked about again if flagged. */
export async function l2EmailChanged(userId: string, flagged: boolean, now: Date = new Date()): Promise<void> {
    if (!isId(userId) || config.kycL2.disabled) return;
    await KycL2QueueModel.updateOne({ _id: userId }, { $set: { action: 'forget', trigger: flagged ? 'contact_change_flagged' : 'forget', nextAt: now, enqueuedAt: now, attempts: 0, lastError: null } }, { upsert: true });
    await KycL2RequestModel.deleteOne({ _id: userId });
}

/** Members whose score reached require_code or hold and who were not asked about recently. */
export async function sweepFlagged(now: Date = new Date(), limit = 5000): Promise<number> {
    const flagged = await RiskMemberModel.find({ decision: { $in: ['require_code', 'hold'] } }, { userId: 1, decision: 1 }).limit(limit).lean() as any[];
    if (!flagged.length) return 0;
    const recent = new Set((await KycL2RequestModel.find({ _id: { $in: flagged.map(f => f.userId) }, ...recentFilter(now) }, { _id: 1 }).lean() as any[]).map(r => String(r._id)));
    const queued = new Set((await KycL2QueueModel.find({ _id: { $in: flagged.map(f => f.userId) } }, { _id: 1 }).lean() as any[]).map(r => String(r._id)));
    let n = 0;
    for (const d of ['hold', 'require_code'] as const) {
        const ids = flagged.filter(f => f.decision === d && !recent.has(f.userId) && !queued.has(f.userId)).map(f => f.userId);
        if (ids.length) n += await l2Request(ids, d === 'hold' ? 'score_hold' : 'score_require_code', now, true);
    }
    return n;
}

/** How long before the same member may be asked about again, by the secondary's answer. */
function retryAfterMs(outcome: string): number {
    switch (outcome) {
        case 'queued': case 'fresh': case 'skipped_allowlist': return config.kycL2.recheckDays * DAY;
        case 'invalid': case 'no_email': case 'gone': return 30 * DAY;
        default: return DAY; // off, not_allowlisted: asked again tomorrow (the switch may have changed)
    }
}

export interface L2Forward { claimed: number; checks: number; forgets: number; gone: number; failed: number; outcomes: Record<string, number> }

/** Up to `limit` due rows: forgets first, then checks with the address read (read-only) now. */
export async function forwardL2(limit = 50, now: Date = new Date()): Promise<L2Forward> {
    const out: L2Forward = { claimed: 0, checks: 0, forgets: 0, gone: 0, failed: 0, outcomes: {} };
    const users = await sourceCollection('users', 'users');
    if (!users) return out;
    const free = { $or: [{ claimedUntil: null }, { claimedUntil: { $lt: now } }] };
    const due = await KycL2QueueModel.find({ nextAt: { $lte: now }, ...free }).sort({ nextAt: 1 }).limit(limit).select('_id').lean();
    if (!due.length) return out;
    const token = randomUUID();
    await KycL2QueueModel.updateMany({ _id: { $in: due.map(d => d._id) }, ...free }, { $set: { claimedUntil: new Date(now.getTime() + 120_000), claimToken: token } });
    const rows: any[] = await KycL2QueueModel.find({ claimToken: token }).lean();
    out.claimed = rows.length;
    const backoff = async (list: any[], why: string) => {
        out.failed += list.length;
        log.warn({ rows: list.length, why }, 'KYC level 2: secondary unreachable; kept for later');
        await KycL2QueueModel.bulkWrite(list.map(r => ({
            updateOne: {
                filter: { _id: r._id, claimToken: token },
                update: { $set: { claimedUntil: null, claimToken: null, lastError: why, nextAt: new Date(now.getTime() + Math.min(30 * 60_000, 30_000 * 2 ** Math.min(6, r.attempts ?? 0))) }, $inc: { attempts: 1 } },
            },
        })) as any, { ordered: false });
    };
    const why = (e: any) => String(e?.response?.status ?? e?.code ?? e?.message ?? 'error').slice(0, 80);

    // forgets: the old result goes; a flagged member is then checked with the new address
    const forgets = rows.filter(r => r.action === 'forget');
    if (forgets.length) {
        try {
            await callSecondary('/v1/l2/forget', { refs: forgets.map(r => r._id) }, 10_000);
            out.forgets = forgets.length;
            for (const r of forgets) {
                if (r.trigger === 'contact_change_flagged') {
                    await KycL2QueueModel.updateOne({ _id: r._id, claimToken: token }, { $set: { action: 'check', nextAt: now, claimedUntil: null, claimToken: null, attempts: 0 } });
                } else {
                    await KycL2QueueModel.deleteOne({ _id: r._id, claimToken: token });
                }
            }
        } catch (e: any) { await backoff(forgets, why(e)); }
    }

    const checks = rows.filter(r => r.action === 'check');
    if (!checks.length) return out;
    const found = await users.find({ _id: { $in: checks.map(r => new Types.ObjectId(r._id)) } }, { projection: { email: 1, deleted: 1 } }).toArray();
    const byId = new Map(found.map((u: any) => [String(u._id), u]));
    const items: { ref: string; email: string; trigger: string }[] = [];
    const record = async (id: string, trigger: string, outcome: string) => {
        out.outcomes[outcome] = (out.outcomes[outcome] ?? 0) + 1;
        await KycL2RequestModel.updateOne({ _id: id }, { $set: { trigger, outcome, at: now, retryAt: new Date(now.getTime() + retryAfterMs(outcome)) } }, { upsert: true });
        await KycL2QueueModel.deleteOne({ _id: id, claimToken: token, action: 'check' });
    };
    for (const r of checks) {
        const u: any = byId.get(r._id);
        if (!u || u.deleted) { out.gone += 1; await record(r._id, r.trigger, 'gone'); continue; }
        const email = typeof u.email === 'string' ? u.email.trim().toLowerCase() : '';
        if (!email) { await record(r._id, r.trigger, 'no_email'); continue; }
        // allowlist set (preprod, tests): anyone else's address never leaves this server
        if (config.kycL2.onlyEmails.size && !config.kycL2.onlyEmails.has(email)) { await record(r._id, r.trigger, 'skipped_allowlist'); continue; }
        items.push({ ref: r._id, email, trigger: r.trigger });
    }
    if (!items.length) return out;
    try {
        const res = await callSecondary<{ outcomes: Record<string, string> }>('/v1/l2/enqueue', { items }, 10_000);
        if (!res?.outcomes || typeof res.outcomes !== 'object') throw new Error('secondary answered without outcomes');
        out.checks = items.length;
        for (const it of items) await record(it.ref, it.trigger, res.outcomes[it.ref] ?? 'unknown');
    } catch (e: any) {
        await backoff(checks.filter(r => items.some(i => i.ref === r._id)), why(e));
    }
    return out;
}

let timer: NodeJS.Timeout | null = null;
let running = false;
let lastSweep = 0;
export const l2Stats = { sent: 0, failed: 0, swept: 0, lastSweepAt: null as Date | null, lastOutcomes: {} as Record<string, number> };

/** Every 5 s: send what is due; every 10 min: queue the members the engine flags. */
export function startKycL2Loop(): void {
    if (timer) return;
    if (!l2Ready()) { log.info('KYC level 2 feeder off (KYC level 1 not ready, or KYC_L2_DISABLED)'); return; }
    log.info({ recheckDays: config.kycL2.recheckDays }, 'KYC level 2 feeder started (lookups run on the secondary server)');
    timer = setInterval(() => {
        if (running) return;
        running = true;
        (async () => {
            const now = new Date();
            if (now.getTime() - lastSweep > 10 * 60_000) {
                lastSweep = now.getTime();
                const n = await sweepFlagged(now);
                l2Stats.swept += n; l2Stats.lastSweepAt = now;
                if (n) log.info({ queued: n }, 'KYC level 2: flagged members queued');
            }
            const b = await forwardL2(50, now);
            l2Stats.sent += b.checks; l2Stats.failed += b.failed;
            if (b.checks) l2Stats.lastOutcomes = b.outcomes;
        })().catch((e) => log.warn({ message: e?.message }, 'KYC level 2 pass failed')).finally(() => { running = false; });
    }, 5000);
}
export function stopKycL2Loop(): void { if (timer) clearInterval(timer); timer = null; }

export async function l2Status() {
    const [outbox, requests] = await Promise.all([KycL2QueueModel.estimatedDocumentCount(), KycL2RequestModel.estimatedDocumentCount()]);
    return { ready: l2Ready(), outbox, requests, ...l2Stats };
}
