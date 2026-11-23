import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LivePanel from './LivePanel';
import * as api from '../../services/impactV2Api';
import { conflict, finalEdition, juryOverview, renderWithClient } from './finaleTestUtils';

vi.mock('../../services/impactV2Api', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../services/impactV2Api')>()),
    getJury: vi.fn(),
    startFinal: vi.fn(),
    setOnStage: vi.fn(),
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function renderLive(edition = finalEdition(), onChanged = vi.fn(), onEdition = vi.fn()) {
    renderWithClient(<LivePanel edition={edition} canWrite onChanged={onChanged} onEdition={onEdition} />);
    return { onChanged, onEdition };
}

describe('LivePanel', () => {
    it('starts the final after confirmation', async () => {
        vi.mocked(api.getJury).mockResolvedValue(juryOverview());
        const started = finalEdition({ stage: 'LIVE' });
        vi.mocked(api.startFinal).mockResolvedValueOnce(started);
        const { onChanged } = renderLive(finalEdition({ stage: 'TOP3' }));
        const start = await screen.findByRole('button', { name: 'Démarrer la finale' }) as HTMLButtonElement;
        await waitFor(() => expect(start.disabled).toBe(false)); // once the jury is loaded
        fireEvent.click(start);
        const d = await screen.findByRole('dialog', { name: 'Démarrer la finale ?' });
        expect(within(d).getByText(/1 juré actif/)).toBeTruthy();
        fireEvent.click(within(d).getByRole('button', { name: 'Démarrer la finale' }));
        await waitFor(() => expect(api.startFinal).toHaveBeenCalledWith('e1'));
        expect(onChanged).toHaveBeenCalledWith(started);
    });

    it('keeps the dialog open on NO_JURY (the server says to add a juror)', async () => {
        vi.mocked(api.getJury).mockResolvedValue(juryOverview({ jurors: [] }));
        vi.mocked(api.startFinal).mockRejectedValueOnce(conflict('NO_JURY', 'Ajoutez au moins un juré avant de démarrer la finale.'));
        const { onChanged } = renderLive(finalEdition({ stage: 'TOP3' }));
        expect(await screen.findByText('Ajoutez d’abord au moins un juré.')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Démarrer la finale' }));
        const d = await screen.findByRole('dialog', { name: 'Démarrer la finale ?' });
        expect(within(d).getByText(/Aucun juré actif/)).toBeTruthy();
        fireEvent.click(within(d).getByRole('button', { name: 'Démarrer la finale' }));
        await waitFor(() => expect(api.startFinal).toHaveBeenCalled());
        expect(screen.getByRole('dialog', { name: 'Démarrer la finale ?' })).toBeTruthy();
        expect(onChanged).not.toHaveBeenCalled();
    });

    it('puts a finalist on stage, changes the phase, then clears the stage', async () => {
        vi.mocked(api.getJury).mockResolvedValue(juryOverview());
        const onStage = finalEdition({ live: { onStageCandidateId: 'fB', phase: 'PRESENTATION' } });
        vi.mocked(api.setOnStage).mockResolvedValue(onStage);
        const { onEdition } = renderLive(finalEdition());

        fireEvent.click(await screen.findByRole('button', { name: /Bako/ }));
        await waitFor(() => expect(api.setOnStage).toHaveBeenCalledWith('e1', 'fB', 'PRESENTATION'));
        expect(onEdition).toHaveBeenCalledWith(onStage);

        cleanup();
        vi.mocked(api.setOnStage).mockClear();
        renderLive(onStage);
        expect((await screen.findByRole('button', { name: /Bako/ })).getAttribute('aria-pressed')).toBe('true');
        fireEvent.click(screen.getByRole('radio', { name: 'Questions' }));
        await waitFor(() => expect(api.setOnStage).toHaveBeenCalledWith('e1', 'fB', 'QUESTIONS'));
        fireEvent.click(screen.getByRole('button', { name: 'Personne en scène' }));
        await waitFor(() => expect(api.setOnStage).toHaveBeenLastCalledWith('e1', null, null));
    });

    it('links to the public live screen and shows the final vote round', async () => {
        vi.mocked(api.getJury).mockResolvedValue(juryOverview());
        renderLive();
        const link = await screen.findByRole('link', { name: /Écran public du direct/ });
        expect(link.getAttribute('href')).toMatch(/\/impact-challenge\/finale$/);
        expect(link.getAttribute('target')).toBe('_blank');
        expect(screen.getByTestId('round-FINAL')).toBeTruthy();
        expect(within(screen.getByTestId('round-FINAL')).getByText('Vote public de la finale')).toBeTruthy();
    });
});
