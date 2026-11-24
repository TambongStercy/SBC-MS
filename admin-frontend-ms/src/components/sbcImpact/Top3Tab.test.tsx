import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, type AxiosResponse } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Top3Tab from './Top3Tab';
import { TooltipProvider } from '../ui';
import * as api from '../../services/impactV2Api';
import type { Edition, Top3Preview, Top3Row } from '../../services/impactV2Api';
import { formatDateTime } from '../moduleKit';

vi.mock('../../services/impactV2Api', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../services/impactV2Api')>()),
    getTop3: vi.fn(),
    decideTop3: vi.fn(),
}));

const edition = { _id: 'e1', name: 'Édition 1', status: 'COMPETITION', stage: 'WEEK3', rounds: { PAID: { status: 'CLOSED' } } } as unknown as Edition;

const r = (id: string, name: string, paidVotes: number, rank: number, finalist: boolean): Top3Row => ({
    candidateId: id, name, projectName: `Projet ${name}`, seatNumber: rank, status: 'STAGE_3', paidVotes, paidAmount: paidVotes * 200,
    freeVotes: 10, lastPaidAt: '2026-12-20T18:00:00.000Z', rank, finalist,
});
const preview = (patch: Partial<Top3Preview> = {}): Top3Preview => ({
    ranking: [r('c3', 'Chloé', 90, 1, true), r('c1', 'Awa', 80, 2, true), r('c2', 'Bako', 70, 3, true), r('c4', 'Dramane', 70, 4, false)],
    finalistsCount: 3, tieAtCut: true, blockers: [], flaggedPurchases: 0, decided: false, ...patch,
});

function renderTab(e: Edition = edition, onChanged = vi.fn()) {
    render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <TooltipProvider><Top3Tab edition={e} canWrite onChanged={onChanged} onOpenCandidate={() => undefined} /></TooltipProvider>
        </QueryClientProvider>,
    );
    return onChanged;
}

const decideButton = async () => (await screen.findAllByRole('button', { name: 'Désigner le TOP 3' }))[0] as HTMLButtonElement;

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Top3Tab', () => {
    it('is disabled while something blocks the decision, and says what (with the delay’s end in local time)', async () => {
        const until = '2026-12-21T18:15:00.000Z';
        vi.mocked(api.getTop3).mockResolvedValue(preview({ blockers: [
            { code: 'ROUND_OPEN', message: 'Les votes payants ne sont pas clos.' },
            { code: 'PAYMENTS_SETTLING', message: '2 paiement(s) lancé(s) avant la clôture en cours de confirmation.', until },
        ] }));
        renderTab();
        expect((await decideButton()).disabled).toBe(true);
        expect(screen.getByText('Les votes payants ne sont pas clos.')).toBeTruthy();
        expect(screen.getByText(formatDateTime(until))).toBeTruthy();
        // a plain read: nothing recounted
        expect(api.getTop3).toHaveBeenCalledWith('e1');
    });

    it('« Recompter » asks the server to recount first', async () => {
        vi.mocked(api.getTop3).mockResolvedValue(preview());
        renderTab();
        fireEvent.click(await screen.findByRole('button', { name: 'Recompter' }));
        await waitFor(() => expect(api.getTop3).toHaveBeenCalledWith('e1', { recount: true }));
    });

    it('explains the tie rule when a tie decided the cut', async () => {
        vi.mocked(api.getTop3).mockResolvedValue(preview());
        renderTab();
        expect(await screen.findByText(/passe le candidat qui a atteint ce total le premier/)).toBeTruthy();
    });

    it('shows the podium, then sends the order displayed', async () => {
        vi.mocked(api.getTop3).mockResolvedValue(preview());
        const decided = { ...edition, status: 'FINAL', stage: 'TOP3' } as Edition;
        vi.mocked(api.decideTop3).mockResolvedValueOnce({ edition: decided, ranking: preview().ranking });
        const onChanged = renderTab();

        fireEvent.click(await decideButton());
        const d = await screen.findByRole('dialog', { name: /Désigner le TOP 3/ });
        expect(within(d).getByText(/C’est définitif/)).toBeTruthy();
        expect(within(d).getByText(/Chloé/)).toBeTruthy();
        expect(within(d).queryByText(/Dramane/)).toBeNull();
        fireEvent.click(within(d).getByRole('button', { name: 'Désigner le TOP 3' }));

        await waitFor(() => expect(api.decideTop3).toHaveBeenCalledWith('e1', ['c3', 'c1', 'c2', 'c4']));
        expect(onChanged).toHaveBeenCalledWith(decided);
    });

    it('reloads the ranking when it moved since (STALE)', async () => {
        vi.mocked(api.getTop3).mockResolvedValue(preview());
        vi.mocked(api.decideTop3).mockRejectedValueOnce(new AxiosError('409', 'ERR_BAD_REQUEST', undefined, undefined, {
            status: 409, data: { success: false, code: 'STALE', message: 'Le classement a changé depuis votre lecture. Rechargez-le avant de confirmer.' },
        } as AxiosResponse));
        const onChanged = renderTab();
        fireEvent.click(await decideButton());
        fireEvent.click(within(await screen.findByRole('dialog', { name: /Désigner/ })).getByRole('button', { name: 'Désigner le TOP 3' }));
        await waitFor(() => expect(api.getTop3).toHaveBeenCalledTimes(2));
        expect(onChanged).not.toHaveBeenCalled();
    });

    it('shows the frozen podium once decided, from the names stored with it', async () => {
        renderTab({
            ...edition, status: 'FINAL', stage: 'TOP3',
            top3: { decidedAt: '2026-12-21T10:00:00.000Z', ranking: [
                { candidateId: 'c1', rank: 2, paidVotes: 80, finalist: true, name: 'Awa', projectName: 'Atelier Awa', seatNumber: 2, freeVotes: 12 },
                { candidateId: 'c3', rank: 1, paidVotes: 90, finalist: true, name: 'Chloé', projectName: 'Ferme Chloé', seatNumber: 7, freeVotes: 30 },
                { candidateId: 'c9', rank: 4, paidVotes: 10, finalist: false },
            ] },
        } as Edition);
        expect(await screen.findByText('TOP 3 désigné')).toBeTruthy();
        const items = screen.getAllByRole('listitem').map(li => li.textContent);
        expect(items[0]).toMatch(/^1er.*Chloé.*n° 7.*Ferme Chloé.*90 votes payants/);
        expect(items[2]).toMatch(/…c9/); // decided before names were stored
        expect(api.getTop3).not.toHaveBeenCalled();
    });
});
