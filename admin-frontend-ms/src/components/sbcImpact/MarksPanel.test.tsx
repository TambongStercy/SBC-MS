import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MarksPanel from './MarksPanel';
import * as api from '../../services/impactV2Api';
import { conflict, finalEdition, juryOverview, renderWithClient } from './finaleTestUtils';

vi.mock('../../services/impactV2Api', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../services/impactV2Api')>()),
    getJury: vi.fn(),
    getJuryScores: vi.fn(),
    lockJury: vi.fn(),
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('MarksPanel', () => {
    it('shows the jurors × finalists matrix, removed jurors struck through, active averages', async () => {
        vi.mocked(api.getJury).mockResolvedValue(juryOverview());
        renderWithClient(<MarksPanel edition={finalEdition()} canWrite onChanged={vi.fn()} />);
        const cell = await screen.findByRole('button', { name: 'Note de Juré Un pour Awa : 16,5 sur 20' });
        expect(within(cell).getByText('1×')).toBeTruthy(); // corrected once
        expect(screen.getByRole('rowheader', { name: /Juré Retiré/ }).className).toMatch(/line-through/);
        // Chloé was marked only by the removed juror: no active average, and she is flagged
        const footer = screen.getByRole('rowheader', { name: 'Moyenne (jurés actifs)' }).closest('tr')!;
        expect(within(footer).getAllByRole('cell').map(c => c.textContent)).toEqual(['16,5/20', '12/20', '—']);
        expect(screen.getByText(/Pas encore noté par tout le jury : .*Chloé/)).toBeTruthy();
    });

    it('opens a mark with its criteria, comment and corrections', async () => {
        vi.mocked(api.getJury).mockResolvedValue(juryOverview());
        vi.mocked(api.getJuryScores).mockResolvedValue([{
            candidateId: 'fA', jurorUserId: 'u1', jurorName: 'Juré Un', jurorRemoved: false,
            scores: { impact: 8.5, pitch: 8 }, total: 16.5, comment: 'Très convaincant.', updatedAt: '2026-12-21T10:00:00.000Z',
            history: [{ scores: { impact: 7, pitch: 8 }, total: 15, comment: 'Première impression', at: '2026-12-21T09:40:00.000Z' }],
        }]);
        renderWithClient(<MarksPanel edition={finalEdition()} canWrite onChanged={vi.fn()} />);
        fireEvent.click(await screen.findByRole('button', { name: /Note de Juré Un pour Awa/ }));
        const d = await screen.findByRole('dialog', { name: 'Juré Un → Awa' });
        expect(await within(d).findByText('8,5 / 10')).toBeTruthy();
        expect(within(d).getByText('« Très convaincant. »')).toBeTruthy();
        expect(within(d).getByText('Version remplacée : 15 / 20')).toBeTruthy();
        expect(within(d).getByText('Impact 7/10 · Présentation 8/10')).toBeTruthy();
    });

    it('lists who did not mark whom when the lock is refused (MISSING_SCORES)', async () => {
        vi.mocked(api.getJury).mockResolvedValue(juryOverview());
        vi.mocked(api.lockJury).mockRejectedValueOnce(conflict('MISSING_SCORES', 'Chaque finaliste doit avoir au moins une note avant le verrouillage.', {
            missing: [
                { candidateId: 'fA', name: 'Awa', scoredBy: 1, notScoredBy: [] },
                { candidateId: 'fC', name: 'Chloé', scoredBy: 0, notScoredBy: ['Juré Un'] },
            ],
        }));
        const onChanged = vi.fn();
        renderWithClient(<MarksPanel edition={finalEdition()} canWrite onChanged={onChanged} />);
        fireEvent.click(await screen.findByRole('button', { name: /Verrouiller les notes/ }));
        const d = await screen.findByRole('dialog', { name: /Verrouiller les notes du jury/ });
        expect(within(d).getByText(/C’est définitif/)).toBeTruthy();
        fireEvent.click(within(d).getByRole('button', { name: 'Verrouiller les notes' }));
        await waitFor(() => expect(api.lockJury).toHaveBeenCalledWith('e1'));
        expect(await screen.findByText('Chaque finaliste doit avoir au moins une note avant le verrouillage.')).toBeTruthy();
        expect(screen.getByText(/pas encore noté par Juré Un/).textContent).toMatch(/Chloé : aucune note/);
        expect(onChanged).not.toHaveBeenCalled();
    });

    it('offers no lock once locked', async () => {
        vi.mocked(api.getJury).mockResolvedValue(juryOverview({ lockedAt: '2026-12-21T12:00:00.000Z' }));
        renderWithClient(<MarksPanel edition={finalEdition({ jury: { lockedAt: '2026-12-21T12:00:00.000Z' } })} canWrite onChanged={vi.fn()} />);
        await screen.findByText(/Verrouillées le/);
        expect(screen.queryByRole('button', { name: /Verrouiller les notes/ })).toBeNull();
    });
});
