import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import App from '../../App';
import type { Analytics } from '../../api/analytics';
import { mockApi } from '../../test/mockApi';
import { makeAgent, renderWithProviders } from '../../test/render';

const tk = { created: 40, handled: 31, handledOfCreatedRate: 70, firstResponseMedianMin: 42, firstResponseP90Min: 300, resolutionMedianHours: 20, resolutionP90Hours: 70, slaBreachRate: 18 };
const data: Analytics = {
  period: { from: '2026-10-21T00:00:00Z', to: '2026-11-19T23:59:59Z', previousFrom: '2026-09-21T00:00:00Z', days: 3 },
  kpis: {
    tickets: { ...tk, prev: { ...tk, created: 32, handled: 30, slaBreachRate: 12, firstResponseMedianMin: 60, resolutionMedianHours: 24, handledOfCreatedRate: 80 }, createdChange: 25, handledChange: 3.3 },
    backlog: { now: 9, oldestOpenHours: 96, unassigned: 4, urgent: 2 },
    reopened: { count: 3, prev: 1, rate: 9.7 },
    assistant: { conversations: 120, prev: 100, escalated: 30, prevEscalated: 40, settledWithoutAgentRate: 75, prevSettledWithoutAgentRate: 60 },
    cases: { opened: 5, resolved: 4, openNow: 3, criticalOpen: 1 },
    approvalsPending: 2,
    errors: { total: 57, prevTotal: 20, change: 185, membersAffected: 23, prevMembersAffected: 8, typesOpen: 2, typesHandling: 1, typesResolvedInPeriod: 1, regressions: 1 },
  },
  series: ['2026-11-17', '2026-11-18', '2026-11-19'].map((date, i) => ({ date, created: 10 + i, handled: 8 + i, backlog: 7 + i, firstResponseMedianHours: 0.7, resolutionMedianHours: 20, errorsServer: 10, errorsClient: 8, errorsNetwork: i })),
  categories: [
    { key: 'retrait', label: 'Retrait', count: 17, prevCount: 10, change: 70, share: 42.5, resolutionMedianHours: 30, slaBreachRate: 29.4, open: 5 },
    { key: 'technique', label: 'Technique', count: 8, prevCount: 9, change: -11.1, share: 20, resolutionMedianHours: 6, slaBreachRate: 0, open: 1 },
  ],
  sources: [{ key: 'member', count: 30 }, { key: 'assistant', count: 6 }, { key: 'public', count: 4 }],
  agents: [{ id: 'a1', name: 'Awa Diallo', handled: 20, open: 4, firstResponseMedianMin: 35 }],
  errorTypes: [
    { id: 'e1', method: 'POST', route: '/api/payments/intents', status: 502, code: 'PROVIDER_DOWN', message: 'Le prestataire ne répond pas', count: 40, prevCount: 10, members: 18, firstSeen: '2026-11-01T10:00:00Z', lastSeen: '2026-11-19T09:00:00Z', state: 'open', stateBy: null, note: null, regressions: 1, hasReplay: true },
  ],
  insights: [{ tone: 'warning', text: '« Retrait » représente 42.5 % des demandes (17), +70 % par rapport à la période précédente.' }],
};

describe('Analytique', () => {
  it('shows the KPIs with their trend, the findings, recurring problems and errors', async () => {
    mockApi({ 'GET /auth/me': { data: { agent: makeAgent(['support_admin']) } }, 'GET /analytics': { data } });
    renderWithProviders(<App />, { path: '/analytique' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Analytique' })).toBeInTheDocument();
    expect(await screen.findByText(/« Retrait » représente 42.5 % des demandes/)).toBeInTheDocument();
    expect(screen.getByText('Demandes reçues').closest('div')!.parentElement).toHaveTextContent('40');
    expect(screen.getByText('Membres touchés').closest('div')!.parentElement).toHaveTextContent('23');
    const cats = screen.getByRole('table', { name: 'Problèmes qui reviennent' });
    expect(within(cats).getByRole('rowheader', { name: 'Retrait' }).closest('tr')).toHaveTextContent('42,5 %');
    expect(within(screen.getByRole('table', { name: 'Charge par agent' })).getByRole('rowheader', { name: 'Awa Diallo' })).toBeInTheDocument();
    const err = within(screen.getByRole('table', { name: 'Erreurs qui reviennent' })).getByText('/api/payments/intents', { exact: false }).closest('tr')!;
    expect(within(err).getByText('Revenue 1 fois après correction')).toBeInTheDocument();
    expect(within(err).getByRole('button', { name: /Voir une session/ })).toBeInTheDocument();
    expect(screen.getAllByText('Voir les données').length).toBeGreaterThanOrEqual(4);
  });

  it('the administrator marks an error as fixed', async () => {
    document.cookie = 'sbc_sup_csrf=tok; path=/';
    const api = mockApi({ 'GET /auth/me': { data: { agent: makeAgent(['support_admin']) } }, 'GET /analytics': { data }, 'POST /analytics/errors/e1/state': { data: { before: 'open', after: 'resolved' } } });
    renderWithProviders(<App />, { path: '/analytique' });
    const row = (await screen.findByText('/api/payments/intents', { exact: false })).closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Corrigée' }));
    await waitFor(() => expect(api.find('POST', '/analytics/errors/e1/state')).toHaveLength(1));
    expect(api.find('POST', '/analytics/errors/e1/state')[0].body).toEqual({ state: 'resolved' });
  });

  it('is in the menu for the support administrator only', async () => {
    mockApi({ 'GET /auth/me': { data: { agent: makeAgent(['support_agent']) } }, 'GET /tickets': { data: { items: [], total: 0, page: 1, limit: 20 } } });
    renderWithProviders(<App />, { path: '/' });
    await screen.findAllByRole('navigation');
    expect(screen.queryByRole('link', { name: 'Analytique' })).toBeNull();
  });
});
