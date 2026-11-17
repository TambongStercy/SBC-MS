import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import App from '../../App';
import { mockApi } from '../../test/mockApi';
import { makeAgent, renderWithProviders } from '../../test/render';
import type { Role } from '../../lib/permissions';
import { periodFor } from './ReportsPage';

const report = {
  from: '2026-11-10', to: '2026-11-16',
  rows: [{
    agentId: 'a1', name: 'Jean Mbarga', roles: ['verifier'], ticketsHandled: 4, ticketsResolved: 3, avgFirstResponseMinutes: 12,
    casesResolved: 1, viewsDecided: 40, viewsApproved: 35, viewsRejected: 5, viewsReassigned: 1, avgDecisionSeconds: 95, qaErrorRate: 0.05,
  }],
};

function setup(role: Role) {
  document.cookie = 'sbc_sup_csrf=tok; path=/';
  const m = mockApi({
    'GET /auth/me': { data: { agent: makeAgent([role]) } },
    'GET /reports/agents': { data: report },
    'GET /reports/agents/export': { raw: 'agent;tickets\nJean;4\n' },
  });
  renderWithProviders(<App />, { path: '/rapports' });
  return m;
}

const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
afterEach(() => { URL.createObjectURL = original.create; URL.revokeObjectURL = original.revoke; });

describe('Rapports', () => {
  it('no export button without the `export` permission (finance_agent)', async () => {
    setup('finance_agent');
    expect((await screen.findAllByText('Jean Mbarga')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Exporter/ })).toBeNull();
  });

  it('finance_manager can export the CSV', async () => {
    const created: string[] = [];
    URL.createObjectURL = () => { created.push('blob'); return 'blob:x'; };
    URL.revokeObjectURL = () => {};
    // jsdom cannot follow a download link.
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const m = setup('finance_manager');
    const button = await screen.findByRole('button', { name: /Exporter en CSV/ });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => expect(m.find('GET', '/reports/agents/export')).toHaveLength(1));
    const q = m.find('GET', '/reports/agents/export')[0].query;
    expect(q.get('from')).toBeTruthy();
    expect(q.get('to')).toBeTruthy();
    await waitFor(() => expect(created).toHaveLength(1));
  });

  it('period presets', () => {
    const now = new Date(2026, 10, 17);
    expect(periodFor('7d', now)).toEqual({ from: '2026-11-11', to: '2026-11-17' });
    expect(periodFor('month', now)).toEqual({ from: '2026-11-01', to: '2026-11-17' });
    expect(periodFor('custom', now, { from: '2026-10-01', to: '2026-10-31' })).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });
});
