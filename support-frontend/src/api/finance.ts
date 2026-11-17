import { api, type Page } from './http';
import type { AgeBucket, FinanceSummary, FinanceWithdrawal, RecheckResult } from './types';

export interface FinanceFilters {
  from?: string;
  to?: string;
  country?: string;
  gateway?: string;
}

export const financeApi = {
  summary: (f: FinanceFilters) => api.get<FinanceSummary>('/finance/summary', { ...f }),
  withdrawals: (f: FinanceFilters & { status?: string; ageBucket?: AgeBucket | ''; page?: number; limit?: number }) =>
    api.get<Page<FinanceWithdrawal>>('/finance/withdrawals', { ...f }),
  recheck: (transactionId: string) => api.post<RecheckResult>(`/finance/withdrawals/${encodeURIComponent(transactionId)}/recheck`),
  /** Sensitive: creates a regularization approval (never acts directly). */
  requestRegularization: (transactionId: string, body: { action: 'complete' | 'fail'; reason: string; evidence: string[]; caseId?: string }, reauthToken: string) =>
    api.post<{ approvalId: string }>(`/finance/withdrawals/${encodeURIComponent(transactionId)}/regularization-requests`, body, { reauthToken }),
};
