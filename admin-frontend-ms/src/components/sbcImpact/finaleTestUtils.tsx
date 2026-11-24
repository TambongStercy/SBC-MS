import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, type AxiosResponse } from 'axios';
import { TooltipProvider } from '../ui';
import { AuthContext, type AuthContextType } from '../../context/AuthContext';
import type { Edition, JuryOverview } from '../../services/impactV2Api';

/** Test helpers for the « Finale » tab (not shipped: imported by *.test.tsx only). */

export const finalEdition = (patch: Partial<Edition> = {}): Edition => ({
    _id: 'e1', name: 'Édition 1', slug: 'e1', description: '', rulesText: '', statusHistory: [],
    status: 'FINAL', stage: 'LIVE',
    schedule: { qualificationOpensAt: '2026-12-01T08:00:00.000Z', qualificationClosesAt: '2026-12-20T18:00:00.000Z' },
    settings: { weights: { paidVotes: 50, publicVote: 30, jury: 20 } } as Edition['settings'],
    seatSeq: 20, waitlistSeq: 0, createdAt: '', updatedAt: '',
    live: { onStageCandidateId: null, phase: null },
    rounds: { FINAL: { status: 'SCHEDULED' } },
    ...patch,
});

export const juryOverview = (patch: Partial<JuryOverview> = {}): JuryOverview => ({
    lockedAt: null,
    criteria: [{ key: 'impact', label: 'Impact', max: 10 }, { key: 'pitch', label: 'Présentation', max: 10 }],
    maxTotal: 20,
    finalists: [{ _id: 'fA', name: 'Awa' }, { _id: 'fB', name: 'Bako' }, { _id: 'fC', name: 'Chloé' }],
    jurors: [
        {
            _id: 'j1', userId: 'u1', name: 'Juré Un', addedAt: '2026-12-21T08:00:00.000Z', removedAt: null, scored: 2,
            scores: [
                { candidateId: 'fA', total: 16.5, updatedAt: '2026-12-21T10:00:00.000Z', edits: 1 },
                { candidateId: 'fB', total: 12, updatedAt: '2026-12-21T10:10:00.000Z', edits: 0 },
            ],
        },
        {
            _id: 'j2', userId: 'u2', name: 'Juré Retiré', addedAt: '2026-12-21T08:00:00.000Z', removedAt: '2026-12-21T09:00:00.000Z', scored: 1,
            scores: [{ candidateId: 'fC', total: 20, updatedAt: '2026-12-21T08:30:00.000Z', edits: 0 }],
        },
    ],
    ...patch,
});

export const conflict = (code: string, message: string, details?: unknown, status = 409) =>
    new AxiosError(String(status), 'ERR_BAD_REQUEST', undefined, undefined, {
        status, data: { success: false, code, message, details },
    } as AxiosResponse);

export function renderWithClient(node: ReactNode) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <TooltipProvider>{node}</TooltipProvider>
        </QueryClientProvider>,
    );
}

/** As renderWithClient, signed in with write access to the Impact Challenge (pages that read permissions). */
export function renderAsWriter(node: ReactNode, access: 'read' | 'write' = 'write') {
    return renderWithClient(
        <AuthContext.Provider value={{ permissions: { impactChallenge: access } } as unknown as AuthContextType}>{node}</AuthContext.Provider>,
    );
}
