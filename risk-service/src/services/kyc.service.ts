import { createHmac, randomUUID } from 'crypto';
import axios from 'axios';
import { Types } from 'mongoose';
import { sourceCollection } from '../lib/sources';
import { config } from '../config';
import { KYC_BACKFILL, KYC_LIVE, KycQueueModel, KycResultModel } from '../database/models';
import { childLogger } from '../lib/logger';

/**
 * Security plan Phase 8: KYC level 1, main-server side. Since 2026-11-22 KYC runs entirely
 * on the secondary server (kyc-worker + kyc-runner): its queue, pacing, checks and results
 * live there. risk-service only hands over the fields and reads results back.
 *
 *   user-service ── hint ──▶ kycqueue (outbox) ──▶ every second ──▶ POST /v1/enqueue (secondary)
 *   nightly 02:05 Douala: users (fingerprints) ──▶ POST /v1/needed ──▶ POST /v1/enqueue (backfill)
 *   member view / status ──▶ POST /v1/results, /v1/status (1.5 s budget)
 *
 * The old `kycresults` collection is no longer written; it is kept (never deleted, its TTL
 * expires rows after 12 months) and shown only while the secondary has no result yet.
 */
const log = childLogger('Kyc');

/** Bump when the checks change: every member is then checked again by the nightly refresh. */
export const LEVEL1_VERSION = 1;
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

/** Due outbox rows, live first. Backfill pacing (night window) is the secondary's job now. */
async function claim(limit: number, now: Date) {
    const free = { $or: [{ claimedUntil: null }, { claimedUntil: { $lt: now } }] };
    const due = await KycQueueModel.find({ nextAt: { $lte: now }, ...free }).sort({ priority: 1, nextAt: 1 }).limit(limit).select('_id').lean();
    if (!due.length) return [];
    const token = randomUUID();
    await KycQueueModel.updateMany({ _id: { $in: due.map(d => d._id) }, ...free }, { $set: { claimedUntil: new Date(now.getTime() + 120_000), claimToken: token } });
    return KycQueueModel.find({ claimToken: token }).lean();
}

// ---------------------------------------------------------------- secondary server

export interface KycFields { email: string | null; phone: string | null; country: string | null; ipCountry: string | null; geoCountry: string | null; momoNumber: string | null; momoOperator: string | null }
export interface SubmitItem { ref: string; fingerprint: string; priority: 'live' | 'backfill'; reason: string; fields: KycFields }

export function signBody(raw: string, ts: number, secret = config.kyc.secret): string {
    return createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex');
}

/** A signed POST to kyc-worker on the secondary server. */
async function callSecondary<T = any>(path: string, body: unknown, timeoutMs = 15_000): Promise<T> {
    const raw = JSON.stringify(body);
    const ts = Math.floor(Date.now() / 1000);
    const res = await axios.post(`${config.kyc.workerUrl}${path}`, raw, {
        timeout: timeoutMs,
        headers: { 'content-type': 'application/json', 'x-kyc-timestamp': String(ts), 'x-kyc-signature': signBody(raw, ts) },
        maxBodyLength: 1024 * 1024,
        transformRequest: [(d) => d],
    });
    return res.data as T;
}

const fieldsOf = (u: any): KycFields => ({
    email: u.email ?? null, phone: u.phoneNumber ?? null, country: u.country ?? null, ipCountry: u.ipCountry ?? null,
    geoCountry: u.geo?.lastCountry ?? null, momoNumber: u.momoNumber ?? null, momoOperator: u.momoOperator ?? null,
});

const SUBMIT_MAX = 500;
async function submit(items: SubmitItem[]): Promise<number> {
    let queued = 0;
    for (let i = 0; i < items.length; i += SUBMIT_MAX) {
        const r = await callSecondary<{ queued: number }>('/v1/enqueue', { items: items.slice(i, i + SUBMIT_MAX) });
        if (typeof r?.queued !== 'number') throw new Error('secondary answered without queued');
        queued += r.queued;
    }
    return queued;
}

export function kycReady(): boolean {
    return !config.kyc.disabled && !!config.kyc.workerUrl && config.kyc.secret.length >= 32 && !!config.sources.usersUri;
}

