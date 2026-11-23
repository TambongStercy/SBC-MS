import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AxiosError, type AxiosResponse } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CompetitionPanel from './CompetitionPanel';
import * as api from '../../services/impactV2Api';
import type { Edition } from '../../services/impactV2Api';

vi.mock('../../services/impactV2Api', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../services/impactV2Api')>()),
    launchCompetition: vi.fn(),
    advanceStage: vi.fn(),
    scheduleRound: vi.fn(),
    openRoundNow: vi.fn(),
    closeRoundNow: vi.fn(),
}));

const base = {
    _id: 'e1', name: 'Édition 1', slug: 'e1', description: '', rulesText: '', statusHistory: [],
    schedule: { qualificationOpensAt: '2026-12-01T08:00:00.000Z', qualificationClosesAt: '2026-12-20T18:00:00.000Z' },
    settings: { finalistsCount: 3 }, seatSeq: 20, waitlistSeq: 0, createdAt: '', updatedAt: '',
} as unknown as Edition;

const edition = (patch: Partial<Edition>): Edition => ({ ...base, ...patch });
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

const conflict = (code: string, message: string, details?: unknown) => new AxiosError('409', 'ERR_BAD_REQUEST', undefined, undefined, {
    status: 409, data: { success: false, code, message, details },
} as AxiosResponse);

function renderPanel(e: Edition, extra: Partial<Parameters<typeof CompetitionPanel>[0]> = {}) {
    const props = {
        edition: e, canWrite: true, onChanged: vi.fn(), onOpenCandidate: vi.fn(), onShowCandidates: vi.fn(), onShowTop3: vi.fn(), onShowFinal: vi.fn(), ...extra,
    };
    render(<CompetitionPanel {...props} />);
    return props;
}

