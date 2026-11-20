import request from 'supertest';
import { Case } from '../database/models/case.model';
import { ViewTask } from '../database/models/view-task.model';
import { getApp, mockFetch, setupDb, teardown } from './helpers';

beforeEach(setupDb);
afterAll(teardown);

const post = (path: string, body: unknown, secret = process.env.SERVICE_SECRET!) =>
    request(getApp()).post(`/api/support/internal${path}`).set('Authorization', `Bearer ${secret}`).set('x-service-name', 'payment-service').send(body as object);

describe('/internal/cases', () => {
    it('refuses a wrong service secret', async () => {
        const r = await post('/cases', {}, 'not-the-secret');
        expect(r.status).toBe(401);
    });

    it('is idempotent on dedupKey, even with concurrent reports, and only raises severity', async () => {
        const fetchMock = mockFetch({ '/api/notifications': () => ({ json: { success: true } }) });
        try {
            const body = {
                type: 'withdrawal_divergence', dedupKey: 'withdrawal:TX123:divergence', severity: 'warning',
                subject: { userId: '6e2e00000000000000000b01', transactionId: 'TX123', gateway: 'moneyfusion' }, summary: 'Provider says completed, we say processing',
            };
            const results = await Promise.all(Array.from({ length: 10 }, () => post('/cases', body)));
            expect(results.every((r) => r.status === 200 || r.status === 201)).toBe(true);
            const ids = new Set(results.map((r) => r.body.data.caseId));
            expect(ids.size).toBe(1);
            expect(results.filter((r) => r.body.data.created).length).toBe(1);
            expect(await Case.countDocuments({})).toBe(1);
            const c = await Case.findOne({}).lean();
            expect(c!.occurrences).toBe(10);

            const critical = await post('/cases', { ...body, severity: 'critical' });
            expect(critical.body.data.created).toBe(false);
            expect((await Case.findOne({}).lean())!.severity).toBe('critical');
            await post('/cases', { ...body, severity: 'info' });
            expect((await Case.findOne({}).lean())!.severity).toBe('critical');

            const bad = await post('/cases', { ...body, type: 'nope' });
            expect(bad.status).toBe(400);
        } finally {
            fetchMock.restore();
        }
    });
});

describe('/internal/view-tasks', () => {
    it('is idempotent on sourceId', async () => {
        const body = { sourceId: 'mv-1', submittedAt: new Date().toISOString(), campaignId: 'c1', diffuseurUserId: 'u1', dayIndex: 2, country: 'CM' };
        const rs = await Promise.all(Array.from({ length: 5 }, () => post('/view-tasks', body)));
        expect(new Set(rs.map((r) => r.body.data.taskId)).size).toBe(1);
        expect(await ViewTask.countDocuments({})).toBe(1);
    });
});
