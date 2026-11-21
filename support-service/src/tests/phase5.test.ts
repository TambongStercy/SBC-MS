import { Agent } from '../database/models/agent.model';
import { Approval } from '../database/models/approval.model';
import { AgentNotification } from '../database/models/agent-notification.model';
import { AuditLog } from '../database/models/audit-log.model';
import { Case } from '../database/models/case.model';
import { Ticket } from '../database/models/ticket.model';
import { upsertCase } from '../services/case.service';
import { createTicket } from '../services/ticket.service';
import { desk, FetchCall, login, makeAgent, mockFetch, reauthToken, setupDb, teardown, TestAgent, Jar } from './helpers';

/** Security plan Phase 5: approvals, super manager, conflict rule, country teams, fraud queue, case intake. */

const M1 = '6e2e00000000000000000c01'; // CM member
const M2 = '6e2e00000000000000000c02'; // BJ member
const RELATED = '6e2e00000000000000000c03';
const COUNTRY: Record<string, string> = { [M1]: 'CM', [M2]: 'BJ', [RELATED]: 'CM' };

let f: { calls: FetchCall[]; restore: () => void };
let ownerAnswer: { status?: number; json: unknown } = { json: { success: true, data: { ok: true } } };
beforeEach(async () => {
    await setupDb();
    ownerAnswer = { json: { success: true, data: { ok: true } } };
    f = mockFetch({
        '/api/users/internal/support-details': (c) => ({
            json: { success: true, data: (c.body?.userIds ?? []).map((id: string) => ({ _id: id, name: `Membre ${id.slice(-2)}`, country: COUNTRY[id] ?? 'CM', frozen: null })) },
        }),
        '/api/users/internal/support/related': (c) => ({ json: { success: true, data: { related: [c.body.userId, c.body.otherUserId].includes(RELATED) } } }),
        '/api/users/internal/support/authenticator-reset': () => ownerAnswer,
        '/api/users/internal/support/freeze': () => ownerAnswer,
        '/api/users/internal/support/momo-change': () => ownerAnswer,
        '/api/notifications': () => ({ json: { success: true } }),
    });
});
afterEach(() => f.restore());
afterAll(teardown);

const reauth = async (a: TestAgent, jar: Jar) => ({ 'x-reauth-token': await reauthToken(a, jar) });
const calls = (part: string) => f.calls.filter((c) => c.url.includes(part));

