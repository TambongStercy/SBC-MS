import request from 'supertest';
import { desk, getApp, login, makeAgent, memberToken, mockFetch, setupDb, teardown } from './helpers';

beforeEach(setupDb);
afterAll(teardown);

const member = (method: 'get' | 'post', path: string, userId?: string) =>
    (request(getApp()) as any)[method](`/api/support/me${path}`).set('Authorization', `Bearer ${memberToken(userId)}`) as request.Test;

describe('tickets', () => {
    it('member ticket → agent queue → internal note hidden from the member → public reply notifies', async () => {
        const fetchMock = mockFetch({ '127.0.0.1:9/api/notifications': () => ({ json: { success: true } }), '127.0.0.1:9/api/users': () => ({ json: { success: true, data: [] } }) });
        try {
            const pdf = Buffer.from('%PDF-1.4\n%test\n');
            const up = await member('post', '/attachments').attach('file', pdf, 'recu.pdf');
            expect(up.status).toBe(201);
            const exe = await member('post', '/attachments').attach('file', Buffer.from('MZ\x90\x00binary'), 'virus.pdf');
            expect(exe.status).toBe(400);

            const created = await member('post', '/tickets').send({ category: 'retrait', subject: 'Retrait non reçu', message: 'Je n’ai pas reçu mon retrait.', attachmentIds: [up.body.data.id] });
            expect(created.status).toBe(201);
            expect(created.body.data.number).toBe('SUP-000001');
            expect(created.body.data.status).toBe('nouveau');

            const agent = await makeAgent(['support_agent']);
            const jar = await login(agent);
            const list = await desk('get', '/tickets?status=new&queue=retrait', jar);
            expect(list.status).toBe(200);
            expect(list.body.data.total).toBe(1);
            expect(list.body.data.items[0].status).toBe('new');
            expect(list.body.data.items[0].priority).toBe('high');
            const id = list.body.data.items[0].id;

            const note = await desk('post', `/tickets/${id}/messages`, jar).send({ body: 'Vérifier chez MF', internal: true });
            expect(note.status).toBe(201);
            const reply = await desk('post', `/tickets/${id}/messages`, jar).send({ body: 'Nous vérifions auprès de l’opérateur.', internal: false });
            expect(reply.body.data.internal).toBe(false);

            const detail = await desk('get', `/tickets/${id}`, jar);
            expect(detail.body.data.messages).toHaveLength(3);
            expect(detail.body.data.messages[0].attachments[0].mimeType).toBe('application/pdf');
            expect(detail.body.data.ticket.status).toBe('waiting_member');
            expect(detail.body.data.ticket.assignee.id).toBe(agent.id);

            const mine = await member('get', `/tickets/${id}`);
            expect(mine.body.data.messages).toHaveLength(2);
            expect(JSON.stringify(mine.body.data)).not.toContain('Vérifier chez MF');
            expect(fetchMock.calls.some((c) => c.url.includes('/push/internal/send') && c.body.category === 'support')).toBe(true);

            // Another member sees nothing.
            expect((await member('get', `/tickets/${id}`, '6e2e00000000000000000b09')).status).toBe(404);
        } finally {
            fetchMock.restore();
        }
    });

    it('limits ticket creation to 5 per day per member with a 429 RATE_LIMITED', async () => {
        const fetchMock = mockFetch({ '127.0.0.1:9': () => ({ json: { success: true } }) });
        try {
            for (let i = 0; i < 5; i++) {
                expect((await member('post', '/tickets').send({ category: 'autre', subject: `Question ${i}`, message: 'Bonjour' })).status).toBe(201);
            }
            const r = await member('post', '/tickets').send({ category: 'autre', subject: 'Encore', message: 'Bonjour' });
            expect(r.status).toBe(429);
            expect(r.body.code).toBe('RATE_LIMITED');
        } finally {
            fetchMock.restore();
        }
    });

    it('never shows a refused, expired or unknown withdrawal as "in progress"', async () => {
        const w = (transactionId: string, businessStatus: string) => ({ transactionId, amount: 2500, currency: 'XAF', status: 'x', businessStatus, createdAt: new Date().toISOString() });
        const fetchMock = mockFetch({
            '127.0.0.1:9/api/internal/support': () => ({ json: { success: true, data: [w('t1', 'REJECTED'), w('t2', 'EXPIRED'), w('t3', 'SOMETHING_NEW')] } }),
        });
        try {
            const r = await member('get', '/withdrawals');
            expect(r.status).toBe(200);
            const byId = Object.fromEntries(r.body.data.map((x: any) => [x.id, x]));
            expect(byId.t1.statusLabel).toBe('Refusé');
            expect(byId.t2.statusLabel).toBe('Expiré');
            expect(byId.t3.statusLabel).toBe('Statut à vérifier');
            for (const x of r.body.data) expect(`${x.statusLabel} ${x.explanation}`).not.toMatch(/en cours/i);
        } finally {
            fetchMock.restore();
        }
    });

    it('says the payment service is unavailable instead of failing when it is not deployed', async () => {
        const fetchMock = mockFetch({ '127.0.0.1:9/api/internal/support': () => ({ status: 404, json: undefined }) });
        try {
            const r = await member('get', '/withdrawals');
            expect(r.status).toBe(503);
            expect(r.body.code).toBe('SERVICE_UNAVAILABLE');
            expect(r.body.message).toMatch(/Service paiement indisponible/);
        } finally {
            fetchMock.restore();
        }
    });
});
