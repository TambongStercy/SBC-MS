import { api } from './http';
import type { RecheckResult } from './types';

export const activationApi = {
  /** Asks the provider again for one payin (by session id or provider reference). */
  check: (body: { userId?: string; sessionId?: string; reference?: string }) => api.post<RecheckResult>('/activation/check', body),
  /** Sensitive: creates a manual-activation approval. */
  requestManual: (body: { userId: string; gateway: string; externalRef: string; plan: string; reason: string; caseId?: string }, reauthToken: string) =>
    api.post<{ approvalId: string }>('/activation/manual-requests', body, { reauthToken }),
};