const dialog = (name: RegExp) => screen.findByRole('dialog', { name });

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('CompetitionPanel · launch', () => {
    it('lists the profiles to review, each opening its sheet', async () => {
        vi.mocked(api.launchCompetition).mockRejectedValueOnce(conflict('PROFILES_TO_REVIEW', '2 profil(s) officiel(s) à valider avant la publication.', {
            candidates: [{ _id: 'c1', name: 'Awa' }, { _id: 'c2', name: 'Moussa' }],
        }));
        const props = renderPanel(edition({ status: 'QUALIFICATION_CLOSED' }));

        fireEvent.click(screen.getAllByRole('button', { name: 'Lancer la compétition' })[0]);
        const d = await dialog(/Lancer la compétition/);
        fireEvent.click(within(d).getByRole('button', { name: 'Lancer la compétition' }));

        await waitFor(() => expect(api.launchCompetition).toHaveBeenCalledWith('e1'));
        expect(await screen.findByText('2 profil(s) officiel(s) à valider avant la publication.')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Moussa' }));
        expect(props.onOpenCandidate).toHaveBeenCalledWith('c2');
        expect(props.onChanged).not.toHaveBeenCalled();
    });

    it('offers the suspended candidates on SUSPENDED_CANDIDATES', async () => {
        vi.mocked(api.launchCompetition).mockRejectedValueOnce(conflict('SUSPENDED_CANDIDATES', 'Un candidat est suspendu.'));
        const props = renderPanel(edition({ status: 'QUALIFICATION_CLOSED' }));
        fireEvent.click(screen.getAllByRole('button', { name: 'Lancer la compétition' })[0]);
        fireEvent.click(within(await dialog(/Lancer la compétition/)).getByRole('button', { name: 'Lancer la compétition' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Voir les candidats suspendus' }));
        expect(props.onShowCandidates).toHaveBeenCalledWith({ statut: 'SUSPENDED' });
    });
});

describe('CompetitionPanel · rounds', () => {
    it('schedules the dates in local time, and opening waits for them to be saved', async () => {
        const saved = edition({ status: 'COMPETITION', stage: 'WEEK2', rounds: { FREE: { status: 'SCHEDULED' }, PAID: { status: 'SCHEDULED' } } });
        vi.mocked(api.scheduleRound).mockResolvedValueOnce(saved);
        const props = renderPanel(saved);
        const free = screen.getByTestId('round-FREE');

        // No end date yet: « Ouvrir maintenant » is off.
        expect((within(free).getByRole('button', { name: 'Ouvrir maintenant' }) as HTMLButtonElement).disabled).toBe(true);

        fireEvent.change(within(free).getByLabelText('Ouverture'), { target: { value: '2027-01-05T09:00' } });
        fireEvent.change(within(free).getByLabelText('Fin'), { target: { value: '2027-01-08T21:30' } });
        fireEvent.click(within(free).getByRole('button', { name: 'Enregistrer les dates' }));

        await waitFor(() => expect(api.scheduleRound).toHaveBeenCalledWith('e1', 'FREE', {
            opensAt: new Date('2027-01-05T09:00').toISOString(),
            closesAt: new Date('2027-01-08T21:30').toISOString(),
        }));
        expect(props.onChanged).toHaveBeenCalledWith(saved);
    });

    it('refuses an end before the opening without calling the server', () => {
        renderPanel(edition({ status: 'COMPETITION', stage: 'WEEK2', rounds: { FREE: { status: 'SCHEDULED' } } }));
        const free = screen.getByTestId('round-FREE');
        fireEvent.change(within(free).getByLabelText('Ouverture'), { target: { value: '2027-01-08T09:00' } });
        fireEvent.change(within(free).getByLabelText('Fin'), { target: { value: '2027-01-05T09:00' } });
        fireEvent.click(within(free).getByRole('button', { name: 'Enregistrer les dates' }));
        expect(screen.getByText('Le vote doit se terminer après son ouverture.')).toBeTruthy();
        expect(api.scheduleRound).not.toHaveBeenCalled();
    });

    it('opens a scheduled round of its own week after confirmation', async () => {
        const e = edition({ status: 'COMPETITION', stage: 'WEEK2', rounds: { FREE: { status: 'SCHEDULED', opensAt: future(1), closesAt: future(3) } } });
        vi.mocked(api.openRoundNow).mockResolvedValueOnce(e);
        renderPanel(e);
        fireEvent.click(within(screen.getByTestId('round-FREE')).getByRole('button', { name: 'Ouvrir maintenant' }));
        fireEvent.click(within(await dialog(/Ouvrir le vote gratuit/)).getByRole('button', { name: 'Ouvrir maintenant' }));
        await waitFor(() => expect(api.openRoundNow).toHaveBeenCalledWith('e1', 'FREE'));
    });

    it('open now: an end date already passed is pointed at in the form', async () => {
        const e = edition({ status: 'COMPETITION', stage: 'WEEK2', rounds: { FREE: { status: 'SCHEDULED', opensAt: future(1), closesAt: future(3) } } });
        vi.mocked(api.openRoundNow).mockRejectedValueOnce(new AxiosError('400', 'ERR_BAD_REQUEST', undefined, undefined, {
            status: 400, data: { success: false, code: 'INVALID_SCHEDULE', message: 'La fin du vote est déjà passée.', details: { field: 'rounds.FREE.closesAt' } },
        } as AxiosResponse));
        const props = renderPanel(e);
        const free = screen.getByTestId('round-FREE');
        fireEvent.click(within(free).getByRole('button', { name: 'Ouvrir maintenant' }));
        fireEvent.click(within(await dialog(/Ouvrir le vote gratuit/)).getByRole('button', { name: 'Ouvrir maintenant' }));
        await waitFor(() => expect(within(free).getByLabelText('Fin').getAttribute('aria-invalid')).toBe('true'));
        expect(within(free).getByLabelText('Ouverture').getAttribute('aria-invalid')).toBeNull();
        expect(props.onChanged).not.toHaveBeenCalled();
    });

    it('open now: a round opened meanwhile (ROUND_STARTED) reloads the edition', async () => {
        const e = edition({ status: 'COMPETITION', stage: 'WEEK2', rounds: { FREE: { status: 'SCHEDULED', opensAt: future(1), closesAt: future(3) } } });
        vi.mocked(api.openRoundNow).mockRejectedValueOnce(conflict('ROUND_STARTED', 'Ce vote est déjà ouvert ou clos.'));
        const props = renderPanel(e);
        fireEvent.click(within(screen.getByTestId('round-FREE')).getByRole('button', { name: 'Ouvrir maintenant' }));
        fireEvent.click(within(await dialog(/Ouvrir le vote gratuit/)).getByRole('button', { name: 'Ouvrir maintenant' }));
        await waitFor(() => expect(props.onChanged).toHaveBeenCalledWith());
    });

    it('offers no « Ouvrir maintenant » outside the round’s week', () => {
        renderPanel(edition({ status: 'COMPETITION', stage: 'WEEK2', rounds: { PAID: { status: 'SCHEDULED', closesAt: future(9) } } }));
        expect(within(screen.getByTestId('round-PAID')).queryByRole('button', { name: 'Ouvrir maintenant' })).toBeNull();
    });

    it('closes an open round with a reason of 5 characters at least, in a danger dialog', async () => {
        const e = edition({ status: 'COMPETITION', stage: 'WEEK2', rounds: { FREE: { status: 'OPEN', openedAt: future(-1), closesAt: future(2) } } });
        vi.mocked(api.closeRoundNow).mockResolvedValueOnce(e);
        renderPanel(e);
        fireEvent.click(within(screen.getByTestId('round-FREE')).getByRole('button', { name: 'Clore maintenant' }));
        const d = await dialog(/Clore le vote gratuit/);
        expect(within(d).getByText(/Un vote clos ne se rouvre jamais/)).toBeTruthy();
        const confirm = within(d).getByRole('button', { name: 'Clore le vote' }) as HTMLButtonElement;
        expect(confirm.className).toMatch(/bg-danger/);

        fireEvent.change(within(d).getByLabelText(/Raison/), { target: { value: 'abc' } });
        expect(confirm.disabled).toBe(true);
        fireEvent.change(within(d).getByLabelText(/Raison/), { target: { value: 'Fraude détectée' } });
        expect(confirm.disabled).toBe(false);
        fireEvent.click(confirm);
        await waitFor(() => expect(api.closeRoundNow).toHaveBeenCalledWith('e1', 'FREE', 'Fraude détectée'));
    });

    it('blocks the move to week 3 while the free vote is open', () => {
        renderPanel(edition({ status: 'COMPETITION', stage: 'WEEK2', rounds: { FREE: { status: 'OPEN', closesAt: future(2) } } }));
        const buttons = screen.getAllByRole('button', { name: 'Passer à la semaine 3' }) as HTMLButtonElement[];
        expect(buttons.every(b => b.disabled)).toBe(true);
        expect(screen.getByText('Clôturez d’abord le vote gratuit pour passer à la semaine 3.')).toBeTruthy();
    });
});
