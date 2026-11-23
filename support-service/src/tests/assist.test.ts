import request from 'supertest';
import config from '../config';
import { Agent } from '../database/models/agent.model';
import { AssistGrant } from '../database/models/assist-grant.model';
import { AuditLog } from '../database/models/audit-log.model';
import { resetOpenReplayTokenForTests } from '../services/clients/openreplay.client';
import { desk, getApp, login, makeAgent, memberToken, mockFetch, setupDb, teardown, type FetchCall } from './helpers';

const MEMBER = '64b000000000000000000c01';
const OTHER = '64b000000000000000000c02';
const DASH = 'https://replay.sbc.test';
const grant = (agent: string, who = MEMBER) =>
    (request(getApp()) as any).get(`/api/support/me/assist/grant?agent=${encodeURIComponent(agent)}`).set('Authorization', `Bearer ${memberToken(who)}`) as request.Test;

let f: { calls: FetchCall[]; restore: () => void };
let orDown = false;
beforeEach(async () => {
    await setupDb();
    resetOpenReplayTokenForTests();
    orDown = false;
    Object.assign(config.openreplay, { dashboardUrl: DASH, projectId: 2, apiEmail: 'support-api@sbc.test', apiPassword: 'x'.repeat(20) });
    f = mockFetch({
        [`${DASH}/api/login`]: () => (orDown ? { status: 502, json: {} } : { json: { jwt: 'or-jwt' } }),
        [`${DASH}/v2/api/2/sessions/search`]: (c) => ({
            json: { data: { total: 2, sessions: c.body.filters[0].value[0] === MEMBER ? [
                { sessionId: '7700000000000001', startTs: 1795400000000, duration: 61000, pagesCount: 4, userOs: 'Android', userBrowser: 'Chrome' },
                { sessionId: '7700000000000002', startTs: 1795300000000, duration: 5000, pagesCount: 1 },
            ] : [] } },
        }),
        [`${DASH}/api/2/assist/sessions`]: (c) => ({
            json: { data: { total: 1, sessions: c.url.includes(`userID=${MEMBER}`) ? [{ sessionID: '7700000000000009', userID: MEMBER, timestamp: 1795410000000 }] : [] } },
        }),
        '127.0.0.1:9/api/users/internal/support/related': () => ({ json: { success: true, data: { related: false } } }),
        '127.0.0.1:9/api/users': () => ({ json: { success: true, data: { country: 'CM' } } }),
        '127.0.0.1:9/api/notifications': () => ({ json: { success: true } }),
    });
});
afterEach(() => { Object.assign(config.openreplay, { dashboardUrl: '', projectId: 0, apiEmail: '', apiPassword: '' }); f.restore(); });
afterAll(teardown);

describe('member sessions on the desk (OpenReplay)', () => {
    it('lists live and recorded sessions without links; each opening is audited and limited to this member’s sessions', async () => {
        const jar = await login(await makeAgent(['support_agent']));
        const list = await desk('get', `/members/${MEMBER}/sessions`, jar);
        expect(list.status).toBe(200);
        expect(list.body.data.live.map((s: any) => s.sessionId)).toEqual(['7700000000000009']);
        expect(list.body.data.recorded.map((s: any) => s.sessionId)).toEqual(['7700000000000001', '7700000000000002']);
        expect(list.body.data.recorded[0]).toMatchObject({ pages: 4, device: 'Android · Chrome', durationMs: 61000 });
        expect(JSON.stringify(list.body)).not.toContain(DASH);
        // the service signed in with its own account and filtered on user_id
        const search = f.calls.find((c) => c.url.includes('/sessions/search'))!;
        expect(search.headers.authorization).toBe('Bearer or-jwt');
        expect(search.body.filters).toEqual([{ name: 'user_id', value: [MEMBER], operator: 'is', isEvent: false }]);
        expect(await AuditLog.countDocuments({ action: 'member.sessions.listed' })).toBe(1);

        const open = await desk('post', `/members/${MEMBER}/sessions/7700000000000001/open`, jar);
        expect(open.body.data.url).toBe(`${DASH}/2/session/7700000000000001`);
        const watch = await desk('post', `/members/${MEMBER}/sessions/7700000000000009/open`, jar, {}).send({ live: true });
        expect(watch.body.data.url).toBe(`${DASH}/2/assist/7700000000000009`);
        // « Regarder » lets this agent ask the member to watch, never to take control
        const agentEmail = (await AssistGrant.findOne({ memberId: MEMBER }).lean())!.agentEmail;
        expect((await grant(agentEmail)).body.data).toMatchObject({ allowed: true, control: false });
        expect(await AuditLog.countDocuments({ action: { $in: ['member.replay.opened', 'member.live.watched'] } })).toBe(2);

        // another member's session id, or garbage: refused
        expect((await desk('post', `/members/${OTHER}/sessions/7700000000000001/open`, jar)).status).toBe(404);
        expect((await desk('post', `/members/${MEMBER}/sessions/..%2Fx/open`, jar)).status).toBe(400);
    });

    it('a verifier cannot see sessions; OpenReplay down answers 503; not configured answers 503', async () => {
        const v = await login(await makeAgent(['verifier']));
        expect((await desk('get', `/members/${MEMBER}/sessions`, v)).status).toBe(403);
        const jar = await login(await makeAgent(['support_agent']));
        orDown = true;
        expect((await desk('get', `/members/${MEMBER}/sessions`, jar)).body.code).toBe('REPLAY_UNAVAILABLE');
        config.openreplay.apiEmail = '';
        expect((await desk('get', `/members/${MEMBER}/sessions`, jar)).body.code).toBe('REPLAY_OFF');
    });
});

