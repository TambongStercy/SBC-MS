import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SbcImpactShowcasePage from './SbcImpactShowcasePage';
import * as api from '../services/impactV2Api';
import type { PendingShowcaseUpdate, ShowcasePage } from '../services/impactV2Api';
import { renderAsWriter } from '../components/sbcImpact/finaleTestUtils';

vi.mock('../services/impactV2Api', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../services/impactV2Api')>()),
    listShowcase: vi.fn(),
    listPendingShowcaseUpdates: vi.fn(),
    listEditions: vi.fn(),
    reviewShowcaseUpdate: vi.fn(),
}));

const showcasePage = (patch: Partial<ShowcasePage> = {}): ShowcasePage => ({
    _id: 's1', editionId: 'e1', candidateId: 'c1',
    profile: { name: 'Awa Ndiaye', photoFileId: 'impact/awa.jpg', projectName: 'Atelier Awa', city: 'Douala', country: 'CM', activity: 'Couture' },
    result: { rank: 1, score: 79.76, winner: true, editionName: 'Édition 1', decidedAt: '2026-12-21T21:00:00.000Z' },
    videoFileId: 'impact/video.mp4', podcast: null, youtubeUrl: null, shopUrl: 'https://sbc.shop/awa',
    visibleFrom: '2026-12-21T21:00:00.000Z', visibleUntil: '2027-12-21T21:00:00.000Z', archived: false,
    userId: 'u1', hidden: false, hiddenAt: null, hiddenReason: null, pendingUpdates: 1, ...patch,
});

const pending: PendingShowcaseUpdate = {
    _id: 'n1', kind: 'PRODUCT', title: 'Nouvelle collection', body: 'Notre nouvelle collection de pagnes est disponible en boutique.',
    imageFileId: null, link: null, publishedAt: null, status: 'PENDING', authorRole: 'finalist', review: null,
    createdAt: '2027-01-10T09:00:00.000Z', showcaseId: 's1', finalist: { name: 'Awa Ndiaye', projectName: 'Atelier Awa' },
};

function renderPage() {
    renderAsWriter(<MemoryRouter><SbcImpactShowcasePage /></MemoryRouter>);
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('SbcImpactShowcasePage', () => {
    it('lists the pages with their result, end date, state and pending news, filterable by edition', async () => {
        vi.mocked(api.listShowcase).mockResolvedValue([
            showcasePage(),
            showcasePage({ _id: 's2', profile: { ...showcasePage().profile, name: 'Bako' }, result: { ...showcasePage().result, rank: 2, winner: false, score: 75 }, hidden: true, hiddenAt: '2027-02-01T00:00:00.000Z', hiddenReason: 'Contenu signalé', archived: false, pendingUpdates: 0 }),
            showcasePage({ _id: 's3', profile: { ...showcasePage().profile, name: 'Chloé' }, result: { ...showcasePage().result, rank: 3, winner: false, score: 24.12 }, visibleUntil: '2026-12-31T00:00:00.000Z', archived: true, pendingUpdates: 0 }),
        ]);
        vi.mocked(api.listPendingShowcaseUpdates).mockResolvedValue([]);
        vi.mocked(api.listEditions).mockResolvedValue([{ _id: 'e1', name: 'Édition 1', status: 'FINISHED' }, { _id: 'e2', name: 'Édition 2', status: 'DRAFT' }] as never);
        renderPage();
        const table = (await screen.findAllByRole('table'))[0];
        const rows = within(table).getAllByRole('row').slice(1);
        expect(within(rows[0]).getByText('1er · 79,76/100')).toBeTruthy();
        expect(within(rows[0]).getByText('Gagnant')).toBeTruthy();
        expect(within(rows[0]).getByText('1 nouvelle à valider')).toBeTruthy();
        expect(within(rows[0]).getByText('En ligne')).toBeTruthy();
        expect(within(rows[1]).getByText('Masquée')).toBeTruthy();
        expect(within(rows[2]).getByText('Archivée')).toBeTruthy();
        expect(screen.getByText('Aucune nouvelle en attente.')).toBeTruthy();
        expect(api.listShowcase).toHaveBeenCalledWith({ editionId: undefined });
    });

    it('approves a finalist’s news after confirmation', async () => {
        vi.mocked(api.listShowcase).mockResolvedValue([showcasePage()]);
        vi.mocked(api.listPendingShowcaseUpdates).mockResolvedValue([pending]);
        vi.mocked(api.listEditions).mockResolvedValue([]);
        vi.mocked(api.reviewShowcaseUpdate).mockResolvedValueOnce({ ...pending, status: 'PUBLISHED' });
        renderPage();
        const card = await screen.findByTestId('update-n1');
        expect(within(card).getByText('Awa Ndiaye · Atelier Awa')).toBeTruthy();
        fireEvent.click(within(card).getByRole('button', { name: 'Publier' }));
        fireEvent.click(within(await screen.findByRole('dialog', { name: /Publier « Nouvelle collection »/ })).getByRole('button', { name: 'Publier' }));
        await waitFor(() => expect(api.reviewShowcaseUpdate).toHaveBeenCalledWith('n1', 'approve', undefined));
    });

    it('rejects only with a reason of 10 characters, which the finalist reads', async () => {
        vi.mocked(api.listShowcase).mockResolvedValue([]);
        vi.mocked(api.listPendingShowcaseUpdates).mockResolvedValue([pending]);
        vi.mocked(api.listEditions).mockResolvedValue([]);
        vi.mocked(api.reviewShowcaseUpdate).mockResolvedValueOnce({ ...pending, status: 'REJECTED' });
        renderPage();
        fireEvent.click(within(await screen.findByTestId('update-n1')).getByRole('button', { name: 'Refuser' }));
        const d = await screen.findByRole('dialog', { name: /Refuser « Nouvelle collection »/ });
        const confirm = within(d).getByRole('button', { name: 'Refuser' }) as HTMLButtonElement;
        fireEvent.change(within(d).getByLabelText(/lue par le finaliste/), { target: { value: 'Trop vague' } });
        expect(confirm.disabled).toBe(false); // exactly 10
        fireEvent.change(within(d).getByLabelText(/lue par le finaliste/), { target: { value: 'Pas clair' } });
        expect(confirm.disabled).toBe(true);
        fireEvent.change(within(d).getByLabelText(/lue par le finaliste/), { target: { value: 'Ajoutez une photo du produit, merci.' } });
        fireEvent.click(confirm);
        await waitFor(() => expect(api.reviewShowcaseUpdate).toHaveBeenCalledWith('n1', 'reject', 'Ajoutez une photo du produit, merci.'));
    });
});
