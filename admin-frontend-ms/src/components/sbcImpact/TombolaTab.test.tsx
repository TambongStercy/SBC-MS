import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TombolaTab from './TombolaTab';
import * as api from '../../services/impactV2Api';
import type { TombolaDraw, TombolaOverview } from '../../services/impactV2Api';
import { conflict, finalEdition, renderWithClient } from './finaleTestUtils';

vi.mock('../../services/impactV2Api', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../services/impactV2Api')>()),
    getTombola: vi.fn(),
    getTombolaProof: vi.fn(),
    commitTombola: vi.fn(),
    drawTombola: vi.fn(),
    revealNextWinner: vi.fn(),
    setPrizeStatus: vi.fn(),
}));

const committed: TombolaDraw = {
    _id: 'd1', editionId: 'e1', status: 'COMMITTED', seedCommitment: 'a'.repeat(64), committedAt: '2026-12-15T10:00:00.000Z',
    committedBeforeTicketsClosed: true, seed: null, drawnAt: null, prizes: [], totalTickets: null, participants: null,
    segmentsHash: null, revealedCount: 0, winnersCount: 0, winners: [],
};
const drawn = (revealedCount = 0, seed: string | null = 'f'.repeat(64)): TombolaDraw => ({
    ...committed, status: 'DONE', seed, drawnAt: '2026-12-21T21:00:00.000Z', totalTickets: 120, participants: 14, segmentsHash: 'b'.repeat(64),
    prizes: [{ key: 'cash', label: 'Prix en espèces', category: 'cash' }, { key: 'pc', label: 'Un ordinateur', category: 'ordinateur' }, { key: 'tel', label: 'Un téléphone', category: 'telephone' }],
    revealedCount, winnersCount: 3,
    winners: [
        { order: 1, prizeKey: 'cash', prizeLabel: 'Prix en espèces', category: 'cash', ticketNumber: 42, displayName: 'Awa N.', status: 'PENDING', userId: 'u1', attempts: 1 },
        { order: 2, prizeKey: 'pc', prizeLabel: 'Un ordinateur', category: 'ordinateur', ticketNumber: 7, displayName: 'Bako T.', status: 'DELIVERED', userId: 'u2', attempts: 2 },
        { order: 3, prizeKey: 'tel', prizeLabel: 'Un téléphone', category: 'telephone', ticketNumber: null, displayName: null, status: 'NOT_AWARDED', userId: null, attempts: 0 },
    ],
});
const overview = (patch: Partial<TombolaOverview> = {}): TombolaOverview => ({
    draw: null,
    tickets: { totalTickets: 120, participants: 14, totalWeight: 650000, weightScale: 10000, topHolders: [{ userId: 'u1', name: 'Awa Ndiaye', tickets: 60, sharePct: 31.5 }] },
    prizes: drawn().prizes,
    tiers: [{ upTo: 10, weight: 1 }, { upTo: 50, weight: 0.5 }, { upTo: null, weight: 0.25 }],
    cooldownDays: 365, paidRoundClosed: false, canCommit: true, canDraw: false, blockers: [], ...patch,
});