describe('live assistance (remote control) from the desk', () => {
    it('only an agent with assist.control opens it; the member app sees the grant for that agent only, until it ends', async () => {
        const plain = await login(await makeAgent(['support_agent']));
        expect((await desk('post', `/members/${MEMBER}/assist`, plain)).status).toBe(403);
        // the refusal is audited (written in the background)
        let denied = 0;
        for (let i = 0; i < 20 && !denied; i++) { denied = await AuditLog.countDocuments({ action: 'access.denied', 'meta.missing': 'assist.control' }); if (!denied) await new Promise((r) => setTimeout(r, 50)); }
        expect(denied).toBe(1);
        expect((await grant('Agent-Support@agents.test')).body.data).toEqual({ allowed: false, control: false, agentName: null });

        const admin = await makeAgent(['support_admin'], { email: 'awa.admin@agents.test' });
        const jar = await login(admin);
        const started = await desk('post', `/members/${MEMBER}/assist`, jar);
        expect(started.status).toBe(201);
        expect(started.body.data.live).toEqual([expect.objectContaining({ sessionId: '7700000000000009', url: `${DASH}/2/assist/7700000000000009` })]);
        expect(await AuditLog.countDocuments({ action: 'assist.started', 'target.id': MEMBER })).toBe(1);

        // the member app: allowed for that agent's e-mail (any case), not for another, not for another member
        expect((await grant('Awa.Admin@agents.test')).body.data).toEqual({ allowed: true, control: true, agentName: 'Agent' });
        expect((await grant('someone@agents.test')).body.data.allowed).toBe(false);
        expect((await grant('awa.admin@agents.test', OTHER)).body.data.allowed).toBe(false);

        const end = await desk('post', `/members/assist/${started.body.data.grantId}/end`, jar);
        expect(end.status).toBe(200);
        expect(await AuditLog.countDocuments({ action: 'assist.ended' })).toBe(1);
        expect((await grant('awa.admin@agents.test')).body.data.allowed).toBe(false);
        // ending twice, or someone else's: 404
        expect((await desk('post', `/members/assist/${started.body.data.grantId}/end`, jar)).status).toBe(404);
    });

    it('an expired grant allows nothing; a second opening replaces the first', async () => {
        const admin = await makeAgent(['support_admin'], { email: 'moussa@agents.test' });
        const jar = await login(admin);
        await desk('post', `/members/${MEMBER}/assist`, jar);
        await desk('post', `/members/${MEMBER}/assist`, jar);
        expect(await AssistGrant.countDocuments({ memberId: MEMBER, endedAt: null })).toBe(1);
        await AssistGrant.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
        expect((await grant('moussa@agents.test')).body.data.allowed).toBe(false);
    });

    it('a ticket of another member is refused; the agent’s own account (conflict rule) is refused', async () => {
        const admin = await makeAgent(['support_admin']);
        const jar = await login(admin);
        expect((await desk('post', `/members/${MEMBER}/assist`, jar, {}).send({ ticketId: '64b0000000000000000000ff' })).status).toBe(404);
        await Agent.updateOne({ _id: admin.id }, { $set: { memberUserId: MEMBER } });
        const r = await desk('post', `/members/${MEMBER}/assist`, jar);
        expect(r.status).toBe(403);
        expect(r.body.code).toBe('CONFLICT_OF_INTEREST');
        expect(await AssistGrant.countDocuments({})).toBe(0);
    });
});
