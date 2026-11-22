import crypto from 'crypto';
import request from 'supertest';
import config from '../config';
import { Agent } from '../database/models/agent.model';
import { AuditLog } from '../database/models/audit-log.model';
import { IdentityVerification } from '../database/models/identity-verification.model';
import { Ticket, TicketMessage } from '../database/models/ticket.model';
import { desk, FetchCall, getApp, login, makeAgent, memberToken, mockFetch, reauthToken, setupDb, teardown } from './helpers';

/** KYC level 3 (2026-11-22): ID + selfie, sent to the secondary server, reviewed by any support agent. */

const M1 = '6e2e00000000000000000e01';
const SECRET = 'k'.repeat(40);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(3000, 7)]);
const SELFIE = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), Buffer.alloc(3000, 9)]);

type Kyc = { id: string; ref: string; purpose: string; status: string; scores: any; decidedBy: string | null; imagesDeletedAt: string | null };
let worker: Record<string, Kyc>;
let f: { calls: FetchCall[]; restore: () => void };
let pushes: any[];

const signed = (c: FetchCall) => {
    const ts = c.headers['x-kyc-timestamp'];
    const expect = crypto.createHmac('sha256', SECRET).update(`${ts}.${JSON.stringify(c.body)}`).digest('hex');
    return c.headers['x-kyc-signature'] === expect;
};

function fakeWorker() {
    return {
        'kyc.test/v1/l3/submit': (c: FetchCall) => {
            if (!signed(c)) return { status: 401, json: {} };
            const id = crypto.randomBytes(16).toString('hex');
            worker[id] = { id, ref: c.body.ref, purpose: c.body.purpose, status: 'pending', scores: null, decidedBy: null, imagesDeletedAt: null };
            return { json: { id } };
        },
        'kyc.test/v1/l3/get': (c: FetchCall) => ({ json: { items: Object.fromEntries(c.body.ids.filter((i: string) => worker[i]).map((i: string) => [i, worker[i]])) } }),
        'kyc.test/v1/l3/image': (c: FetchCall) => (worker[c.body.id] && c.body.kind !== 'id_back' ? { raw: SELFIE, contentType: 'image/jpeg' } : { status: 404, json: {} }),
        'kyc.test/v1/l3/decide': (c: FetchCall) => {
            const k = worker[c.body.id];
            if (!['pending', 'checked'].includes(k.status)) return { status: 409, json: {} };
            Object.assign(k, { status: c.body.decision, decidedBy: c.body.by });
            return { json: k };
        },
        '/api/users/internal/support-details': (c: FetchCall) => ({ json: { success: true, data: (c.body?.userIds ?? []).map((id: string) => ({ _id: id, name: 'Awa Test', country: 'CM', email: 'awa@e2e.test' })) } }),
        '/api/users/internal/support/related': () => ({ json: { success: true, data: { related: false } } }),
        '/api/notifications': (c: FetchCall) => { pushes.push(c); return { json: { success: true } }; },
    };
}

beforeEach(async () => {
    await setupDb();
    worker = {};
    pushes = [];
    f = mockFetch(fakeWorker());
});
afterEach(() => f.restore());
afterAll(teardown);

const member = (method: 'get' | 'post', path: string, userId = M1) =>
    (request(getApp()) as any)[method](`/api/support/me${path}`).set('Authorization', `Bearer ${memberToken(userId)}`) as request.Test;

const send = (purpose = 'fraud_hold', userId = M1) =>
    member('post', '/identity-verifications', userId).field('purpose', purpose)
        .attach('id_front', JPG, { filename: 'recto.jpg', contentType: 'image/jpeg' })
        .attach('selfie', SELFIE, { filename: 'selfie.jpg', contentType: 'image/jpeg' });

