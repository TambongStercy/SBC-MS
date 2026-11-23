import { api } from './http';
import type { MemberHit, MemberWithdrawal, Payin, RiskCard, SupportMember, Ticket } from './types';

export interface CommissionInfo {
  transactionId: string; amount: number; currency: string; status: string; createdAt: string; description?: string;
  isCommission: boolean; level: number | null; sourceUserId: string | null; reversible: boolean; reversed: boolean;
}

export type ReplaySession = { sessionId: string; startedAt: string | null; durationMs: number | null; pages: number | null; device: string | null; live: boolean };
export type AssistStart = { grantId: string; expiresAt: string; live: (ReplaySession & { url: string })[] };

export const membersApi = {
  search: (q: string) => api.post<MemberHit[]>('/members/search', { q }), // POST: an email or phone never goes in a URL
  get: (id: string) => api.get<{ member: SupportMember }>(`/members/${encodeURIComponent(id)}`),
  payins: (id: string) => api.get<Payin[]>(`/members/${encodeURIComponent(id)}/payins`, { limit: 20 }),
  withdrawals: (id: string) => api.get<MemberWithdrawal[]>(`/members/${encodeURIComponent(id)}/withdrawals`, { limit: 20 }),
  tickets: (id: string) => api.get<Ticket[]>(`/members/${encodeURIComponent(id)}/tickets`),
  /** Security plan Phase 4: score, reasons, linked accounts, KYC (finance managers). */
  risk: (id: string) => api.get<RiskCard>(`/members/${encodeURIComponent(id)}/risk`),
  // Session replay + live assistance (OpenReplay, 2026-11-23). Links come only from the audited calls.
  sessions: (id: string) => api.get<{ live: ReplaySession[]; recorded: ReplaySession[] }>(`/members/${encodeURIComponent(id)}/sessions`),
  openSession: (id: string, sessionId: string, live: boolean) =>
    api.post<{ url: string }>(`/members/${encodeURIComponent(id)}/sessions/${encodeURIComponent(sessionId)}/open`, { live }),
  startAssist: (id: string, ticketId?: string) =>
    api.post<AssistStart>(`/members/${encodeURIComponent(id)}/assist`, ticketId ? { ticketId } : {}),
  endAssist: (grantId: string) => api.post<{ ended: boolean }>(`/members/assist/${encodeURIComponent(grantId)}/end`, {}),
  /** After the approval: sends the confirmation code to the member's NEW email or number. */
  sendContactCode: (approvalId: string) => api.post<{ ok: boolean }>(`/members/contact-change/${encodeURIComponent(approvalId)}/send-code`, {}),
  /** Applies the change with the code the member received (needs a reauth token). */
  applyContactChange: (approvalId: string, code: string, reauthToken: string) =>
    api.post<{ ok: boolean }>(`/members/contact-change/${encodeURIComponent(approvalId)}/apply`, { code }, { reauthToken }),
  /** Sensitive: needs a reauth token; creates an approval (double validation). */
  requestContactChange: (id: string, body: { field: 'email' | 'phoneNumber'; newValue: string; reason: string; ticketId?: string } | { field: 'momo'; momoNumber: string; momoOperator: string; reason: string; ticketId?: string }, reauthToken: string) =>
    api.post<{ approvalId: string }>(`/members/${encodeURIComponent(id)}/contact-change`, body, { reauthToken }),
  /** Security plan Phase 5: lost phone (after ID + selfie); a finance manager approves. */
  requestAuthenticatorReset: (id: string, reason: string, reauthToken: string) =>
    api.post<{ approvalId: string }>(`/members/${encodeURIComponent(id)}/authenticator-reset`, { reason }, { reauthToken }),
  /** Blocking mode: release a member the fraud engine holds; another finance manager approves. */
  requestRiskRelease: (id: string, reason: string, reauthToken: string) =>
    api.post<{ approvalId: string }>(`/members/${encodeURIComponent(id)}/risk/release`, { reason }, { reauthToken }),
  /** Security plan Phase 5: freeze or unfreeze the member's money; another finance manager approves. */
  /** Lifts an account suspension (members.unban): done at once, audited. */
  unban: (id: string, reason: string, reauthToken: string) =>
    api.post<{ unbanned: boolean; stillBlocked: boolean }>(`/members/${encodeURIComponent(id)}/unban`, { reason }, { reauthToken }),
  requestFreeze: (id: string, action: 'freeze' | 'unfreeze', reason: string, reauthToken: string) =>
    api.post<{ approvalId: string }>(`/members/${encodeURIComponent(id)}/freeze`, { action, reason }, { reauthToken }),
  /** A commission of this member (to check it before asking to take it back). */
  commission: (id: string, transactionId: string) =>
    api.get<CommissionInfo>(`/members/${encodeURIComponent(id)}/commissions/${encodeURIComponent(transactionId)}`),
  /** Take back a commission paid by mistake; another finance manager approves. */
  requestCommissionReversal: (id: string, transactionId: string, reason: string, reauthToken: string) =>
    api.post<{ approvalId: string }>(`/members/${encodeURIComponent(id)}/commission-reversal`, { transactionId, reason }, { reauthToken }),
};
