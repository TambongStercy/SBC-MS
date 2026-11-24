import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AxiosError, type AxiosResponse } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SbcImpactShowcaseDetailPage from './SbcImpactShowcaseDetailPage';
import * as api from '../services/impactV2Api';
import type { ShowcaseDetail } from '../services/impactV2Api';
import { renderAsWriter } from '../components/sbcImpact/finaleTestUtils';

vi.mock('../services/impactV2Api', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../services/impactV2Api')>()),
    getShowcase: vi.fn(),
    editShowcase: vi.fn(),
    postShowcaseUpdate: vi.fn(),
    uploadShowcaseImage: vi.fn(),
    reviewShowcaseUpdate: vi.fn(),
}));

const detail = (patch: Partial<ShowcaseDetail> = {}): ShowcaseDetail => ({
    _id: 's1', editionId: 'e1', candidateId: 'c1',
    profile: { name: 'Awa Ndiaye', photoFileId: 'impact/awa.jpg', projectName: 'Atelier Awa' },
    result: { rank: 1, score: 79.76, winner: true, editionName: 'Édition 1', decidedAt: '2026-12-21T21:00:00.000Z' },
    videoFileId: null, podcast: { url: 'https://pod.example/ep1', title: 'Épisode 1', platform: 'Spotify' },
    youtubeUrl: 'https://youtu.be/abc', shopUrl: null,
    visibleFrom: '2026-12-21T21:00:00.000Z', visibleUntil: '2027-12-21T21:00:00.000Z', archived: false,
    userId: 'u1', hidden: false, hiddenAt: null, hiddenReason: null, minVisibleUntil: '2027-12-21T21:00:00.000Z',
    updates: [{
        _id: 'n9', kind: 'NEWS', title: 'Article de presse', body: 'Le projet a été cité dans le journal local de Douala.', imageFileId: null, link: null,
        publishedAt: '2027-01-02T10:00:00.000Z', status: 'PUBLISHED', authorRole: 'admin', review: null, createdAt: '2027-01-02T10:00:00.000Z',
    }],
    ...patch,
});

