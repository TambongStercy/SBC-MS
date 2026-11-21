import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextType } from '../context/AuthContext';
import type { Permissions } from '../lib/permissions';
import DormantAccountsPage from './DormantAccountsPage';
import * as api from '../services/adminDormantApi';

vi.mock('../services/adminDormantApi', async () => ({
  getDormantSummary: vi.fn(),
  getDormantList: vi.fn(),
  startDormantExport: vi.fn(),
  getDormantExport: vi.fn(),
  downloadDormantExport: vi.fn(),
  markDormantChecked: vi.fn(),
  requestDormantFreeze: vi.fn(),
}));

const tot = (count: number, xafEq: number) => ({ count, xaf: xafEq, usd: 0, xafEq });
const summary: api.DormantSummary = {
  ready: true, day: '2026-11-21', at: '2026-11-21T02:45:00Z',
  thresholds: { inactiveDays: 90, dormantDays: 180, longDormantDays: 365 }, xafPerUsd: 660,
  all: tot(10, 1_000_000),
  byStatus: { active: tot(5, 600_000), inactive: tot(2, 100_000), dormant: tot(2, 50_000), long_dormant: tot(1, 250_000) },
  dormant: {
    ...tot(5, 400_000),
    byBalance: { balance: 400_000, usdBalance: 0, activationBalance: 0, advertisingBalance: 0, eventOrganizerBalance: 0, sbcLiveBalance: 0 },
    byCountry: [{ country: 'CM', ...tot(5, 400_000) }],
    bySize: [{ key: 'gt200k', label: '> 200 000', ...tot(1, 250_000) }],
    flags: { commissionsNoLogin: tot(1, 20_000), fraudFlag: tot(0, 0), checked: tot(0, 0), noAuthenticator: tot(5, 400_000), neverWithdrew: tot(5, 400_000) },
    basis: { created: 5 },
  },
  share: 0.4, previous: { day: '2026-10-21', count: 4, xafEq: 200_000 },
  trend: [{ month: '2026-11', day: '2026-11-21', count: 5, xafEq: 400_000, allXafEq: 1_000_000 }],
  check: { ok: true, card: { count: 5, xafEq: 400_000 }, list: { count: 5, xafEq: 400_000 } },
  reliability: { since: '2026-11-21', days: 0, holdMode: 'log', holdHours: 72 },
};
const row: api.DormantRow = {
  _id: '6a0000000000000000000001', name: 'Awa Dormante', email: 'awa@e2e.test', phoneNumber: '237670000001', country: 'CM', status: 'long_dormant',
  lastSeenAt: '2025-01-01T00:00:00Z', basis: 'created',
  balances: { balance: 250_000, usdBalance: 0, activationBalance: 0, advertisingBalance: 0, eventOrganizerBalance: 0, sbcLiveBalance: 0 },
  debt: 0, heldXaf: 250_000, commissionsNoLogin: true, lastCommissionAt: null, lastWithdrawalAt: null, authenticator: false, fraudFlag: false, frozen: false,
  checkedAt: null, checkedBy: null, checkedNote: null, reactivatedAt: null, holdUntil: null,
};

function renderPage(permissions: Permissions) {
  return render(
    <AuthContext.Provider value={{ permissions } as AuthContextType}>
      <MemoryRouter><DormantAccountsPage /></MemoryRouter>
    </AuthContext.Provider>,
  );
}

beforeEach(() => {
  vi.mocked(api.getDormantSummary).mockResolvedValue(summary);
  vi.mocked(api.getDormantList).mockResolvedValue({ items: [row], nextCursor: null, totals: { count: 5, xafEq: 400_000 } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Comptes dormants', () => {
  it('shows the card, the share, the month change and the list', async () => {
    renderPage({ finance: 'read' });
    expect(await screen.findByText('Awa Dormante')).toBeTruthy();
    expect(screen.getByText('40 %')).toBeTruthy();
    expect(screen.getByText(/\+100 % sur un mois/)).toBeTruthy();
    expect(screen.getByText('Commissions sans connexion', { selector: 'span' })).toBeTruthy();
    expect(screen.getByText(/Les dates de connexion sont enregistrées depuis/)).toBeTruthy();
  });

  it('read-only access: no actions', async () => {
    renderPage({ finance: 'read' });
    await screen.findByText('Awa Dormante');
    expect(screen.queryByRole('button', { name: 'Geler…' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Vérifié' })).toBeNull();
  });

  it('write access: the freeze request needs a reason and goes to support', async () => {
    vi.mocked(api.requestDormantFreeze).mockResolvedValue({ caseId: 'c1', queued: false });
    renderPage({ finance: 'write' });
    fireEvent.click(await screen.findByRole('button', { name: 'Geler…' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Envoyer au support' }));
    expect(await screen.findByText(/10 caractères au moins/)).toBeTruthy();
    expect(api.requestDormantFreeze).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Commissions sur un compte abandonné' } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer au support' }));
    await waitFor(() => expect(api.requestDormantFreeze).toHaveBeenCalledWith(row._id, 'Commissions sur un compte abandonné'));
  });

  it('the commissions card filters the list', async () => {
    renderPage({ finance: 'read' });
    await screen.findByText('Awa Dormante');
    fireEvent.click(screen.getByRole('button', { name: /Commissions sans connexion/ }));
    await waitFor(() => expect(api.getDormantList).toHaveBeenLastCalledWith({ commissionsNoLogin: 'yes' }, undefined));
  });
});
