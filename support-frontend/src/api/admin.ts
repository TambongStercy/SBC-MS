import { api, type Page } from './http';
import type { AgentAccount, AuditEntry, AuditVerifyResult, SettingEntry } from './types';

export const agentsApi = {
  list: () => api.get<AgentAccount[]>('/agents'),
  /** Returns the one-time activation link; it is shown once and never stored by the app. */
  create: (body: { name: string; email: string; roles: string[] }, reauthToken: string) =>
    api.post<{ agent: AgentAccount; activationUrl: string }>('/agents', body, { reauthToken }),
  setRoles: (id: string, roles: string[], reauthToken: string) => api.put<AgentAccount>(`/agents/${encodeURIComponent(id)}/roles`, { roles }, { reauthToken }),
  /** Country team: [] = every country. Filters the activity panel. */
  setCountries: (id: string, countries: string[], reauthToken: string) => api.put<AgentAccount>(`/agents/${encodeURIComponent(id)}/countries`, { countries }, { reauthToken }),
  disable: (id: string, reason: string, reauthToken: string) => api.post<AgentAccount>(`/agents/${encodeURIComponent(id)}/disable`, { reason }, { reauthToken }),
  enable: (id: string, reauthToken: string) => api.post<AgentAccount>(`/agents/${encodeURIComponent(id)}/enable`, {}, { reauthToken }),
  revokeSessions: (id: string, reauthToken: string) => api.post<{ revoked: number }>(`/agents/${encodeURIComponent(id)}/revoke-sessions`, {}, { reauthToken }),
  newActivationLink: (id: string, reauthToken: string) =>
    api.post<{ activationUrl: string }>(`/agents/${encodeURIComponent(id)}/activation-link`, {}, { reauthToken }),
};

export const settingsApi = {
  list: () => api.get<SettingEntry[]>('/settings'),
  save: (key: string, value: unknown, reason: string, reauthToken: string) =>
    api.put<SettingEntry>(`/settings/${encodeURIComponent(key)}`, { value, reason }, { reauthToken }),
};

export interface AuditFilters {
  actor?: string;
  action?: string;
  objectId?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export const auditApi = {
  list: (f: AuditFilters) => api.get<Page<AuditEntry>>('/audit', { ...f }),
  verify: () => api.post<AuditVerifyResult>('/audit/verify'),
};
