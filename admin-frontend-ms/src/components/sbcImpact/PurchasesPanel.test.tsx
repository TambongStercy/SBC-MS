import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PurchasesPanel from './PurchasesPanel';
import { TooltipProvider } from '../ui';
import * as api from '../../services/impactV2Api';
import type { PurchaseList, PurchaseRow } from '../../services/impactV2Api';

vi.mock('../../services/impactV2Api', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../services/impactV2Api')>()),
    listPurchases: vi.fn(),
    refundPurchase: vi.fn(),
}));

const row = (patch: Partial<PurchaseRow>): PurchaseRow => ({
    _id: 't1', candidateId: 'c1', votes: 5, amount: 1000, method: 'MOBILE_MONEY', status: 'SUCCESS', counted: true, lateSettlement: false,
    paymentSessionId: 'ps1', refund: null, createdAt: '2026-12-15T10:00:00.000Z', settledAt: '2026-12-15T10:01:00.000Z',
    userId: 'u1', buyerName: 'Jean Acheteur', candidateName: 'Awa Candidate', flags: [], refundUncertain: false, providerStatus: 'SUCCEEDED', ...patch,
});

const answer = (items: PurchaseRow[]): PurchaseList => ({
    items, total: items.length, page: 1, limit: 25,
    totals: { byStatus: { SUCCESS: { count: 1, amount: 1000, votes: 5, countedVotes: 5 } }, revenue: 1000, countedVotes: 5, uncertainRefunds: 1 },
});

function renderPanel(items: PurchaseRow[], canRefund = true, initialSignal: '' | 'uncertain' = '') {
    vi.mocked(api.listPurchases).mockResolvedValue(answer(items));
    const onChanged = vi.fn();
    render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <TooltipProvider><PurchasesPanel editionId="e1" canRefund={canRefund} onChanged={onChanged} initialSignal={initialSignal} /></TooltipProvider>
        </QueryClientProvider>,
    );
    return onChanged;
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('PurchasesPanel · refund', () => {
    it('refunds a paid purchase with a reason of 10 characters, after confirmation', async () => {
        vi.mocked(api.refundPurchase).mockResolvedValueOnce({ ...row({ status: 'REFUNDED' }), refundCompleted: true });
        const onChanged = renderPanel([row({})]);

        fireEvent.click((await screen.findAllByRole('button', { name: 'Rembourser' }))[0]);
        const d = await screen.findByRole('dialog', { name: /Rembourser/ });
        expect(within(d).getByText(/pour Awa Candidate sont retirés et l’argent revient sur le solde SBC/)).toBeTruthy();
        const confirm = within(d).getByRole('button', { name: 'Rembourser' }) as HTMLButtonElement;
        expect(confirm.disabled).toBe(true);
        fireEvent.change(within(d).getByLabelText(/Raison/), { target: { value: 'Erreur' } });
        expect(confirm.disabled).toBe(true);
        fireEvent.change(within(d).getByLabelText(/Raison/), { target: { value: 'Votes achetés par erreur, à la demande du membre.' } });
        fireEvent.click(confirm);

        await waitFor(() => expect(api.refundPurchase).toHaveBeenCalledWith('t1', 'Votes achetés par erreur, à la demande du membre.'));
        await waitFor(() => expect(onChanged).toHaveBeenCalled());
        expect(api.listPurchases).toHaveBeenCalledTimes(2);
    });

    it('offers no refund for a purchase not paid, already refunding, or once the TOP 3 is set', async () => {
        renderPanel([
            row({ _id: 'a', status: 'PENDING' }),
            row({ _id: 'b', refund: { reason: 'Déjà en cours de remboursement', at: null } }),
            row({ _id: 'c', status: 'REFUNDED', refund: { reason: 'Remboursé hier par l’équipe', at: '2026-12-15T11:00:00.000Z' } }),
        ]);
        await screen.findAllByText('Jean Acheteur');
        expect(screen.queryByRole('button', { name: 'Rembourser' })).toBeNull();
        cleanup();
        renderPanel([row({})], false);
        await screen.findAllByText('Jean Acheteur');
        expect(screen.queryByRole('button', { name: 'Rembourser' })).toBeNull();
    });

    it('marks an uncertain refund, and the to-do link asks the server for those only', async () => {
        renderPanel([row({ refund: { reason: 'Remboursement demandé par le support', at: null }, refundUncertain: true })], true, 'uncertain');
        expect((await screen.findAllByText('Remboursement incertain')).length).toBeGreaterThan(0);
        expect(api.listPurchases).toHaveBeenCalledWith('e1', expect.objectContaining({ refundUncertain: true, flagged: false }));
        expect(screen.getAllByText('Awa Candidate').length).toBeGreaterThan(0);
    });
});
