import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CandidatesTab from './CandidatesTab';
import * as api from '../../services/impactV2Api';
import type { CandidateList, Edition } from '../../services/impactV2Api';

vi.mock('../../services/impactV2Api', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../services/impactV2Api')>()),
    listCandidates: vi.fn(),
}));

const edition = { _id: 'e1', name: 'Édition 1', status: 'QUALIFICATION', settings: { invitationsRequired: 10 } } as unknown as Edition;

const answer: CandidateList = {
    items: [{
        _id: 'c1', editionId: 'e1', userId: 'u1', sbcId: 'SBC1',
        profile: {
            name: 'Awa Candidate', photoFileId: 'impact/awa.jpg', country: 'CM', city: 'Douala', activity: 'Couture', category: 'Mode',
            projectName: 'Atelier Awa', projectDescription: 'x'.repeat(20), presentation: 'y'.repeat(50), extra: {},
        },
        status: 'OFFICIAL', statusLabel: 'Candidat officiel', suspendedFrom: null,
        invitations: { valid: 9, pending: 1, required: 10, reachedAt: null, checkedAt: null },
        seatNumber: 4, seatAt: null, waitlistRank: null, review: { status: 'APPROVED' }, profileUpdatedAt: '2026-12-02T09:00:00Z',
        statusHistory: [], createdAt: '2026-12-02T09:00:00Z', updatedAt: '2026-12-02T09:00:00Z', belowRequirement: true,
    }],
    total: 1, page: 1, limit: 20, byStatus: { OFFICIAL: 4 }, belowRequirementCount: 1, seats: { taken: 4, max: 20 },
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('CandidatesTab', () => {
    it('asks the server for seat holders below the requirement with ?sous=1', async () => {
        vi.mocked(api.listCandidates).mockResolvedValue(answer);
        render(
            <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
                <MemoryRouter initialEntries={['/sbc-impact/e1?sous=1']}>
                    <CandidatesTab edition={edition} onOpen={() => undefined} />
                </MemoryRouter>
            </QueryClientProvider>,
        );
        await waitFor(() => expect(api.listCandidates).toHaveBeenCalledWith('e1', expect.objectContaining({ below: true, page: 1 })));
        expect((await screen.findAllByText('Sous le seuil')).length).toBeGreaterThan(0);
        expect(screen.getAllByText('n° 4').length).toBeGreaterThan(0);
    });
});
