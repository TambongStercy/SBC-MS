import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import App from '../../App';
import { mockApi } from '../../test/mockApi';
import { makeAgent, renderWithProviders } from '../../test/render';

const LINK = 'https://support.sniperbuisnesscenter.com/activate?token=one-time-abc';

describe('Agents', () => {
  it('creates an agent through reauth and shows the activation link once', async () => {
    document.cookie = 'sbc_sup_csrf=tok; path=/';
    const m = mockApi({
      'GET /auth/me': { data: { agent: makeAgent(['support_admin']) } },
      'GET /agents': { data: [] },
      'POST /auth/reauth': { data: { reauthToken: 'rt-create' } },
      'POST /agents': {
        data: {
          agent: { id: 'n1', name: 'Paul Nkodo', email: 'paul@sbc.test', roles: ['support_agent'], status: 'pending_activation', totpEnrolled: false, createdAt: '2026-11-17T10:00:00Z', activeSessions: 0 },
          activationUrl: LINK,
        },
      },
    });
    renderWithProviders(<App />, { path: '/admin/agents' });

    fireEvent.click(await screen.findByRole('button', { name: /Nouvel agent/ }));
    const form = await screen.findByRole('dialog', { name: 'Nouvel agent' });
    fireEvent.change(within(form).getByLabelText(/Nom complet/), { target: { value: 'Paul Nkodo' } });
    fireEvent.change(within(form).getByLabelText(/E-mail/), { target: { value: 'Paul@SBC.test' } });
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Agent support' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Créer le compte' }));

    // Reauth first: nothing is created without the code.
    await screen.findByRole('dialog', { name: 'Créer le compte agent' });
    expect(m.find('POST', '/agents')).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Code de l’application'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));

    expect(await screen.findByTestId('activation-link')).toHaveTextContent(LINK);
    const call = m.find('POST', '/agents')[0];
    expect(call.headers.get('x-reauth-token')).toBe('rt-create');
    expect(call.body).toEqual({ name: 'Paul Nkodo', email: 'paul@sbc.test', roles: ['support_agent'] });
    expect(screen.getByText(/ne sera plus jamais affiché/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'J’ai transmis le lien' }));
    await waitFor(() => expect(screen.queryByTestId('activation-link')).toBeNull());
    expect(screen.queryByText(LINK)).toBeNull();
  });

  it('requires at least one role', async () => {
    document.cookie = 'sbc_sup_csrf=tok; path=/';
    const m = mockApi({ 'GET /auth/me': { data: { agent: makeAgent(['support_admin']) } }, 'GET /agents': { data: [] } });
    renderWithProviders(<App />, { path: '/admin/agents' });
    fireEvent.click(await screen.findByRole('button', { name: /Nouvel agent/ }));
    const form = await screen.findByRole('dialog', { name: 'Nouvel agent' });
    fireEvent.change(within(form).getByLabelText(/Nom complet/), { target: { value: 'Paul Nkodo' } });
    fireEvent.change(within(form).getByLabelText(/E-mail/), { target: { value: 'paul@sbc.test' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Créer le compte' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('Choisissez au moins un rôle.');
    expect(m.find('POST', '/auth/reauth')).toHaveLength(0);
  });
});
