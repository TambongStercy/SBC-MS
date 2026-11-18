import { api, type Page } from './http';
import type { PersonRef, QueueCount, Ticket, TicketDetail, TicketMessage, TicketPriority, TicketStatus } from './types';

export interface TicketFilters {
  queue?: string;
  status?: TicketStatus | 'active' | '';
  priority?: TicketPriority | '';
  /** 'me', 'unassigned' or an agent id. */
  assignee?: string;
  q?: string;
  page?: number;
  limit?: number;
}

export const ticketsApi = {
  /** With a search text the request is a POST: the text (often an email or a phone) never goes in a URL. */
  list: ({ q, ...filters }: TicketFilters) => q
    ? api.post<Page<Ticket>>('/tickets/search', { ...filters, q })
    : api.get<Page<Ticket>>('/tickets', { ...filters }),
  queues: () => api.get<QueueCount[]>('/tickets/queues'),
  get: (id: string) => api.get<TicketDetail>(`/tickets/${encodeURIComponent(id)}`),
  reply: (id: string, body: { body: string; internal: boolean; attachmentIds?: string[] }) =>
    api.post<TicketMessage>(`/tickets/${encodeURIComponent(id)}/messages`, body),
  assign: (id: string, agentId: string | null) => api.post<Ticket>(`/tickets/${encodeURIComponent(id)}/assign`, { agentId }),
  setStatus: (id: string, status: TicketStatus, reason?: string) =>
    api.post<Ticket>(`/tickets/${encodeURIComponent(id)}/status`, { status, reason }),
  setPriority: (id: string, priority: TicketPriority) => api.post<Ticket>(`/tickets/${encodeURIComponent(id)}/priority`, { priority }),
  /** Short-lived presigned URL of a private attachment. */
  /** Link to the member's session replay; the server audits every call. */
  replayUrl: (ticketId: string) => api.post<{ url: string }>(`/tickets/${encodeURIComponent(ticketId)}/replay`),
  attachmentUrl: (ticketId: string, attachmentId: string) =>
    api.get<{ url: string; expiresAt?: string }>(`/tickets/${encodeURIComponent(ticketId)}/attachments/${encodeURIComponent(attachmentId)}/url`),
  /** Agents who can take tickets (for the assign menu). */
  assignees: () => api.get<PersonRef[]>('/tickets/assignees'),
};
