import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AxiosError, type AxiosResponse } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SettingsTab from './SettingsTab';
import * as api from '../../services/impactV2Api';
import type { Edition } from '../../services/impactV2Api';

vi.mock('../../services/impactV2Api', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../services/impactV2Api')>()),
    updateEdition: vi.fn(),
}));

const edition = (status: Edition['status']): Edition => ({
    _id: 'e1', name: 'Édition 1', slug: 'edition-1', description: 'Desc', rulesText: 'R'.repeat(250),
    status, statusHistory: [],
    schedule: { qualificationOpensAt: '2026-12-01T08:00:00.000Z', qualificationClosesAt: '2026-12-20T18:00:00.000Z' },
    settings: {
        maxCandidates: 20, invitationsRequired: 10, waitlistSize: 5, finalistsCount: 3, votePrice: 200,
        votePacks: [{ votes: 1, price: 200 }],
        weights: { paidVotes: 50, publicVote: 30, jury: 20 },
        juryCriteria: [{ key: 'impact', label: 'Impact', max: 10 }],
        ticketTiers: [{ upTo: null, weight: 1 }],
        prizes: [{ key: 'cash', label: 'Prix en espèces', category: 'cash' }],
        prizeCooldownDays: 365, showcaseMonths: 12, categories: ['Commerce'], profileFields: [],
    },
    seatSeq: 0, waitlistSeq: 0, createdAt: '2026-11-23T00:00:00Z', updatedAt: '2026-11-23T00:00:00Z',
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const disabled = (el: HTMLElement) => (el as HTMLInputElement | HTMLTextAreaElement).disabled;

describe('SettingsTab', () => {
    it('disables the rules frozen by an open qualification, not the others', () => {
        render(<SettingsTab edition={edition('QUALIFICATION')} canWrite onSaved={() => undefined} />);
        expect(disabled(screen.getByLabelText(/^Règlement/))).toBe(true);
        expect(disabled(screen.getByLabelText(/^Nombre de candidats/))).toBe(true);
        expect(disabled(screen.getByLabelText(/^Fin de la qualification/))).toBe(true);
        expect(disabled(screen.getByLabelText(/^Nom de l’édition/))).toBe(false);
        expect(disabled(screen.getByLabelText(/^Prix d’un vote/))).toBe(false);
        expect(screen.getAllByText(/Verrouillé depuis l’ouverture de la qualification/).length).toBeGreaterThan(0);
    });

    it('is read-only without write access', () => {
        render(<SettingsTab edition={edition('DRAFT')} canWrite={false} onSaved={() => undefined} />);
        expect(disabled(screen.getByLabelText(/^Nom de l’édition/))).toBe(true);
        expect(disabled(screen.getByLabelText(/^Règlement/))).toBe(true);
        expect(screen.queryByRole('button', { name: 'Enregistrer' })).toBeNull();
    });

    it('shows the live weight total', () => {
        render(<SettingsTab edition={edition('DRAFT')} canWrite onSaved={() => undefined} />);
        expect(screen.getByText('100 %')).toBeTruthy();
        fireEvent.change(screen.getByLabelText('Jury'), { target: { value: '25' } });
        expect(screen.getByText('105 %')).toBeTruthy();
        expect(screen.getByText('Le total doit faire 100 %.')).toBeTruthy();
    });

    it('highlights the date named by INVALID_SCHEDULE', async () => {
        vi.mocked(api.updateEdition).mockRejectedValueOnce(new AxiosError('400', 'ERR_BAD_REQUEST', undefined, undefined, {
            status: 400,
            data: { success: false, code: 'INVALID_SCHEDULE', message: 'La finale a lieu après le début de la compétition.', details: { field: 'schedule.finalAt' } },
        } as AxiosResponse));
        render(<SettingsTab edition={edition('DRAFT')} canWrite onSaved={() => undefined} />);
        fireEvent.change(screen.getByLabelText(/^Finale/), { target: { value: '2026-12-25T10:00' } });
        fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
        await waitFor(() => expect(screen.getByLabelText(/^Finale/).getAttribute('aria-invalid')).toBe('true'));
        expect(screen.getByLabelText(/^Début de la compétition/).getAttribute('aria-invalid')).toBeNull();
    });

    it('saves only what changed and reports a locked rule in words', async () => {
        const onSaved = vi.fn();
        vi.mocked(api.updateEdition).mockRejectedValueOnce(new AxiosError('409', 'ERR_BAD_REQUEST', undefined, undefined, {
            status: 409,
            data: { success: false, code: 'RULES_LOCKED', message: 'Ces règles sont verrouillées pour cette édition.', details: { fields: ['settings.votePrice'] } },
        } as AxiosResponse));
        render(<SettingsTab edition={edition('QUALIFICATION')} canWrite onSaved={onSaved} />);
        fireEvent.change(screen.getByLabelText(/^Nom de l’édition/), { target: { value: 'Édition 1 bis' } });
        fireEvent.change(screen.getByLabelText(/^Prix d’un vote/), { target: { value: '300' } });
        fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

        await waitFor(() => expect(api.updateEdition).toHaveBeenCalledWith('e1', { name: 'Édition 1 bis', settings: { votePrice: 300 } }));
        expect((await screen.findAllByText(/Champs refusés : prix d’un vote/)).length).toBeGreaterThan(0);
        expect(onSaved).not.toHaveBeenCalled();
    });
});
