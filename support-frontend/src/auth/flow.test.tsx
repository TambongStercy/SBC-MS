import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import App from '../App';
import { mockApi } from '../test/mockApi';
import { makeAgent, renderWithProviders } from '../test/render';

const agent = makeAgent(['support_agent']);
const setCsrf = () => { document.cookie = 'sbc_sup_csrf=tok; path=/'; };
const empty = { data: { items: [], total: 0, page: 1, limit: 1 } };

describe('sign-in flow', () => {
  it('login → TOTP → app', async () => {
    setCsrf();
    const m = mockApi({
      'GET /auth/me': { status: 401 },
      'POST /auth/login': { data: { step: 'totp', challengeId: 'ch-1' } },
      'POST /auth/totp': { data: { agent } },
      'GET /tickets': empty,
    });
    renderWithProviders(<App />, { path: '/tickets' });

    fireEvent.change(await screen.findByLabelText('E-mail'), { target: { value: 'awa@sbc.test' } });
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'correct horse battery' } });
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));

    const code = await screen.findByLabelText('Code de l’application');
    fireEvent.change(code, { target: { value: '12 34 56' } });
    fireEvent.click(screen.getByRole('button', { name: 'Valider' }));

    // Back on the page asked for before sign-in, inside the shell.
    await screen.findByRole('navigation', { name: 'Raccourcis' });
    expect(m.find('POST', '/auth/login')[0].body).toEqual({ email: 'awa@sbc.test', password: 'correct horse battery' });
    expect(m.find('POST', '/auth/totp')[0].body).toEqual({ challengeId: 'ch-1', code: '123456' });
    expect(m.find('POST', '/auth/totp')[0].headers.get('x-csrf-token')).toBe('tok');
  });

  it('accepts a backup code instead of the app code', async () => {
    setCsrf();
    const m = mockApi({
      'GET /auth/me': { status: 401 },
      'POST /auth/login': { data: { step: 'totp', challengeId: 'ch-2' } },
      'POST /auth/totp': { data: { agent } },
    });
    renderWithProviders(<App />, { path: '/connexion' });
    fireEvent.change(await screen.findByLabelText('E-mail'), { target: { value: 'a@b.c' } });
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Utiliser un code de secours' }));
    fireEvent.change(screen.getByLabelText('Code de secours'), { target: { value: 'abcd-efgh' } });
    fireEvent.click(screen.getByRole('button', { name: 'Valider' }));
    await waitFor(() => expect(m.find('POST', '/auth/totp')).toHaveLength(1));
    expect(m.find('POST', '/auth/totp')[0].body).toEqual({ challengeId: 'ch-2', backupCode: 'abcd-efgh' });
    await screen.findByText(/Bonjour Awa/);
  });

  it('shows one message for a refused login and stays on the form', async () => {
    setCsrf();
    mockApi({ 'GET /auth/me': { status: 401 }, 'POST /auth/login': { status: 401, message: 'Identifiants invalides.' } });
    renderWithProviders(<App />, { path: '/connexion' });
    fireEvent.change(await screen.findByLabelText('E-mail'), { target: { value: 'a@b.c' } });
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Identifiants invalides.');
    expect(screen.getByLabelText('Mot de passe')).toHaveValue('');
  });

  it('first login: enrol (QR + manual key), then backup codes once, then app', async () => {
    setCsrf();
    const codes = Array.from({ length: 10 }, (_, i) => `code-${i}`);
    const m = mockApi({
      'GET /auth/me': { status: 401 },
      'POST /auth/login': { data: { step: 'enroll', challengeId: 'ch-e' } },
      'POST /auth/enroll/start': { data: { otpauthUrl: 'otpauth://totp/SBC%20Support:awa?secret=JBSWY3DPEHPK3PXP&issuer=SBC', qrDataUrl: 'data:image/png;base64,iVBORw0KGgo=' } },
      'POST /auth/enroll/confirm': { data: { agent, backupCodes: codes } },
    });
    renderWithProviders(<App />, { path: '/connexion' });
    fireEvent.change(await screen.findByLabelText('E-mail'), { target: { value: 'a@b.c' } });
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));

    expect(await screen.findByAltText(/QR code/)).toHaveAttribute('src', 'data:image/png;base64,iVBORw0KGgo=');
    expect(screen.getByTestId('manual-key')).toHaveTextContent('JBSW Y3DP EHPK 3PXP');
    expect(m.find('POST', '/auth/enroll/start')[0].body).toEqual({ challengeId: 'ch-e' });

    fireEvent.change(screen.getByLabelText('Code affiché par l’application'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Activer' }));

    const list = await screen.findByRole('list', { name: 'Codes de secours' });
    expect(list.querySelectorAll('li')).toHaveLength(10);
    const next = screen.getByRole('button', { name: 'Continuer' });
    expect(next).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'J’ai rangé mes codes de secours' }));
    fireEvent.click(next);
    await screen.findByText(/Bonjour Awa/);
    expect(screen.queryByText('code-0')).toBeNull();
    expect(m.find('POST', '/auth/enroll/confirm')[0].body).toEqual({ challengeId: 'ch-e', code: '654321' });
  });

  it('an existing session goes straight to the app; logout revokes it', async () => {
    setCsrf();
    const m = mockApi({ 'GET /auth/me': { data: { agent } }, 'POST /auth/logout': { data: null }, 'GET /tickets': empty });
    renderWithProviders(<App />, { path: '/' });
    await screen.findByText(/Bonjour Awa/);
    fireEvent.click(screen.getAllByRole('link', { name: 'Déconnexion' })[0]);
    await screen.findByLabelText('E-mail');
    expect(m.find('POST', '/auth/logout')).toHaveLength(1);
  });

  it('a session that cannot be refreshed sends the agent back to sign-in', async () => {
    setCsrf();
    mockApi({
      'GET /auth/me': { data: { agent } },
      'GET /tickets': { status: 401 },
      'POST /auth/refresh': { status: 401 },
    });
    renderWithProviders(<App />, { path: '/' });
    expect(await screen.findByText('Votre session a expiré. Reconnectez-vous.')).toBeTruthy();
    expect(screen.getByLabelText('E-mail')).toBeTruthy();
  });
});
