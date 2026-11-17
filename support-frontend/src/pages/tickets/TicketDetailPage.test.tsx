import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import App from '../../App';
import { mockApi } from '../../test/mockApi';
import { makeAgent, renderWithProviders } from '../../test/render';
import type { TicketDetail } from '../../api/types';

const detail: TicketDetail = {
  ticket: {
    id: 't1', number: 'SUP-000123', subject: 'Mon retrait est bloqué', category: 'withdrawal', queue: 'withdrawal',
    priority: 'high', status: 'open', source: 'member', member: { id: 'm1', name: 'Jean Dupont' }, assignee: null,
    slaDueAt: null, createdAt: '2026-11-17T08:00:00Z', updatedAt: '2026-11-17T09:00:00Z',
  },
  messages: [
    { id: 'msg1', author: { type: 'member', id: 'm1', name: 'Jean Dupont' }, body: 'Bonjour, mon retrait est bloqué.', internal: false, attachments: [], createdAt: '2026-11-17T08:00:00Z' },
    { id: 'msg2', author: { type: 'agent', id: 'agent-1', name: 'Awa Diallo' }, body: 'Nous vérifions votre retrait.', internal: false, attachments: [], createdAt: '2026-11-17T08:30:00Z' },
    { id: 'msg3', author: { type: 'agent', id: 'agent-2', name: 'Paul' }, body: 'Vu chez MoneyFusion, en attente.', internal: true, attachments: [], createdAt: '2026-11-17T08:40:00Z' },
  ],
  events: [],
};

describe('ticket detail', () => {
  it('marks internal notes apart from public replies', async () => {
    document.cookie = 'sbc_sup_csrf=tok; path=/';
    mockApi({ 'GET /auth/me': { data: { agent: makeAgent(['support_agent']) } }, 'GET /tickets/t1': { data: detail } });
    renderWithProviders(<App />, { path: '/tickets/t1' });

    const note = await screen.findByRole('article', { name: 'Note interne de Paul' });
    expect(within(note).getByText('Note interne — invisible pour le membre')).toBeInTheDocument();
    const reply = screen.getByRole('article', { name: 'Message de Awa Diallo' });
    expect(within(reply).queryByText(/Note interne/)).toBeNull();
    const memberMsg = screen.getByRole('article', { name: 'Message de Jean Dupont' });
    expect(within(memberMsg).queryByText(/Note interne/)).toBeNull();
    expect(screen.getAllByText('Note interne — invisible pour le membre')).toHaveLength(1);
  });

  it('sends an internal note with internal: true and the CSRF header', async () => {
    document.cookie = 'sbc_sup_csrf=tok; path=/';
    const m = mockApi({
      'GET /auth/me': { data: { agent: makeAgent(['support_agent']) } },
      'GET /tickets/t1': { data: detail },
      'POST /tickets/t1/messages': { data: { id: 'new' } },
    });
    renderWithProviders(<App />, { path: '/tickets/t1' });
    fireEvent.click(await screen.findByRole('radio', { name: 'Note interne' }));
    fireEvent.change(screen.getByLabelText('Note interne', { selector: 'textarea' }), { target: { value: 'Rappeler demain.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter la note' }));
    await waitFor(() => expect(m.find('POST', '/tickets/t1/messages')).toHaveLength(1));
    const call = m.find('POST', '/tickets/t1/messages')[0];
    expect(call.body).toEqual({ body: 'Rappeler demain.', internal: true });
    expect(call.headers.get('x-csrf-token')).toBe('tok');
  });

  it('a public reply is sent with internal: false', async () => {
    document.cookie = 'sbc_sup_csrf=tok; path=/';
    const m = mockApi({
      'GET /auth/me': { data: { agent: makeAgent(['support_agent']) } },
      'GET /tickets/t1': { data: detail },
      'POST /tickets/t1/messages': { data: { id: 'new' } },
    });
    renderWithProviders(<App />, { path: '/tickets/t1' });
    fireEvent.change(await screen.findByLabelText('Réponse', { selector: 'textarea' }), { target: { value: 'C’est réglé.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer la réponse' }));
    await waitFor(() => expect(m.find('POST', '/tickets/t1/messages')).toHaveLength(1));
    expect(m.find('POST', '/tickets/t1/messages')[0].body).toEqual({ body: 'C’est réglé.', internal: false });
  });
});
