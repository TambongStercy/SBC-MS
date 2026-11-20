import apiClient from '../api/apiClient';

/** Security plan Phase 10: payment conversion figures (payment-service, read-only). */

export interface FunnelCounts {
  attempts: number; opened: number; chosen: number; reached: number;
  succeeded: number; failed: number; waiting: number; credited: number;
}
export interface Row extends FunnelCounts { successRate: number | null; successOfReached?: number | null }

export interface ConversionSummary {
  range: { from: string; to: string };
  totals: FunnelCounts & { members: number; payingMembers: number; attemptConversion: number | null; memberConversion: number | null };
  byGateway: (Row & { gateway: string })[];
  byCountry: (Row & { country: string })[];
  byProduct: (Row & { product: string })[];
  byCountryGateway: (Row & { country: string; gateway: string })[];
  daily: { day: string; attempts: number; succeeded: number; failed: number }[];
  failureGroups: Partial<Record<FailureGroup, number>>;
  topCodes: { group: FailureGroup; code: string; count: number; message: string | null }[];
  stuckOver24h: { gateway: string; count: number }[];
  medianSecondsToSuccess: number | null;
  computedAt: string;
}

export type FailureGroup = 'sbc_code' | 'provider_api' | 'member' | 'unknown';

export interface FailureItem {
  sessionId: string; userId: string; country: string | null; gateway: string; operator: string | null;
  amount: number; currency: string; status: string; product: string;
  group: FailureGroup; code: string | null; message: string | null; providerCode: string | null;
  step: string | null; requestId: string | null; checks: number; createdAt: string; updatedAt: string;
}

export interface ConversionQuery { from?: string; to?: string; country?: string; gateway?: string }
export interface FailureQuery extends ConversionQuery { group?: string; code?: string; cursor?: string; limit?: number }

const clean = (q: object) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== ''));

export async function getConversionSummary(q: ConversionQuery): Promise<ConversionSummary> {
  const r = await apiClient.get('/payments/admin/conversion/summary', { params: clean(q) });
  return r.data.data;
}

export async function getFailures(q: FailureQuery): Promise<{ items: FailureItem[]; nextCursor: string | null }> {
  const r = await apiClient.get('/payments/admin/conversion/failures', { params: clean(q) });
  return r.data.data;
}

/** Downloads the failure list as CSV (the request needs the admin token, so not a plain link). */
export async function downloadFailuresCsv(q: FailureQuery): Promise<void> {
  const r = await apiClient.get('/payments/admin/conversion/failures', { params: { ...clean(q), format: 'csv' }, responseType: 'blob' });
  const url = URL.createObjectURL(r.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `paiements-echecs-${q.from || ''}-${q.to || ''}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
