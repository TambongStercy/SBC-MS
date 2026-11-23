import request from 'supertest';
import config from '../config';
import { Agent } from '../database/models/agent.model';
import { AgentNotification } from '../database/models/agent-notification.model';
import { AuditLog } from '../database/models/audit-log.model';
import { Case } from '../database/models/case.model';
import { desk, FetchCall, getApp, Jar, login, makeAgent, mockFetch, reauthToken, setupDb, teardown, TestAgent } from './helpers';

/**
 * Account suspension on a withdrawal without filleuls (2026-11-23):
 *   - intake of the critical `no_referral_withdrawal_ban` case: Fraude queue, desk bell to finance
 *     managers + support administrators (+ super managers), e-mail, ntfy at top priority;
 *   - the member card shows the ban (details for money readers only);
 *   - « Lever la suspension »: members.unban (FM, SA, SM), reauth code, reason, conflict rule, audited,
 *     executed by user-service.
 */

const M1 = '6e2e00000000000000000d01';
const RELATED = '6e2e00000000000000000d02';
const OWN = '6e2e00000000000000000d03'; // an agent's own member account; RELATED is in its referral tree
const BAN = { at: '2026-11-23T10:00:00.000Z', reason: 'no_referral_withdrawal', by: 'system:no-referral-rule', details: { reasons: ['unexplained_balance'], evaluation: { currency: 'XAF', a: 51000, b: 1000 } } };

const savedNtfy = { ...config.ntfy };
let f: { calls: FetchCall[]; restore: () => void };
let banned = true;
let unbanAnswer: { status?: number; json: unknown } = { json: { success: true, data: { unbanned: true, stillBlocked: false } } };
beforeEach(async () => {
    await setupDb();
    banned = true;
    unbanAnswer = { json: { success: true, data: { unbanned: true, stillBlocked: false } } };
    Object.assign(config.ntfy, { url: 'https://ntfy.test', topic: 'sbc-support-tests', token: '' });
    f = mockFetch({
        '/api/users/internal/support-details': (c) => ({
            json: {
                success: true, data: (c.body?.userIds ?? []).map((id: string) => ({
                    _id: id, name: `Membre ${id.slice(-2)}`, country: 'CM', blocked: banned, frozen: null,
                    ban: banned ? BAN : null, banHistory: [],
                })),
            },
        }),
        '/api/users/internal/support/related': (c) => ({ json: { success: true, data: { related: [c.body.userId, c.body.otherUserId].sort().join() === [OWN, RELATED].sort().join() } } }),
        '/unban': () => unbanAnswer,
        '/api/notifications': () => ({ json: { success: true } }),
        'ntfy.test': () => ({ json: { id: 'x' } }),
    });
});
afterEach(() => { f.restore(); Object.assign(config.ntfy, savedNtfy); });
afterAll(teardown);

const intake = (body: unknown) =>
    request(getApp()).post('/api/support/internal/cases').set('Authorization', `Bearer ${process.env.SERVICE_SECRET}`).set('x-service-name', 'payment-service').send(body as object);
const reauth = async (a: TestAgent, jar: Jar) => ({ 'x-reauth-token': await reauthToken(a, jar) });
const calls = (part: string) => f.calls.filter((c) => c.url.includes(part));
const waitFor = async (fn: () => boolean | Promise<boolean>) => { for (let i = 0; i < 40 && !(await fn()); i++) await new Promise((r) => setTimeout(r, 25)); };

describe('no_referral_withdrawal_ban case', () => {
    it('is accepted, lands in the Fraude queue, and alerts like a critical fraud case, louder', async () => {
        const fm = await makeAgent(['finance_manager']);
        await makeAgent(['support_admin'], { email: 'sa@e2e.test' });
        await makeAgent(['support_agent'], { email: 'a@e2e.test' });
        const r = await intake({
            type: 'no_referral_withdrawal_ban', dedupKey: `noref-ban:${M1}:${BAN.at}`, severity: 'critical',
            subject: { userId: M1 }, summary: 'Compte suspendu automatiquement : retrait demandé sans aucun filleul, solde non justifié.', amount: 20000, country: 'CM',
        });
        expect(r.status).toBe(201);
        const c = (await Case.findOne({}).lean())!;
        expect(c.type).toBe('no_referral_withdrawal_ban');
        expect(c.severity).toBe('critical');
        const bells = await AgentNotification.find({}).lean();
        expect(bells.map((n: any) => n.role).sort()).toEqual(['finance_manager', 'super_manager', 'support_admin']);
        expect(bells[0].title).toMatch(/suspendu/);
        await waitFor(() => calls('ntfy.test').length > 0);
        const ring = calls('ntfy.test')[0];
        expect(ring.body.priority).toBe(5);
        expect(ring.body.title).toMatch(/Compte suspendu/);
        // E-mailed to the agents holding those roles.
        expect(calls('/api/notifications').length).toBeGreaterThan(0);
        // The Fraude queue lists it.
        const jf = await login(fm);
        const q = await desk('get', '/cases?type=fraud', jf);
        expect(q.status).toBe(200);
        expect(q.body.data.items.map((i: any) => i.type)).toContain('no_referral_withdrawal_ban');
    });

    it('a warning (log mode) does not ring the phones', async () => {
        await makeAgent(['finance_manager']);
        const r = await intake({ type: 'no_referral_withdrawal_ban', dedupKey: `noref-ban:log:${M1}:2026-11-23`, severity: 'warning', subject: { userId: M1 }, summary: 'Mode observation : aurait été suspendu.' });
        expect(r.status).toBe(201);
        await new Promise((res) => setTimeout(res, 100));
        expect(calls('ntfy.test')).toHaveLength(0);
        expect((await AgentNotification.find({}).lean()).map((n: any) => n.role)).toEqual(['finance_manager']);
    });
});