describe('member sends an ID + selfie', () => {
    it('stored on the secondary server (signed, base64), a ticket opened, agents told; one at a time', async () => {
        const r = await send();
        expect(r.status).toBe(201);
        expect(r.body.data).toMatchObject({ purpose: 'fraud_hold', status: 'pending' });
        const call = f.calls.find((c) => c.url.endsWith('/v1/l3/submit'))!;
        expect(signed(call)).toBe(true);
        expect(call.body).toMatchObject({ ref: M1, purpose: 'fraud_hold' });
        expect(Buffer.from(call.body.images.selfie, 'base64').equals(SELFIE)).toBe(true);
        const v = await IdentityVerification.findOne({ memberId: M1 }).lean();
        expect(v).toMatchObject({ status: 'pending', country: 'CM', name: 'Awa Test', images: ['id_front', 'selfie'] });
        const t = await Ticket.findById(v!.ticketId).lean();
        expect(t).toMatchObject({ memberId: M1, category: 'retrait', subject: 'Vérification d’identité' });
        const notes = await TicketMessage.find({ ticketId: t!._id, internal: true }).lean();
        expect(notes.some((n) => /Identités/.test(n.body))).toBe(true);
        // nothing of the images kept here
        expect(JSON.stringify(v)).not.toContain(SELFIE.toString('base64').slice(0, 40));

        const again = await send();
        expect(again.status).toBe(409);
        expect(again.body.code).toBe('IDENTITY_PENDING');
        expect(f.calls.filter((c) => c.url.endsWith('/v1/l3/submit'))).toHaveLength(1);
        const latest = await member('get', '/identity-verifications/latest');
        expect(latest.body.data).toMatchObject({ status: 'pending', purpose: 'fraud_hold' });
        expect(JSON.stringify(latest.body.data)).not.toMatch(/hints|match|decidedBy/);
    });

    it('refuses a missing selfie, a non-image, an unknown purpose; nothing sent', async () => {
        expect((await member('post', '/identity-verifications').field('purpose', 'fraud_hold').attach('id_front', JPG, 'r.jpg')).status).toBe(400);
        const pdf = Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(3000)]);
        expect((await member('post', '/identity-verifications').field('purpose', 'fraud_hold').attach('id_front', JPG, 'r.jpg').attach('selfie', pdf, 's.jpg')).status).toBe(400);
        expect((await send('vip')).status).toBe(400);
        expect(f.calls.some((c) => c.url.includes('/v1/l3/submit'))).toBe(false);
    });

    it('secondary server not configured → 503, nothing stored', async () => {
        const saved = config.kyc.url;
        (config.kyc as any).url = '';
        try {
            const r = await send();
            expect(r.status).toBe(503);
            expect(r.body.code).toBe('KYC_NOT_CONNECTED');
            expect(await IdentityVerification.countDocuments()).toBe(0);
        } finally { (config.kyc as any).url = saved; }
    });
});

