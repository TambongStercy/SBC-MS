import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AxiosError, type AxiosResponse } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CandidateSheet from './CandidateSheet';
import { TooltipProvider } from '../ui';
import * as api from '../../services/impactV2Api';
import type { Candidate, CandidateDetails, Edition } from '../../services/impactV2Api';

vi.mock('../../services/impactV2Api', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../services/impactV2Api')>()),
    getCandidate: vi.fn(),
    reviewCandidate: vi.fn(),
}));

const edition = {
    _id: 'e1', name: 'Édition 1', status: 'QUALIFICATION',
    settings: { profileFields: [{ key: 'clients', label: 'Nombre de clients', required: false, maxLength: 100 }] },
} as unknown as Edition;

const candidate = (profileUpdatedAt: string): Candidate => ({
    _id: 'c1', editionId: 'e1', userId: 'u1', sbcId: 'SBC123',
    profile: {
        name: 'Awa Candidate', photoFileId: 'impact/awa.jpg', country: 'CM', city: 'Douala', activity: 'Couture',
        category: 'Mode & beauté', projectName: 'Atelier Awa', projectDescription: 'Un atelier de couture solidaire.',
        presentation: 'Présentation longue du projet.', extra: { clients: '120' },
    },
    status: 'OFFICIAL', statusLabel: 'Candidat officiel', suspendedFrom: null,
    invitations: { valid: 10, pending: 2, required: 10, reachedAt: '2026-12-05T10:00:00Z', checkedAt: '2026-12-05T10:00:10Z' },
    seatNumber: 3, seatAt: '2026-12-05T10:00:10Z', waitlistRank: null,
    review: { status: 'PENDING' }, profileUpdatedAt,
    statusHistory: [{ from: 'QUALIFYING', to: 'OFFICIAL', at: '2026-12-05T10:00:10Z' }],
    createdAt: '2026-12-02T09:00:00Z', updatedAt: '2026-12-05T10:00:10Z',
});

const details = (c: Candidate): CandidateDetails => ({
    candidate: c, edition: { _id: 'e1', name: 'Édition 1', status: 'QUALIFICATION' },
    audit: [
        { _id: 'a2', candidateId: 'c1', actorUserId: 'adm1', actorName: 'Sterling Admin', actorRole: 'admin', action: 'candidate.changes_requested', reason: 'Photo floue, merci.', at: '2026-12-03T09:00:00Z' },
        { _id: 'a1', candidateId: 'c1', actorUserId: 'u1', actorName: null, actorRole: 'member', action: 'candidate.applied', at: '2026-12-02T09:00:00Z' },
    ],
});

function renderSheet(onChanged = vi.fn()) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
        <QueryClientProvider client={client}>
            <TooltipProvider>
                <MemoryRouter>
                    <CandidateSheet candidateId="c1" edition={edition} canWrite onClose={() => undefined} onChanged={onChanged} />
                </MemoryRouter>
            </TooltipProvider>
        </QueryClientProvider>,
    );
    return onChanged;
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('CandidateSheet', () => {
    it('shows the profile with the edition’s extra questions and the audit trail', async () => {
        vi.mocked(api.getCandidate).mockResolvedValue(details(candidate('2026-12-02T09:00:00.000Z')));
        renderSheet();
        expect(await screen.findByText('Nombre de clients')).toBeTruthy();
        expect(screen.getByText('120')).toBeTruthy();
        expect(screen.getByText('SBC123')).toBeTruthy();
        expect(screen.getByText('Candidature déposée', { selector: 'span' })).toBeTruthy();
        expect(screen.getByText('Sterling Admin')).toBeTruthy();
        expect(screen.getByText('Membre')).toBeTruthy();
    });

    it('approves with the profileUpdatedAt it displayed, and reloads on STALE', async () => {
        vi.mocked(api.getCandidate)
            .mockResolvedValueOnce(details(candidate('2026-12-02T09:00:00.000Z')))
            .mockResolvedValueOnce(details(candidate('2026-12-03T11:00:00.000Z')));
        vi.mocked(api.reviewCandidate).mockRejectedValueOnce(new AxiosError('409', 'ERR_BAD_REQUEST', undefined, undefined, {
            status: 409,
            data: { success: false, code: 'STALE', message: 'Le profil a été modifié depuis votre lecture. Rechargez-le avant de décider.' },
        } as AxiosResponse));
        const onChanged = renderSheet();

        fireEvent.click(await screen.findByRole('button', { name: /Valider le profil/ }));
        // the confirmation, over the sheet (which Radix hides from the accessibility tree meanwhile)
        const dialog = await screen.findByRole('dialog', { name: /Valider le profil de Awa Candidate/ });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Valider le profil' }));

        await waitFor(() => expect(api.reviewCandidate).toHaveBeenCalledWith('c1', { decision: 'approve', profileUpdatedAt: '2026-12-02T09:00:00.000Z' }));
        await waitFor(() => expect(api.getCandidate).toHaveBeenCalledTimes(2));
        expect(onChanged).toHaveBeenCalled();
    });
});
