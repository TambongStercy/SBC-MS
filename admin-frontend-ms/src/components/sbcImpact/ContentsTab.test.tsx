import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, type AxiosResponse } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ContentsTab from './ContentsTab';
import { TooltipProvider } from '../ui';
import * as api from '../../services/impactV2Api';
import type { SubmissionRow } from '../../services/impactV2Api';

vi.mock('../../services/impactV2Api', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../services/impactV2Api')>()),
    listSubmissions: vi.fn(),
    reviewSubmission: vi.fn(),
    setSubmissionExternalUrl: vi.fn(),
}));

const text = (s: string) => `${s} — un texte assez long pour la rubrique.`;
const project: SubmissionRow = {
    _id: 's1', candidateId: 'c1', kind: 'PROJECT', version: 1, status: 'PENDING',
    project: {
        problem: text('Problème'), solution: text('Solution'), howItWorks: text('Fonctionnement'), targetCustomers: text('Clients'),
        businessModel: text('Modèle'), expectedImpact: text('Impact'), fundingUse: text('Financement'), outlook: text('Perspectives'),
    },
    review: null, publishedAt: null, externalUrl: null,
    createdAt: '2026-12-10T08:00:00.000Z', updatedAt: '2026-12-10T08:05:00.123Z',
    candidate: { name: 'Awa Candidate', projectName: 'Atelier Awa', photoFileId: 'impact/awa.jpg', seatNumber: 3, status: 'STAGE_3' },
};
const accepted: SubmissionRow = { ...project, _id: 's2', status: 'ACCEPTED', publishedAt: '2026-12-11T08:00:00.000Z', candidate: { ...project.candidate!, name: 'Moussa' } };

function renderTab(onChanged = vi.fn()) {
    render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <TooltipProvider><ContentsTab editionId="e1" canWrite onChanged={onChanged} /></TooltipProvider>
        </QueryClientProvider>,
    );
    return onChanged;
}