describe('new approvals', () => {
    it('authenticator reset: a support agent asks, a finance manager approves, user-service resets it', async () => {
        const agent = await makeAgent(['support_agent']);
        const fm = await makeAgent(['finance_manager'], { email: 'fm@e2e.test' });
        const ja = await login(agent);
        const jf = await login(fm);
        const short = await desk('post', `/members/${M1}/authenticator-reset`, ja, await reauth(agent, ja)).send({ reason: 'perdu' });
        expect(short.status).toBe(400);
        const r = await desk('post', `/members/${M1}/authenticator-reset`, ja, await reauth(agent, ja)).send({ reason: 'Pièce d’identité et selfie vérifiés, téléphone volé.' });
        expect(r.status).toBe(201);
        const id = r.body.data.approvalId;
        // The support agent cannot approve it.
        expect((await desk('post', `/approvals/${id}/approve`, ja, await reauth(agent, ja)).send({})).status).toBe(403);
        const ok = await desk('post', `/approvals/${id}/approve`, jf, await reauth(fm, jf)).send({ note: 'OK' });
        expect(ok.status).toBe(200);
        expect(ok.body.data.status).toBe('executed');
        expect(calls('/support/authenticator-reset')[0].body).toMatchObject({ userId: M1, approvalId: id });
    });

    it('freeze: one finance manager asks, another approves; user-service refusals mark it failed', async () => {
        const fm1 = await makeAgent(['finance_manager']);
        const fm2 = await makeAgent(['finance_manager'], { email: 'fm2@e2e.test' });
        const fa = await makeAgent(['finance_agent'], { email: 'fa@e2e.test' });
        const j1 = await login(fm1);
        const j2 = await login(fm2);
        const jfa = await login(fa);
        expect((await desk('post', `/members/${M1}/freeze`, jfa, await reauth(fa, jfa)).send({ action: 'freeze', reason: 'x'.repeat(30) })).status).toBe(403);
        const r = await desk('post', `/members/${M1}/freeze`, j1, await reauth(fm1, j1)).send({ action: 'freeze', reason: 'Même numéro de retrait que 12 comptes de son arbre.' });
        expect(r.status).toBe(201);
        expect((await desk('post', `/approvals/${r.body.data.approvalId}/approve`, j1, await reauth(fm1, j1)).send({})).body.code).toBe('SELF_APPROVAL');
        ownerAnswer = { status: 409, json: { success: false, code: 'ALREADY_FROZEN', message: 'déjà gelé' } };
        const ok = await desk('post', `/approvals/${r.body.data.approvalId}/approve`, j2, await reauth(fm2, j2)).send({});
        expect(ok.body.data.status).toBe('failed');
        expect(calls('/support/freeze')[0].body).toMatchObject({ userId: M1, action: 'freeze' });
    });

    it('MoMo change applies at approval; an email change stays approved for its code step', async () => {
        const agent = await makeAgent(['support_agent']);
        const fm = await makeAgent(['finance_manager'], { email: 'fm@e2e.test' });
        const ja = await login(agent);
        const jf = await login(fm);
        const reason = 'Identité vérifiée par appel vidéo et pièce.';
        const momo = await desk('post', `/members/${M1}/contact-change`, ja, await reauth(agent, ja)).send({ field: 'momo', momoNumber: '699112233', momoOperator: 'orange_cmr', reason });
        expect(momo.status).toBe(201);
        const ok = await desk('post', `/approvals/${momo.body.data.approvalId}/approve`, jf, await reauth(fm, jf)).send({});
        expect(ok.body.data.status).toBe('executed');
        expect(calls('/support/momo-change')[0].body).toMatchObject({ userId: M1, momoNumber: '699112233', momoOperator: 'ORANGE_CMR' });
        // The agent without full read sees the number masked.
        const seen = await desk('get', `/approvals/${momo.body.data.approvalId}`, ja);
        expect(seen.body.data.payload.momoNumber).not.toBe('699112233');
        const audit = await AuditLog.findOne({ action: 'approval.requested', 'target.id': momo.body.data.approvalId }).lean();
        expect(JSON.stringify(audit)).not.toContain('699112233');

        const email = await desk('post', `/members/${M2}/contact-change`, ja, await reauth(agent, ja)).send({ field: 'email', newValue: 'nouveau@gmail.com', reason });
        const ok2 = await desk('post', `/approvals/${email.body.data.approvalId}/approve`, jf, await reauth(fm, jf)).send({});
        expect(ok2.body.data.status).toBe('approved');
    });
});

