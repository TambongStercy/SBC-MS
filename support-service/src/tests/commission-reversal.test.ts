import { Agent } from '../database/models/agent.model';
import { Approval } from '../database/models/approval.model';
import { desk, FetchCall, login, makeAgent, mockFetch, reauthToken, setupDb, teardown, TestAgent, Jar } from './helpers';

/** Commission reversal (Phase 5 leftover, 2026-11-23): finance agent asks, another finance manager approves, payment-service executes. */

const M1 = '6e2e00000000000000000d01';
const RELATED = '6e2e00000000000000000d03';
const TX = 'CommTx0001';

const commission = (over: Record<string, unknown> = {}) => ({
    transactionId: TX, amount: 2500, currency: 'XAF', status: 'completed', createdAt: '2026-11-20T10:00:00Z',
    isCommission: true, level: 1, sourceUserId: RELATED, reversible: true, reversed: false, ...over,
});

let f: { calls: FetchCall[]; restore: () => void };
let preview: { status?: number; json: unknown };
let reverse: { status?: number; json: unknown };
beforeEach(async () => {
    await setupDb();
    preview = { json: { success: true, data: commission() } };
    reverse = { json: { success: true, data: { status: 'reversed', amount: 2500, currency: 'XAF', reversalTransactionId: 'R1' } } };
    f = mockFetch({
        '/api/users/internal/support-details': (c) => ({ json: { success: true, data: (c.body?.userIds ?? []).map((id: string) => ({ _id: id, name: 'Membre', country: 'CM', frozen: null })) } }),
        '/api/users/internal/support/related': (c) => ({ json: { success: true, data: { related: [c.body.userId, c.body.otherUserId].includes(RELATED) } } }),
        [`/api/internal/support/commissions/${TX}/reverse`]: () => reverse,
        [`/api/internal/support/commissions/${TX}`]: () => preview,
        '/api/notifications': () => ({ json: { success: true } }),
    });
});
afterEach(() => f.restore());
afterAll(teardown);

const reauth = async (a: TestAgent, jar: Jar) => ({ 'x-reauth-token': await reauthToken(a, jar) });
const calls = (part: string) => f.calls.filter((c) => c.url.includes(part));
const REASON = 'Commission versée deux fois pour le même filleul (doublon du 20/11).';