describe('desk review', () => {
    it('any support agent: list with hints, detail, image (audited, no-store), decision with reauth', async () => {
        await send('authenticator_reset');
        const kid = Object.keys(worker)[0];
        worker[kid].status = 'checked';
        worker[kid].scores = { engine: 'opencv-yunet-sface', match: { score: 0.21, same: false, threshold: 0.363 }, hints: ['faces_differ'], sameFaceOtherPeople: [{ request: 'x', ref: '6e2e00000000000000000e09', score: 0.6 }] };
        const a = await makeAgent(['support_agent']);
        const jar = await login(a);
        const list = await desk('get', '/identity', jar);
        expect(list.status).toBe(200);
        expect(list.body.data[0]).toMatchObject({ status: 'checked', purpose: 'authenticator_reset', matchScore: 0.21 });
        expect(list.body.data[0].hints[0].text).toMatch(/ne ressemble pas/);
        const id = list.body.data[0].id;

        const d = await desk('get', `/identity/${id}`, jar);
        expect(d.body.data.checks.sameFaceOtherPeople[0]).toEqual({ score: 0.6, memberId: '6e2e00000000000000000e09', guest: false });
        const img = await desk('get', `/identity/${id}/images/selfie`, jar);
        expect(img.status).toBe(200);
        expect(img.headers['content-type']).toBe('image/jpeg');
        expect(img.headers['cache-control']).toMatch(/no-store/);
        expect(Buffer.from(img.body).equals(SELFIE)).toBe(true);
        expect(await AuditLog.countDocuments({ action: 'identity.image.viewed', 'target.id': id })).toBe(1);
        expect((await desk('get', `/identity/${id}/images/id_back`, jar)).status).toBe(404);
        expect((await desk('get', `/identity/${id}/images/passport`, jar)).status).toBe(404);

        expect((await desk('post', `/identity/${id}/decision`, jar).send({ decision: 'approved', reason: 'Pièce et selfie concordants' })).status).toBe(401);
        const short = await desk('post', `/identity/${id}/decision`, jar, { 'x-reauth-token': await reauthToken(a, jar) }).send({ decision: 'approved', reason: 'ok' });
        expect(short.status).toBe(400);
        const ok = await desk('post', `/identity/${id}/decision`, jar, { 'x-reauth-token': await reauthToken(a, jar) }).send({ decision: 'approved', reason: 'Pièce et selfie concordants, vu en appel' });
        expect(ok.status).toBe(200);
        expect(ok.body.data).toMatchObject({ status: 'approved', decidedBy: { id: a.id } });
        expect(worker[kid]).toMatchObject({ status: 'approved', decidedBy: a.id });
        const v = await IdentityVerification.findById(id).lean();
        const visible = await TicketMessage.find({ ticketId: v!.ticketId, internal: false, 'author.type': 'system' }).lean();
        expect(visible.some((m) => /a été vérifiée/.test(m.body))).toBe(true);
        expect(pushes.some((c) => c.url.includes('/push/internal/send') && c.body.userId === M1)).toBe(true);
        expect(await AuditLog.countDocuments({ action: 'identity.approved', 'target.id': id })).toBe(1);

        const twice = await desk('post', `/identity/${id}/decision`, jar, { 'x-reauth-token': await reauthToken(a, jar) }).send({ decision: 'refused', reason: 'Changement d’avis tardif' });
        expect(twice.status).toBe(409);
        expect((await desk('get', '/identity', jar)).body.data).toHaveLength(0); // open ones only by default
        expect((await desk('get', '/identity?status=approved', jar)).body.data).toHaveLength(1);
    });

    it('a views verifier is refused; a country team outside the member country gets 404', async () => {
        await send();
        const id = String((await IdentityVerification.findOne().lean())!._id);
        const v = await makeAgent(['verifier']);
        expect((await desk('get', '/identity', await login(v))).status).toBe(403);
        const sn = await makeAgent(['support_agent']);
        await Agent.updateOne({ _id: sn.id }, { $set: { countries: ['SN'] } });
        const jar = await login(sn);
        expect((await desk('get', '/identity', jar)).body.data).toHaveLength(0);
        expect((await desk('get', `/identity/${id}`, jar)).status).toBe(404);
        expect((await desk('get', `/identity/${id}/images/selfie`, jar)).status).toBe(404);
    });

    it('an agent cannot decide on their own member account', async () => {
        await send();
        const id = String((await IdentityVerification.findOne().lean())!._id);
        const a = await makeAgent(['support_agent']);
        await Agent.updateOne({ _id: a.id }, { $set: { memberUserId: M1 } });
        const jar = await login(a);
        const r = await desk('post', `/identity/${id}/decision`, jar, { 'x-reauth-token': await reauthToken(a, jar) }).send({ decision: 'approved', reason: 'C’est bien moi, promis' });
        expect(r.status).toBe(403);
        expect(r.body.code).toBe('CONFLICT_OF_INTEREST');
        expect(f.calls.some((c) => c.url.endsWith('/v1/l3/decide'))).toBe(false);
    });
});

describe('guest (lost access)', () => {
    it('sends on its own request with its key; the decision is emailed with the chat link', async () => {
        const created = await request(getApp()).post('/api/support/public/tickets').send({
            category: 'compte_acces', subject: 'Je n’ai plus accès', message: 'J’ai perdu mon téléphone et mon email.',
            contact: { name: 'Awa', email: 'awa@e2e.test', phone: '+237690000000' },
        });
        expect(created.status).toBe(201);
        const { id: tid, key } = created.body.data;
        const up = (k: string) => request(getApp()).post(`/api/support/public/tickets/${tid}/identity-verification`).set('x-support-guest-key', k)
            .attach('id_front', JPG, 'r.jpg').attach('selfie', SELFIE, 's.jpg');
        expect((await up('wrong-key')).status).toBe(404);
        const r = await up(key);
        expect(r.status).toBe(201);
        expect(r.body.data).toMatchObject({ purpose: 'lost_access', status: 'pending', ticketId: tid });
        const call = f.calls.find((c) => c.url.endsWith('/v1/l3/submit'))!;
        expect(call.body.ref).toBe(`guest:${tid}`);

        const a = await makeAgent(['support_agent']);
        const jar = await login(a);
        const id = (await desk('get', '/identity', jar)).body.data[0].id;
        expect((await desk('get', '/identity', jar)).body.data[0]).toMatchObject({ guest: true, name: 'Awa' });
        const ok = await desk('post', `/identity/${id}/decision`, jar, { 'x-reauth-token': await reauthToken(a, jar) }).send({ decision: 'refused', reason: 'Selfie flou, à refaire' });
        expect(ok.status).toBe(200);
        const mail = pushes.find((c) => c.url.includes('/internal/create') && c.body.recipient === 'awa@e2e.test' && /identité/.test(JSON.stringify(c.body)));
        expect(mail).toBeTruthy();
        expect((await request(getApp()).get(`/api/support/public/tickets/${tid}/identity-verification`).set('x-support-guest-key', key)).body.data.status).toBe('refused');
    });
});