describe('super manager', () => {
    it('approves their own request alone, with a reason, and every other manager is alerted', async () => {
        const sm = await makeAgent(['super_manager']);
        const js = await login(sm);
        const r = await desk('post', `/members/${M1}/freeze`, js, await reauth(sm, js)).send({ action: 'freeze', reason: 'Retraits en rafale vers un numéro partagé.' });
        expect(r.status).toBe(201);
        const id = r.body.data.approvalId;
        const noReason = await desk('post', `/approvals/${id}/approve`, js, await reauth(sm, js)).send({ note: 'ok' });
        expect(noReason.status).toBe(400);
        expect(noReason.body.code).toBe('REASON_REQUIRED');
        const noCode = await desk('post', `/approvals/${id}/approve`, js).send({ note: 'Urgence : retrait en cours vers le numéro partagé.' });
        expect(noCode.status).toBe(401);
        const ok = await desk('post', `/approvals/${id}/approve`, js, await reauth(sm, js)).send({ note: 'Urgence : retrait en cours vers le numéro partagé.' });
        expect(ok.status).toBe(200);
        expect(ok.body.data.status).toBe('executed');
        const a = (await Approval.findById(id).lean())!;
        expect(a.approvals).toHaveLength(1);
        expect(a.approvals[0].override).toBe(true);
        expect(await AuditLog.countDocuments({ action: 'approval.super_override' })).toBe(1);
        const alerted = await AgentNotification.find({ kind: 'approval.super_override' }).lean();
        expect(alerted.map((n: any) => n.role).sort()).toEqual(['finance_manager', 'super_manager', 'support_admin']);
    });

    it('two named accounts at most', async () => {
        const admin = await makeAgent(['support_admin']);
        const ja = await login(admin);
        await makeAgent(['super_manager'], { email: 'sm1@e2e.test' });
        await makeAgent(['super_manager'], { email: 'sm2@e2e.test' });
        const third = await desk('post', '/agents', ja, await reauth(admin, ja)).send({ name: 'Trois', email: 'sm3@e2e.test', roles: ['super_manager'] });
        expect(third.status).toBe(409);
        expect(third.body.code).toBe('SUPER_MANAGER_LIMIT');
    });
});

describe('conflict of interest', () => {
    it('no request or approval on one’s own member account or its referral tree', async () => {
        const fm = await makeAgent(['finance_manager']);
        const fm2 = await makeAgent(['finance_manager'], { email: 'fm2@e2e.test' });
        await Agent.updateOne({ _id: fm.id }, { $set: { memberUserId: M1 } });
        const j = await login(fm);
        const j2 = await login(fm2);
        const own = await desk('post', `/members/${M1}/freeze`, j, await reauth(fm, j)).send({ action: 'freeze', reason: 'x'.repeat(30) });
        expect(own.status).toBe(403);
        expect(own.body.code).toBe('CONFLICT_OF_INTEREST');
        // RELATED is in M1's referral tree (user-service says so).
        const tree = await desk('post', `/members/${RELATED}/freeze`, j, await reauth(fm, j)).send({ action: 'freeze', reason: 'x'.repeat(30) });
        expect(tree.body.code).toBe('CONFLICT_OF_INTEREST');
        // Asked by someone else, fm still may not approve it.
        const r = await desk('post', `/members/${RELATED}/freeze`, j2, await reauth(fm2, j2)).send({ action: 'freeze', reason: 'x'.repeat(30) });
        expect(r.status).toBe(201);
        expect((await desk('post', `/approvals/${r.body.data.approvalId}/approve`, j, await reauth(fm, j)).send({})).body.code).toBe('CONFLICT_OF_INTEREST');
        // An unrelated member is fine.
        expect((await desk('post', `/members/${M2}/freeze`, j, await reauth(fm, j)).send({ action: 'freeze', reason: 'x'.repeat(30) })).status).toBe(201);
        expect(await AuditLog.countDocuments({ action: 'conflict_of_interest.refused' })).toBe(3);
    });
});

