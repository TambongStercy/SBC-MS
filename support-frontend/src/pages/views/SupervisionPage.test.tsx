import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import App from '../../App';
import type { ViewTask } from '../../api/types';
import { mockApi } from '../../test/mockApi';
import { makeAgent, renderWithProviders } from '../../test/render';

const setAside: ViewTask = {
  id: 't1', sourceId: 'mv-1', state: 'to_review', version: 4, reason: 'Vues difficiles à lire',
  assignee: { id: 'verifier-1', name: 'Paul' }, submittedAt: '2026-11-17T08:00:00Z',
  proof: { videoUrl: '/v.mp4', dayIndex: 2, submittedAt: '2026-11-17T08:00:00Z', campaign: { name: 'Campagne Savon' }, diffuseur: { id: 'u1', name: 'Jean' }, history: [] },
} as ViewTask;

describe('Supervision: proofs set aside', () => {
  it('a supervisor decides a set-aside proof: the task is first taken over (reason given), then decided with its new version', async () => {
    document.cookie = 'sbc_sup_csrf=tok; path=/';
    const m = mockApi({
      'GET /auth/me': { data: { agent: makeAgent(['views_supervisor'], { id: 'sup-1' }) } },
      'GET /views/tasks': { data: [setAside] },
      'POST /views/tasks/t1/reassign': { data: { ...setAside, state: 'assigned', version: 5, assignee: { id: 'sup-1', name: 'Sup' } } },
      'POST /views/tasks/t1/decision': { data: { ...setAside, state: 'approved', version: 6 } },
    });
    renderWithProviders(<App />, { path: '/supervision?tab=a-revoir' });
    fireEvent.click((await screen.findAllByText('Campagne Savon'))[0]);
    const form = await screen.findByRole('form', { name: 'Décision' });
    fireEvent.click(within(form).getByRole('button', { name: /Valider/ }));
    fireEvent.change(within(form).getByLabelText(/Vues observées/), { target: { value: '120' } });
    fireEvent.submit(form);

    await waitFor(() => expect(m.find('POST', '/views/tasks/t1/decision')).toHaveLength(1));
    expect(m.find('POST', '/views/tasks/t1/reassign')[0].body).toEqual({ agentId: 'sup-1', reason: 'Reprise par le superviseur pour décision' });
    expect(m.find('POST', '/views/tasks/t1/decision')[0].body).toMatchObject({ decision: 'approve', observedViews: 120, version: 5 });
  });
});
