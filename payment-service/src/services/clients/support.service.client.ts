import axios from 'axios';
import { randomUUID } from 'crypto';
import config from '../../config';
import logger from '../../utils/logger';

const log = logger.getLogger('SupportServiceClient');

/**
 * Opens cases in support-service (contract §2.5, POST /api/support/internal/cases,
 * idempotent on dedupKey). Best-effort by design: it never throws into the
 * caller, and it is a no-op with a warning while SUPPORT_SERVICE_URL is unset.
 */
export type SupportCaseType =
    | 'activation' | 'withdrawal_divergence' | 'debit_missing' | 'paid_not_debited'
    | 'duplicate_callback' | 'unknown_status' | 'amount_mismatch' | 'ledger_mismatch';

export interface SupportCaseInput {
    type: SupportCaseType;
    dedupKey: string;
    severity: 'info' | 'warning' | 'critical';
    subject: { userId?: string; transactionId?: string; sessionId?: string; gateway?: string };
    summary: string;
    details?: Record<string, unknown>;
}

let warnedUnset = false;

export async function openSupportCase(input: SupportCaseInput): Promise<{ caseId?: string; created?: boolean } | null> {
    const base = (process.env.SUPPORT_SERVICE_URL || '').replace(/\/$/, '');
    if (!base) {
        if (!warnedUnset) {
            log.warn('SUPPORT_SERVICE_URL is unset: support cases are logged here only, not sent');
            warnedUnset = true;
        }
        log.warn(`[support-case skipped] ${input.type} ${input.dedupKey}: ${input.summary}`);
        return null;
    }
    try {
        const res = await axios.post(`${base}/api/support/internal/cases`, input, {
            timeout: 5000,
            headers: {
                Authorization: `Bearer ${config.services.serviceSecret}`,
                'x-service-name': 'payment-service',
                'x-request-id': randomUUID(),
            },
        });
        return res.data?.data ?? null;
    } catch (error: any) {
        log.error(`Could not open support case ${input.dedupKey}: ${error.response?.status ?? ''} ${error.message}`);
        return null;
    }
}
