import { AuditLog } from '../database/models/audit-log.model';
import { desk, FetchCall, login, makeAgent, mockFetch, reauthToken, setupDb, teardown } from './helpers';

/** Security plan Phase 11: the desk's activity panel reads user-service's board, filtered to the agent's countries. */
let f: { calls: FetchCall[]; restore: () => void };
const board = { rows: [{ country: 'CM' }], total: { country: 'ALL' } };
beforeEach(async () => {
    await setupDb();
    f = mockFetch({
        '/api/users/internal/activity/board': () => ({ json: { success: true, data: board } }),
        '127.0.0.1:9/api/notifications': () => ({ json: { success: true } }),
    });
});
afterEach(() => f.restore());
afterAll(teardown);

const boardCalls = () => f.calls.filter((c) => c.url.includes('/activity/board'));

describe('desk activity panel', () => {
    it('an agent without a country team reads every country', async () => {
        const agent = await login(await makeAgent(['support_agent']));
        const r = await desk('get', '/activity?range=7d&source=app', agent);
        expect(r.status).toBe(200);
        expect(r.body.data).toEqual({ board, team: [] });
        const url = boardCalls()[0].url;
        expect(url).toContain('range=7d');
        expect(url).toContain('source=app');
        expect(url).not.toContain('countries=');
    });

    it('a country team only ever asks for its own countries', async () => {
        const admin = await makeAgent(['support_admin']);
        const adminJar = await login(admin);
        const agentAcc = await makeAgent(['support_agent'], { email: 'cm@e2e.test' });
        const set = await desk('put', `/agents/${agentAcc.id}/countries`, adminJar, { 'x-reauth-token': await reauthToken(admin, adminJar) }).send({ countries: ['cm', 'BJ'] });
        expect(set.status).toBe(200);
        expect(set.body.data.countries).toEqual(['CM', 'BJ']);
        expect(await AuditLog.countDocuments({ action: 'agent.countries_changed' })).toBe(1);

        const agent = await login(agentAcc);
        await desk('get', '/activity', agent);
        expect(boardCalls().pop()!.url).toContain(`countries=${encodeURIComponent('CM,BJ')}`);
        await desk('get', '/activity?country=BJ', agent);
        expect(boardCalls().pop()!.url).toContain('countries=BJ');
        const before = boardCalls().length;
        const other = await desk('get', '/activity?country=CI', agent);
        expect(other.body.data.board).toBeNull();
        expect(boardCalls().length).toBe(before);
    });

    it('countries are checked, and only agents.manage may set them', async () => {
        const admin = await makeAgent(['support_admin']);
        const adminJar = await login(admin);
        const target = await makeAgent(['support_agent'], { email: 't@e2e.test' });
        const bad = await desk('put', `/agents/${target.id}/countries`, adminJar, { 'x-reauth-token': await reauthToken(admin, adminJar) }).send({ countries: ['Cameroun'] });
        expect(bad.status).toBe(400);
        const agent = await login(await makeAgent(['support_agent'], { email: 'a@e2e.test' }));
        expect((await desk('put', `/agents/${target.id}/countries`, agent).send({ countries: ['CM'] })).status).toBe(403);
    });

    it('a verifier has no activity panel', async () => {
        const v = await login(await makeAgent(['verifier']));
        expect((await desk('get', '/activity', v)).status).toBe(403);
    });
});
