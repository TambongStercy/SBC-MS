import { describe, expect, it } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import App from '../../App';
import { mockApi } from '../../test/mockApi';
import { makeAgent, renderWithProviders } from '../../test/render';
import { ROLE_PERMISSIONS } from '../../lib/permissions';
import type { SupportMember } from '../../api/types';

/** « Compte suspendu » banner and « Lever la suspension » (no-referral withdrawal rule, 2026-11-23). */
const banned: SupportMember = {
  _id: 'm1', name: 'Jean Dupont', country: 'CM', createdAt: '2026-01-02T10:00:00Z', isVerified: true, subscriptions: [],
  balance: 51000, usdBalance: 0, reservedBalance: 0, debt: 0, blocked: true,
  ban: {
    at: '2026-11-23T10:00:00Z', reason: 'no_referral_withdrawal',
    details: {
      reasons: ['unexplained_balance', 'commission_without_referrals'],
      evaluation: { currency: 'XAF', a: 51000, b: 1000, commissionCredits: 1500, balances: [{ currency: 'XAF', a: 51000, b: 1000, diff: 50000, decidable: true, unexplained: true }] },
      attempt: { amount: 20000, currency: 'XAF', transactionId: null },
    },
  },
  banHistory: [],
};

function setup(roles: Parameters<typeof makeAgent>[0], member: SupportMember = banned, extra: Record<string, unknown> = {}) {
  document.cookie = 'sbc_sup_csrf=tok; path=/';
  return mockApi({
    'GET /auth/me': { data: { agent: makeAgent(roles) } },
    'GET /members/m1': { data: { member } },
    'GET /members/m1/payins': { data: [] },
    ...extra,
  });
}

describe('member ban banner', () => {
  it('shows « Compte suspendu » with the date, the reasons and the figures', async () => {
    setup(['finance_manager']);
    renderWithProviders(<App />, { path: '/membres/m1' });
    const banner = await screen.findByRole('alert', { name: 'Compte suspendu' });
    expect(banner).toHaveTextContent('Compte suspendu');
    expect(banner).toHaveTextContent(/retrait demandé sans aucun filleul/);
    expect(banner).toHaveTextContent(/solde plus élevé que ce que ses mouvements expliquent/);
    expect(banner).toHaveTextContent(/commissions de parrainage reçues sans aucun filleul/);
    expect(banner).toHaveTextContent(/51/);
    expect(banner).toHaveTextContent(/20000 XAF/);
    expect(screen.getAllByText('Compte suspendu').length).toBeGreaterThan(1); // header badge too
  });

  it('nothing is shown for a member who is not suspended', async () => {
    setup(['finance_manager'], { ...banned, ban: null, blocked: false });
    renderWithProviders(<App />, { path: '/membres/m1' });
    await screen.findByText('Sécurité');
    expect(screen.queryByRole('alert', { name: 'Compte suspendu' })).toBeNull();
  });

  it('a support agent sees the banner but cannot lift it', async () => {
    setup(['support_agent']);
    renderWithProviders(<App />, { path: '/membres/m1' });
    await screen.findByRole('alert', { name: 'Compte suspendu' });
    expect(screen.queryByRole('button', { name: 'Lever la suspension' })).toBeNull();
  });

  it('a finance manager lifts it: reason, then the code', async () => {
    const m = setup(['finance_manager'], banned, {
      'POST /auth/reauth': { data: { reauthToken: 'rt-1' } },
      'POST /members/m1/unban': { data: { unbanned: true, stillBlocked: false } },
    });
    renderWithProviders(<App />, { path: '/membres/m1' });
    fireEvent.click(await screen.findByRole('button', { name: 'Lever la suspension' }));
    const dialog = await screen.findByRole('dialog', { name: 'Lever la suspension' });
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'court' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lever la suspension' }));
    expect(await within(dialog).findByText(/au moins 20 caractères/)).toBeInTheDocument();
    expect(m.find('POST', '/members/m1/unban')).toHaveLength(0);
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Dépôt manuel vérifié avec la finance le 23/11.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lever la suspension' }));
    fireEvent.change(await screen.findByLabelText('Code de l’application'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
    await screen.findByText('Suspension levée.');
    const call = m.find('POST', '/members/m1/unban')[0];
    expect(call.headers.get('x-reauth-token')).toBe('rt-1');
    expect(call.body).toEqual({ reason: 'Dépôt manuel vérifié avec la finance le 23/11.' });
  });

  it('members.unban: finance manager, support administrator, super manager only', () => {
    const holders = Object.entries(ROLE_PERMISSIONS).filter(([, p]) => p.includes('members.unban')).map(([r]) => r).sort();
    expect(holders).toEqual(['finance_manager', 'super_manager', 'support_admin']);
  });
});
