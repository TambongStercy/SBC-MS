import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import App from '../../App';
import type { ViewTask } from '../../api/types';
import { mockApi } from '../../test/mockApi';
import { makeAgent, renderWithProviders } from '../../test/render';

const setCsrf = () => { document.cookie = 'sbc_sup_csrf=tok; path=/'; };
const verifier = makeAgent(['verifier']);

const task: ViewTask = {
  id: 't1',
  sourceId: 'mv-1',
  state: 'in_progress',
  version: 3,
  submittedAt: '2026-11-17T08:00:00Z',
  assignedAt: '2026-11-17T09:00:00Z',
  startedAt: '2026-11-17T09:01:00Z',
  proof: {
    videoUrl: 'https://r2.example/proof.mp4?sig=x',
    dayIndex: 2,
    submittedAt: '2026-11-17T08:00:00Z',
    campaign: { name: 'Campagne Lait Bébé', targetViews: 150 },
    diffuseur: { id: 'd1', name: 'Jean Mbarga', country: 'CM' },
  },
};

const mine = { data: { items: [], today: { decided: 4, approved: 3, rejected: 1 } } };

function choose(name: string) {
  fireEvent.click(screen.getByRole('button', { name }));
}

describe('Vérifications', () => {
  it('"Tâche suivante" asks once, even on a double tap, and shows the proof video', async () => {
    setCsrf();
    const m = mockApi({
      'GET /auth/me': { data: { agent: verifier } },
      'GET /views/current': { data: { task: null } },
      'GET /views/mine': mine,
      'POST /views/next': { data: { task } },
    });
    renderWithProviders(<App />, { path: '/' });
    const next = await screen.findByRole('button', { name: /Tâche suivante/ });
    fireEvent.click(next);
    fireEvent.click(next);
    expect(await screen.findByText('Campagne Lait Bébé')).toBeInTheDocument();
    expect(m.find('POST', '/views/next')).toHaveLength(1);
    const video = document.querySelector('video');
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute('src', 'https://r2.example/proof.mp4?sig=x');
    expect(video).not.toHaveAttribute('autoplay');
    expect(screen.getByText('Jour 2')).toBeInTheDocument();
  });

  it('says so when no proof is waiting', async () => {
    setCsrf();
    mockApi({
      'GET /auth/me': { data: { agent: verifier } },
      'GET /views/current': { data: { task: null } },
      'GET /views/mine': mine,
      'POST /views/next': { data: { task: null } },
    });
    renderWithProviders(<App />, { path: '/verifications' });
    fireEvent.click(await screen.findByRole('button', { name: /Tâche suivante/ }));
    expect(await screen.findByText('Aucune preuve en attente')).toBeInTheDocument();
  });

  it('a rejection needs a reason, then sends decision, reason and version', async () => {
    setCsrf();
    const m = mockApi({
      'GET /auth/me': { data: { agent: verifier } },
      'GET /views/current': { data: { task } },
      'GET /views/mine': mine,
      'POST /views/tasks/t1/decision': { data: { ...task, state: 'rejected' } },
    });
    renderWithProviders(<App />, { path: '/verifications' });
    await screen.findByText('Campagne Lait Bébé');
    choose('Rejeter');
    // Verifiers cannot ban.
    expect(screen.queryByRole('checkbox', { name: 'Bannir le diffuseur' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer la décision' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Le motif du rejet est obligatoire');
    expect(m.find('POST', '/views/tasks/t1/decision')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Lien absent de la vidéo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer la décision' }));
    await waitFor(() => expect(m.find('POST', '/views/tasks/t1/decision')).toHaveLength(1));
    expect(m.find('POST', '/views/tasks/t1/decision')[0].body).toEqual({ decision: 'reject', reason: 'Lien absent de la vidéo', version: 3 });
    // Straight back to the next-task button.
    expect(await screen.findByRole('button', { name: /Tâche suivante/ })).toBeInTheDocument();
  });

  it('validation needs the observed views', async () => {
    setCsrf();
    const m = mockApi({
      'GET /auth/me': { data: { agent: verifier } },
      'GET /views/current': { data: { task } },
      'GET /views/mine': mine,
      'POST /views/tasks/t1/decision': { data: { ...task, state: 'approved' } },
    });
    renderWithProviders(<App />, { path: '/verifications' });
    await screen.findByText('Campagne Lait Bébé');
    choose('Valider');
    expect(screen.getByText('Objectif de la campagne : 150 vues.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer la décision' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('nombre de vues');
    expect(m.find('POST', '/views/tasks/t1/decision')).toHaveLength(0);

    fireEvent.change(screen.getByLabelText(/Vues observées/), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer la décision' }));
    await waitFor(() => expect(m.find('POST', '/views/tasks/t1/decision')).toHaveLength(1));
    expect(m.find('POST', '/views/tasks/t1/decision')[0].body).toEqual({ decision: 'approve', observedViews: 120, version: 3 });
  });

  it('a decision already taken elsewhere reloads the task', async () => {
    setCsrf();
    const m = mockApi({
      'GET /auth/me': { data: { agent: verifier } },
      'GET /views/current': { data: { task } },
      'GET /views/mine': mine,
      'POST /views/tasks/t1/decision': { status: 409, code: 'ALREADY_DECIDED', message: 'Déjà décidée' },
    });
    renderWithProviders(<App />, { path: '/verifications' });
    await screen.findByText('Campagne Lait Bébé');
    choose('Erreur technique');
    fireEvent.change(screen.getByLabelText(/Note/), { target: { value: 'écran noir' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer la décision' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('déjà été traitée');
    await waitFor(() => expect(m.find('GET', '/views/current').length).toBeGreaterThanOrEqual(2));
  });

  it('an assigned task is started on the first interaction', async () => {
    setCsrf();
    const m = mockApi({
      'GET /auth/me': { data: { agent: verifier } },
      'GET /views/current': { data: { task: { ...task, state: 'assigned', startedAt: null } } },
      'GET /views/mine': mine,
      'POST /views/tasks/t1/start': { data: { ...task, state: 'in_progress' } },
    });
    renderWithProviders(<App />, { path: '/verifications' });
    await screen.findByText('Campagne Lait Bébé');
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Valider' }));
    choose('Valider');
    await waitFor(() => expect(m.find('POST', '/views/tasks/t1/start')).toHaveLength(1));
  });
});

describe('Supervision', () => {
  it('reassigning a task requires a reason', async () => {
    setCsrf();
    const m = mockApi({
      'GET /auth/me': { data: { agent: makeAgent(['views_supervisor']) } },
      'GET /views/board': { data: {
        counts: { available: 5, assigned: 2, in_progress: 1, to_review: 0 },
        agents: [{ id: 'v1', name: 'Paul Etoa', online: true, current: { taskId: 't9', state: 'in_progress', idleMinutes: 22 }, todayDecided: 7, todayApproved: 6, todayRejected: 1 }],
        alerts: [{ taskId: 't9', agentId: 'v1', agentName: 'Paul Etoa', idleMinutes: 22, kind: 'idle' }],
      } },
      'GET /views/verifiers': { data: [{ id: 'v1', name: 'Paul Etoa' }, { id: 'v2', name: 'Marie Ngo' }] },
      'POST /views/tasks/t9/reassign': { data: { ...task, id: 't9' } },
    });
    renderWithProviders(<App />, { path: '/supervision' });
    expect(await screen.findByText('Inactif depuis 22 min')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Réaffecter' })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Réaffecter la tâche' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Réaffecter' }));
    // Empty reason: blocked (the field is required), nothing is sent.
    await new Promise(r => setTimeout(r, 50));
    expect(m.find('POST', '/views/tasks/t9/reassign')).toHaveLength(0);
    expect(within(dialog).getByLabelText(/Motif/)).toBeRequired();

    fireEvent.change(within(dialog).getByLabelText(/Motif/), { target: { value: 'Inactif depuis 22 minutes' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Réaffecter' }));
    await waitFor(() => expect(m.find('POST', '/views/tasks/t9/reassign')).toHaveLength(1));
    expect(m.find('POST', '/views/tasks/t9/reassign')[0].body).toEqual({ agentId: null, reason: 'Inactif depuis 22 minutes' });
  });
});
