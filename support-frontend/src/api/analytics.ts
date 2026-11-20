import { api } from './http';

/** support-service `GET /desk/analytics` (CONTRACT §3.1). Percent values are 0–100. */
export type TicketKpis = {
  created: number; handled: number; handledOfCreatedRate: number | null;
  firstResponseMedianMin: number | null; firstResponseP90Min: number | null;
  resolutionMedianHours: number | null; resolutionP90Hours: number | null;
  slaBreachRate: number | null;
};
export type ErrorState = 'open' | 'handling' | 'resolved';
export type ErrorTypeRow = {
  id: string; method: string; route: string; status: number; code: string | null; message: string | null;
  count: number; prevCount: number; members: number; firstSeen: string; lastSeen: string;
  state: ErrorState; stateBy: string | null; note: string | null; regressions: number; hasReplay: boolean;
};
export type Analytics = {
  period: { from: string; to: string; previousFrom: string; days: number };
  kpis: {
    tickets: TicketKpis & { prev: TicketKpis; createdChange: number | null; handledChange: number | null };
    backlog: { now: number; oldestOpenHours: number | null; unassigned: number; urgent: number };
    reopened: { count: number; prev: number; rate: number | null };
    assistant: { conversations: number; prev: number; escalated: number; prevEscalated: number; settledWithoutAgentRate: number | null; prevSettledWithoutAgentRate: number | null };
    cases: { opened: number; resolved: number; openNow: number; criticalOpen: number };
    approvalsPending: number;
    errors: { total: number; prevTotal: number; change: number | null; membersAffected: number; prevMembersAffected: number; typesOpen: number; typesHandling: number; typesResolvedInPeriod: number; regressions: number };
  };
  series: {
    date: string; created: number; handled: number; backlog: number;
    firstResponseMedianHours: number | null; resolutionMedianHours: number | null;
    errorsServer: number; errorsClient: number; errorsNetwork: number;
  }[];
  categories: { key: string; label: string; count: number; prevCount: number; change: number | null; share: number | null; resolutionMedianHours: number | null; slaBreachRate: number | null; open: number }[];
  sources: { key: string; count: number }[];
  agents: { id: string; name: string; handled: number; open: number; firstResponseMedianMin: number | null }[];
  errorTypes: ErrorTypeRow[];
  insights: { tone: 'good' | 'warning' | 'critical' | 'info'; text: string }[];
};

export const analyticsApi = {
  get: (q: { from: string; to: string }) => api.get<Analytics>('/analytics', q),
  setErrorState: (id: string, state: ErrorState, note?: string) => api.post<{ before: string; after: string }>(`/analytics/errors/${encodeURIComponent(id)}/state`, { state, note }),
  /** Audited by the server, like a ticket's replay. */
  errorReplayUrl: (id: string) => api.post<{ url: string }>(`/analytics/errors/${encodeURIComponent(id)}/replay`),
};
