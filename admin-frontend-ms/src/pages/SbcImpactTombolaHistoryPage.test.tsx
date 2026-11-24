import { cleanup, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SbcImpactTombolaHistoryPage from './SbcImpactTombolaHistoryPage';
import * as api from '../services/impactV2Api';
import { renderWithClient } from '../components/sbcImpact/finaleTestUtils';

vi.mock('../services/impactV2Api', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../services/impactV2Api')>()),
    getTombolaHistory: vi.fn(),
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('SbcImpactTombolaHistoryPage', () => {
    it('lists every prize of every draw: edition, date, ticket, winner, prize, status, note', async () => {
        vi.mocked(api.getTombolaHistory).mockResolvedValue([{
            drawId: 'd2', editionId: 'e2', editionName: 'Édition 2', drawnAt: '2027-06-21T21:00:00.000Z', totalTickets: 300, participants: 40,
            winners: [
                { order: 1, prize: 'Prix en espèces', category: 'cash', ticketNumber: 12, displayName: 'Awa N.', status: 'DELIVERED', userId: 'u1', statusNote: null },
                { order: 2, prize: 'Un ordinateur', category: 'ordinateur', ticketNumber: 250, displayName: 'Bako T.', status: 'FORFEITED', userId: 'u2', statusNote: 'Injoignable après 3 relances' },
            ],
        }, {
            drawId: 'd1', editionId: 'e1', editionName: 'Édition 1', drawnAt: '2026-12-21T21:00:00.000Z', totalTickets: 120, participants: 14,
            winners: [{ order: 1, prize: 'Prix en espèces', category: 'cash', ticketNumber: null, displayName: null, status: 'NOT_AWARDED', userId: null }],
        }]);
        renderWithClient(<MemoryRouter><SbcImpactTombolaHistoryPage /></MemoryRouter>);

        expect(await screen.findByText('2 tirages · 3 lots')).toBeTruthy();
        const table = screen.getAllByRole('table')[0];
        const rows = within(table).getAllByRole('row').slice(1);
        expect(rows).toHaveLength(3);
        expect(within(rows[0]).getByRole('link', { name: 'Édition 2' }).getAttribute('href')).toBe('/sbc-impact/e2?tab=tombola');
        expect(within(rows[0]).getByRole('link', { name: 'Awa N.' }).getAttribute('href')).toBe('/userpage/u1');
        expect(within(rows[0]).getByText('n° 12')).toBeTruthy();
        expect(within(rows[0]).getByText('Remis')).toBeTruthy();
        expect(within(rows[1]).getByText('Non remis')).toBeTruthy();
        expect(within(rows[1]).getByText('Injoignable après 3 relances')).toBeTruthy();
        expect(within(rows[2]).getByText('Non attribué')).toBeTruthy();
    });

    it('says when there is no draw yet', async () => {
        vi.mocked(api.getTombolaHistory).mockResolvedValue([]);
        renderWithClient(<MemoryRouter><SbcImpactTombolaHistoryPage /></MemoryRouter>);
        expect(await screen.findByText('Aucun tirage pour l’instant')).toBeTruthy();
    });
});
