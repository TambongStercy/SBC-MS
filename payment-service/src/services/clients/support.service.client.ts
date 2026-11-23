import axios from 'axios';
import { randomUUID } from 'crypto';
import { Schema, model } from 'mongoose';
import config from '../../config';
import logger from '../../utils/logger';

const log = logger.getLogger('SupportServiceClient');
const SERVICE_NAME = 'payment-service';

/**
 * Opens cases in support-service (contract §2.5, POST /api/support/internal/cases,
 * idempotent on dedupKey). It never throws into the caller, and it is a no-op
 * with a warning while SUPPORT_SERVICE_URL is unset.
 *
 * Security plan Phase 5: support being down never loses a case. A send that
 * fails on the network, a 5xx or a 429 is kept in `support_case_outbox` (one
 * row per dedupKey) and sent again every 30 s with a growing wait (1 min … 30
 * min), until support answers. A 4xx (bad input) is only logged: sending it
 * again would not help. Delivered rows are removed after 30 days.
 */
export type SupportCaseType =
    | 'activation' | 'withdrawal_divergence' | 'debit_missing' | 'paid_not_debited'
    | 'duplicate_callback' | 'unknown_status' | 'amount_mismatch' | 'ledger_mismatch'
    // Security plan Phase 5: fraud cases (the fraud engine, Phase 4, opens them).
    | 'self_referral' | 'shared_payout_number' | 'multi_account' | 'abnormal_behavior' | 'geo_anomaly' | 'dormant_reactivation'
    // Account suspended on a withdrawal (no filleul + unexplained money, 2026-11-23).
    | 'no_referral_withdrawal_ban';

export interface SupportCaseInput {
    type: SupportCaseType;
    dedupKey: string;
    severity: 'info' | 'warning' | 'critical';
    subject: { userId?: string; transactionId?: string; sessionId?: string; gateway?: string };
    summary: string;
    details?: Record<string, unknown>;
    /** Member's country (ISO) when known; support looks it up otherwise. */
    country?: string;
    /** Money at stake (XAF), for the fraud queue's order. */
    amount?: number;
}

const OutboxSchema = new Schema({
    dedupKey: { type: String, required: true, unique: true },
    input: { type: Schema.Types.Mixed, required: true },
    attempts: { type: Number, default: 0 },
    nextAt: { type: Date, default: () => new Date() },
    lastError: { type: String, default: null },
    deliveredAt: { type: Date, default: null },
    createdAt: { type: Date, default: () => new Date() },
}, { collection: 'support_case_outbox', versionKey: false });
OutboxSchema.index({ deliveredAt: 1, nextAt: 1 });
OutboxSchema.index({ deliveredAt: 1 }, { expireAfterSeconds: 30 * 86400, partialFilterExpression: { deliveredAt: { $type: 'date' } } });
export const SupportCaseOutbox = model('SupportCaseOutbox', OutboxSchema);

let warnedUnset = false;
const baseUrl = () => (process.env.SUPPORT_SERVICE_URL || '').replace(/\/$/, '');

type SendResult = { ok: true; data: { caseId?: string; created?: boolean } | null } | { ok: false; retry: boolean; error: string };

async function send(input: SupportCaseInput): Promise<SendResult> {
    try {
        const res = await axios.post(`${baseUrl()}/api/support/internal/cases`, input, {
            timeout: 5000,
            headers: {
                Authorization: `Bearer ${config.services.serviceSecret}`,
                'x-service-name': SERVICE_NAME,
                'x-request-id': randomUUID(),
            },
        });
        return { ok: true, data: res.data?.data ?? null };
    } catch (error: any) {
        const status: number | undefined = error.response?.status;
        const retry = !status || status >= 500 || status === 429;
        return { ok: false, retry, error: `${status ?? ''} ${error.message}`.trim().slice(0, 300) };
    }
}

async function enqueue(input: SupportCaseInput, error: string): Promise<void> {
    try {
        await SupportCaseOutbox.updateOne(
            { dedupKey: input.dedupKey, deliveredAt: null },
            { $set: { input, lastError: error }, $setOnInsert: { attempts: 1, nextAt: new Date(Date.now() + 60_000), createdAt: new Date() } },
            { upsert: true },
        );
    } catch (err: any) {
        // A row already delivered for this dedupKey (E11000): support has the case, the new occurrence is a repeat.
        if (err?.code !== 11000) log.error(`Support case ${input.dedupKey} could not be queued: ${err?.message ?? err}`);
    }
}

export async function openSupportCase(input: SupportCaseInput): Promise<{ caseId?: string; created?: boolean } | null> {
    if (!baseUrl()) {
        if (!warnedUnset) {
            log.warn('SUPPORT_SERVICE_URL is unset: support cases are logged here only, not sent');
            warnedUnset = true;
        }
        log.warn(`[support-case skipped] ${input.type} ${input.dedupKey}: ${input.summary}`);
        return null;
    }
    const r = await send(input);
    if (r.ok) return r.data;
    if (r.retry) {
        log.warn(`Support unreachable, case ${input.dedupKey} queued for retry: ${r.error}`);
        await enqueue(input, r.error);
    } else {
        log.error(`Could not open support case ${input.dedupKey}: ${r.error}`);
    }
    return null;
}

/** One pass over the queued cases that are due. Returns how many were delivered. */
export async function flushSupportCaseOutbox(now: Date = new Date(), batch = 50): Promise<number> {
    if (!baseUrl()) return 0;
    const due = await SupportCaseOutbox.find({ deliveredAt: null, nextAt: { $lte: now } }).sort({ nextAt: 1 }).limit(batch).lean();
    let delivered = 0;
    for (const row of due as any[]) {
        const r = await send(row.input as SupportCaseInput);
        if (r.ok || !r.retry) {
            await SupportCaseOutbox.updateOne({ _id: row._id }, { $set: { deliveredAt: new Date(), lastError: r.ok ? null : r.error } });
            if (r.ok) delivered++;
            else log.error(`Queued support case ${row.dedupKey} refused: ${r.error}`);
            continue;
        }
        const attempts = (row.attempts ?? 0) + 1;
        const waitMin = Math.min(2 ** Math.min(attempts, 5), 30);
        await SupportCaseOutbox.updateOne({ _id: row._id }, { $set: { attempts, lastError: r.error, nextAt: new Date(Date.now() + waitMin * 60_000) } });
        break; // support still down: the rest waits for the next pass
    }
    if (delivered) log.info(`Delivered ${delivered} queued support case(s)`);
    return delivered;
}

let timer: NodeJS.Timeout | null = null;
let flushing = false;

/** Starts the 30-second retry loop (server start). */
export function startSupportCaseOutbox(): void {
    if (timer) return;
    timer = setInterval(() => {
        if (flushing) return;
        flushing = true;
        flushSupportCaseOutbox().catch((err) => log.error(`Support case outbox pass failed: ${err?.message ?? err}`)).finally(() => { flushing = false; });
    }, 30_000);
    timer.unref?.();
}

export function stopSupportCaseOutbox(): void {
    if (timer) clearInterval(timer);
    timer = null;
}
