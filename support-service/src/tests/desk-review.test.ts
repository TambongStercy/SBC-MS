import { upsertCase } from '../services/case.service';
import { presentProof } from '../api/presenters';
import { desk, login, makeAgent, mockFetch, reauthToken, setupDb, teardown } from './helpers';

beforeEach(setupDb);
afterAll(teardown);

describe('desk fixes from the front/back review', () => {
    it('a support agent works activation cases, not finance ones', async () => {
        const users = mockFetch({ '127.0.0.1:9/api/users': () => ({ json: { success: true, data: [] } }) });
        try {
            const act = await upsertCase({ type: 'activation', dedupKey: 'activation:u1:S1', summary: 'Activation', subject: { userId: '64b000000000000000000a01', sessionId: 'S1' } } as any, 'test');
            const fin = await upsertCase({ type: 'withdrawal_divergence', dedupKey: 'withdrawal:t1:divergence', summary: 'Divergence', subject: { transactionId: 't1' } } as any, 'test');
            const jar = await login(await makeAgent(['support_agent']));
            expect((await desk('get', '/cases?type=activation', jar)).status).toBe(200);
            expect((await desk('get', '/cases?type=finance', jar)).status).toBe(403);
            expect((await desk('post', `/cases/${act.caseId}/comments`, jar).send({ body: 'Vu avec le membre' })).status).toBe(200);
            expect((await desk('post', `/cases/${fin.caseId}/comments`, jar).send({ body: 'Vu' })).status).toBe(403);
        } finally {
            users.restore();
        }
    });

    it('refuses at request time a manual activation payment-service could not apply', async () => {
        const agent = await makeAgent(['finance_agent']);
        const jar = await login(agent);
        const r = await desk('post', '/activation/manual-requests', jar, { 'x-reauth-token': await reauthToken(agent, jar) })
            .send({ userId: '64b000000000000000000a01', gateway: 'CinetPay', externalRef: 'CP-1', plan: 'WINNER', reason: 'Paiement vu chez CinetPay' });
        expect(r.status).toBe(400);
        expect(r.body.code).toBe('BAD_PLAN');
    });

    it('turns the proof history into dated plain-French lines and never sends a null name', () => {
        const p = presentProof({
            campaign: { id: 'c1', name: null }, diffuseur: { id: 'u1', name: null },
            history: {
                events: [{ at: '2026-11-10T10:00:00Z', action: 'submitted' }, { at: '2026-11-10T12:00:00Z', action: 'rejected', reason: 'Vues illisibles', by: { name: 'Awa' } }],
                previousAttempts: [{ dayIndex: 1, status: 'rejected', submittedAt: '2026-11-09T09:00:00Z', rejectionReason: 'Lien absent' }],
            },
        });
        expect(p.campaign.name).toBe('Campagne sans titre');
        expect(p.diffuseur.name).toBe('Nom indisponible');
        expect(p.history.map((h: any) => h.label)).toEqual([
            expect.stringMatching(/^Tentative précédente \(jour 1/),
            'Preuve envoyée',
            'Rejetée par Awa : Vues illisibles',
        ]);
    });

    it('a one-day period means that whole day (reports)', async () => {
        const jar = await login(await makeAgent(['support_admin']));
        const r = await desk('get', '/reports/agents?from=2026-11-18&to=2026-11-18', jar);
        expect(r.status).toBe(200);
        expect(r.body.data.to).toBe('2026-11-18T23:59:59.999Z');
    });
});
