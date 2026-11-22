import { api } from './http';

/** Security plan Phase 11: the day's activity (user-service computes it once for admin and support). */
export type FailureGroup = 'sbc_code' | 'provider_api' | 'member' | 'unknown';

export interface ActivityRow {
  country: string;
  connected: number;
  connectedTrend: number | null;
  signups: { started: number; completed: number; failed: number; inProgress: number; failedGroups: Record<FailureGroup, number>; reasons: Record<string, number> };
  completedTrend: number | null;
  activated: number;
  payments: { failed: number; waiting: number; abandoned: number; groups: Record<FailureGroup, number> };
  /** Security plan Phase 1: sign-in steps (absent before the release that records them). */
  signins?: { attempts: number; codeSent: number; signedIn: number; failed: number; reasons: Record<string, number> };
}

export interface ActivityBoard {
  range: { key: 'today' | '7d' | '30d'; from: string; to: string; days: number };
  rows: ActivityRow[];
  total: ActivityRow;
  reasons: { code: string; group: FailureGroup; label: string }[];
  signinReasons?: { code: string; label: string }[];
  connectedCollecting: boolean;
  updatedAt: string | null;
}

export const activityApi = {
  /** `board` is null when a country outside the agent's team is asked for. */
  board: (q: { range?: string; source?: string; country?: string }) => api.get<{ board: ActivityBoard | null; team: string[] }>('/activity', q),
};
