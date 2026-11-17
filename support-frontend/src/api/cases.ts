import { api, type Page } from './http';
import type { CaseStatus, CaseType, RecheckResult, Severity, SupportCase } from './types';

export interface CaseFilters {
  /** One type, or 'finance' for every non-activation type. */
  type?: CaseType | 'finance' | '';
  status?: CaseStatus | 'active' | '';
  severity?: Severity | '';
  assignee?: string;
  page?: number;
  limit?: number;
}

export const casesApi = {
  list: (f: CaseFilters) => api.get<Page<SupportCase>>('/cases', { ...f }),
  get: (id: string) => api.get<SupportCase>(`/cases/${encodeURIComponent(id)}`),
  recheck: (id: string) => api.post<RecheckResult>(`/cases/${encodeURIComponent(id)}/recheck`),
  comment: (id: string, body: string) => api.post<SupportCase>(`/cases/${encodeURIComponent(id)}/comments`, { body }),
  assign: (id: string, agentId: string | null) => api.post<SupportCase>(`/cases/${encodeURIComponent(id)}/assign`, { agentId }),
  setStatus: (id: string, status: CaseStatus, reason: string) => api.post<SupportCase>(`/cases/${encodeURIComponent(id)}/status`, { status, reason }),
};