function renderTab(onChanged = vi.fn()) {
    renderWithClient(<MemoryRouter><TombolaTab edition={finalEdition()} canWrite onChanged={onChanged} /></MemoryRouter>);
    return onChanged;
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('TombolaTab · tickets', () => {
    it('shows the tickets, the weights, the biggest holders’ share and the prizes in order', async () => {
        vi.mocked(api.getTombola).mockResolvedValue(overview());
        renderTab();
        expect(await screen.findByText(/1 du 1er au 10e ticket · 0,5 du 11e au 50e ticket · 0,25 au-delà/)).toBeTruthy();
        expect(screen.getByText('Awa Ndiaye')).toBeTruthy();
        expect(screen.getByText('31,5 %')).toBeTruthy();
        expect(screen.getByText('1. Prix en espèces')).toBeTruthy();
        expect(screen.getByText('3. Un téléphone')).toBeTruthy();
    });
});

describe('TombolaTab · 1. seed', () => {
    it('fixes the seed after confirmation and shows its fingerprint', async () => {
        vi.mocked(api.getTombola).mockResolvedValue(overview());
        vi.mocked(api.commitTombola).mockResolvedValueOnce(committed);
        const onChanged = renderTab();
        fireEvent.click(await screen.findByRole('button', { name: 'Fixer la graine' }));
        const d = await screen.findByRole('dialog', { name: 'Fixer la graine du tirage ?' });
        expect(within(d).getByText(/publie tout de suite son empreinte/)).toBeTruthy();
        expect(within(d).getByText(/c’est le bon moment/)).toBeTruthy();
        fireEvent.click(within(d).getByRole('button', { name: 'Fixer la graine' }));
        await waitFor(() => expect(api.commitTombola).toHaveBeenCalledWith('e1'));
        expect((await screen.findByTestId('seed-commitment')).textContent).toBe('a'.repeat(64));
        expect(screen.getByText('Fixée avant la clôture des tickets')).toBeTruthy();
        expect(onChanged).toHaveBeenCalled();
    });

    it('warns when the paid votes are already closed', async () => {
        vi.mocked(api.getTombola).mockResolvedValue(overview({ paidRoundClosed: true }));
        renderTab();
        fireEvent.click(await screen.findByRole('button', { name: 'Fixer la graine' }));
        const d = await screen.findByRole('dialog', { name: 'Fixer la graine du tirage ?' });
        expect(within(d).getByText(/marquée publiquement comme « graine fixée après la clôture des tickets »/)).toBeTruthy();
    });
});

describe('TombolaTab · 2. draw', () => {
    it('is disabled with the blockers shown', async () => {
        vi.mocked(api.getTombola).mockResolvedValue(overview({
            draw: committed, canCommit: false, canDraw: false,
            blockers: [{ code: 'TICKETS_NOT_FINAL', message: 'Les tickets sont définitifs une fois le TOP 3 désigné.' }],
        }));
        renderTab();
        expect(((await screen.findByRole('button', { name: 'Lancer le tirage' })) as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByText('Les tickets sont définitifs une fois le TOP 3 désigné.')).toBeTruthy();
    });

    it('draws after confirmation, then lists every winner and the revealed seed', async () => {
        vi.mocked(api.getTombola).mockResolvedValue(overview({ draw: committed, canCommit: false, canDraw: true }));
        vi.mocked(api.drawTombola).mockResolvedValueOnce(drawn());
        renderTab();
        fireEvent.click(await screen.findByRole('button', { name: 'Lancer le tirage' }));
        const d = await screen.findByRole('dialog', { name: 'Lancer le tirage ?' });
        expect(within(d).getByText(/enregistré pour de bon/)).toBeTruthy();
        expect(within(d).getByText(/ne sont prévenus qu’au moment où vous les affichez/)).toBeTruthy();
        fireEvent.click(within(d).getByRole('button', { name: 'Lancer le tirage' }));
        await waitFor(() => expect(api.drawTombola).toHaveBeenCalledWith('e1'));
        expect((await screen.findByTestId('seed')).textContent).toBe('f'.repeat(64));
        expect(within(screen.getByTestId('winner-1')).getByText('Awa N.')).toBeTruthy();
        expect(within(screen.getByTestId('winner-2')).getByText(/2 essais/)).toBeTruthy();
        expect(within(screen.getByTestId('winner-3')).getByText(/Plus aucun participant éligible/)).toBeTruthy();
        // the member app's readable proof page
        expect(screen.getByRole('link', { name: /Preuve publique du tirage/ }).getAttribute('href')).toMatch(/^https?:\/\/[^/]+\/impact-challenge\/tombola\/preuve\/d1$/);
        expect(screen.getByRole('link', { name: /Écran du tirage/ }).getAttribute('href')).toMatch(/\/impact-challenge\/tombola$/);
    });

    it('reads the seed from the public proof after a reload', async () => {
        vi.mocked(api.getTombola).mockResolvedValue(overview({ draw: drawn(0, null), canCommit: false }));
        vi.mocked(api.getTombolaProof).mockResolvedValueOnce({ seed: 'c'.repeat(64), seedCommitment: 'a'.repeat(64) });
        renderTab();
        await waitFor(() => expect(api.getTombolaProof).toHaveBeenCalledWith('d1'));
        await waitFor(() => expect(screen.getByTestId('seed').textContent).toBe('c'.repeat(64)));
    });
});

describe('TombolaTab · 3. reveal', () => {
    it('shows one more winner per click, counts them, and stops at the end', async () => {
        vi.mocked(api.getTombola).mockResolvedValue(overview({ draw: drawn(1), canCommit: false }));
        vi.mocked(api.revealNextWinner).mockResolvedValueOnce(drawn(2)).mockResolvedValueOnce(drawn(3));
        renderTab();
        expect(await screen.findByText('1/3 affichés')).toBeTruthy();
        const next = screen.getByRole('button', { name: 'Afficher le gagnant suivant' }) as HTMLButtonElement;
        fireEvent.click(next);
        expect(await screen.findByText('2/3 affichés')).toBeTruthy();
        expect(within(screen.getByTestId('winner-2')).getByText('Affiché')).toBeTruthy();
        fireEvent.click(next);
        expect(await screen.findByText('3/3 affichés')).toBeTruthy();
        await waitFor(() => expect(next.disabled).toBe(true));
        expect(api.revealNextWinner).toHaveBeenCalledTimes(2);
    });

    it('reloads when the server says everything is shown (ALL_REVEALED)', async () => {
        vi.mocked(api.getTombola).mockResolvedValue(overview({ draw: drawn(2), canCommit: false }));
        vi.mocked(api.revealNextWinner).mockRejectedValueOnce(conflict('ALL_REVEALED', 'Tous les gagnants sont déjà affichés.'));
        renderTab();
        fireEvent.click(await screen.findByRole('button', { name: 'Afficher le gagnant suivant' }));
        await waitFor(() => expect(api.getTombola).toHaveBeenCalledTimes(2));
    });
});

describe('TombolaTab · prize statuses', () => {
    it('marks a prize delivered, forfeited with a reason of 5 characters, or back to pending', async () => {
        vi.mocked(api.getTombola).mockResolvedValue(overview({ draw: drawn(3), canCommit: false }));
        vi.mocked(api.setPrizeStatus).mockResolvedValue(drawn(3));
        renderTab();
        const first = await screen.findByTestId('winner-1');
        fireEvent.click(within(first).getByRole('button', { name: 'Remis' }));
        await waitFor(() => expect(api.setPrizeStatus).toHaveBeenCalledWith('e1', 1, 'DELIVERED'));

        fireEvent.click(within(first).getByRole('button', { name: 'Non remis' }));
        const d = await screen.findByRole('dialog', { name: /non remis/ });
        const confirm = within(d).getByRole('button', { name: 'Marquer non remis' }) as HTMLButtonElement;
        fireEvent.change(within(d).getByLabelText(/Raison/), { target: { value: 'abcd' } });
        expect(confirm.disabled).toBe(true);
        fireEvent.change(within(d).getByLabelText(/Raison/), { target: { value: 'Injoignable' } });
        fireEvent.click(confirm);
        await waitFor(() => expect(api.setPrizeStatus).toHaveBeenCalledWith('e1', 1, 'FORFEITED', 'Injoignable'));

        // the delivered one goes back to pending; the unawarded one has no actions
        fireEvent.click(within(screen.getByTestId('winner-2')).getByRole('button', { name: 'Remettre en attente' }));
        await waitFor(() => expect(api.setPrizeStatus).toHaveBeenCalledWith('e1', 2, 'PENDING'));
        expect(within(screen.getByTestId('winner-3')).queryByRole('button')).toBeNull();
    });
});
