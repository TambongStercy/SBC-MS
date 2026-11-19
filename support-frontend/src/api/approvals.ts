import { api } from './http';
import type { Approval, ApprovalStatus } from './types';

export const approvalsApi = {
  /** `mine` = the requests this agent made. */
  list: (q: { status?: ApprovalStatus | ''; mine?: boolean }) => api.get<Approval[]>('/approvals', { status: q.status, mine: q.mine ? 1 : undefined }),
  approve: (id: string, note: string | undefined, reauthToken: string) =>
    api.post<Approval>(`/approvals/${encodeURIComponent(id)}/approve`, { note }, { reauthToken }),
  reject: (id: string, reason: string, reauthToken: string) =>
    api.post<Approval>(`/approvals/${encodeURIComponent(id)}/reject`, { reason }, { reauthToken }),
};
