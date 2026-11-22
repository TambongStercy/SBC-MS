import { createHmac, randomUUID } from 'crypto';
import axios from 'axios';
import { Types } from 'mongoose';
import { sourceCollection } from '../lib/sources';
import { config } from '../config';
import { KYC_BACKFILL, KYC_LIVE, KycQueueModel, KycResultModel } from '../database/models';
import { childLogger } from '../lib/logger';
import { hashOf } from './identity';

/**
 * Security plan Phase 8: KYC level 1, risk-service side.
 *
 *   user-service ── hint {userId, reason} ──▶ kycqueue ──▶ (1 batch / s) ──▶ kyc-worker (secondary server)
 *                                                │                                    │
 *            nightly refresh (02:05 Douala) ─────┘          kycresults ◀── signals + score
 *
 * Nothing runs on the member's request: the hint is a fire-and-forget call, and a
 * lost one is caught by the nightly refresh, which re-queues every member whose
 * checked fields changed (fingerprint) or who was never checked.
 */
const log = childLogger('Kyc');

/** Bump when the checks change: every member is then checked again by the nightly refresh. */
export const LEVEL1_VERSION = 1;
const DAY_MS = 86_400_000;
const USER_FIELDS = { email: 1, phoneNumber: 1, country: 1, ipCountry: 1, 'geo.lastCountry': 1, momoNumber: 1, momoOperator: 1, deleted: 1 };
export type KycReason = 'signup' | 'contact_change' | 'refresh' | 'manual';
const REASONS: KycReason[] = ['signup', 'contact_change', 'refresh', 'manual'];

// ---------------------------------------------------------------- users database (read-only)

/** The users collection (native driver) once connected; null when not configured or unreachable. */
const usersCollection = () => sourceCollection('users', 'users');

// ---------------------------------------------------------------- helpers

const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '').replace(/^00/, '');
export function fingerprintOf(u: any): string {
    const parts = [LEVEL1_VERSION, String(u.email ?? '').trim().toLowerCase(), digits(u.phoneNumber), digits(u.momoNumber),
        String(u.momoOperator ?? '').toUpperCase(), String(u.country ?? '').trim().toLowerCase()];
    return createHmac('sha256', config.hashKey).update(`kycfp:${parts.join('|')}`).digest('hex').slice(0, 32);
}
export function doualaHour(now: Date = new Date()): number { return (now.getUTCHours() + 1) % 24; }
export function inNightWindow(now: Date = new Date()): boolean {
    const h = doualaHour(now);
    const { nightFrom: a, nightTo: b } = config.kyc;
    return a <= b ? h >= a && h < b : h >= a || h < b;
}
const isId = (s: string) => /^[a-f0-9]{24}$/i.test(s);

// ---------------------------------------------------------------- queue

/** Queue (or re-queue) members. A live hint outranks a backfill row and makes a running check redo. */
export async function enqueue(userIds: string[], reason: KycReason, now: Date = new Date()): Promise<number> {
    const ids = [...new Set(userIds.filter(isId))];
    if (!ids.length || !REASONS.includes(reason)) return 0;
    const priority = reason === 'refresh' ? KYC_BACKFILL : KYC_LIVE;
    const ops = ids.map(_id => ({
        updateOne: {
            filter: { _id },
            update: {
                $setOnInsert: { enqueuedAt: now, attempts: 0 },
                $set: priority === KYC_LIVE ? { reason, nextAt: now, lastError: null } : { nextAt: now },
                $min: { priority },
                $inc: { v: 1 },
            },
            upsert: true,
        },
    }));
    const r = await KycQueueModel.bulkWrite(ops as any, { ordered: false });
    return (r.upsertedCount ?? 0) + (r.modifiedCount ?? 0);
}

