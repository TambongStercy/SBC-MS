import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AuditTab from './AuditTab';
import { TooltipProvider } from '../ui';
import * as api from '../../services/impactV2Api';
import type { AuditEntry } from '../../services/impactV2Api';

vi.mock('../../services/impactV2Api', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../services/impactV2Api')>()),
    listEditionAudit: vi.fn(),
}));

// 50 lines written in the same millisecond (the job's loops do that).
const SAME_MS = '2026-12-20T18:00:00.000Z';
const page1: AuditEntry[] = Array.from({ length: 50 }, (_, i) => ({
    _id: `id${String(99 - i).padStart(2, '0')}`, editionId: 'e1', candidateId: `c${i}`, actorUserId: null, actorName: null,
    actorRole: 'system', action: 'candidate.not_selected', at: SAME_MS,
}));
const page2: AuditEntry[] = [{
    _id: 'adm', editionId: 'e1', actorUserId: 'a1', actorName: 'Rufus', actorRole: 'admin', action: 'edition.close_requested',
    reason: 'Fin anticipée', at: '2026-12-20T17:59:00.000Z',
}];

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('AuditTab', () => {
    it('loads more with the last entry’s at + _id, and shows the admin’s name', async () => {
        vi.mocked(api.listEditionAudit).mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        render(
            <QueryClientProvider client={client}>
                <TooltipProvider><AuditTab editionId="e1" onOpenCandidate={() => undefined} /></TooltipProvider>
            </QueryClientProvider>,
        );

        fireEvent.click(await screen.findByRole('button', { name: 'Charger plus' }));
        await waitFor(() => expect(api.listEditionAudit).toHaveBeenCalledTimes(2));
        expect(vi.mocked(api.listEditionAudit).mock.calls[0]).toEqual(['e1', { limit: 50 }]);
        expect(vi.mocked(api.listEditionAudit).mock.calls[1]).toEqual(['e1', { limit: 50, before: SAME_MS, beforeId: 'id50' }]);
        expect((await screen.findAllByText('Rufus')).length).toBeGreaterThan(0);
        // fewer than a page came back: nothing more to load
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Charger plus' })).toBeNull());
    });
});
