import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import App from '../../App';
import { mockApi } from '../../test/mockApi';
import { makeAgent, renderWithProviders } from '../../test/render';
import type { SupportMember } from '../../api/types';

const base: SupportMember = {
  _id: 'm1', name: 'Jean Dupont', country: 'CM', city: 'Douala', createdAt: '2026-01-02T10:00:00Z',
  isVerified: true, blocked: false, deleted: false, balance: 12500, usdBalance: 0, reservedBalance: 0, debt: 0, subscriptions: [],
};

function setup(roles: Parameters<typeof makeAgent>[0], member: SupportMember) {
  document.cookie = 'sbc_sup_csrf=tok; path=/';
  return mockApi({
    'GET /auth/me': { data: { agent: makeAgent(roles) } },
    'GET /members/m1': { data: { member } },
    'GET /members/m1/payins': { data: [] },
  });
}

describe('member record: masked values', () => {
  it('shows the masked email and phone exactly as the server sent them, with the masked hint', async () => {
    setup(['support_agent'], { ...base, email: 'j•••@gmail.com', phoneNumber: '+237 6•• •• 34', masked: true });
    renderWithProviders(<App />, { path: '/membres/m1' });
    expect(await screen.findByTestId('member-email')).toHaveTextContent(/^j•••@gmail\.com$/);
    expect(screen.getByTestId('member-phone')).toHaveTextContent(/^\+237 6•• •• 34$/);
    expect(screen.getByText('Masqué selon votre rôle')).toBeInTheDocument();
    // Payins tab loads on its own.
    expect(await screen.findByText('Aucun paiement récent')).toBeInTheDocument();
  });

  it('a finance manager sees the full values as given, without the hint', async () => {
    setup(['finance_manager'], { ...base, email: 'jean.dupont@gmail.com', phoneNumber: '+237 690 12 34 34', masked: false });
    renderWithProviders(<App />, { path: '/membres/m1' });
    expect(await screen.findByTestId('member-email')).toHaveTextContent(/^jean\.dupont@gmail\.com$/);
    expect(screen.getByTestId('member-phone')).toHaveTextContent(/^\+237 690 12 34 34$/);
    expect(screen.queryByText('Masqué selon votre rôle')).toBeNull();
  });

  it('the contact-change request is offered only with members.contact.request', async () => {
    setup(['finance_manager'], { ...base, email: 'x', phoneNumber: 'y' });
    renderWithProviders(<App />, { path: '/membres/m1' });
    await screen.findByTestId('member-email');
    expect(screen.queryByRole('button', { name: /Demander un changement de contact/ })).toBeNull();
  });
});