async function claim(limit: number, now: Date) {
    const allowBackfill = config.kyc.backfillAnytime || inNightWindow(now);
    const free = { $or: [{ claimedUntil: null }, { claimedUntil: { $lt: now } }] };
    const due = await KycQueueModel.find({ nextAt: { $lte: now }, priority: allowBackfill ? { $in: [KYC_LIVE, KYC_BACKFILL] } : KYC_LIVE, ...free })
        .sort({ priority: 1, nextAt: 1 }).limit(limit).select('_id').lean();
    if (!due.length) return [];
    const token = randomUUID();
    await KycQueueModel.updateMany({ _id: { $in: due.map(d => d._id) }, ...free }, { $set: { claimedUntil: new Date(now.getTime() + 120_000), claimToken: token } });
    return KycQueueModel.find({ claimToken: token }).lean();
}

// ---------------------------------------------------------------- worker

export interface WorkerItem { ref: string; email?: string | null; phone?: string | null; country?: string | null; ipCountry?: string | null; geoCountry?: string | null; momoNumber?: string | null; momoOperator?: string | null }

export function signBody(raw: string, ts: number, secret = config.kyc.secret): string {
    return createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex');
}

async function callWorker(items: WorkerItem[]): Promise<any[]> {
    const raw = JSON.stringify({ items });
    const ts = Math.floor(Date.now() / 1000);
    const res = await axios.post(`${config.kyc.workerUrl}/v1/level1`, raw, {
        timeout: 15_000,
        headers: { 'content-type': 'application/json', 'x-kyc-timestamp': String(ts), 'x-kyc-signature': signBody(raw, ts) },
        maxBodyLength: 1024 * 1024,
        transformRequest: [(d) => d],
    });
    const results = res.data?.results;
    if (!Array.isArray(results)) throw new Error('worker answered without results');
    return results;
}

export function kycReady(): boolean {
    return !config.kyc.disabled && !!config.kyc.workerUrl && config.kyc.secret.length >= 32 && !!config.sources.usersUri;
}

// ---------------------------------------------------------------- one batch

export interface BatchOutcome { claimed: number; checked: number; unchanged: number; gone: number; failed: number; ms: number }

