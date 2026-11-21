import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import App from '../../App';
import { mockApi } from '../../test/mockApi';
import { makeAgent, renderWithProviders } from '../../test/render';
import { parseCountries } from '../../pages/admin/AgentsPage';

const row = (country: string, connected: number) => ({
  country, connected, connectedTrend: 12.5,
  signups: { started: 10, completed: 6, failed: 3, inProgress: 1, failedGroups: { sbc_code: 1, provider_api: 1, member: 1, unknown: 0 }, reasons: {} },
  completedTrend: null, activated: 2,
  payments: { failed: 4, waiting: 0, abandoned: 0, groups: { sbc_code: 0, provider_api: 4, member: 0, unknown: 0 } },
});

describe('Activity panel (Phase 11)', () => {
  it('shows the day per country for the agent’s countries, with the total first', async () => {
    mockApi({
      'GET /auth/me': { data: { agent: makeAgent(['support_agent']) } },
      'GET /tickets': { data: { items: [], total: 0, page: 1, limit: 1 } },
      'GET /activity': { data: { team: ['CM'], board: { range: { key: 'today', from: '2026-11-21', to: '2026-11-21', days: 1 }, rows: [row('CM', 40)], total: row('ALL', 40), reasons: [], connectedCollecting: true, updatedAt: null } } },
    });
    renderWithProviders(<App />, { path: '/' });
    expect(await screen.findByText('Vos pays : Cameroun')).toBeInTheDocument();
    expect(await screen.findByText('Total')).toBeInTheDocument();
    expect(screen.getByText('Code SBC 1 · Fournisseur 1 · Côté membre 1')).toBeInTheDocument();
  });

  it('a verifier has no activity panel', async () => {
    const m = mockApi({ 'GET /auth/me': { data: { agent: makeAgent(['verifier']) } } });
    renderWithProviders(<App />, { path: '/' });
    await waitFor(() => expect(m.find('GET', '/auth/me').length).toBeGreaterThan(0));
    await new Promise(r => setTimeout(r, 300));
    expect(screen.queryByText('Vos pays', { exact: false })).toBeNull();
    expect(m.find('GET', '/activity')).toHaveLength(0);
  });

  it('country codes typed by an admin are checked', () => {
    expect(parseCountries('cm, BJ ci')).toEqual(['CM', 'BJ', 'CI']);
    expect(parseCountries('')).toEqual([]);
    expect(parseCountries('Cameroun')).toBeNull();
  });
});
