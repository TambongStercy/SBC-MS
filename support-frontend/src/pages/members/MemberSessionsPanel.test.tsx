import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import App from '../../App';
import { mockApi } from '../../test/mockApi';
import { makeAgent, renderWithProviders } from '../../test/render';
import type { SupportMember } from '../../api/types';

/** Session replay + live assistance on the member page (OpenReplay, 2026-11-23). */
const member: SupportMember = {
  _id: 'm1', name: 'Jean Dupont', country: 'CM', createdAt: '2026-01-02T10:00:00Z', isVerified: true, subscriptions: [],
  balance: 0, usdBalance: 0, reservedBalance: 0, debt: 0,
};
const sessions = {
  live: [{ sessionId: '7700000000000009', startedAt: '2026-11-23T08:00:00Z', durationMs: null, pages: 2, device: 'Android · Chrome', live: true }],
  recorded: [{ sessionId: '7700000000000001', startedAt: '2026-11-22T08:00:00Z', durationMs: 120000, pages: 4, device: null, live: false }],
};

function setup(roles: Parameters<typeof makeAgent>[0], extra: Record<string, unknown> = {}) {
  document.cookie = 'sbc_sup_csrf=tok; path=/';
  return mockApi({
    'GET /auth/me': { data: { agent: makeAgent(roles) } },
    'GET /members/m1': { data: { member } },
    'GET /members/m1/payins': { data: [] },
    'GET /members/m1/sessions': { data: sessions },
    ...extra,
  });
}

afterEach(() => vi.restoreAllMocks());

describe('member sessions panel', () => {
  it('a finance agent lists sessions on demand and opens one through the audited call; no live assistance', async () => {
    const tab = { opener: {}, location: { href: '' }, close: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    const m = setup(['finance_agent'], { 'POST /members/m1/sessions/7700000000000001/open': { data: { url: 'https://replay.test/2/session/7700000000000001' } } });
    renderWithProviders(<App />, { path: '/membres/m1' });
    fireEvent.click(await screen.findByRole('button', { name: 'Afficher' }));
    expect(await screen.findByText('En direct')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Assistance en direct/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Revoir la session' }));
    await waitFor(() => expect(tab.location.href).toBe('https://replay.test/2/session/7700000000000001'));
    expect(tab.opener).toBeNull();
    expect(m.find('POST', '/members/m1/sessions/7700000000000001/open')[0].body).toEqual({ live: false });
  });

  it('a support agent now has live assistance too', async () => {
    setup(['support_agent']);
    renderWithProviders(<App />, { path: '/membres/m1' });
    fireEvent.click(await screen.findByRole('button', { name: 'Afficher' }));
    expect(await screen.findByRole('button', { name: /Assistance en direct/ })).toBeInTheDocument();
  });

  it('a support administrator opens live assistance: grant first, then the live view', async () => {
    const tab = { opener: {}, location: { href: '' }, close: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    const m = setup(['support_admin'], {
      'POST /members/m1/assist': { data: { grantId: 'g1', expiresAt: '2026-11-23T09:00:00Z', live: [{ ...sessions.live[0], url: 'https://replay.test/2/assist/7700000000000009' }] } },
      'POST /members/assist/g1/end': { data: { ended: true } },
    });
    renderWithProviders(<App />, { path: '/membres/m1' });
    fireEvent.click(await screen.findByRole('button', { name: /Assistance en direct/ }));
    await waitFor(() => expect(tab.location.href).toBe('https://replay.test/2/assist/7700000000000009'));
    fireEvent.click(await screen.findByRole('button', { name: 'Terminer l’assistance en direct' }));
    await waitFor(() => expect(m.find('POST', '/members/assist/g1/end')).toHaveLength(1));
  });

  it('a verifier sees no sessions panel', async () => {
    setup(['verifier']);
    renderWithProviders(<App />, { path: '/membres/m1' });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('Sessions')).toBeNull();
  });
});