/** Takes up to `limit` due members, checks the ones whose fields changed, stores signals + score. */
export async function processBatch(limit = config.kyc.perSecond, now: Date = new Date()): Promise<BatchOutcome> {
    const t0 = Date.now();
    const out: BatchOutcome = { claimed: 0, checked: 0, unchanged: 0, gone: 0, failed: 0, ms: 0 };
    const users = await usersCollection();
    if (!users) return out;
    const rows: any[] = await claim(limit, now);
    out.claimed = rows.length;
    if (!rows.length) return out;

    const found = await users.find({ _id: { $in: rows.map(r => new Types.ObjectId(r._id)) } }, { projection: USER_FIELDS }).toArray();
    const byId = new Map(found.map((u: any) => [String(u._id), u]));
    const existing = await KycResultModel.find({ userId: { $in: rows.map(r => r._id) } }, { userId: 1, fingerprint: 1 }).lean();
    const fpOf = new Map(existing.map((e: any) => [e.userId, e.fingerprint]));

    const done: any[] = [];
    const items: WorkerItem[] = [];
    const work: { row: any; fp: string }[] = [];
    for (const row of rows) {
        const u: any = byId.get(row._id);
        if (!u || u.deleted) { out.gone += 1; done.push(row); continue; }
        const fp = fingerprintOf(u);
        if (fpOf.get(row._id) === fp) { out.unchanged += 1; done.push(row); continue; }
        work.push({ row, fp });
        items.push({
            ref: row._id, email: u.email ?? null, phone: u.phoneNumber ?? null, country: u.country ?? null,
            ipCountry: u.ipCountry ?? null, geoCountry: u.geo?.lastCountry ?? null, momoNumber: u.momoNumber ?? null, momoOperator: u.momoOperator ?? null,
        });
    }

    if (items.length) {
        let results: any[] | null = null;
        try {
            results = await callWorker(items);
        } catch (e: any) {
            const why = String(e?.response?.status ?? e?.code ?? e?.message ?? 'error').slice(0, 80);
            out.failed = items.length;
            log.warn({ items: items.length, why }, 'kyc-worker unreachable; batch kept for later');
            await KycQueueModel.bulkWrite(work.map(({ row }) => ({
                updateOne: {
                    filter: { _id: row._id, claimToken: row.claimToken },
                    update: {
                        $set: { claimedUntil: null, claimToken: null, lastError: why, nextAt: new Date(now.getTime() + Math.min(30 * 60_000, 30_000 * 2 ** Math.min(6, row.attempts ?? 0))) },
                        $inc: { attempts: 1 },
                    },
                },
            })) as any, { ordered: false });
        }
        if (results) {
            const byRef = new Map(results.map((r: any) => [String(r.ref), r]));
            const resultOps: any[] = [];
            const keys = new Map<string, string>();
            for (const { row } of work) {
                const r: any = byRef.get(row._id);
                if (r?.emailNormalized) keys.set(row._id, hashOf('email', String(r.emailNormalized)));
            }
            // Other accounts whose address reaches the same mailbox (already checked, plus this batch).
            const keyList = [...new Set(keys.values())];
            const others = keyList.length
                ? await KycResultModel.aggregate([{ $match: { emailKey: { $in: keyList } } }, { $group: { _id: '$emailKey', users: { $addToSet: '$userId' } } }])
                : [];
            const holders = new Map<string, Set<string>>(others.map((o: any) => [o._id, new Set(o.users)]));
            for (const [uid, k] of keys) { if (!holders.has(k)) holders.set(k, new Set()); holders.get(k)!.add(uid); }

            for (const { row, fp } of work) {
                const r: any = byRef.get(row._id);
                if (!r || r.error) { out.failed += 1; continue; }
                const emailKey = keys.get(row._id) ?? null;
                const variantAccounts = emailKey ? Math.max(0, (holders.get(emailKey)?.size ?? 1) - 1) : 0;
                const reasons: string[] = Array.isArray(r.reasons) ? r.reasons.slice(0, 20) : [];
                if (variantAccounts > 0) reasons.push('email_variant_shared');
                const score = Math.min(100, Number(r.score || 0) + (variantAccounts > 0 ? config.kyc.variantPoints : 0));
                resultOps.push({
                    updateOne: {
                        filter: { userId: row._id },
                        update: {
                            $set: {
                                level: 1, fingerprint: fp, signals: r.signals ?? {}, reasons, workerScore: Number(r.score || 0), score,
                                band: score >= 50 ? 'high' : score >= 20 ? 'medium' : 'low', emailKey, variantAccounts, trigger: row.reason,
                                checkedAt: now, expiresAt: new Date(now.getTime() + config.kyc.retentionDays * DAY_MS),
                            },
                        },
                        upsert: true,
                    },
                });
                out.checked += 1;
                done.push(row);
            }
            if (resultOps.length) await KycResultModel.bulkWrite(resultOps, { ordered: false });
            const failedRows = work.filter(w => { const r: any = byRef.get(w.row._id); return !r || r.error; });
            if (failedRows.length) {
                await KycQueueModel.bulkWrite(failedRows.map(({ row }) => ({
                    updateOne: { filter: { _id: row._id, claimToken: row.claimToken }, update: { $set: { claimedUntil: null, claimToken: null, lastError: 'check_failed', nextAt: new Date(now.getTime() + 3600_000) }, $inc: { attempts: 1 } } },
                })) as any, { ordered: false });
            }
        }
    }

    // Done: removed unless a new hint arrived meanwhile (v changed), which keeps it queued.
    if (done.length) {
        await KycQueueModel.bulkWrite(done.map(row => ({ deleteOne: { filter: { _id: row._id, v: row.v, claimToken: row.claimToken } } })) as any, { ordered: false });
        await KycQueueModel.updateMany({ _id: { $in: done.map(r => r._id) }, claimToken: { $in: [...new Set(done.map(r => r.claimToken))] } },
            { $set: { claimedUntil: null, claimToken: null } });
    }
    out.ms = Date.now() - t0;
    return out;
}

// ---------------------------------------------------------------- nightly refresh

/**
 * Queues (as backfill) every member never checked, or whose checked fields changed since.
 * Reads users with a projection, 1,000 at a time; writes only the queue.
 */
