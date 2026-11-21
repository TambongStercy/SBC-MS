import apiClient from '../api/apiClient';

/** Security plan Phase 11: daily activity (user-service computes it once; the support desk reads the same figures). */

export type FailureGroup = 'sbc_code' | 'provider_api' | 'member' | 'unknown';
export type Range = 'today' | '7d' | '30d';
export type Source = 'web' | 'app' | 'api';

export interface ActivityRow {
  country: string;
  connected: number;
  connectedTrend: number | null;
  signups: { started: number; completed: number; failed: number; inProgress: number; failedGroups: Record<FailureGroup, number>; reasons: Record<string, number> };
  completedTrend: number | null;
  activated: number;
  activatedTrend: number | null;
  payments: { failed: number; waiting: number; abandoned: number; groups: Record<FailureGroup, number> };
}

export interface ActivityBoard {
  range: { key: Range; from: string; to: string; days: number; previous: { from: string; to: string } };
  source: Source | null;
  countries: string[] | null;
  rows: ActivityRow[];
  total: ActivityRow;
  daily: { day: string; current: boolean; connected: number; started: number; completed: number; failed: number; activated: number; paymentsFailed: number }[];
  reasons: { code: string; group: FailureGroup; label: string }[];
  connectedExact: boolean;
  connectedCollecting: boolean;
  updatedAt: string | null;
  computedAt: string;
  notes: { connected: string; paymentsSource: string };
}

export interface BoardQuery { range: Range; country?: string; source?: Source }

export interface SignupItem {
  id: string; startedAt: string; day: string; country: string; geoCountry: string | null; source: Source;
  outcome: 'in_progress' | 'completed' | 'failed'; step: string; reason: string | null; group: FailureGroup | null; reasonLabel: string | null;
  detail: string | null; email: string | null; phone: string | null; sponsorCode: string | null; annonceur: boolean; userId: string | null;
  wrongCodes: number; delivery: { channel: string; status: string; error?: string | null; at?: string }[]; requestId: string | null;
  completedAt: string | null; failedAt: string | null;
}
export interface ConnectedItem { id: string; userId: string; name: string | null; declaredCountry: string | null; day: string; country: string; requests: number; logins: number; sources: { web: number; app: number; api: number }; lastAt: string }
export interface ActivatedItem { id: string; userId: string; name: string | null; country: string; subscriptionType: string; createdAt: string }

export type ListKind = 'signups' | 'connected' | 'activated';
export interface ListQuery { kind: ListKind; from: string; to: string; country?: string; source?: Source; outcome?: string; group?: string; reason?: string; cursor?: string }

const clean = (q: object) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== ''));

export async function getActivityBoard(q: BoardQuery): Promise<ActivityBoard> {
  const r = await apiClient.get('/users/admin/activity', { params: clean(q) });
  return r.data.data;
}

export async function getActivityList<T = SignupItem | ConnectedItem | ActivatedItem>(q: ListQuery): Promise<{ items: T[]; nextCursor: string | null }> {
  const r = await apiClient.get('/users/admin/activity/list', { params: clean(q) });
  return r.data.data;
}
