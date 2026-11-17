import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import App from '../../App';
import { mockApi } from '../../test/mockApi';
import { makeAgent, renderWithProviders } from '../../test/render';

const entries = {
  items: [{
    id: 'e1', seq: 7, at: '2026-11-17T09:00:00Z', actor: { id: 'a1', name: 'Awa Diallo', role: 'support_admin' }, action: 'settings.update',
    object: { type: 'setting', id: 'killswitch.deepseek' }, reason: 'Clé absente', ip: '10.0.0.1', requestId: 'req-1234567890',
    before: { value: false }, after: { value: true }, hash: 'h7', prevHash: 'h6',
  }],
  total: 1, page: 1, limit: 50,
};

function setup(verify: unknown) {
  document.cookie = 'sbc_sup_csrf=tok; path=/';
  const m = mockApi({
    'GET /auth/me': { data: { agent: makeAgent(['support_admin']) } },
    'GET /audit': { data: entries },
    'POST /audit/verify': { data: verify },
  });
  renderWithProviders(<App />, { path: '/admin/audit' });
  return m;
}

describe('Journal d’audit', () => {
  it('"Vérifier la chaîne" reports an intact chain', async () => {
    const m = setup({ ok: true, checked: 1250, verifiedAt: '2026-11-17T10:00:00Z' });
    fireEvent.click(await screen.findByRole('button', { name: /Vérifier la chaîne/ }));
    expect(await screen.findByText(/Chaîne intacte — 1\s250 entrées vérifiées\./)).toBeInTheDocument();
    expect(m.find('POST', '/audit/verify')[0].headers.get('x-csrf-token')).toBe('tok');
  });

  it('"Vérifier la chaîne" reports the first broken entry', async () => {
    setup({ ok: false, checked: 41, firstBrokenSeq: 42, verifiedAt: '2026-11-17T10:00:00Z' });
    fireEvent.click(await screen.findByRole('button', { name: /Vérifier la chaîne/ }));
    expect(await screen.findByText('Chaîne rompue à l’entrée n° 42.')).toBeInTheDocument();
  });

  it('opens an entry with its before/after as text', async () => {
    setup({ ok: true, checked: 1, verifiedAt: '2026-11-17T10:00:00Z' });
    fireEvent.click((await screen.findAllByText('settings.update'))[0]);
    const sheet = await screen.findByRole('dialog');
    expect(sheet).toHaveTextContent('"value": true');
    expect(sheet).toHaveTextContent('h6');
  });
});
