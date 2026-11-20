import request from 'supertest';
import { Case } from '../database/models/case.model';
import { Ticket } from '../database/models/ticket.model';
import { getApp, memberToken, mockFetch, setupDb, teardown } from './helpers';

beforeEach(setupDb);
afterAll(teardown);

const USER = '64b000000000000000000a01';
const check = (body: object) =>
    request(getApp()).post('/api/support/me/activation/check').set('Authorization', `Bearer ${memberToken(USER)}`).send(body);

/** payment-service mocked: one payin, and a recheck that answers `recheck`. */
function payment(payin: object, recheck = { result: 'not_found', provider: 'MoneyFusion', checkedAt: new Date().toISOString() }) {
    return mockFetch({
        '/payins/lookup': () => ({ json: { success: true, data: { sessionId: 'S1', amount: 2150, currency: 'XAF', createdAt: new Date().toISOString(), ...payin } } }),
        '/payins/S1/recheck': () => ({ json: { success: true, data: recheck } }),
        '127.0.0.1:9/api/notifications': () => ({ json: { success: true } }),
        '127.0.0.1:9/api/users': () => ({ json: { success: true, data: [] } }),
    });
}

describe('member activation check', () => {
    it('a payment never sent to an operator: plain answer, no operator call, no case', async () => {
        const f = payment({ gateway: 'none', status: 'PENDING_USER_INPUT', gatewayRef: null });
        try {
            const r = await check({ sessionId: 'S1' });
            expect(r.status).toBe(200);
            expect(r.body.data).toMatchObject({ result: 'not_finished', ticketId: null, canReportDebit: true });
            expect(r.body.data.message).toMatch(/aucun argent n’a pu être prélevé/);
            expect(r.body.data.message).not.toMatch(/introuvable chez l’opérateur/);
            expect(f.calls.some((c) => c.url.includes('/recheck'))).toBe(false);
            expect(await Case.countDocuments()).toBe(0);
            expect(await Ticket.countDocuments()).toBe(0);
        } finally {
            f.restore();
        }
    });

    it('…but when the member says money was debited, an agent gets one case and one ticket', async () => {
        const f = payment({ gateway: 'none', status: 'PENDING_USER_INPUT', gatewayRef: null });
        try {
            const r = await check({ sessionId: 'S1', moneyDebited: true });
            expect(r.body.data.result).toBe('not_finished');
            expect(r.body.data.ticketId).toBeTruthy();
            const again = await check({ sessionId: 'S1', moneyDebited: true });
            expect(again.body.data.ticketId).toBe(r.body.data.ticketId);
            expect(await Case.countDocuments({ type: 'activation' })).toBe(1);
            expect((await Case.findOne().lean())!.summary).toMatch(/débité/);
            expect(await Ticket.countDocuments()).toBe(1);
        } finally {
            f.restore();
        }
    });

    it('a payment the operator received but cannot find still opens a case at once', async () => {
        const f = payment({ gateway: 'MoneyFusion', status: 'PENDING_PROVIDER', gatewayRef: 'MF-123' });
        try {
            const r = await check({ sessionId: 'S1' });
            expect(r.body.data.result).toBe('not_found');
            expect(r.body.data.ticketId).toBeTruthy();
            expect(f.calls.some((c) => c.url.includes('/recheck'))).toBe(true);
            expect(await Case.countDocuments({ type: 'activation' })).toBe(1);
        } finally {
            f.restore();
        }
    });
});
