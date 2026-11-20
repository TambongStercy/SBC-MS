import { serviceRequest, requireOk, isRouteMissing } from './http';
import { DependencyError } from '../../utils/errors';

/** payment-service internal support API (CONTRACT §2.2, built on feature/support-money). */

export interface PayinFailure { group: 'sbc_code' | 'provider_api' | 'member' | 'unknown'; code: string; message: string | null; providerCode: string | null; step: string; at: string }
export interface Payin { sessionId: string; gateway: string; amount: number; currency: string; status: string; purpose?: string; createdAt: string; gatewayRef?: string; failure?: PayinFailure | null; earlierFailures?: number }
export interface Withdrawal { transactionId: string; amount: number; currency: string; status: string; businessStatus: string; method?: string; createdAt: string; updatedAt?: string }
export interface RecheckResult {
    result: 'confirmed' | 'pending' | 'not_found' | 'failed' | 'provider_unavailable';
    provider: string; providerStatus?: string; providerRef?: string; amount?: number; currency?: string; checkedAt: string; requestId?: string;
}

const BASE = '/api/internal/support';
const enc = encodeURIComponent;

export async function memberPayins(userId: string, limit = 20): Promise<Payin[]> {
    return requireOk('payment', await serviceRequest<Payin[]>('payment', 'GET', `${BASE}/members/${enc(userId)}/payins`, { query: { limit } })) ?? [];
}

export async function memberWithdrawals(userId: string, limit = 20): Promise<Withdrawal[]> {
    return requireOk('payment', await serviceRequest<Withdrawal[]>('payment', 'GET', `${BASE}/members/${enc(userId)}/withdrawals`, { query: { limit } })) ?? [];
}

/** The intent if it exists and belongs to userId, else null. */
export async function lookupPayin(ref: string, userId?: string): Promise<Payin | null> {
    const r = await serviceRequest<Payin>('payment', 'GET', `${BASE}/payins/lookup`, { query: { ref, userId } });
    if (r.ok) return r.data ?? null;
    if (r.status === 404 && !isRouteMissing(r)) return null;
    throw new DependencyError('payment', r.status);
}

export async function recheckPayin(sessionId: string): Promise<RecheckResult> {
    return requireOk('payment', await serviceRequest<RecheckResult>('payment', 'POST', `${BASE}/payins/${enc(sessionId)}/recheck`, { timeoutMs: 30000 }));
}

export async function recheckWithdrawal(transactionId: string): Promise<RecheckResult> {
    return requireOk('payment', await serviceRequest<RecheckResult>('payment', 'POST', `${BASE}/withdrawals/${enc(transactionId)}/recheck`, { timeoutMs: 30000 }));
}

export interface OwnerActionResult { ok: boolean; status: number; code?: string; message?: string; data?: unknown }

export async function regularizeWithdrawal(transactionId: string, body: { action: 'complete' | 'fail'; reason: string; evidence: string[]; approvalId: string }): Promise<OwnerActionResult> {
    const r = await serviceRequest('payment', 'POST', `${BASE}/withdrawals/${enc(transactionId)}/regularize`, { body, timeoutMs: 30000 });
    if (isRouteMissing(r)) throw new DependencyError('payment', 404);
    return { ok: r.ok, status: r.status, code: r.code, message: r.message, data: r.data };
}

export async function manualActivation(body: { userId: string; gateway: string; externalRef: string; plan: string; approvalId: string }): Promise<OwnerActionResult> {
    const r = await serviceRequest('payment', 'POST', `${BASE}/activation/manual`, { body, timeoutMs: 30000 });
    if (isRouteMissing(r)) throw new DependencyError('payment', 404);
    return { ok: r.ok, status: r.status, code: r.code, message: r.message, data: r.data };
}

export async function financeSummary(query: { from?: string; to?: string; country?: string; gateway?: string }) {
    return requireOk('payment', await serviceRequest('payment', 'GET', `${BASE}/finance/summary`, { query }));
}

export async function financeWithdrawals(query: Record<string, string | number | undefined>) {
    return requireOk('payment', await serviceRequest('payment', 'GET', `${BASE}/finance/withdrawals`, { query }));
}