describe('country teams', () => {
    it('an agent with countries [CM] sees only Cameroon tickets and cases', async () => {
        const author = { type: 'system' as const, id: 'test', name: 'test' };
        const tCM = await createTicket({ memberId: M1, category: 'autre', subject: 'Question CM', body: 'Bonjour', source: 'member', author });
        const tBJ = await createTicket({ memberId: M2, category: 'autre', subject: 'Question BJ', body: 'Bonjour', source: 'member', author });
        expect(tCM.country).toBe('CM');
        expect(tBJ.country).toBe('BJ');
        const cCM = await upsertCase({ type: 'ledger_mismatch', dedupKey: 'p5:cm', summary: 'Écart CM', subject: { userId: M1 } }, 'test');
        const cBJ = await upsertCase({ type: 'ledger_mismatch', dedupKey: 'p5:bj', summary: 'Écart BJ', subject: { userId: M2 }, country: 'bj' }, 'test');

        const fm = await makeAgent(['finance_manager']);
        await Agent.updateOne({ _id: fm.id }, { $set: { countries: ['CM'] } });
        const j = await login(fm);
        const list = await desk('get', '/tickets', j);
        expect(list.body.data.items.map((t: any) => t.number)).toEqual([tCM.number]);
        expect((await desk('get', `/tickets/${tBJ._id}`, j)).status).toBe(404);
        expect((await desk('post', `/tickets/${tBJ._id}/messages`, j).send({ body: 'x' })).status).toBe(404);
        expect((await desk('get', `/tickets/${tCM._id}`, j)).status).toBe(200);
        const cases = await desk('get', '/cases?type=finance', j);
        expect(cases.body.data.items.map((c: any) => c.id ?? c._id)).toEqual([cCM.caseId]);
        expect((await desk('get', `/cases/${cBJ.caseId}`, j)).status).toBe(404);

        // Without a team: everything.
        const all = await login(await makeAgent(['finance_manager'], { email: 'all@e2e.test' }));
        expect((await desk('get', '/tickets', all)).body.data.items).toHaveLength(2);
        expect((await Case.findById(cBJ.caseId).lean())!.country).toBe('BJ');
        expect(await Ticket.countDocuments({ country: null })).toBe(0);
    });
});

describe('fraud queue and case intake', () => {
    it('fraud cases: finance managers only, worst first then largest amount, kept out of the finance list', async () => {
        await upsertCase({ type: 'shared_payout_number', dedupKey: 'f:1', severity: 'warning', summary: 'Numéro partagé', subject: { userId: M1 }, amount: 50000 }, 'risk');
        await upsertCase({ type: 'self_referral', dedupKey: 'f:2', severity: 'critical', summary: 'Auto-parrainage', subject: { userId: M1 }, amount: 10000 }, 'risk');
        await upsertCase({ type: 'multi_account', dedupKey: 'f:3', severity: 'warning', summary: 'Comptes multiples', subject: { userId: M2 }, amount: 900000 }, 'risk');
        await upsertCase({ type: 'ledger_mismatch', dedupKey: 'l:1', summary: 'Écart', subject: { userId: M1 } }, 'user-service');
        const fa = await login(await makeAgent(['finance_agent']));
        expect((await desk('get', '/cases?type=fraud', fa)).status).toBe(403);
        expect((await desk('get', '/cases?type=finance', fa)).body.data.items.map((c: any) => c.type)).toEqual(['ledger_mismatch']);
        const fm = await login(await makeAgent(['finance_manager'], { email: 'fm@e2e.test' }));
        const q = await desk('get', '/cases?type=fraud', fm);
        expect(q.body.data.items.map((c: any) => c.type)).toEqual(['self_referral', 'multi_account', 'shared_payout_number']);
        const fraudId = q.body.data.items[0].id ?? q.body.data.items[0]._id;
        expect((await desk('get', `/cases/${fraudId}`, fa)).status).toBe(403);
        expect((await desk('post', `/cases/${fraudId}/comments`, fa).send({ body: 'note' })).status).toBe(403);
        expect((await desk('post', `/cases/${fraudId}/comments`, fm).send({ body: 'Je regarde.' })).status).toBe(200);
        expect(await AgentNotification.countDocuments({ role: 'finance_manager', kind: /^case\./ })).toBeGreaterThanOrEqual(3);
    });

    it('1,000 identical alerts make one case with 1,000 occurrences', async () => {
        const one = { type: 'abnormal_behavior', dedupKey: 'burst:1', severity: 'warning', summary: 'Rafale', subject: { userId: M1 } };
        for (let i = 0; i < 20; i++) await Promise.all(Array.from({ length: 50 }, () => upsertCase(one, 'risk')));
        const all = await Case.find({ dedupKey: 'burst:1' }).lean();
        expect(all).toHaveLength(1);
        expect(all[0].occurrences).toBe(1000);
    }, 60_000);
});
