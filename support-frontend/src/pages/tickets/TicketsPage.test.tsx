import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import App from '../../App';
import { mockApi } from '../../test/mockApi';
import { makeAgent, renderWithProviders } from '../../test/render';

const page = (subjects: string[]) => ({
  data: {
    items: subjects.map((subject, i) => ({
      id: `t${i}`, number: `SUP-00000${i}`, subject, category: 'retrait', queue: 'retrait', priority: 'normal', status: 'open',
      source: 'member', member: { id: 'm1', name: 'Jean' }, assignee: null, slaDueAt: null, createdAt: '2026-11-17T08:00:00Z', updatedAt: '2026-11-17T08:00:00Z',
    })),
    total: subjects.length, page: 1, limit: 20,
  },
});

describe('tickets list', () => {
  it('sends the search text in a POST body, never in the address or a URL', async () => {
    document.cookie = 'sbc_sup_csrf=tok; path=/';
    const api = mockApi({
      'GET /auth/me': { data: { agent: makeAgent(['support_agent']) } },
      'GET /tickets/queues': { data: [] },
      'GET /tickets/assignees': { data: [] },
      'GET /tickets': page(['Retrait bloqué', 'Question parrainage']),
      'POST /tickets/search': page(['Retrait bloqué']),
    });
    renderWithProviders(<App />, { path: '/tickets?queue=retrait' });
    expect((await screen.findAllByText('Question parrainage')).length).toBeGreaterThan(0);

    const box = screen.getByRole('searchbox');
    fireEvent.change(box, { target: { value: 'jean.dupont@gmail.com' } });
    fireEvent.submit(box.closest('form')!);

    await waitFor(() => expect(screen.queryAllByText('Question parrainage')).toHaveLength(0));
    const search = api.calls.find(c => c.method === 'POST' && c.path === '/tickets/search')!;
    expect(search.body).toMatchObject({ q: 'jean.dupont@gmail.com', queue: 'retrait' });
    for (const c of api.calls) expect(c.query.toString()).not.toContain('dupont');
    expect(window.location.href).not.toContain('dupont');
  });
});
