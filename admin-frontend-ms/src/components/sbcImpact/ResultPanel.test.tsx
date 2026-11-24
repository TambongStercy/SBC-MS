import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ResultPanel from './ResultPanel';
import * as api from '../../services/impactV2Api';
import type { FinalResultRow, ResultPreview } from '../../services/impactV2Api';
import { conflict, finalEdition, renderWithClient } from './finaleTestUtils';

vi.mock('../../services/impactV2Api', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../services/impactV2Api')>()),
    getResult: vi.fn(),
    publishResult: vi.fn(),
}));

const row = (candidateId: string, name: string, score: number, rank: number, c: [number, number, number]): FinalResultRow => ({
    candidateId, name, projectName: `Projet ${name}`, paidVotes: 100, finalVotes: 40, juryAverage: 15, juryMax: 20, jurorsCount: 3,
    components: { paidVotes: c[0], publicVote: c[1], jury: c[2] }, score, rank,
});
const rows = [row('fA', 'Awa', 79.76, 1, [100, 60, 88.2]), row('fB', 'Bako', 75, 2, [80, 100, 50]), row('fC', 'Chloé', 24.12, 3, [20, 10, 50])];
const preview = (patch: Partial<Extract<ResultPreview, { published: false }>> = {}): ResultPreview => ({
    published: false, weights: { paidVotes: 50, publicVote: 30, jury: 20 }, rows, missing: [], blockers: [], warnings: [],
    formula: 'Chaque partie est ramenée sur 100 : le meilleur finaliste de la partie obtient 100.', ...patch,
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const publishButton = async () => (await screen.findByRole('button', { name: 'Publier le résultat' })) as HTMLButtonElement;

describe('ResultPanel', () => {
    it('shows the parts on 100 with their weights, the score, the rank, the formula and the warnings', async () => {
        vi.mocked(api.getResult).mockResolvedValue(preview({ warnings: ['Le vote public de la finale n’a pas eu lieu : sa part vaut 0 pour tous.'] }));
        renderWithClient(<ResultPanel edition={finalEdition({ jury: { lockedAt: '2026-12-21T12:00:00.000Z' } })} canWrite onChanged={vi.fn()} />);
        const awa = await screen.findByTestId('result-fA');
        expect(within(awa).getByText('1er')).toBeTruthy();
        expect(within(awa).getByText('79,76')).toBeTruthy();
        expect(within(awa).getByText('88,2')).toBeTruthy();
        expect(screen.getByRole('columnheader', { name: 'Votes payants (50 %)' })).toBeTruthy();
        expect(screen.getByRole('columnheader', { name: 'Jury (20 %)' })).toBeTruthy();
        expect(screen.getByText(/le meilleur finaliste de la partie obtient 100/)).toBeTruthy();
        expect(screen.getByText(/sa part vaut 0 pour tous/)).toBeTruthy();
    });

    it('is disabled while something blocks the publication, and says what', async () => {
        vi.mocked(api.getResult).mockResolvedValue(preview({
            blockers: [
                { code: 'JURY_NOT_LOCKED', message: 'Verrouillez d’abord les notes du jury.' },
                { code: 'MISSING_SCORES', message: 'Un finaliste n’a aucune note du jury.', details: { missing: [{ candidateId: 'fC', name: 'Chloé', scoredBy: 0, notScoredBy: ['Juré Un', 'Juré Deux'] }] } },
            ],
        }));
        renderWithClient(<ResultPanel edition={finalEdition()} canWrite onChanged={vi.fn()} />);
        expect((await publishButton()).disabled).toBe(true);
        expect(screen.getByText('Verrouillez d’abord les notes du jury.')).toBeTruthy();
        expect(screen.getByText('Chloé : pas encore noté par Juré Un, Juré Deux')).toBeTruthy();
    });

    it('confirms with the winner and the table, then sends the order displayed', async () => {
        vi.mocked(api.getResult).mockResolvedValue(preview());
        const finished = finalEdition({ status: 'FINISHED', stage: 'RESULT' });
        vi.mocked(api.publishResult).mockResolvedValueOnce(finished);
        const onChanged = vi.fn();
        renderWithClient(<ResultPanel edition={finalEdition({ jury: { lockedAt: '2026-12-21T12:00:00.000Z' } })} canWrite onChanged={onChanged} />);
        fireEvent.click(await publishButton());
        const d = await screen.findByRole('dialog', { name: 'Publier le résultat ?' });
        expect(within(d).getByText('Gagnant : Awa')).toBeTruthy();
        expect(within(d).getByText(/C’est définitif/)).toBeTruthy();
        expect(within(d).getByText('Chloé')).toBeTruthy();
        fireEvent.click(within(d).getByRole('button', { name: 'Publier le résultat' }));
        await waitFor(() => expect(api.publishResult).toHaveBeenCalledWith('e1', ['fA', 'fB', 'fC']));
        expect(onChanged).toHaveBeenCalledWith(finished);
    });

    it('reloads the table when the result changed since (STALE)', async () => {
        vi.mocked(api.getResult).mockResolvedValue(preview());
        vi.mocked(api.publishResult).mockRejectedValueOnce(conflict('STALE', 'Le résultat a changé depuis votre lecture. Rechargez-le avant de publier.'));
        const onChanged = vi.fn();
        renderWithClient(<ResultPanel edition={finalEdition()} canWrite onChanged={onChanged} />);
        fireEvent.click(await publishButton());
        fireEvent.click(within(await screen.findByRole('dialog', { name: 'Publier le résultat ?' })).getByRole('button', { name: 'Publier le résultat' }));
        await waitFor(() => expect(api.getResult).toHaveBeenCalledTimes(2));
        expect(onChanged).not.toHaveBeenCalled();
    });

    it('shows the frozen result once published', async () => {
        vi.mocked(api.getResult).mockResolvedValue({
            published: true, formula: 'Formule.',
            result: { publishedAt: '2026-12-21T20:00:00.000Z', weights: { paidVotes: 50, publicVote: 30, jury: 20 }, rows: [...rows].reverse(), winnerCandidateId: 'fA' },
        });
        renderWithClient(<ResultPanel edition={finalEdition({ status: 'FINISHED', stage: 'RESULT' })} canWrite onChanged={vi.fn()} />);
        expect(await screen.findByText('Résultat publié')).toBeTruthy();
        const first = screen.getAllByTestId(/^result-/)[0];
        expect(first.getAttribute('data-testid')).toBe('result-fA');
        expect(within(first).getByText('Gagnant')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Publier le résultat' })).toBeNull();
    });
});