export async function refreshScan(opts: { dryRun?: boolean; batch?: number; limit?: number } = {}): Promise<{ scanned: number; missing: number; changed: number; queued: number; ms: number }> {
    const t0 = Date.now();
    const users = await usersCollection();
    const out = { scanned: 0, missing: 0, changed: 0, queued: 0, ms: 0 };
    if (!users) return out;
    const size = opts.batch ?? 1000;
    const cursor = users.find({ deleted: { $ne: true } }, { projection: USER_FIELDS }).sort({ _id: 1 }).batchSize(size);
    let batch: any[] = [];
    const flush = async () => {
        if (!batch.length) return;
        const ids = batch.map(u => String(u._id));
        const have = new Map((await KycResultModel.find({ userId: { $in: ids } }, { userId: 1, fingerprint: 1 }).lean()).map((r: any) => [r.userId, r.fingerprint]));
        const todo: string[] = [];
        for (const u of batch) {
            const id = String(u._id);
            const fp = have.get(id);
            if (!fp) { out.missing += 1; todo.push(id); } else if (fp !== fingerprintOf(u)) { out.changed += 1; todo.push(id); }
        }
        if (todo.length && !opts.dryRun) out.queued += await enqueue(todo, 'refresh');
        batch = [];
    };
    for await (const u of cursor) {
        out.scanned += 1;
        batch.push(u);
        if (batch.length >= size) await flush();
        if (opts.limit && out.scanned >= opts.limit) break;
    }
    await flush();
    out.ms = Date.now() - t0;
    return out;
}

// ---------------------------------------------------------------- loop

let timer: NodeJS.Timeout | null = null;
let running = false;
let lastRefreshDay: string | null = null;
const stats = { batches: 0, checked: 0, failed: 0, lastBatchAt: null as Date | null };

/** One batch a second; the refresh once a night at the window's start (+5 min). */
export function startKycLoop(): void {
    if (timer || !kycReady()) {
        if (!kycReady()) log.info('KYC level 1 off (KYC_WORKER_URL, KYC_SHARED_SECRET or USERS_MONGODB_URI missing, or KYC_DISABLED)');
        return;
    }
    log.info({ perSecond: config.kyc.perSecond, night: `${config.kyc.nightFrom}-${config.kyc.nightTo} Douala` }, 'KYC level 1 loop started');
    timer = setInterval(() => {
        if (running) return;
        running = true;
        (async () => {
            const now = new Date();
            const day = new Date(now.getTime() + 3600_000).toISOString().slice(0, 10);
            if (doualaHour(now) === config.kyc.nightFrom && now.getUTCMinutes() >= 5 && lastRefreshDay !== day) {
                lastRefreshDay = day;
                const r = await refreshScan();
                log.info(r, 'KYC nightly refresh queued');
            }
            const b = await processBatch(config.kyc.perSecond, now);
            if (b.claimed) {
                stats.batches += 1; stats.checked += b.checked; stats.failed += b.failed; stats.lastBatchAt = now;
                if (b.checked || b.failed) log.debug(b, 'KYC batch');
            }
        })().catch((e) => log.warn({ message: e?.message }, 'KYC batch failed')).finally(() => { running = false; });
    }, 1000);
}
export function stopKycLoop(): void { if (timer) clearInterval(timer); timer = null; }

export async function kycStatus() {
    const [queued, live, results, high, medium] = await Promise.all([
        KycQueueModel.estimatedDocumentCount(),
        KycQueueModel.countDocuments({ priority: KYC_LIVE }),
        KycResultModel.estimatedDocumentCount(),
        KycResultModel.countDocuments({ band: 'high' }),
        KycResultModel.countDocuments({ band: 'medium' }),
    ]);
    return { ready: kycReady(), queued, live, results, bands: { high, medium }, ...stats };
}

/** The member's level 1, as the support desk will show it (no email, number or key). */
export async function kycView(userId: string) {
    const r: any = await KycResultModel.findOne({ userId }, { _id: 0, emailKey: 0, fingerprint: 0 }).lean();
    return r ? { level: r.level, score: r.score, band: r.band, reasons: r.reasons, signals: r.signals, variantAccounts: r.variantAccounts, checkedAt: r.checkedAt } : null;
}
