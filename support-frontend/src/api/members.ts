import { api } from './http';
import type { MemberHit, MemberWithdrawal, Payin, RiskCard, SupportMember, Ticket } from './types';

export const membersApi = {
  search: (q: string) => api.post<MemberHit[]>('/members/search', { q }), // POST: an email or phone never goes in a URL
  get: (id: string) => api.get<{ member: SupportMember }>(`/members/${encodeURIComponent(id)}`),
  payins: (id: string) => api.get<Payin[]>(`/members/${encodeURIComponent(id)}/payins`, { limit: 20 }),
  withdrawals: (id: string) => api.get<MemberWithdrawal[]>(`/members/${encodeURIComponent(id)}/withdrawals`, { limit: 20 }),
  tickets: (id: string) => api.get<Ticket[]>(`/members/${encodeURIComponent(id)}/tickets`),
  /** Security plan Phase 4: score, reasons, linked accounts, KYC (finance managers). */
  risk: (id: string) => api.get<RiskCard>(`/members/${encodeURIComponent(id)}/risk`),
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
  /** Security plan Phase 5: freeze or unfreeze the member's money; another finance manager approves. */
  requestFreeze: (id: string, action: 'freeze' | 'unfreeze', reason: string, reauthToken: string) =>
    api.post<{ approvalId: string }>(`/members/${encodeURIComponent(id)}/freeze`, { action, reason }, { reauthToken }),
};