function renderDetail(d = detail()) {
    vi.mocked(api.getShowcase).mockResolvedValue(d);
    vi.mocked(api.editShowcase).mockResolvedValue(d);
    renderAsWriter(
        <MemoryRouter initialEntries={['/sbc-impact/vitrine/s1']}>
            <Routes><Route path="/sbc-impact/vitrine/:id" element={<SbcImpactShowcaseDetailPage />} /></Routes>
        </MemoryRouter>,
    );
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('SbcImpactShowcaseDetailPage · links', () => {
    it('refuses a non-YouTube address like the server, without calling it', async () => {
        renderDetail();
        const yt = await screen.findByLabelText(/Vidéo YouTube/);
        fireEvent.change(yt, { target: { value: 'https://vimeo.com/123' } });
        fireEvent.click(screen.getByRole('button', { name: 'Enregistrer les liens' }));
        expect(await screen.findByText('Ce lien n’est pas une adresse YouTube.')).toBeTruthy();
        fireEvent.change(yt, { target: { value: 'http://youtube.com/watch?v=x' } });
        fireEvent.click(screen.getByRole('button', { name: 'Enregistrer les liens' }));
        expect(await screen.findByText('L’adresse doit commencer par https://.')).toBeTruthy();
        expect(api.editShowcase).not.toHaveBeenCalled();
    });

    it('sends only what changed; an empty field removes the link', async () => {
        renderDetail();
        fireEvent.change(await screen.findByLabelText(/Vidéo YouTube/), { target: { value: 'https://m.youtube.com/watch?v=z' } });
        fireEvent.change(screen.getByLabelText(/Podcast \(adresse\)/), { target: { value: '' } });
        fireEvent.click(screen.getByRole('button', { name: 'Enregistrer les liens' }));
        await waitFor(() => expect(api.editShowcase).toHaveBeenCalledWith('s1', { podcast: null, youtubeUrl: 'https://m.youtube.com/watch?v=z' }));
    });
});

describe('SbcImpactShowcaseDetailPage · visibility', () => {
    it('extends the end date (end of the chosen day) and shows the server’s TOO_EARLY message', async () => {
        renderDetail();
        vi.mocked(api.editShowcase).mockRejectedValueOnce(new AxiosError('400', 'ERR_BAD_REQUEST', undefined, undefined, {
            status: 400, data: { success: false, code: 'TOO_EARLY', message: 'La page reste visible au moins jusqu’au 21 décembre 2027.', details: { field: 'visibleUntil', minVisibleUntil: '2027-12-21T21:00:00.000Z' } },
        } as AxiosResponse));
        const date = await screen.findByLabelText(/Prolonger jusqu’au/);
        fireEvent.change(date, { target: { value: '2028-06-30' } });
        fireEvent.click(screen.getByRole('button', { name: 'Enregistrer la date' }));
        await waitFor(() => expect(api.editShowcase).toHaveBeenCalledWith('s1', { visibleUntil: new Date(2028, 5, 30, 23, 59, 59, 999).toISOString() }));
        expect(await screen.findByText('La page reste visible au moins jusqu’au 21 décembre 2027.')).toBeTruthy();
    });

    it('refuses a date under the server’s minimum (minVisibleUntil) before asking it', async () => {
        // An edition with a longer « Durée dans SBC Impact »: the minimum comes from the answer, not from 12 months.
        renderDetail(detail({ minVisibleUntil: '2028-06-21T21:00:00.000Z', visibleUntil: '2028-06-21T21:00:00.000Z' }));
        const date = await screen.findByLabelText(/Prolonger jusqu’au/);
        expect(date.getAttribute('min')).toBe('2028-06-21');
        fireEvent.change(date, { target: { value: '2028-01-15' } });
        fireEvent.click(screen.getByRole('button', { name: 'Enregistrer la date' }));
        expect(await screen.findByText(/La page reste visible au moins jusqu’au/)).toBeTruthy();
        expect(api.editShowcase).not.toHaveBeenCalled();
    });

    it('hides the page with a reason of 10 characters after confirmation', async () => {
        renderDetail();
        fireEvent.click(await screen.findByRole('button', { name: 'Masquer la page' }));
        const d = await screen.findByRole('dialog', { name: 'Masquer la page ?' });
        const confirm = within(d).getByRole('button', { name: 'Masquer la page' }) as HTMLButtonElement;
        fireEvent.change(within(d).getByLabelText(/Raison/), { target: { value: 'Trop court' } });
        expect(confirm.disabled).toBe(false);
        fireEvent.change(within(d).getByLabelText(/Raison/), { target: { value: 'court' } });
        expect(confirm.disabled).toBe(true);
        fireEvent.change(within(d).getByLabelText(/Raison/), { target: { value: 'Demande du finaliste, à revoir' } });
        fireEvent.click(confirm);
        await waitFor(() => expect(api.editShowcase).toHaveBeenCalledWith('s1', { hidden: true, hiddenReason: 'Demande du finaliste, à revoir' }));
    });

    it('shows a hidden page again', async () => {
        renderDetail(detail({ hidden: true, hiddenAt: '2027-02-01T00:00:00.000Z', hiddenReason: 'Contenu signalé', archived: false }));
        expect(await screen.findByText(/« Contenu signalé »/)).toBeTruthy();
        // no news on a hidden page
        expect(screen.queryByRole('button', { name: /Publier une nouvelle/ })).toBeNull();
        expect(screen.getByText('Page masquée : affichez-la d’abord pour publier une nouvelle.')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Afficher à nouveau' }));
        fireEvent.click(within(await screen.findByRole('dialog', { name: 'Afficher la page à nouveau ?' })).getByRole('button', { name: 'Afficher à nouveau' }));
        await waitFor(() => expect(api.editShowcase).toHaveBeenCalledWith('s1', { hidden: false }));
    });
});

describe('SbcImpactShowcaseDetailPage · news', () => {
    it('publishes news at once, with an uploaded image', async () => {
        renderDetail();
        vi.mocked(api.uploadShowcaseImage).mockResolvedValueOnce('impact/news.jpg');
        vi.mocked(api.postShowcaseUpdate).mockResolvedValueOnce(detail().updates[0]);
        fireEvent.click(await screen.findByRole('button', { name: /Publier une nouvelle/ }));
        const d = await screen.findByRole('dialog', { name: 'Publier une nouvelle' });
        fireEvent.change(within(d).getByLabelText(/^Titre/), { target: { value: 'Ok' } });
        fireEvent.change(within(d).getByLabelText(/^Texte/), { target: { value: 'Trop court' } });
        fireEvent.click(within(d).getByRole('button', { name: 'Publier' }));
        expect(within(d).getByText('Le titre compte 3 à 120 caractères.')).toBeTruthy();
        expect(within(d).getByText('Le texte compte 20 à 3 000 caractères.')).toBeTruthy();

        fireEvent.change(within(d).getByLabelText(/^Titre/), { target: { value: 'Deuxième boutique' } });
        fireEvent.change(within(d).getByLabelText(/^Texte/), { target: { value: 'Une deuxième boutique ouvre à Yaoundé en février.' } });
        const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
        fireEvent.change(within(d).getByLabelText(/^Image/), { target: { files: [file] } });
        await waitFor(() => expect(api.uploadShowcaseImage).toHaveBeenCalledWith(file));
        await within(d).findByAltText('Aperçu');
        fireEvent.click(within(d).getByRole('button', { name: 'Publier' }));
        await waitFor(() => expect(api.postShowcaseUpdate).toHaveBeenCalledWith('s1', {
            kind: 'NEWS', title: 'Deuxième boutique', body: 'Une deuxième boutique ouvre à Yaoundé en février.', imageFileId: 'impact/news.jpg',
        }));
    });

    it('shows the server’s message when the page was hidden meanwhile (HIDDEN)', async () => {
        renderDetail();
        vi.mocked(api.postShowcaseUpdate).mockRejectedValueOnce(new AxiosError('409', 'ERR_BAD_REQUEST', undefined, undefined, {
            status: 409, data: { success: false, code: 'HIDDEN', message: 'Cette page est masquée : affichez-la d’abord.' },
        } as AxiosResponse));
        fireEvent.click(await screen.findByRole('button', { name: /Publier une nouvelle/ }));
        const d = await screen.findByRole('dialog', { name: 'Publier une nouvelle' });
        fireEvent.change(within(d).getByLabelText(/^Titre/), { target: { value: 'Deuxième boutique' } });
        fireEvent.change(within(d).getByLabelText(/^Texte/), { target: { value: 'Une deuxième boutique ouvre à Yaoundé en février.' } });
        fireEvent.click(within(d).getByRole('button', { name: 'Publier' }));
        expect(await within(d).findByText('Cette page est masquée : affichez-la d’abord.')).toBeTruthy();
    });

    it('removes a published news item with a reason of 5 characters', async () => {
        renderDetail();
        vi.mocked(api.reviewShowcaseUpdate).mockResolvedValueOnce({ ...detail().updates[0], status: 'REMOVED' });
        fireEvent.click(within(await screen.findByTestId('update-n9')).getByRole('button', { name: 'Retirer' }));
        const d = await screen.findByRole('dialog', { name: /Retirer « Article de presse »/ });
        fireEvent.change(within(d).getByLabelText(/Raison/), { target: { value: 'Erreur' } });
        fireEvent.click(within(d).getByRole('button', { name: 'Retirer' }));
        await waitFor(() => expect(api.reviewShowcaseUpdate).toHaveBeenCalledWith('n9', 'remove', 'Erreur'));
    });

    it('links to the public page in the member app', async () => {
        renderDetail();
        expect((await screen.findByRole('link', { name: /Page publique/ })).getAttribute('href')).toMatch(/\/impact\/s1$/);
    });
});
