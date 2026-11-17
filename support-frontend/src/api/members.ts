import { api } from './http';
import type { MemberHit, MemberWithdrawal, Payin, SupportMember, Ticket } from './types';

export const membersApi = {
  search: (q: string) => api.post<MemberHit[]>('/members/search', { q }), // POST: an email or phone never goes in a URL
  get: (id: string) => api.get<{ member: SupportMember }>(`/members/${encodeURIComponent(id)}`),
  payins: (id: string) => api.get<Payin[]>(`/members/${encodeURIComponent(id)}/payins`, { limit: 20 }),
  withdrawals: (id: string) => api.get<MemberWithdrawal[]>(`/members/${encodeURIComponent(id)}/withdrawals`, { limit: 20 }),
  tickets: (id: string) => api.get<Ticket[]>(`/members/${encodeURIComponent(id)}/tickets`),
  /** Sensitive: needs a reauth token; creates an approval (double validation). */
  requestContactChange: (id: string, body: { field: 'email' | 'phoneNumber'; newValue: string; reason: string; ticketId?: string }, reauthToken: string) =>
    api.post<{ approvalId: string }>(`/members/${encodeURIComponent(id)}/contact-change`, body, { reauthToken }),
};
