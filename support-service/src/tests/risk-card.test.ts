import config from '../config';
import { AuditLog } from '../database/models/audit-log.model';
import { desk, FetchCall, login, makeAgent, mockFetch, reauthToken, setupDb, teardown } from './helpers';

/** Security plan Phase 4, part 2: the « Risque » card on the member page (risk.read). */

const M1 = '6e2e00000000000000000d01';
const LINKED = '6e2e00000000000000000d02';
const VIEW = {
    userId: M1, scored: true, score: 120, decision: 'hold', structuralScore: 90, groupSize: 2, scoredAt: '2026-11-22T08:00:00.000Z',
    reasons: [{ rule: 'shared_payout_number', points: 40, detail: 'Numéro de retrait •••777 partagé avec 1 compte(s) de son parrainage' }, { rule: 'self_referral', points: 50, detail: 'Parrain et filleul dans le même groupe' }],
    liveReasons: [{ rule: 'contact_change_withdrawal', points: 30, detail: 'Retrait demandé 10 h après un changement de numéro Mobile Money', at: '2026-11-22T07:00:00.000Z', expiresAt: '2026-11-29T07:00:00.000Z' }],
    linked: [{ userId: LINKED, score: 90, decision: 'hold', country: null }],
    identifiers: [{ kind: 'phone', uses: ['payout_number'], tail: '777', count: 2, hub: false }],
    events: [{ type: 'withdrawal_requested', at: '2026-11-22T07:00:00.000Z', kind: null, amountXaf: 40000, numberTail: '777' }],
    kyc: {
        level: 2, score: 15, band: 'low', reasons: ['email_no_mx'], signals: { email: { domain: 'gmail.con' } }, variantAccounts: 0, checkedAt: '2026-11-22T02:10:00.000Z',
        level2: { found: ['github'], asked: 20, answered: 8, gravatar: false, trigger: 'score_hold', checkedAt: '2026-11-23T10:00:00.000Z', reasons: [], points: 0 },
    },
};

let f: { calls: FetchCall[]; restore: () => void };
beforeEach(async () => {
    await setupDb();
    f = mockFetch({
        '/api/risk/internal/members/': (c) => (c.method === 'POST' && c.url.endsWith('/release')
            ? { json: { success: true, data: { released: true, scoreAtRelease: VIEW.score, wasHeld: true } } }
            : { json: { success: true, data: VIEW } }),
        '/api/users/internal/support-details': (c) => ({ json: { success: true, data: (c.body?.userIds ?? []).map((id: string) => ({ _id: id, name: `Membre ${id.slice(-2)}`, country: 'CM' })) } }),
    });
});
afterEach(() => f.restore());
afterAll(teardown);

describe('member risk card', () => {
    it('finance manager: score, structural + live reasons, linked accounts with names, KYC; audited', async () => {
        const fm = await makeAgent(['finance_manager']);
        const r = await desk('get', `/members/${M1}/risk`, await login(fm));
        expect(r.status).toBe(200);
        const d = r.body.data;
        expect(d).toMatchObject({ available: true, score: 120, decision: 'hold', groupSize: 2 });
        expect(d.reasons.map((x: any) => `${x.rule}:${x.live}`)).toEqual(['shared_payout_number:false', 'self_referral:false', 'contact_change_withdrawal:true']);
        expect(d.linked[0]).toMatchObject({ userId: LINKED, name: 'Membre 02', country: 'CM' });
        expect(d.kyc).toMatchObject({ band: 'low', emailDomain: 'gmail.con', level2: { found: ['github'], answered: 8, asked: 20, gravatar: false, trigger: 'score_hold' } });
        expect(JSON.stringify(d)).not.toContain('signals');
        const call = f.calls.find((c) => c.url.includes('/api/risk/internal/members/'))!;
        expect(call.headers.authorization).toBe('Bearer test-service-secret');
        expect(await AuditLog.countDocuments({ action: 'member.risk.viewed', 'target.id': M1 })).toBe(1);
    });

    it('a support agent (no risk.read) is refused', async () => {
        const a = await makeAgent(['support_agent']);
        expect((await desk('get', `/members/${M1}/risk`, await login(a))).status).toBe(403);
    });

    it('risk-service not connected → available: false, nothing called', async () => {
        const saved = config.services.risk;
        (config.services as any).risk = '';
        try {
            const fm = await makeAgent(['finance_manager']);
            const r = await desk('get', `/members/${M1}/risk`, await login(fm));
            expect(r.body.data).toEqual({ available: false });
            expect(f.calls.some((c) => c.url.includes('/api/risk/'))).toBe(false);
        } finally { (config.services as any).risk = saved; }
    });

    it('risk-service down → 503, not a blank card', async () => {
        f.restore();
        f = mockFetch({ '/api/users/internal/support-details': () => ({ json: { success: true, data: [] } }), '/api/risk/internal/members/': () => ({ status: 502, json: {} }) });
        const fm = await makeAgent(['finance_manager']);
        expect((await desk('get', `/members/${M1}/risk`, await login(fm))).status).toBe(503);
    });

    it('blocking mode: one finance manager asks to release a held member, another approves, risk-service records it', async () => {
        const fm1 = await makeAgent(['finance_manager']);
        const fm2 = await makeAgent(['finance_manager'], { email: 'fm2@e2e.test' });
        const j1 = await login(fm1);
        const j2 = await login(fm2);
        const short = await desk('post', `/members/${M1}/risk/release`, j1, { 'x-reauth-token': await reauthToken(fm1, j1) }).send({ reason: 'ok' });
        expect(short.status).toBe(400);
        const r = await desk('post', `/members/${M1}/risk/release`, j1, { 'x-reauth-token': await reauthToken(fm1, j1) }).send({ reason: 'Appel vidéo avec le membre, famille qui partage un numéro.' });
        expect(r.status).toBe(201);
        const id = r.body.data.approvalId;
        expect((await desk('post', `/approvals/${id}/approve`, j1, { 'x-reauth-token': await reauthToken(fm1, j1) }).send({})).body.code).toBe('SELF_APPROVAL');
        const ok = await desk('post', `/approvals/${id}/approve`, j2, { 'x-reauth-token': await reauthToken(fm2, j2) }).send({});
        expect(ok.body.data.status).toBe('executed');
        const call = f.calls.find((c) => c.method === 'POST' && c.url.endsWith(`/members/${M1}/release`))!;
        expect(call.body).toMatchObject({ approvalId: id, by: { name: expect.any(String) } });
        expect(call.body.reason).toContain('Appel vidéo');
    });

    it('a member the engine does not hold cannot be « released »', async () => {
        f.restore();
        f = mockFetch({
            '/api/risk/internal/members/': () => ({ json: { success: true, data: { ...VIEW, decision: 'require_code', score: 45 } } }),
            '/api/users/internal/support-details': (c) => ({ json: { success: true, data: (c.body?.userIds ?? []).map((id: string) => ({ _id: id, name: 'M', country: 'CM' })) } }),
        });
        const fm = await makeAgent(['finance_manager']);
        const j = await login(fm);
        const r = await desk('post', `/members/${M1}/risk/release`, j, { 'x-reauth-token': await reauthToken(fm, j) }).send({ reason: 'x'.repeat(30) });
        expect(r.status).toBe(409);
        expect(r.body.code).toBe('NOT_HELD');
    });
});
