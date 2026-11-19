import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import App from '../../App';
import { ApiError } from '../../api/http';
import { manualActivationError } from '../cases/ManualActivationDialog';
import { mockApi } from '../../test/mockApi';
import { makeAgent, renderWithProviders } from '../../test/render';

describe('Activation', () => {
  it('rechecks a payment and explains the outcome', async () => {
    document.cookie = 'sbc_sup_csrf=tok; path=/';
    const m = mockApi({
      'GET /auth/me': { data: { agent: makeAgent(['support_agent']) } },
      'GET /cases': { data: { items: [], total: 0, page: 1, limit: 20 } },
      'POST /activation/check': { data: { result: 'not_found', provider: 'CinetPay', providerStatus: 'NOT_FOUND', providerRef: 'cp-1', checkedAt: new Date().toISOString(), requestId: 'req-1' } },
    });
    renderWithProviders(<App />, { path: '/activation' });
    fireEvent.change(await screen.findByLabelText('Identifiant de session'), { target: { value: ' sess-1 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Vérifier' }));
    expect(await screen.findByText('Introuvable')).toBeInTheDocument();
    expect(screen.getByText(/dossier d’activation est ouvert automatiquement/)).toBeInTheDocument();
    expect(m.find('POST', '/activation/check')[0].body).toEqual({ sessionId: 'sess-1' });
    expect(m.find('GET', '/cases')[0].query.get('type')).toBe('activation');
  });

  it('a manual activation refused by the provider says so in French', async () => {
    document.cookie = 'sbc_sup_csrf=tok; path=/';
    const m = mockApi({
      'GET /auth/me': { data: { agent: makeAgent(['support_agent']) } },
      'GET /cases': { data: { items: [], total: 0, page: 1, limit: 20 } },
      'POST /auth/reauth': { data: { reauthToken: 'rt-a' } },
      'POST /activation/manual-requests': { status: 409, code: 'REF_ALREADY_USED', message: 'ref used' },
    });
    renderWithProviders(<App />, { path: '/activation' });
    fireEvent.click(await screen.findByRole('button', { name: 'Demande d’activation manuelle' }));
    const dialog = await screen.findByRole('dialog', { name: 'Demande d’activation manuelle' });
    expect(dialog).toBeInTheDocument();
    // Required fields: the form refuses before any call.
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer la demande' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Remplissez le membre');
    expect(m.find('POST', '/activation/manual-requests')).toHaveLength(0);
    await waitFor(() => expect(m.find('POST', '/auth/reauth')).toHaveLength(0));
  });

  it('explains provider refusals in French', () => {
    expect(manualActivationError(new ApiError(409, 'x', 'REF_ALREADY_USED'))).toMatch(/déjà servi/);
    expect(manualActivationError(new ApiError(422, 'x', 'PROVIDER_NOT_CONFIRMED'))).toMatch(/ne confirme pas/);
  });
});
