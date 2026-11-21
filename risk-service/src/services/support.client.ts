import axios from 'axios';
import { randomUUID } from 'crypto';
import { Schema, model } from 'mongoose';
import { config } from '../config';
import { childLogger } from '../lib/logger';

const log = childLogger('SupportClient');

/**
 * Opens fraud cases in support-service (POST /api/support/internal/cases,
 * idempotent on dedupKey: the same group or number reported again is one case
 * whose occurrence count grows). Same outbox as user-service and payment-service:
 * a send that fails on the network / 5xx / 429 is kept in `support_case_outbox`
 * and sent again until support answers. Without SUPPORT_SERVICE_URL, cases are
 * only logged.
 */
export interface CaseInput {
    type: 'self_referral' | 'shared_payout_number' | 'multi_account' | 'abnormal_behavior' | 'geo_anomaly' | 'dormant_reactivation';
    dedupKey: string; severity: 'info' | 'warning' | 'critical';
    subject: { userId?: string }; summary: string; details?: Record<string, unknown>;
    country?: string; amount?: number;
    /** false: filed without alerting anyone (look-back over past data). */
    alert?: boolean;
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

type SendResult = { ok: true } | { ok: false; retry: boolean; error: string };

async function send(input: CaseInput): Promise<SendResult> {
    try {
        await axios.post(`${config.supportUrl}/api/support/internal/cases`, input, {
            timeout: 5000,
            headers: { Authorization: `Bearer ${config.serviceSecret}`, 'x-service-name': 'risk-service', 'x-request-id': randomUUID() },
        });
        return { ok: true };
    } catch (error: any) {
        const status: number | undefined = error.response?.status;
        return { ok: false, retry: !status || status >= 500 || status === 429, error: `${status ?? ''} ${error.message}`.trim().slice(0, 300) };
    }
}

export async function openCase(input: CaseInput): Promise<'sent' | 'queued' | 'refused' | 'logged'> {
    if (!config.supportUrl) {
        log.warn({ dedupKey: input.dedupKey, type: input.type }, `[case not sent: SUPPORT_SERVICE_URL unset] ${input.summary}`);
        return 'logged';
    }
    const r = await send(input);
    if (r.ok) return 'sent';
    if (!r.retry) { log.error({ dedupKey: input.dedupKey, error: r.error }, 'support refused the case'); return 'refused'; }
    try {
        await SupportCaseOutbox.updateOne(
            { dedupKey: input.dedupKey, deliveredAt: null },
            { $set: { input, lastError: r.error }, $setOnInsert: { attempts: 1, nextAt: new Date(Date.now() + 60_000), createdAt: new Date() } },
            { upsert: true },
        );
    } catch (err: any) {
        if (err?.code !== 11000) log.error({ message: err?.message }, 'case could not be queued');
    }
    return 'queued';
}

export async function flushOutbox(batch = 50): Promise<number> {
    if (!config.supportUrl) return 0;
    const due = await SupportCaseOutbox.find({ deliveredAt: null, nextAt: { $lte: new Date() } }).sort({ nextAt: 1 }).limit(batch).lean();
    let delivered = 0;
    for (const row of due as any[]) {
        const r = await send(row.input);
        if (r.ok || !r.retry) {
            await SupportCaseOutbox.updateOne({ _id: row._id }, { $set: { deliveredAt: new Date(), lastError: r.ok ? null : r.error } });
            if (r.ok) delivered++;
            continue;
        }
        const attempts = (row.attempts ?? 0) + 1;
        await SupportCaseOutbox.updateOne({ _id: row._id }, { $set: { attempts, lastError: r.error, nextAt: new Date(Date.now() + Math.min(2 ** Math.min(attempts, 5), 30) * 60_000) } });
        break;
    }
    return delivered;
}
