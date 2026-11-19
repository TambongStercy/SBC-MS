import { Approval } from '../database/models/approval.model';
import { AuditLog } from '../database/models/audit-log.model';
import { desk, login, makeAgent, mockFetch, reauthToken, setupDb, teardown } from './helpers';

beforeEach(setupDb);
afterAll(teardown);

const userId = '6e2e00000000000000000b01';
const member = { _id: userId, name: 'Membre Test', email: 'old@e2e.test', phoneNumber: '237699123456', subscriptions: [] };

it('contact change: request → approval by a manager → code to the new contact → apply; a channel outage keeps the approval usable', async () => {
    let channelDown = true;
    const fetchMock = mockFetch({
        '/api/users/internal/support-details': () => ({ json: { success: true, data: [member] } }),
        '/api/users/internal/support/contact-change': (c) => {
            if (c.body.step === 'send-code' && channelDown) return { status: 503, json: { success: false, code: 'CHANNEL_UNAVAILABLE', message: 'whatsapp off' } };
            if (c.body.step === 'apply' && c.body.code !== 'K7Q2PA') return { status: 400, json: { success: false, code: 'INVALID_CODE' } };
            return { json: { success: true } };
        },
        '/api/notifications': () => ({ json: { success: true } }),
    });
    try {
        const agent = await makeAgent(['support_agent']);
        const manager = await makeAgent(['finance_manager']);
        const jarA = await login(agent);
        const jarM = await login(manager);

        const req = await desk('post', `/members/${userId}/contact-change`, jarA, { 'x-reauth-token': await reauthToken(agent, jarA) })
            .send({ field: 'phoneNumber', newValue: '+237 6 77 00 11 22', reason: 'Pièce d’identité et selfie vérifiés, appel au numéro d’origine' });
        expect(req.status).toBe(201);
        const id = req.body.data.approvalId;

        // Masked for the agent in the approval list.
        const list = await desk('get', '/approvals?mine=1', jarA);
        expect(list.body.data[0].payload.newValue).not.toContain('770011');

        // Nothing can be sent before the approval.
        expect((await desk('post', `/members/contact-change/${id}/send-code`, jarA).send({})).status).toBe(409);
        const ok = await desk('post', `/approvals/${id}/approve`, jarM, { 'x-reauth-token': await reauthToken(manager, jarM) }).send({});
        expect(ok.body.data.status).toBe('approved');

        const down = await desk('post', `/members/contact-change/${id}/send-code`, jarA).send({});
        expect(down.status).toBe(503);
        expect(down.body.code).toBe('CHANNEL_UNAVAILABLE');
        expect(down.body.message).toMatch(/Changement de téléphone indisponible/);
        expect((await Approval.findById(id).lean())!.status).toBe('approved');

        channelDown = false;
        expect((await desk('post', `/members/contact-change/${id}/send-code`, jarA).send({})).status).toBe(200);
        const sendCall = fetchMock.calls.filter((c) => c.url.includes('contact-change')).pop()!;
        expect(sendCall.body).toEqual({ userId, field: 'phoneNumber', newValue: '+237677001122', step: 'send-code', approvalId: id });

        const wrong = await desk('post', `/members/contact-change/${id}/apply`, jarA, { 'x-reauth-token': await reauthToken(agent, jarA) }).send({ code: 'ZZZZZZ' });
        expect(wrong.status).toBe(400);
        expect(wrong.body.code).toBe('INVALID_CODE');
        const applied = await desk('post', `/members/contact-change/${id}/apply`, jarA, { 'x-reauth-token': await reauthToken(agent, jarA) }).send({ code: 'K7Q2PA' });
        expect(applied.status).toBe(200);
        expect((await Approval.findById(id).lean())!.status).toBe('executed');
        const entry = await AuditLog.findOne({ action: 'member.contact_change.applied' }).lean();
        expect(JSON.stringify(entry)).not.toContain('677001122');
    } finally {
        fetchMock.restore();
    }
});
