import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ShowcaseBlock from './ShowcaseBlock';
import * as api from '../../services/impactV2Api';
import { finalEdition, renderWithClient } from './finaleTestUtils';

vi.mock('../../services/impactV2Api', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../services/impactV2Api')>()),
    listShowcase: vi.fn(),
    createShowcasePages: vi.fn(),
}));

const finished = finalEdition({
    status: 'FINISHED', stage: 'RESULT',
    result: { publishedAt: '2026-12-21T21:00:00.000Z', weights: { paidVotes: 50, publicVote: 30, jury: 20 }, winnerCandidateId: 'fA', rows: [{}, {}, {}] as never },
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('ShowcaseBlock', () => {
    it('creates the missing pages and says how many', async () => {
        vi.mocked(api.listShowcase).mockResolvedValueOnce([]).mockResolvedValue([]);
        vi.mocked(api.createShowcasePages).mockResolvedValueOnce({ created: 3 });
        const onChanged = vi.fn();
        renderWithClient(<MemoryRouter><ShowcaseBlock edition={finished} canWrite onChanged={onChanged} /></MemoryRouter>);
        fireEvent.click(await screen.findByRole('button', { name: 'Créer les pages' }));
        await waitFor(() => expect(api.createShowcasePages).toHaveBeenCalledWith('e1'));
        await waitFor(() => expect(api.listShowcase).toHaveBeenCalledTimes(2));
        expect(onChanged).toHaveBeenCalled();
    });

    it('lists the edition’s pages and offers no creation when they all exist', async () => {
        const page = { _id: 's1', profile: { name: 'Awa', photoFileId: 'a.jpg', projectName: 'P' }, result: { rank: 1, score: 80, winner: true, editionName: 'Édition 1', decidedAt: '' }, visibleUntil: '2027-12-21T21:00:00.000Z', archived: false, pendingUpdates: 2 };
        vi.mocked(api.listShowcase).mockResolvedValue([page, { ...page, _id: 's2' }, { ...page, _id: 's3' }] as never);
        renderWithClient(<MemoryRouter><ShowcaseBlock edition={finished} canWrite onChanged={vi.fn()} /></MemoryRouter>);
        expect((await screen.findAllByRole('link', { name: /Awa/ }))[0].getAttribute('href')).toBe('/sbc-impact/vitrine/s1');
        expect(screen.getAllByText('2 à valider').length).toBe(3);
        expect(screen.queryByRole('button', { name: 'Créer les pages' })).toBeNull();
        expect(api.listShowcase).toHaveBeenCalledWith({ editionId: 'e1' });
    });
});
