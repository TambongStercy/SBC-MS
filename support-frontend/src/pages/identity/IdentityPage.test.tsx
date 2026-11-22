import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import App from '../../App';
import { mockApi } from '../../test/mockApi';
import { makeAgent, renderWithProviders } from '../../test/render';
import type { IdentityDetail } from '../../api/identity';

/** KYC level 3: « Identités » — list, review with photos and hints, decision with reauth. */
const row: IdentityDetail = {
  id: 'v1', memberId: '6e2e00000000000000000e01', ticketId: 't1', purpose: 'fraud_hold', purposeLabel: 'Compte retenu par le contrôle anti-fraude',
  status: 'checked', country: 'CM', name: 'Awa Test', guest: false, images: ['id_front', 'selfie'], matchScore: 0.21,
  hints: [{ code: 'faces_differ', text: 'Le visage du selfie ne ressemble pas à la photo de la pièce.' }],
  submittedAt: '2026-11-22T08:00:00Z', decidedAt: null, decidedBy: null, decisionReason: null, imagesDeletedAt: null,
  checks: {
    engine: 'opencv-yunet-sface', match: { score: 0.21, same: false, threshold: 0.363 }, images: {}, sameImageOtherPeople: 0,
    sameFaceOtherPeople: [{ score: 0.6, memberId: '6e2e00000000000000000e09', guest: false }],
  },
  imagesDeleteAt: null,
};

beforeEach(() => {
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:photo'), revokeObjectURL: vi.fn() }));
});
afterEach(() => vi.unstubAllGlobals());

describe('identity review', () => {
  it('support agent: list → review with hints and photos → accept with a reason and the code', async () => {
    document.cookie = 'sbc_sup_csrf=tok; path=/';
    const m = mockApi({
      'GET /auth/me': { data: { agent: makeAgent(['support_agent']) } },
      'GET /identity': { data: [row] },
      'GET /identity/v1': { data: row },
      'GET /identity/v1/images/id_front': { raw: new Blob(['jpg']) },
      'GET /identity/v1/images/selfie': { raw: new Blob(['jpg']) },
      'POST /auth/reauth': { data: { reauthToken: 'rt-id' } },
      'POST /identity/v1/decision': { data: { ...row, status: 'approved' } },
    });
    renderWithProviders(<App />, { path: '/identites' });
    expect(m.find('GET', '/identity')[0]?.query.get('status') ?? (await waitFor(() => m.find('GET', '/identity')[0].query.get('status')))).toBe('open');
    fireEvent.click(await screen.findByRole('link', { name: /Awa Test/ }));

    expect(await screen.findByText('Le visage du selfie ne ressemble pas à la photo de la pièce.')).toBeInTheDocument();
    expect(screen.getByText('Visages différents ?')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Membre …000e09/ })).toHaveAttribute('href', '/membres/6e2e00000000000000000e09');
    expect(await screen.findByRole('img', { name: 'Selfie' })).toHaveAttribute('src', 'blob:photo');
    expect(m.find('GET', '/identity/v1/images/id_front')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Accepter' }));
    const dialog = await screen.findByRole('dialog', { name: 'Accepter cette identité' });
    fireEvent.change(within(dialog).getByLabelText(/Ce que vous avez vérifié/), { target: { value: 'Pièce lisible, même visage en appel vidéo' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Accepter' }));
    fireEvent.change(await screen.findByLabelText('Code de l’application'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));

    await waitFor(() => expect(m.find('POST', '/identity/v1/decision')).toHaveLength(1));
    const call = m.find('POST', '/identity/v1/decision')[0];
    expect(call.headers.get('x-reauth-token')).toBe('rt-id');
    expect(call.body).toEqual({ decision: 'approved', reason: 'Pièce lisible, même visage en appel vidéo' });
    expect(await screen.findByText('Identité acceptée. Le membre est prévenu.')).toBeInTheDocument();
  });

  it('a views verifier does not see « Identités » and cannot open it', async () => {
    document.cookie = 'sbc_sup_csrf=tok; path=/';
    const m = mockApi({ 'GET /auth/me': { data: { agent: makeAgent(['verifier']) } } });
    renderWithProviders(<App />, { path: '/identites' });
    expect(await screen.findByText('Accès refusé')).toBeInTheDocument();
    expect(m.find('GET', '/identity')).toHaveLength(0);
  });
});
