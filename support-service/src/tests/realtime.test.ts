import request from 'supertest';
import jwt from 'jsonwebtoken';
import config from '../config';
import { setRoomClientForTests } from '../services/realtime.service';
import { desk, getApp, login, makeAgent, memberToken, mockFetch, setupDb, teardown } from './helpers';

const MEMBER = '64b000000000000000000a01';
const member = (method: 'get' | 'post', path: string) =>
    (request(getApp()) as any)[method](`/api/support/me${path}`).set('Authorization', `Bearer ${memberToken(MEMBER)}`) as request.Test;

let sent: { room: string; payload: any; topic?: string }[] = [];
const saved = { ...config.livekit };

beforeEach(async () => {
    await setupDb();
    sent = [];
    Object.assign(config.livekit, { url: 'wss://live.test', httpUrl: 'https://live.test', apiKey: 'key-test', apiSecret: 'secret-test-secret-test-secret-test' });
    setRoomClientForTests({ sendData: async (room: string, data: Uint8Array, _kind: unknown, opts: any) => { sent.push({ room, payload: JSON.parse(new TextDecoder().decode(data)), topic: opts?.topic }); } } as any);
});
afterEach(() => { Object.assign(config.livekit, saved); setRoomClientForTests(null); });
afterAll(teardown);

const settle = () => new Promise((r) => setTimeout(r, 30));

describe('live ticket updates (LiveKit)', () => {
    it('is off without LiveKit settings: no token, nothing sent', async () => {
        Object.assign(config.livekit, { url: '', apiKey: '', apiSecret: '', httpUrl: '' });
        expect((await member('get', '/realtime/token')).body.data).toEqual({ enabled: false });
    });

    it('gives a member a listen-only token for their own room', async () => {
        const r = await member('get', '/realtime/token');
        expect(r.status).toBe(200);
        expect(r.body.data).toMatchObject({ enabled: true, url: 'wss://live.test', room: `support-member-${MEMBER}` });
        const claims: any = jwt.verify(r.body.data.token, 'secret-test-secret-test-secret-test');
        expect(claims.sub).toMatch(new RegExp(`^member:${MEMBER}#[0-9a-f]{8}$`));
        expect(claims.video).toMatchObject({ room: `support-member-${MEMBER}`, roomJoin: true, canSubscribe: true, canPublish: false, canPublishData: false });
        // A second tab or device gets its own identity, so the two never kick each other out.
        const again: any = jwt.verify((await member('get', '/realtime/token')).body.data.token, 'secret-test-secret-test-secret-test');
        expect(again.sub).not.toBe(claims.sub);
    });

    it('signals the desk and the member on a public reply, the desk only on an internal note; never any text', async () => {
        const f = mockFetch({ '127.0.0.1:9/api/notifications': () => ({ json: { success: true } }), '127.0.0.1:9/api/users': () => ({ json: { success: true, data: [] } }) });
        try {
            const created = await member('post', '/tickets').send({ category: 'retrait', subject: 'Retrait bloqué', message: 'Mon retrait est bloqué depuis hier.' });
            await settle();
            expect(sent.map((s) => s.room).sort()).toEqual(['support-desk', `support-member-${MEMBER}`]);
            const id = created.body.data.id;

            const jar = await login(await makeAgent(['support_agent']));
            const token = await desk('get', '/realtime/token', jar);
            expect(token.body.data.room).toBe('support-desk');

            sent = [];
            await desk('post', `/tickets/${id}/messages`, jar).send({ body: 'Vérifié chez MoneyFusion', internal: true });
            await settle();
            expect(sent.map((s) => s.room)).toEqual(['support-desk']);

            sent = [];
            await desk('post', `/tickets/${id}/messages`, jar).send({ body: 'Nous vérifions avec l’opérateur.', internal: false });
            await settle();
            expect(sent.map((s) => s.room).sort()).toEqual(['support-desk', `support-member-${MEMBER}`]);
            for (const s of sent) {
                expect(s.topic).toBe('support');
                expect(s.payload).toMatchObject({ type: 'ticket', ticketId: id, kind: 'message' });
                expect(JSON.stringify(s.payload)).not.toMatch(/opérateur|MoneyFusion/);
            }
        } finally {
            f.restore();
        }
    });

    it('marks the member’s messages read when an agent opens the ticket, once, and tells the member', async () => {
        const f = mockFetch({ '127.0.0.1:9/api/notifications': () => ({ json: { success: true } }), '127.0.0.1:9/api/users': () => ({ json: { success: true, data: [] } }) });
        try {
            const id = (await member('post', '/tickets').send({ category: 'retrait', subject: 'Retrait bloqué', message: 'Mon retrait est bloqué depuis hier.' })).body.data.id;
            expect((await member('get', `/tickets/${id}`)).body.data.agentReadAt).toBeNull();
            const jar = await login(await makeAgent(['support_agent']));

            sent = [];
            await desk('get', `/tickets/${id}`, jar);
            await settle();
            const read = (await member('get', `/tickets/${id}`)).body.data.agentReadAt;
            expect(read).toEqual(expect.any(String));
            expect(sent.filter((x) => x.payload.kind === 'read').map((x) => x.room).sort()).toEqual(['support-desk', `support-member-${MEMBER}`]);

            sent = [];
            await desk('get', `/tickets/${id}`, jar); // the desk reloads: nothing new to mark
            await settle();
            expect(sent.filter((x) => x.payload.kind === 'read')).toEqual([]);

            await new Promise((r) => setTimeout(r, 5));
            await member('post', `/tickets/${id}/messages`).send({ message: 'Toujours rien ce matin.' });
            sent = [];
            await desk('get', `/tickets/${id}`, jar);
            await settle();
            expect(sent.some((x) => x.payload.kind === 'read')).toBe(true);
            expect(new Date((await member('get', `/tickets/${id}`)).body.data.agentReadAt) > new Date(read)).toBe(true);
        } finally {
            f.restore();
        }
    });

    it('a request sent without an account has its own room, opened with its key', async () => {
        const f = mockFetch({ '127.0.0.1:9/api/notifications': () => ({ json: { success: true } }), '127.0.0.1:9/api/users': () => ({ json: { success: true, data: [] } }) });
        try {
            const created = await request(getApp()).post('/api/support/public/tickets').set('CF-Connecting-IP', '203.0.113.77').send({
                category: 'compte_acces', subject: 'Connexion impossible', message: 'Le code de connexion n’arrive jamais.',
                contact: { name: 'Awa', phone: '+237675090755', email: 'awa@example.com' },
            });
            const { id, key } = created.body.data;
            const tok = await request(getApp()).get(`/api/support/public/tickets/${id}/realtime/token`).set('x-support-guest-key', key);
            expect(tok.body.data).toMatchObject({ enabled: true, room: `support-guest-${id}` });
            expect((await request(getApp()).get(`/api/support/public/tickets/${id}/realtime/token`)).status).toBe(404);

            const jar = await login(await makeAgent(['support_agent']));
            sent = [];
            await desk('post', `/tickets/${id}/messages`, jar).send({ body: 'Nous regardons.', internal: false });
            await settle();
            expect(sent.map((x) => x.room).sort()).toEqual(['support-desk', `support-guest-${id}`]);
        } finally {
            f.restore();
        }
    });
});