describe('commission reversal', () => {
    it('a finance agent asks; another finance manager approves; payment-service takes it back', async () => {
        const fa = await makeAgent(['finance_agent']);
        const fm = await makeAgent(['finance_manager'], { email: 'fm@e2e.test' });
        const ja = await login(fa);
        const jf = await login(fm);
        const seen = await desk('get', `/members/${M1}/commissions/${TX}`, ja);
        expect(seen.status).toBe(200);
        expect(seen.body.data.reversible).toBe(true);
        expect((await desk('post', `/members/${M1}/commission-reversal`, ja, await reauth(fa, ja)).send({ transactionId: TX, reason: 'court' })).status).toBe(400);
        const r = await desk('post', `/members/${M1}/commission-reversal`, ja, await reauth(fa, ja)).send({ transactionId: TX, reason: REASON });
        expect(r.status).toBe(201);
        const id = r.body.data.approvalId;
        const stored = await Approval.findById(id).lean();
        expect(stored).toMatchObject({ type: 'commission_reversal', subject: { userId: M1, transactionId: TX }, payload: { amount: 2500, currency: 'XAF', level: 1 } });
        // A second request for the same commission while one is open.
        expect((await desk('post', `/members/${M1}/commission-reversal`, ja, await reauth(fa, ja)).send({ transactionId: TX, reason: REASON })).body.code).toBe('ALREADY_PENDING');
        // A finance agent cannot approve.
        expect((await desk('post', `/approvals/${id}/approve`, ja, await reauth(fa, ja)).send({})).status).toBe(403);
        const ok = await desk('post', `/approvals/${id}/approve`, jf, await reauth(fm, jf)).send({ note: 'Doublon confirmé' });
        expect(ok.status).toBe(200);
        expect(ok.body.data.status).toBe('executed');
        const call = calls(`/commissions/${TX}/reverse`)[0];
        expect(call.body).toMatchObject({ userId: M1, approvalId: id });
        expect(call.headers['x-support-actor']).toBeTruthy();
    });

    it('not enough money left: the approval ends failed with the reason, nothing else happens', async () => {
        const fm1 = await makeAgent(['finance_manager']);
        const fm2 = await makeAgent(['finance_manager'], { email: 'fm2@e2e.test' });
        const j1 = await login(fm1);
        const j2 = await login(fm2);
        const r = await desk('post', `/members/${M1}/commission-reversal`, j1, await reauth(fm1, j1)).send({ transactionId: TX, reason: REASON });
        expect((await desk('post', `/approvals/${r.body.data.approvalId}/approve`, j1, await reauth(fm1, j1)).send({})).body.code).toBe('SELF_APPROVAL');
        reverse = { status: 409, json: { success: false, code: 'INSUFFICIENT_AVAILABLE_BALANCE', message: 'Le membre n’a plus assez d’argent disponible.' } };
        const ok = await desk('post', `/approvals/${r.body.data.approvalId}/approve`, j2, await reauth(fm2, j2)).send({});
        expect(ok.body.data.status).toBe('failed');
        const a = await Approval.findById(r.body.data.approvalId).lean();
        expect(a?.execution).toMatchObject({ ok: false, code: 'INSUFFICIENT_AVAILABLE_BALANCE' });
    });

    it('payment-service down: stays approved; « exécuter à nouveau » finishes it', async () => {
        const fm1 = await makeAgent(['finance_manager']);
        const fm2 = await makeAgent(['finance_manager'], { email: 'fm2@e2e.test' });
        const j1 = await login(fm1);
        const j2 = await login(fm2);
        const r = await desk('post', `/members/${M1}/commission-reversal`, j1, await reauth(fm1, j1)).send({ transactionId: TX, reason: REASON });
        reverse = { status: 503, json: { success: false, code: 'INTERNAL_ERROR', message: 'Internal error' } };
        const ok = await desk('post', `/approvals/${r.body.data.approvalId}/approve`, j2, await reauth(fm2, j2)).send({});
        expect(ok.body.data.status).toBe('approved');
        reverse = { json: { success: true, data: { status: 'reversed' } } };
        const again = await desk('post', `/approvals/${r.body.data.approvalId}/execute`, j2, await reauth(fm2, j2)).send({});
        expect(again.body.data.status).toBe('executed');
        expect(calls(`/commissions/${TX}/reverse`).every((c) => c.body.approvalId === r.body.data.approvalId)).toBe(true);
    });

    it('refuses what cannot be taken back, and the agent’s own referral tree', async () => {
        const fa = await makeAgent(['finance_agent']);
        const ja = await login(fa);
        preview = { json: { success: true, data: commission({ isCommission: false, reversible: false }) } };
        expect((await desk('post', `/members/${M1}/commission-reversal`, ja, await reauth(fa, ja)).send({ transactionId: TX, reason: REASON })).body.code).toBe('NOT_A_COMMISSION');
        preview = { json: { success: true, data: commission({ status: 'reconciled', reversible: false, reversed: true }) } };
        expect((await desk('post', `/members/${M1}/commission-reversal`, ja, await reauth(fa, ja)).send({ transactionId: TX, reason: REASON })).body.code).toBe('ALREADY_REVERSED');
        preview = { status: 404, json: { success: false, code: 'COMMISSION_NOT_FOUND', message: 'introuvable' } };
        expect((await desk('post', `/members/${M1}/commission-reversal`, ja, await reauth(fa, ja)).send({ transactionId: TX, reason: REASON })).status).toBe(404);
        // A support agent has no right to ask.
        const sa = await makeAgent(['support_agent'], { email: 'sa@e2e.test' });
        const js = await login(sa);
        expect((await desk('post', `/members/${M1}/commission-reversal`, js, await reauth(sa, js)).send({ transactionId: TX, reason: REASON })).status).toBe(403);
        // Conflict rule: an agent linked to a member of the tree.
        preview = { json: { success: true, data: commission() } };
        const linked = await makeAgent(['finance_agent'], { email: 'linked@e2e.test' });
        await Agent.updateOne({ _id: linked.id }, { $set: { memberUserId: RELATED } });
        const jl = await login(linked);
        const r = await desk('post', `/members/${M1}/commission-reversal`, jl, await reauth(linked, jl)).send({ transactionId: TX, reason: REASON });
        expect(r.status).toBe(403);
        expect(await Approval.countDocuments({ type: 'commission_reversal' })).toBe(0);
    });
});
