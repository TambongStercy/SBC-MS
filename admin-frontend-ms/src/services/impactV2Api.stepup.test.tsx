import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import apiClient from '../api/apiClient';
import AdminCodePrompt from '../components/common/AdminCodePrompt';
import { decideTop3, impactErrorMessage, refundPurchase } from './impactV2Api';

/**
 * The two SBC Impact actions guarded by the admin's own code (event-service
 * requireAdminStepUp) go through the same apiClient interceptor as the
 * withdrawal approvals: 403 ADMIN_CODE_REQUIRED → the prompt → the same body
 * again with the code.
 */
describe('SBC Impact actions that need the admin code', () => {
    const sent: { method?: string; url?: string; data: Record<string, unknown> }[] = [];
    let answers: Array<{ status: number; data: Record<string, unknown> }> = [];
    const realAdapter = apiClient.defaults.adapter;

    beforeEach(() => {
        sent.length = 0;
        apiClient.defaults.adapter = (async (config: InternalAxiosRequestConfig) => {
            sent.push({ method: config.method, url: config.url, data: typeof config.data === 'string' ? JSON.parse(config.data) : config.data });
            const a = answers.shift() ?? { status: 200, data: { success: true, data: {} } };
            const response = { data: a.data, status: a.status, statusText: '', headers: {}, config };
            if (a.status >= 400) throw Object.assign(new Error(`status ${a.status}`), { response, config, isAxiosError: true });
            return response;
        }) as AxiosAdapter;
        render(<AdminCodePrompt />);
    });
    afterEach(() => { cleanup(); apiClient.defaults.adapter = realAdapter; answers = []; });

    const giveCode = async (code: string) => {
        fireEvent.change(await screen.findByLabelText('Code à 6 chiffres'), { target: { value: code } });
        fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
    };

    it('refund: asks for the code and resends the reason with it', async () => {
        answers = [
            { status: 403, data: { success: false, code: 'ADMIN_CODE_REQUIRED', message: 'Confirmez avec votre code.' } },
            { status: 200, data: { success: true, data: { _id: 't1', status: 'REFUNDED', refundCompleted: true } } },
        ];
        const call = refundPurchase('t1', 'Achat en double, rendu au membre.');
        await giveCode('654321');
        let result: unknown;
        await act(async () => { result = await call; });
        expect(sent.map(s => s.url)).toEqual(['/tickets/impact/admin/purchases/t1/refund', '/tickets/impact/admin/purchases/t1/refund']);
        expect(sent[1].data).toEqual({ reason: 'Achat en double, rendu au membre.', adminCode: '654321' });
        expect(result).toEqual({ _id: 't1', status: 'REFUNDED', refundCompleted: true });
    });

    it('TOP 3: resends the order seen with the code', async () => {
        answers = [
            { status: 403, data: { success: false, code: 'ADMIN_CODE_REQUIRED' } },
            { status: 200, data: { success: true, data: { edition: { _id: 'e1' }, ranking: [] } } },
        ];
        const call = decideTop3('e1', ['c3', 'c1', 'c2']);
        await giveCode('111222');
        await act(async () => { await call; });
        expect(sent[1].data).toEqual({ expectedOrder: ['c3', 'c1', 'c2'], adminCode: '111222' });
    });

    it('a cancelled prompt leaves the server’s message to the page', async () => {
        answers = [{ status: 403, data: { success: false, code: 'ADMIN_CODE_REQUIRED', message: 'Confirmez avec votre code.' } }];
        const call = refundPurchase('t1', 'Achat en double, rendu au membre.').catch(e => e);
        await screen.findByLabelText('Code à 6 chiffres');
        fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
        const err = await call;
        expect(impactErrorMessage(err)).toBe('Confirmez avec votre code.');
        expect(sent).toHaveLength(1);
    });
});