// ---------------------------------------------------------------- outbox → secondary

export interface ForwardOutcome { claimed: number; sent: number; gone: number; failed: number; ms: number }

/** Takes up to `limit` due outbox rows, reads the members' fields (read-only) and submits them. */
export async function forwardBatch(limit = SUBMIT_MAX, now: Date = new Date()): Promise<ForwardOutcome> {
    const t0 = Date.now();
    const out: ForwardOutcome = { claimed: 0, sent: 0, gone: 0, failed: 0, ms: 0 };
    const users = await usersCollection();
    if (!users) return out;
    const rows: any[] = await claim(limit, now);
    out.claimed = rows.length;
    if (!rows.length) return out;

    const found = await users.find({ _id: { $in: rows.map(r => new Types.ObjectId(r._id)) } }, { projection: USER_FIELDS }).toArray();
    const byId = new Map(found.map((u: any) => [String(u._id), u]));
    const done: any[] = [];
    const sendRows: any[] = [];
    const items: SubmitItem[] = [];
    for (const row of rows) {
        const u: any = byId.get(row._id);
        if (!u || u.deleted) { out.gone += 1; done.push(row); continue; }
        sendRows.push(row);
        items.push({ ref: row._id, fingerprint: fingerprintOf(u), priority: row.priority === KYC_LIVE ? 'live' : 'backfill', reason: row.reason, fields: fieldsOf(u) });
    }
    if (items.length) {
        try {
            await submit(items);
            out.sent = items.length;
            done.push(...sendRows);
        } catch (e: any) {
            const why = String(e?.response?.status ?? e?.code ?? e?.message ?? 'error').slice(0, 80);
            out.failed = items.length;
            log.warn({ items: items.length, why }, 'KYC secondary unreachable; kept for later');
            await KycQueueModel.bulkWrite(sendRows.map(row => ({
                updateOne: {
                    filter: { _id: row._id, claimToken: row.claimToken },
                    update: {
                        $set: { claimedUntil: null, claimToken: null, lastError: why, nextAt: new Date(now.getTime() + Math.min(30 * 60_000, 30_000 * 2 ** Math.min(6, row.attempts ?? 0))) },
                        $inc: { attempts: 1 },
                    },
                },
            })) as any, { ordered: false });
        }
    }
    // Sent: removed unless a new hint arrived meanwhile (v changed), which keeps it for the next pass.
    if (done.length) {
        await KycQueueModel.bulkWrite(done.map(row => ({ deleteOne: { filter: { _id: row._id, v: row.v, claimToken: row.claimToken } } })) as any, { ordered: false });
        await KycQueueModel.updateMany({ _id: { $in: done.map(r => r._id) }, claimToken: { $in: [...new Set(done.map(r => r.claimToken))] } },
            { $set: { claimedUntil: null, claimToken: null } });
    }
    out.ms = Date.now() - t0;
    return out;
}

// ---------------------------------------------------------------- nightly sync

/**
 * Two phases, 1,000 members at a time: send only {id, fingerprint}; the secondary answers
 * which members it has never checked, checked with other fields, or whose result expired;
 * only those are submitted (as backfill, checked in the secondary's night window).
 * Reads users with a projection; writes nothing on the main server.
 */
