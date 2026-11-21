import apiClient from '../api/apiClient';

/** Security plan Phase 7: dormant accounts (user-service; gateway module finance). */

export type DormancyStatus = 'active' | 'inactive' | 'dormant' | 'long_dormant';
export type BalanceField = 'balance' | 'usdBalance' | 'activationBalance' | 'advertisingBalance' | 'eventOrganizerBalance' | 'sbcLiveBalance';

export interface Totals { count: number; xaf: number; usd: number; xafEq: number }

export interface DormantSummary {
  ready: boolean;
  day?: string;
  at?: string;
  thresholds?: { inactiveDays: number; dormantDays: number; longDormantDays: number; minXaf?: number };
  xafPerUsd?: number;
  all?: Totals;
  /** Accounts holding less than thresholds.minXaf: in `all`, never listed. */
  belowMin?: Totals | null;
  byStatus?: Record<DormancyStatus, Totals>;
  dormant?: Totals & {
    byBalance: Record<BalanceField, number>;
    byCountry: (Totals & { country: string })[];
    bySize: (Totals & { key: string; label: string })[];
    flags: Record<'commissionsNoLogin' | 'fraudFlag' | 'checked' | 'noAuthenticator' | 'neverWithdrew', Totals>;
    basis: Record<string, number>;
  };
  share?: number;
  previous?: { day: string; count: number; xafEq: number } | null;
  trend?: { month: string; day: string; count: number; xafEq: number; allXafEq: number }[];
  check?: { ok: boolean; card: { count: number; xafEq: number }; list: { count: number; xafEq: number } } | null;
  reliability?: { since: string; days: number; holdMode: 'off' | 'log' | 'on'; holdHours: number };
}

export interface DormantFilters {
  status?: 'inactive' | 'dormant' | 'long_dormant';
  country?: string;
  minXaf?: number;
  authenticator?: 'yes' | 'no';
  withdrawal?: 'never' | 'over_90d' | 'within_90d';
  fraud?: 'yes' | 'no';
  checked?: 'yes' | 'no';
  commissionsNoLogin?: 'yes';
}

export interface DormantRow {
  _id: string;
  name: string;
  email: string;
  phoneNumber: string;
  country: string;
  status: DormancyStatus | null;
  lastSeenAt: string | null;
  basis: string | null;
  balances: Record<BalanceField, number>;
  debt: number;
  heldXaf: number;
  commissionsNoLogin: boolean;
  lastCommissionAt: string | null;
  lastWithdrawalAt: string | null;
  authenticator: boolean;
  fraudFlag: boolean;
  frozen: boolean;
  checkedAt: string | null;
  checkedBy: string | null;
  checkedNote: string | null;
  reactivatedAt: string | null;
  holdUntil: string | null;
}

export interface DormantPage { items: DormantRow[]; nextCursor: string | null; totals?: { count: number; xafEq: number } }

export interface DormantExport { id: string; status: 'running' | 'done' | 'failed'; rows: number; fileName: string | null; error: string | null }

const clean = (f: DormantFilters) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined && v !== ''));

export async function getDormantSummary(): Promise<DormantSummary> {
  const r = await apiClient.get('/users/admin/dormant-accounts/summary');
  return r.data.data;
}

export async function getDormantList(filters: DormantFilters, cursor?: string | null): Promise<DormantPage> {
  const r = await apiClient.get('/users/admin/dormant-accounts', { params: { ...clean(filters), cursor: cursor || undefined, limit: 50 } });
  return r.data.data;
}

export async function startDormantExport(filters: DormantFilters): Promise<{ id: string }> {
  const r = await apiClient.post('/users/admin/dormant-accounts/export', { filters: clean(filters) });
  return r.data.data;
}

export async function getDormantExport(id: string): Promise<DormantExport> {
  const r = await apiClient.get(`/users/admin/dormant-accounts/exports/${id}`);
  return r.data.data;
}

/** Downloads the finished CSV through the API (the token goes in the header, never in a link). */
export async function downloadDormantExport(id: string, fileName: string): Promise<void> {
  const r = await apiClient.get(`/users/admin/dormant-accounts/exports/${id}/download`, { responseType: 'blob' });
  const url = URL.createObjectURL(r.data as Blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function markDormantChecked(userId: string, note?: string): Promise<void> {
  await apiClient.post(`/users/admin/dormant-accounts/${userId}/checked`, { note: note || undefined });
}

export async function requestDormantFreeze(userId: string, reason: string): Promise<{ caseId: string | null; queued: boolean }> {
  const r = await apiClient.post(`/users/admin/dormant-accounts/${userId}/freeze-request`, { reason });
  return r.data.data;
}