describe('member card', () => {
    it('shows the ban to everyone, its figures to money readers only', async () => {
        const a = await makeAgent(['support_agent']);
        const fm = await makeAgent(['finance_manager'], { email: 'fm@e2e.test' });
        const ja = await login(a);
        const jf = await login(fm);
        const seenByAgent = (await desk('get', `/members/${M1}`, ja)).body.data.member;
        expect(seenByAgent.ban).toMatchObject({ at: BAN.at, reason: 'no_referral_withdrawal' });
        expect(seenByAgent.ban.details).toBeUndefined();
        const seenByFm = (await desk('get', `/members/${M1}`, jf)).body.data.member;
        expect(seenByFm.ban.details.evaluation.a).toBe(51000);
    });
});

describe('« Lever la suspension »', () => {
    const reason = 'Solde vérifié avec la finance : dépôt manuel légitime du 20/11.';

    it('an agent without members.unban is refused (403, audited) and nothing reaches user-service', async () => {
        for (const roles of [['support_agent'], ['finance_agent'], ['views_supervisor']]) {
            const a = await makeAgent(roles);
            const j = await login(a);
            const r = await desk('post', `/members/${M1}/unban`, j, await reauth(a, j)).send({ reason });
            expect(r.status).toBe(403);
        }
        await waitFor(async () => (await AuditLog.countDocuments({ action: 'access.denied', 'meta.missing': 'members.unban' })) >= 3);
        expect(await AuditLog.countDocuments({ action: 'access.denied', 'meta.missing': 'members.unban' })).toBe(3);
        expect(calls('/unban')).toHaveLength(0);
    });

    it('needs the authenticator code and a reason', async () => {
        const fm = await makeAgent(['finance_manager']);
        const j = await login(fm);
        expect((await desk('post', `/members/${M1}/unban`, j).send({ reason })).status).toBe(401);
        const short = await desk('post', `/members/${M1}/unban`, j, await reauth(fm, j)).send({ reason: 'ok' });
        expect(short.status).toBe(400);
        expect(short.body.code).toBe('REASON_REQUIRED');
        expect(calls('/unban')).toHaveLength(0);
    });

    it('a finance manager, a support administrator and a super manager lift it; audited; user-service called', async () => {
        for (const roles of [['finance_manager'], ['support_admin'], ['super_manager']]) {
            const a = await makeAgent(roles);
            const j = await login(a);
            const r = await desk('post', `/members/${M1}/unban`, j, await reauth(a, j)).send({ reason });
            expect(r.status).toBe(200);
            expect(r.body.data.unbanned).toBe(true);
        }
        const sent = calls('/unban');
        expect(sent).toHaveLength(3);
        expect(sent[0].url).toContain(`/api/users/internal/${M1}/unban`);
        expect(sent[0].body.reason).toBe(reason);
        expect(sent[0].body.by).toMatch(/^support:[a-f0-9]{24}\|finance_manager$/);
        const logs = await AuditLog.find({ action: 'member.unban' }).lean();
        expect(logs).toHaveLength(3);
        expect((logs[0] as any).reason).toBe(reason);
        expect((logs[0] as any).target.id).toBe(M1);
    });

    it('a member who is not suspended → 409 NOT_BANNED', async () => {
        banned = false;
        const fm = await makeAgent(['finance_manager']);
        const j = await login(fm);
        const r = await desk('post', `/members/${M1}/unban`, j, await reauth(fm, j)).send({ reason });
        expect(r.status).toBe(409);
        expect(r.body.code).toBe('NOT_BANNED');
    });

    it('never on the agent’s own account or referral tree', async () => {
        const fm = await makeAgent(['finance_manager']);
        await Agent.updateOne({ _id: fm.id }, { $set: { memberUserId: OWN } });
        const j = await login(fm);
        const r = await desk('post', `/members/${M1}/unban`, j, await reauth(fm, j)).send({ reason });
        expect(r.status).toBe(200); // M1 is not related
        const own = await desk('post', `/members/${RELATED}/unban`, j, await reauth(fm, j)).send({ reason });
        expect(own.status).toBe(403);
        expect(own.body.code).toBe('CONFLICT_OF_INTEREST');
    });

    it('a user-service refusal is reported, not hidden', async () => {
        unbanAnswer = { status: 409, json: { success: false, code: 'STATE_CHANGED', message: 'La suspension a changé entre-temps.' } };
        const fm = await makeAgent(['finance_manager']);
        const j = await login(fm);
        const r = await desk('post', `/members/${M1}/unban`, j, await reauth(fm, j)).send({ reason });
        expect(r.status).toBe(409);
        expect(r.body.code).toBe('STATE_CHANGED');
        expect(await AuditLog.countDocuments({ action: 'member.unban', result: 'error' })).toBe(1);
    });
});
