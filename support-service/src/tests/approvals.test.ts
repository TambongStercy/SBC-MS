import { Approval } from '../database/models/approval.model';
import { AuditLog } from '../database/models/audit-log.model';
import { desk, login, makeAgent, mockFetch, reauthToken, setupDb, teardown } from './helpers';

beforeEach(setupDb);
afterAll(teardown);

const userId = '6e2e00000000000000000b01';

describe('approvals', () => {
    it('cannot be approved by its requester; a different manager approves and payment-service executes it', async () => {
        const fetchMock = mockFetch({
            '/api/internal/support/activation/manual': () => ({ json: { success: true, data: { activated: true } } }),
            '/api/notifications': () => ({ json: { success: true } }),
        });
        try {
            const requester = await makeAgent(['support_admin']); // holds both request and approve
            const manager = await makeAgent(['finance_manager']);
            const jarR = await login(requester);
            const jarM = await login(manager);

            const created = await desk('post', '/activation/manual', jarR).send({
                userId, gateway: 'cinetpay', externalRef: 'CP-REF-123', plan: 'CIBLE', reason: 'Paiement confirmé par SMS opérateur, webhook perdu',
            });
            expect(created.status).toBe(201);
            const id = created.body.data.approvalId;

            const self = await desk('post', `/approvals/${id}/approve`, jarR, { 'x-reauth-token': await reauthToken(requester, jarR) }).send({});
            expect(self.status).toBe(403);
            expect(self.body.code).toBe('SELF_APPROVAL');
            expect((await Approval.findById(id).lean())!.status).toBe('pending');
            expect(fetchMock.calls.filter((c) => c.url.includes('/activation/manual'))).toHaveLength(0);

            const noReauth = await desk('post', `/approvals/${id}/approve`, jarM).send({});
            expect(noReauth.status).toBe(401);

            const ok = await desk('post', `/approvals/${id}/approve`, jarM, { 'x-reauth-token': await reauthToken(manager, jarM) }).send({ note: 'Vérifié' });
            expect(ok.status).toBe(200);
            expect(ok.body.data.status).toBe('executed');
            const call = fetchMock.calls.find((c) => c.url.includes('/activation/manual'))!;
            expect(call.body).toEqual({ userId, gateway: 'cinetpay', externalRef: 'CP-REF-123', plan: 'CIBLE', approvalId: id });
            expect(call.headers.authorization).toBe(`Bearer ${process.env.SERVICE_SECRET}`);
            expect(call.headers['x-service-name']).toBe('support-service');
            expect(call.headers['x-request-id']).toBeTruthy();
            expect(call.headers['x-support-actor']).toBe(`${manager.id}|finance_manager`);
            expect(await AuditLog.countDocuments({ action: 'approval.self_approval_refused' })).toBe(1);
            expect(await AuditLog.countDocuments({ action: 'approval.executed' })).toBe(1);

            // Approving again does nothing.
            const again = await desk('post', `/approvals/${id}/approve`, jarM, { 'x-reauth-token': await reauthToken(manager, jarM) }).send({});
            expect(again.status).toBe(409);
        } finally {
            fetchMock.restore();
        }
    });

    it('keeps an approved request retryable when payment-service is down, and marks a provider refusal as failed', async () => {
        let mode: 'down' | 'refuse' = 'down';
        const fetchMock = mockFetch({
            '/api/internal/support/activation/manual': () => (mode === 'down'
                ? { status: 503, json: { success: false } }
                : { status: 422, json: { success: false, code: 'PROVIDER_NOT_CONFIRMED', message: 'not confirmed' } }),
            '/api/notifications': () => ({ json: { success: true } }),
        });
        try {
            const requester = await makeAgent(['support_agent']);
            const manager = await makeAgent(['finance_manager']);
            const other = await makeAgent(['support_admin']);
            const jarR = await login(requester);
            const jarM = await login(manager);
            const created = await desk('post', '/activation/manual', jarR).send({ userId, gateway: 'feexpay', externalRef: 'FX-1', plan: 'CLASSIQUE', reason: 'Le membre a fourni le reçu opérateur' });
            const id = created.body.data.approvalId;
            const r = await desk('post', `/approvals/${id}/approve`, jarM, { 'x-reauth-token': await reauthToken(manager, jarM) }).send({});
            expect(r.body.data.status).toBe('approved');
            expect(r.body.data.execution.code).toBe('SERVICE_UNAVAILABLE');

            mode = 'refuse';
            const jarO = await login(other);
            const retry = await desk('post', `/approvals/${id}/execute`, jarO, { 'x-reauth-token': await reauthToken(other, jarO) }).send({});
            expect(retry.status).toBe(200);
            expect(retry.body.data.status).toBe('failed');
            expect(retry.body.data.execution.code).toBe('PROVIDER_NOT_CONFIRMED');
        } finally {
            fetchMock.restore();
        }
    });
});
