import request from 'supertest';
import config from '../config';
import { AuditLog } from '../database/models/audit-log.model';
import { desk, getApp, login, makeAgent, memberToken, mockFetch, setupDb, teardown } from './helpers';

const MEMBER = '64b000000000000000000a02';
const DASH = 'https://replay.sbc.test';
const member = (path: string, who = MEMBER) =>
    (request(getApp()) as any).post(`/api/support/me${path}`).set('Authorization', `Bearer ${memberToken(who)}`) as request.Test;
const ticket = (replay: unknown) => ({ category: 'retrait', subject: 'Retrait bloqué', message: 'Mon retrait est bloqué depuis hier.', replay });

let f: { restore: () => void };
beforeEach(async () => {
    await setupDb();
    config.openreplay.dashboardUrl = DASH;
    f = mockFetch({ '127.0.0.1:9/api/notifications': () => ({ json: { success: true } }), '127.0.0.1:9/api/users': () => ({ json: { success: true, data: [] } }) });
});
afterEach(() => { config.openreplay.dashboardUrl = ''; f.restore(); });
afterAll(teardown);

describe('session replay on tickets (OpenReplay)', () => {
    it('keeps the member’s session, hands the link to an agent only through an audited call', async () => {
        const created = await member('/tickets').send(ticket({ sessionId: '7712345678901234', url: `${DASH}/3/session/7712345678901234?jumpto=1700000000000` }));
        expect(created.status).toBe(201);
        const id = created.body.data.id;
        expect(JSON.stringify(created.body)).not.toContain('session/');

        const jar = await login(await makeAgent(['support_agent']));
        const detail = await desk('get', `/tickets/${id}`, jar);
        expect(detail.body.data.ticket.replay).toMatchObject({ at: expect.any(String) });
        expect(JSON.stringify(detail.body)).not.toContain(DASH);

        const open = await desk('post', `/tickets/${id}/replay`, jar);
        expect(open.status).toBe(200);
        expect(open.body.data.url).toBe(`${DASH}/3/session/7712345678901234?jumpto=1700000000000`);
        const log = await AuditLog.findOne({ action: 'ticket.replay.opened' }).lean();
        expect(log).toMatchObject({ target: { type: 'ticket', id } });
    });

    it('drops a link that does not point at our dashboard, and stores nothing while replay is off', async () => {
        const jar = await login(await makeAgent(['support_agent']));
        for (const replay of [
            { sessionId: '1', url: 'https://evil.test/3/session/1' },
            { sessionId: '1', url: `${DASH}.evil.test/3/session/1` },
            { sessionId: '1', url: `${DASH}/3/session/2` },
            { sessionId: '../x', url: `${DASH}/3/session/../x` },
            'not-an-object',
        ]) {
            const id = (await member('/tickets').send(ticket(replay))).body.data.id;
            expect((await desk('get', `/tickets/${id}`, jar)).body.data.ticket.replay).toBeNull();
            expect((await desk('post', `/tickets/${id}/replay`, jar)).status).toBe(404);
        }
        config.openreplay.dashboardUrl = '';
        // (another member: the first one used up the 5 requests a day)
        const id = (await member('/tickets', '64b000000000000000000a03').send(ticket({ sessionId: '5', url: `${DASH}/3/session/5` }))).body.data.id;
        expect((await desk('get', `/tickets/${id}`, jar)).body.data.ticket.replay).toBeNull();
    });
});
