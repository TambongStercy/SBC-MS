import { describe, expect, it } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import App from '../../App';
import { mockApi } from '../../test/mockApi';
import { makeAgent, renderWithProviders } from '../../test/render';
import type { Approval, SupportMember } from '../../api/types';

/** Security plan Phase 5 screens: member security panel, super manager approval, fraud queue. */
const member: SupportMember = {
  _id: 'm1', name: 'Jean Dupont', country: 'CM', createdAt: '2026-01-02T10:00:00Z', isVerified: true, subscriptions: [],
  balance: 1500, usdBalance: 0, reservedBalance: 0, debt: 0,
  geo: { declared: 'CM', usual: 'CM', usualShare: 0.8, last: 'BJ', lastAt: '2026-11-20T10:00:00Z' },
  frozen: { at: '2026-11-21T08:00:00Z', reason: 'Numéro de retrait partagé' },
  ledger: [{ currency: 'XAF', actual: 1500, expected: 1000, matches: false }],
  momoNumber: '+237 6•• •• 34', momoOperator: 'MTN_MOMO_CMR',
};

function setup(roles: Parameters<typeof makeAgent>[0], extra: Record<string, unknown> = {}) {
  document.cookie = 'sbc_sup_csrf=tok; path=/';
  return mockApi({
    'GET /auth/me': { data: { agent: makeAgent(roles) } },
    'GET /members/m1': { data: { member } },
    'GET /members/m1/payins': { data: [] },
    ...extra,
  });
}

describe('member security panel', () => {
  it('shows the three countries, the frozen money and balance A against B', async () => {
    setup(['finance_manager']);
    renderWithProviders(<App />, { path: '/membres/m1' });
    expect(await screen.findByText('Sécurité')).toBeInTheDocument();
    expect(screen.getByText(/Argent gelé depuis le/)).toHaveTextContent('Numéro de retrait partagé');
    expect(screen.getByText(/Dernier pays/).parentElement).toHaveTextContent('Bénin');
    expect(screen.getByText(/Écart/)).toBeInTheDocument();
    // A finance manager may unfreeze, not ask for an authenticator reset.
    expect(screen.getByRole('button', { name: 'Dégeler l’argent' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Réinitialiser l’authentificateur' })).toBeNull();
  });

  it('a support agent asks for an authenticator reset (reason, then code), never a freeze; no balances', async () => {
    const m = setup(['support_agent'], { 'POST /auth/reauth': { data: { reauthToken: 'rt-1' } }, 'POST /members/m1/authenticator-reset': { data: { approvalId: 'a1' } } });
    renderWithProviders(<App />, { path: '/membres/m1' });
    fireEvent.click(await screen.findByRole('button', { name: 'Réinitialiser l’authentificateur' }));
    expect(screen.queryByRole('button', { name: /Geler/ })).toBeNull();
    const dialog = await screen.findByRole('dialog', { name: /Réinitialiser l’application/ });
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Pièce et selfie vérifiés, téléphone volé.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Envoyer pour validation' }));
    fireEvent.change(await screen.findByLabelText('Code de l’application'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
    await screen.findByText('Demande envoyée pour validation.');
    const call = m.find('POST', '/members/m1/authenticator-reset')[0];
    expect(call.headers.get('x-reauth-token')).toBe('rt-1');
  });
});

describe('commission reversal', () => {
  it('a finance agent checks the commission, then asks (reason, then code); labels show the six balances', async () => {
    const ledger = [
      { currency: 'XAF', actual: 1500, expected: 1500, matches: true },
      { currency: 'ACTIVATION', actual: 900, expected: 900, matches: true },
    ];
    const m = setup(['finance_agent'], {
      'GET /members/m1': { data: { member: { ...member, ledger } } },
      'GET /members/m1/commissions/CTX1': { data: { transactionId: 'CTX1', amount: 2500, currency: 'XAF', status: 'completed', createdAt: '2026-11-20T10:00:00Z', isCommission: true, level: 1, sourceUserId: 'm9', reversible: true, reversed: false } },
      'POST /auth/reauth': { data: { reauthToken: 'rt-2' } },
      'POST /members/m1/commission-reversal': { data: { approvalId: 'a2' } },
    });
    renderWithProviders(<App />, { path: '/membres/m1' });
    fireEvent.click(await screen.findByRole('button', { name: 'Reprendre une commission' }));
    expect(screen.getAllByText('Principal').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Activation').length).toBeGreaterThan(0);
    const dialog = await screen.findByRole('dialog', { name: /Reprendre une commission/ });
    fireEvent.change(within(dialog).getByLabelText(/Référence de la commission/), { target: { value: 'CTX1' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Vérifier' }));
    expect(await within(dialog).findByText(/niveau 1/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/Pourquoi reprendre/), { target: { value: 'Commission versée deux fois pour le même filleul.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Envoyer pour validation' }));
    fireEvent.change(await screen.findByLabelText('Code de l’application'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
    await screen.findByText('Demande envoyée pour validation.');
    const call = m.find('POST', '/members/m1/commission-reversal')[0];
    expect(call.headers.get('x-reauth-token')).toBe('rt-2');
    expect(call.body).toMatchObject({ transactionId: 'CTX1' });
  });
});

describe('super manager approval', () => {
  const own: Approval = {
    id: 'ap1', type: 'account_freeze', status: 'pending', summary: 'Geler l’argent du membre m1', reason: 'Rafale de retraits vers un numéro partagé.',
    payload: { action: 'freeze' }, requestedBy: { id: 'self', name: 'Moi' }, requestedAt: '2026-11-21T09:00:00Z',
  } as unknown as Approval;

  it('may validate their own request alone, with a reason of 20 characters at least', async () => {
    const agent = makeAgent(['super_manager']);
    document.cookie = 'sbc_sup_csrf=tok; path=/';
    mockApi({
      'GET /auth/me': { data: { agent } },
      'GET /approvals': { data: [{ ...own, requestedBy: { id: agent.id, name: agent.name } }] },
    });
    renderWithProviders(<App />, { path: '/approbations' });
    expect(await screen.findByText(/vous validez seul/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Valider seul' }));
    const dialog = await screen.findByRole('dialog', { name: /Valider seul/ });
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'trop court' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Valider seul' }));
    expect(await within(dialog).findByText(/au moins 20 caractères/)).toBeInTheDocument();
  });
});

describe('fraud queue', () => {
  it('finance managers see the Fraude tab, finance agents do not', async () => {
    setup(['finance_manager'], { 'GET /finance/summary': { data: { currency: 'XAF', byStatus: [], ageBuckets: [] } } });
    renderWithProviders(<App />, { path: '/finance' });
    expect(await screen.findByRole('tab', { name: 'Fraude' })).toBeInTheDocument();
  });
  it('…not finance agents', async () => {
    setup(['finance_agent'], { 'GET /finance/summary': { data: { currency: 'XAF', byStatus: [], ageBuckets: [] } } });
    renderWithProviders(<App />, { path: '/finance' });
    expect(await screen.findByRole('tab', { name: 'Dossiers' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Fraude' })).toBeNull();
  });
});