export async function syncScan(opts: { dryRun?: boolean; batch?: number; limit?: number } = {}): Promise<{ scanned: number; needed: number; queued: number; ms: number }> {
    const t0 = Date.now();
    const users = await usersCollection();
    const out = { scanned: 0, needed: 0, queued: 0, ms: 0 };
    if (!users) return out;
    const size = Math.min(2000, opts.batch ?? 1000);
    const cursor = users.find({ deleted: { $ne: true } }, { projection: USER_FIELDS }).sort({ _id: 1 }).batchSize(size);
    let batch: any[] = [];
    const flush = async () => {
        if (!batch.length) return;
        const fps = new Map(batch.map(u => [String(u._id), fingerprintOf(u)]));
        const r = await callSecondary<{ refs: string[] }>('/v1/needed', { items: [...fps].map(([ref, fingerprint]) => ({ ref, fingerprint })) });
        const need = new Set(Array.isArray(r?.refs) ? r.refs : []);
        out.needed += need.size;
        if (need.size && !opts.dryRun) {
            out.queued += await submit(batch.filter(u => need.has(String(u._id)))
                .map(u => ({ ref: String(u._id), fingerprint: fps.get(String(u._id))!, priority: 'backfill' as const, reason: 'refresh', fields: fieldsOf(u) })));
        }
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
let lastSyncDay: string | null = null;
const stats = { batches: 0, sent: 0, failed: 0, lastBatchAt: null as Date | null, lastSync: null as null | { at: Date; scanned: number; needed: number; queued: number; ms: number; error?: string } };

/** The outbox once a second; the sync once a night at the window's start (+5 min). */
export function startKycLoop(): void {
    if (timer || !kycReady()) {
        if (!kycReady()) log.info('KYC level 1 off (KYC_WORKER_URL, KYC_SHARED_SECRET or USERS_MONGODB_URI missing, or KYC_DISABLED)');
        return;
    }
    log.info({ secondary: config.kyc.workerUrl.replace(/^https?:\/\//, '').split('/')[0], syncAt: `${config.kyc.nightFrom}:05 Douala` }, 'KYC feeder started (checks run on the secondary server)');
    timer = setInterval(() => {
        if (running) return;
        running = true;
        (async () => {
            const now = new Date();
            const day = new Date(now.getTime() + 3600_000).toISOString().slice(0, 10);
            if (doualaHour(now) === config.kyc.nightFrom && now.getUTCMinutes() >= 5 && lastSyncDay !== day) {
                lastSyncDay = day;
                try {
                    const r = await syncScan();
                    stats.lastSync = { at: now, ...r };
                    log.info(r, 'KYC nightly sync submitted');
                } catch (e: any) {
                    stats.lastSync = { at: now, scanned: 0, needed: 0, queued: 0, ms: 0, error: String(e?.response?.status ?? e?.code ?? e?.message).slice(0, 80) };
                    log.warn({ why: stats.lastSync.error }, 'KYC nightly sync failed (next night retries)');
                }
            }
            const b = await forwardBatch(SUBMIT_MAX, now);
            if (b.claimed) {
                stats.batches += 1; stats.sent += b.sent; stats.failed += b.failed; stats.lastBatchAt = now;
            }
        })().catch((e) => log.warn({ message: e?.message }, 'KYC forward failed')).finally(() => { running = false; });
    }, 1000);
}
export function stopKycLoop(): void { if (timer) clearInterval(timer); timer = null; }

/** Outbox here + queue/results on the secondary (no member data). */
export async function kycStatus() {
    const [outbox, retrying] = await Promise.all([KycQueueModel.estimatedDocumentCount(), KycQueueModel.countDocuments({ attempts: { $gt: 0 } })]);
    let secondary: any = null;
    let secondaryError: string | null = null;
    if (kycReady()) {
        try { secondary = await callSecondary('/v1/status', {}, 3000); } catch (e: any) { secondaryError = String(e?.response?.status ?? e?.code ?? e?.message).slice(0, 80); }
    }
    return { ready: kycReady(), outbox, retrying, secondary, secondaryError, ...stats };
}

const shape = (r: any) => ({ level: r.level, score: r.score, band: r.band, reasons: r.reasons, signals: r.signals, variantAccounts: r.variantAccounts, checkedAt: r.checkedAt });

/**
 * The member's level 1, as the support desk shows it (no email, number or key), read from
 * the secondary (1.5 s budget). While it has none yet, or cannot be reached, the last result
 * computed on the main server before 2026-11-22 is shown, marked `source: 'archive'`.
 */
export async function kycView(userId: string) {
    if (kycReady()) {
        try {
            const r = await callSecondary<{ results: Record<string, any> }>('/v1/results', { refs: [userId] }, 1500);
            const hit = r?.results?.[userId];
            if (hit) return { ...shape(hit), source: 'secondary' as const };
        } catch (e: any) {
            log.debug({ why: e?.code ?? e?.message }, 'KYC result not readable from the secondary');
        }
    }
    const old: any = await KycResultModel.findOne({ userId }, { _id: 0, emailKey: 0, fingerprint: 0 }).lean();
    return old ? { ...shape(old), source: 'archive' as const } : null;
}
