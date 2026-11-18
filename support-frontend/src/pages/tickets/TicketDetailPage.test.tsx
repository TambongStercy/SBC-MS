import { describe, expect, it, vi } from 'vitest';
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

  it('shows the member’s new message without reloading the page', async () => {
    document.cookie = 'sbc_sup_csrf=tok; path=/';
    let calls = 0;
    const later = { ...detail, messages: [...detail.messages, { id: 'msg9', author: { type: 'member', id: 'm1', name: 'Jean Dupont' }, body: 'Toujours rien reçu ce soir.', internal: false, attachments: [], createdAt: '2026-11-17T18:00:00Z' }] };
    mockApi({
      'GET /auth/me': { data: { agent: makeAgent(['support_agent']) } },
      'GET /tickets/t1': () => ({ data: ++calls === 1 ? detail : later }),
    });
    renderWithProviders(<App />, { path: '/tickets/t1' });
    expect(await screen.findByText('Bonjour, mon retrait est bloqué.')).toBeInTheDocument();
    expect(screen.queryByText('Toujours rien reçu ce soir.')).toBeNull();
    expect(await screen.findByText('Toujours rien reçu ce soir.', {}, { timeout: 8000 })).toBeInTheDocument();
  }, 12000);

  it('opens the member’s session replay in a new tab through the audited route', async () => {
    document.cookie = 'sbc_sup_csrf=tok; path=/';
    const withReplay = { ...detail, ticket: { ...detail.ticket, replay: { at: '2026-11-17T08:00:00Z' } } };
    const api = mockApi({
      'GET /auth/me': { data: { agent: makeAgent(['support_agent']) } },
      'GET /tickets/t1': { data: withReplay },
      'POST /tickets/t1/replay': { data: { url: 'https://replay.sbc.test/3/session/77' } },
    });
    const tab = { opener: {}, location: { href: '' }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    renderWithProviders(<App />, { path: '/tickets/t1' });

    fireEvent.click(await screen.findByRole('button', { name: /Revoir la session du membre/ }));
    await waitFor(() => expect(tab.location.href).toBe('https://replay.sbc.test/3/session/77'));
    expect(open).toHaveBeenCalledWith('', '_blank');
    expect(tab.opener).toBeNull();
    expect(api.find('POST', '/tickets/t1/replay')).toHaveLength(1);
    expect(api.find('POST', '/tickets/t1/replay')[0].headers.get('x-csrf-token')).toBe('tok');
    open.mockRestore();
  });

  it('shows no replay button when the ticket has no recording', async () => {
    document.cookie = 'sbc_sup_csrf=tok; path=/';
    mockApi({ 'GET /auth/me': { data: { agent: makeAgent(['support_agent']) } }, 'GET /tickets/t1': { data: detail } });
    renderWithProviders(<App />, { path: '/tickets/t1' });
    expect(await screen.findByText('Bonjour, mon retrait est bloqué.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Revoir la session/ })).toBeNull();
  });

  it('shows the contact details of a request sent without an account, with the warning', async () => {
    document.cookie = 'sbc_sup_csrf=tok; path=/';
    const guest = { ...detail, ticket: { ...detail.ticket, source: 'public' as const, member: { id: null, name: 'Awa Diallo' }, contact: { name: 'Awa Diallo', phone: '+237 6 75 09 07 55', email: 'awa@example.com', verified: false as const } } };
    mockApi({ 'GET /auth/me': { data: { agent: makeAgent(['support_agent', 'support_admin']) } }, 'GET /tickets/t1': { data: guest } });
    renderWithProviders(<App />, { path: '/tickets/t1' });
    expect(await screen.findByRole('heading', { name: 'Coordonnées' })).toBeInTheDocument();
    expect(screen.getByText(/Sans compte, non vérifié\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'awa@example.com' })).toHaveAttribute('href', 'mailto:awa@example.com');
    expect(screen.getByRole('link', { name: '+237 6 75 09 07 55' })).toHaveAttribute('href', 'tel:+237675090755');
    expect(screen.queryByRole('link', { name: 'Awa Diallo' })).toBeNull();
    expect(screen.getByText('Formulaire sans compte')).toBeInTheDocument();
    expect(screen.getAllByText('Sans compte').length).toBeGreaterThan(0);
    expect(screen.getByRole('textbox', { name: /Réponse/ })).toHaveAttribute('placeholder', 'Votre réponse, envoyée par email…');
  });
});
