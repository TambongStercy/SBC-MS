import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextType } from '../../context/AuthContext';
import type { Permissions } from '../../lib/permissions';
import ReactivationPanel from './ReactivationPanel';
import * as api from '../../services/adminDormantApi';

vi.mock('../../services/adminDormantApi', async () => ({
  getReactivationText: vi.fn(),
  saveReactivationDraft: vi.fn(),
  approveReactivationText: vi.fn(),
  previewReactivation: vi.fn(),
  startReactivationCampaign: vi.fn(),
  listReactivationCampaigns: vi.fn(),
  cancelReactivationCampaign: vi.fn(),
}));

const base = { subject: 'Des nouvelles de votre compte SBC', body: 'Bonjour {{nom}},\n\nVotre compte vous attend.', pushTitle: 'Votre compte SBC', pushBody: 'Ouvrez SBC' };
const approvedState: api.ReactivationTextState = {
  draft: { ...base, updatedBy: 'a1', updatedAt: '2026-11-23T08:00:00Z' },
  approved: { ...base, version: 2, approvedBy: 'a2', approvedAt: '2026-11-23T09:00:00Z' },
  draftApproved: true, isDefault: false,
};
const campaign: api.ReactivationCampaign = {
  id: 'c1', status: 'sending', mode: 'live', filters: {}, textVersion: 2, createdBy: 'a1', createdAt: '2026-11-23T10:00:00Z', builtAt: null, finishedAt: null,
  waitUntil: null, pending: 40, error: null,
  counts: { targets: 100, sent: 60, failed: 1, skipped: 0, returned: 6, emailSent: 58, pushSent: 20 }, excluded: { frozen: 3 },
};
const preview: api.ReactivationPreview = {
  matched: 120, sendable: 100, excluded: { frozen: 3, recent_contact: 17 }, reachKnown: true, withEmail: 98, withPush: 30,
  mode: 'live', capped: false, minDays: 30, approvedVersion: 2,
};

const renderPanel = (permissions: Permissions) => render(
  <AuthContext.Provider value={{ permissions } as AuthContextType}><ReactivationPanel filters={{ status: 'dormant' }} /></AuthContext.Provider>,
);

beforeEach(() => {
  vi.mocked(api.getReactivationText).mockResolvedValue(approvedState);
  vi.mocked(api.listReactivationCampaigns).mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Message de réactivation', () => {
  it('finance read: sees the approved text and the history, cannot edit or send', async () => {
    vi.mocked(api.listReactivationCampaigns).mockResolvedValue([{ ...campaign, status: 'done', pending: 0 }]);
    renderPanel({ finance: 'read' });
    expect(await screen.findByText(/Version 2 approuvée/)).toBeTruthy();
    expect(screen.getByText('Des nouvelles de votre compte SBC')).toBeTruthy();
    expect(await screen.findByText('Terminée')).toBeTruthy();
    expect(screen.getByText('10 %')).toBeTruthy(); // 6 came back of 60 sent
    expect(screen.queryByRole('button', { name: /Qui recevrait/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Approuver ce texte' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Annuler' })).toBeNull();
  });

  it('super admin: edits, saves, then approves the draft (with a confirmation)', async () => {
    vi.mocked(api.saveReactivationDraft).mockResolvedValue({ ...approvedState, draft: { ...approvedState.draft, subject: 'Nouvel objet' }, draftApproved: false });
    vi.mocked(api.approveReactivationText).mockResolvedValue({ ...approvedState, approved: { ...approvedState.approved!, subject: 'Nouvel objet', version: 3 } });
    renderPanel({ staff: 'write', finance: 'write' });
    const subject = await screen.findByDisplayValue('Des nouvelles de votre compte SBC');
    fireEvent.change(subject, { target: { value: 'Nouvel objet' } });
    expect((screen.getByRole('button', { name: 'Approuver ce texte' }) as HTMLButtonElement).disabled).toBe(true); // save first
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le brouillon' }));
    await waitFor(() => expect(api.saveReactivationDraft).toHaveBeenCalledWith({ ...base, subject: 'Nouvel objet' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Approuver ce texte' }));
    expect(api.approveReactivationText).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Approuver' }));
    await waitFor(() => expect(api.approveReactivationText).toHaveBeenCalled());
  });

  it('finance write: preview with the page filters, then send after a confirmation', async () => {
    vi.mocked(api.previewReactivation).mockResolvedValue(preview);
    vi.mocked(api.startReactivationCampaign).mockResolvedValue({ id: 'c9', status: 'building', mode: 'live' });
    renderPanel({ finance: 'write' });
    fireEvent.click(await screen.findByRole('button', { name: 'Qui recevrait le message ?' }));
    await waitFor(() => expect(api.previewReactivation).toHaveBeenCalledWith({ status: 'dormant' }));
    expect(await screen.findByText(/17 déjà contacté il y a moins de 30 jours/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer à 100 membre(s)' }));
    expect(api.startReactivationCampaign).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Envoyer' }));
    await waitFor(() => expect(api.startReactivationCampaign).toHaveBeenCalledWith({ status: 'dormant' }));
  });

  it('test mode and no approved text are said plainly; sending is off without a text', async () => {
    vi.mocked(api.getReactivationText).mockResolvedValue({ ...approvedState, approved: null, draftApproved: false });
    vi.mocked(api.previewReactivation).mockResolvedValue({ ...preview, mode: 'allowlist', sendable: 1, approvedVersion: null });
    renderPanel({ finance: 'write' });
    expect(await screen.findByText(/Aucun texte approuvé : rien ne peut être envoyé/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Qui recevrait le message ?' }));
    expect(await screen.findByText(/Mode test/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Envoyer à 1 membre(s)' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a running campaign can be cancelled after a confirmation', async () => {
    vi.mocked(api.listReactivationCampaigns).mockResolvedValue([campaign]);
    vi.mocked(api.cancelReactivationCampaign).mockResolvedValue({ cancelled: true, notSent: 40 });
    renderPanel({ finance: 'write' });
    expect(await screen.findByText('40 en attente')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Annuler la campagne' }));
    await waitFor(() => expect(api.cancelReactivationCampaign).toHaveBeenCalledWith('c1'));
  });
});