const card = async (id: string) => screen.findByTestId(`submission-${id}`);

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('ContentsTab', () => {
    it('keeps the server’s order (pending first), with the 8 project headings', async () => {
        vi.mocked(api.listSubmissions).mockResolvedValue([project, accepted]);
        renderTab();
        const cards = await screen.findAllByTestId(/^submission-/);
        expect(cards.map(c => c.getAttribute('data-testid'))).toEqual(['submission-s1', 'submission-s2']);
        const c = within(cards[0]);
        for (const h of ['Le problème', 'La solution', 'Le fonctionnement', 'La clientèle cible', 'Le modèle économique', 'L’impact attendu', 'L’utilisation d’un éventuel financement', 'Les perspectives de développement']) {
            expect(c.getByText(h)).toBeTruthy();
        }
    });

    it('accepts with the updatedAt it displayed, and no reason', async () => {
        vi.mocked(api.listSubmissions).mockResolvedValue([project]);
        vi.mocked(api.reviewSubmission).mockResolvedValueOnce({ ...project, status: 'ACCEPTED' });
        const onChanged = renderTab();
        fireEvent.click(within(await card('s1')).getByRole('button', { name: 'Valider et publier' }));
        fireEvent.click(within(await screen.findByRole('dialog', { name: /Valider la présentation du projet/ })).getByRole('button', { name: 'Valider et publier' }));
        await waitFor(() => expect(api.reviewSubmission).toHaveBeenCalledWith('s1', { decision: 'accept', updatedAt: '2026-12-10T08:05:00.123Z' }));
        expect(onChanged).toHaveBeenCalled();
    });

    it('refuses only with a reason of 10 characters, which it sends', async () => {
        vi.mocked(api.listSubmissions).mockResolvedValue([project]);
        vi.mocked(api.reviewSubmission).mockResolvedValueOnce({ ...project, status: 'REJECTED' });
        renderTab();
        fireEvent.click(within(await card('s1')).getByRole('button', { name: 'Refuser' }));
        const d = await screen.findByRole('dialog', { name: /Refuser la présentation du projet/ });
        const confirm = within(d).getByRole('button', { name: 'Refuser' }) as HTMLButtonElement;
        expect(confirm.disabled).toBe(true);
        fireEvent.change(within(d).getByLabelText(/Raison/), { target: { value: 'Trop court' } });
        expect(confirm.disabled).toBe(false);
        fireEvent.change(within(d).getByLabelText(/Raison/), { target: { value: 'court' } });
        expect(confirm.disabled).toBe(true);
        fireEvent.change(within(d).getByLabelText(/Raison/), { target: { value: 'Ce projet copie celui d’un autre candidat.' } });
        fireEvent.click(confirm);
        await waitFor(() => expect(api.reviewSubmission).toHaveBeenCalledWith('s1', {
            decision: 'reject', reason: 'Ce projet copie celui d’un autre candidat.', updatedAt: '2026-12-10T08:05:00.123Z',
        }));
    });

    it('asks for a new version with a reason', async () => {
        vi.mocked(api.listSubmissions).mockResolvedValue([project]);
        vi.mocked(api.reviewSubmission).mockResolvedValueOnce({ ...project, status: 'RESUBMIT_REQUESTED' });
        renderTab();
        fireEvent.click(within(await card('s1')).getByRole('button', { name: 'Demander une nouvelle version' }));
        const d = await screen.findByRole('dialog', { name: /nouvelle version/ });
        fireEvent.change(within(d).getByLabelText(/Ce qu’il faut changer/), { target: { value: 'Précisez la clientèle visée.' } });
        fireEvent.click(within(d).getByRole('button', { name: 'Envoyer la demande' }));
        await waitFor(() => expect(api.reviewSubmission).toHaveBeenCalledWith('s1', expect.objectContaining({ decision: 'resubmit', reason: 'Précisez la clientèle visée.' })));
    });

    it('reloads the queue when the content changed meanwhile (STALE)', async () => {
        vi.mocked(api.listSubmissions).mockResolvedValue([project]);
        vi.mocked(api.reviewSubmission).mockRejectedValueOnce(new AxiosError('409', 'ERR_BAD_REQUEST', undefined, undefined, {
            status: 409, data: { success: false, code: 'STALE', message: 'Le candidat a remplacé ce contenu depuis votre lecture. Rechargez-le.' },
        } as AxiosResponse));
        const onChanged = renderTab();
        fireEvent.click(within(await card('s1')).getByRole('button', { name: 'Valider et publier' }));
        fireEvent.click(within(await screen.findByRole('dialog', { name: /Valider/ })).getByRole('button', { name: 'Valider et publier' }));
        await waitFor(() => expect(api.listSubmissions).toHaveBeenCalledTimes(2));
        expect(onChanged).toHaveBeenCalled();
        // the dialog closed: the admin decides again on the reloaded content
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('saves the publication link of an accepted content', async () => {
        vi.mocked(api.listSubmissions).mockResolvedValue([accepted]);
        vi.mocked(api.setSubmissionExternalUrl).mockResolvedValueOnce({ ...accepted, externalUrl: 'https://facebook.com/sbc/posts/1' });
        renderTab();
        const c = within(await card('s2'));
        fireEvent.change(c.getByLabelText(/Lien de la publication/), { target: { value: 'http://facebook.com/x' } });
        fireEvent.click(c.getByRole('button', { name: 'Enregistrer le lien' }));
        expect(c.getByText('Le lien doit être une adresse https complète.')).toBeTruthy();
        expect(api.setSubmissionExternalUrl).not.toHaveBeenCalled();
        fireEvent.change(c.getByLabelText(/Lien de la publication/), { target: { value: 'https://facebook.com/sbc/posts/1' } });
        fireEvent.click(c.getByRole('button', { name: 'Enregistrer le lien' }));
        await waitFor(() => expect(api.setSubmissionExternalUrl).toHaveBeenCalledWith('s2', 'https://facebook.com/sbc/posts/1'));
    });
});
