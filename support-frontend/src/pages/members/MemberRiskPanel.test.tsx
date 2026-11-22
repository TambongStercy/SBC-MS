import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import App from '../../App';
import { mockApi } from '../../test/mockApi';
import { makeAgent, renderWithProviders } from '../../test/render';
import type { RiskCard, SupportMember } from '../../api/types';

/** Security plan Phase 4: the « Risque » panel on the member page. */
const member: SupportMember = {
  _id: 'm1', name: 'Jean Dupont', country: 'CM', createdAt: '2026-01-02T10:00:00Z', isVerified: true, subscriptions: [],
  balance: 1500, usdBalance: 0, reservedBalance: 0, debt: 0,
};
const card: RiskCard = {
  available: true, score: 120, decision: 'hold', scoredAt: '2026-11-22T08:00:00Z', groupSize: 2,
  reasons: [
    { rule: 'shared_payout_number', points: 40, detail: 'Numéro de retrait •••777 partagé avec 1 compte(s) de son parrainage', live: false },
    { rule: 'contact_change_withdrawal', points: 30, detail: 'Retrait demandé 10 h après un changement de numéro Mobile Money', live: true, at: '2026-11-22T07:00:00Z', expiresAt: '2026-11-29T07:00:00Z' },
  ],
  linked: [{ userId: 'm2', name: 'Paul Filleul', country: 'CM', score: 90, decision: 'hold' }],
  identifiers: [{ kind: 'phone', uses: ['payout_number'], tail: '777', count: 2, hub: false }],
  events: [{ type: 'withdrawal_requested', at: '2026-11-22T07:00:00Z', kind: null, amountXaf: 40000, numberTail: '777' }],
  kyc: { score: 15, band: 'low', reasons: ['email_no_mx'], emailDomain: 'gmail.con', checkedAt: '2026-11-22T02:10:00Z', variantAccounts: 0 },
};

function setup(roles: Parameters<typeof makeAgent>[0], risk: { data: unknown } = { data: card }) {
  document.cookie = 'sbc_sup_csrf=tok; path=/';
  return mockApi({
    'GET /auth/me': { data: { agent: makeAgent(roles) } },
    'GET /members/m1': { data: { member } },
    'GET /members/m1/payins': { data: [] },
    'GET /members/m1/risk': risk,
  });
}

describe('member risk panel', () => {
  it('finance manager: score, decision, reasons with their end date, linked account link, shared number, KYC', async () => {
    setup(['finance_manager']);
    renderWithProviders(<App />, { path: '/membres/m1' });
    expect(await screen.findByTestId('risk-score')).toHaveTextContent('120');
    expect(screen.getByText('Retrait à retenir')).toBeInTheDocument();
    const reasons = screen.getByRole('list', { name: 'Raisons du score' });
    expect(within(reasons).getAllByRole('listitem')).toHaveLength(2);
    expect(within(reasons).getByText(/compte jusqu’au/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Paul Filleul' })).toHaveAttribute('href', '/membres/m2');
    expect(screen.getByText('Numéro •••777')).toBeInTheDocument();
    expect(screen.getByText(/Demande de retrait/)).toHaveTextContent('vers •••777');
    expect(screen.getByText('Le domaine de l’e-mail ne reçoit pas de courrier')).toBeInTheDocument();
  });

  it('not connected yet → says so', async () => {
    setup(['finance_manager'], { data: { available: false } });
    renderWithProviders(<App />, { path: '/membres/m1' });
    expect(await screen.findByText(/pas encore relié au support/)).toBeInTheDocument();
  });

  it('a support agent (no risk.read) does not see the panel', async () => {
    const api = setup(['support_agent']);
    renderWithProviders(<App />, { path: '/membres/m1' });
    expect(await screen.findByText('Sécurité')).toBeInTheDocument();
    expect(screen.queryByText('Risque')).toBeNull();
    expect(api.calls.some(c => c.path.includes('/risk'))).toBe(false);
  });
});
