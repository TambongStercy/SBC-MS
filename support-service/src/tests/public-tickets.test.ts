import request from 'supertest';
import config from '../config';
import { Ticket } from '../database/models/ticket.model';
import { desk, getApp, login, makeAgent, memberToken, mockFetch, setupDb, teardown } from './helpers';

const report = (body: Record<string, unknown>, ip = '203.0.113.7') =>
    request(getApp()).post('/api/support/public/tickets').set('CF-Connecting-IP', ip).send(body);
const valid = {
    category: 'compte_acces', subject: 'Je ne peux plus me connecter', message: 'Mon code de connexion n’arrive jamais par email.',
    contact: { name: 'Awa Diallo', phone: '+237 6 75 09 07 55', email: 'Awa.Diallo@Example.com' },
};

let sent: { url: string; body: any }[] = [];
let f: { restore: () => void };
beforeEach(async () => {
    await setupDb();
    sent = [];
    f = mockFetch({
        '127.0.0.1:9/api/notifications': (call) => { sent.push({ url: call.url, body: call.body }); return { json: { success: true } }; },
        '127.0.0.1:9/api/users': () => ({ json: { success: true, data: [] } }),
    });
});
afterEach(() => { f.restore(); });
afterAll(teardown);

describe('« Signaler un problème » without an account', () => {
    it('creates a request with the contact details, shown to agents as unverified', async () => {
        const r = await report(valid);
        expect(r.status).toBe(201);
        expect(r.body.data).toEqual({ id: expect.any(String), number: expect.stringMatching(/^SUP-/), key: expect.any(String) });

        const t = await Ticket.findOne({ source: 'public' }).lean();
        expect(t).toMatchObject({ memberId: null, contact: { name: 'Awa Diallo', phone: '+237 6 75 09 07 55', email: 'awa.diallo@example.com' } });

        const jar = await login(await makeAgent(['support_agent']));
        const d = await desk('get', `/tickets/${t!._id}`, jar);
        expect(d.body.data.ticket).toMatchObject({
            source: 'public', member: { id: null, name: 'Awa Diallo' },
            contact: { name: 'Awa Diallo', email: 'awa.diallo@example.com', verified: false },
        });
        expect((await desk('get', '/tickets?status=active', jar)).body.data.items[0].member).toEqual({ id: null, name: 'Awa Diallo' });
    });

    it('asks for name, phone and a valid email', async () => {
        expect((await report({ ...valid, contact: { ...valid.contact, email: '' } })).body.code).toBe('BAD_CONTACT_EMAIL');
        expect((await report({ ...valid, contact: { ...valid.contact, email: 'awa@' } })).body.code).toBe('BAD_CONTACT_EMAIL');
        expect((await report({ ...valid, contact: { ...valid.contact, phone: '12' } })).body.code).toBe('BAD_CONTACT_PHONE');
        expect((await report({ ...valid, contact: { ...valid.contact, name: '' } })).body.code).toBe('BAD_CONTACT_NAME');
        expect(await Ticket.countDocuments()).toBe(0);
    });

    it('ignores bots (hidden field) and limits each IP', async () => {
        const bot = await report({ ...valid, website: 'https://spam.test' });
        expect(bot.status).toBe(201);
        expect(await Ticket.countDocuments()).toBe(0);

        for (let i = 0; i < 3; i++) expect((await report(valid, '198.51.100.9')).status).toBe(201);
        const fourth = await report(valid, '198.51.100.9');
        expect(fourth.status).toBe(429);
        expect((await report(valid, '198.51.100.10')).status).toBe(201);
    });

    it('emails the agent’s reply to the address given (never an internal note)', async () => {
        await report(valid);
        const t = (await Ticket.findOne({ source: 'public' }).lean())!;
        const jar = await login(await makeAgent(['support_agent']));
        sent = [];
        await desk('post', `/tickets/${t._id}/messages`, jar).send({ body: 'Vérifié chez nous, rien d’anormal.', internal: true });
        expect(sent.filter((s) => s.body.channel === 'email')).toEqual([]);

        await desk('post', `/tickets/${t._id}/messages`, jar).send({ body: 'Votre compte est débloqué, reconnectez-vous.', internal: false });
        const mail = sent.find((s) => s.body.channel === 'email');
        expect(mail?.body).toMatchObject({ recipient: 'awa.diallo@example.com', userId: '000000000000000000000000' });
        // The email reopens the chat: the key after « # » never reaches a server.
        expect(mail?.body.data.body).toMatch(new RegExp(`/signaler-un-probleme/suivi/${t._id}#k=[A-Za-z0-9_-]{40,}`));
        expect(mail?.body.data.body).toContain('Votre compte est débloqué, reconnectez-vous.');
        expect(mail?.body.data.subject).toContain(t.number);
    });
});

describe('the chat of a request sent without an account', () => {
    const chat = (method: 'get' | 'post', id: string, path = '', key?: string) => {
        const r = (request(getApp()) as any)[method](`/api/support/public/tickets/${id}${path}`).set('CF-Connecting-IP', '203.0.113.50');
        return (key ? r.set('x-support-guest-key', key) : r) as request.Test;
    };

    it('opens only with its key, and the person chats with the agent like a member', async () => {
        const { id, key } = (await report(valid)).body.data;
        const other = (await report({ ...valid, contact: { ...valid.contact, email: 'autre@example.com' } }, '203.0.113.8')).body.data;

        const open = await chat('get', id, '', key);
        expect(open.status).toBe(200);
        expect(open.body.data.messages.map((m: any) => m.body)).toEqual([valid.message]);
        expect((await chat('get', id)).status).toBe(404);
        expect((await chat('get', id, '', 'x'.repeat(43))).status).toBe(404);
        expect((await chat('get', id, '', other.key)).status).toBe(404);
        // what browsers send (no extra CORS header needed)
        expect((await request(getApp()).get(`/api/support/public/tickets/${id}`).set('Authorization', `SupportKey ${key}`)).status).toBe(200);
        expect((await request(getApp()).get(`/api/support/public/tickets/${id}`).set('Authorization', `SupportKey ${other.key}`)).status).toBe(404);
        // and never through a member's account
        expect((await request(getApp()).get(`/api/support/me/tickets/${id}`).set('Authorization', `Bearer ${memberToken('64b000000000000000000a09')}`)).status).toBe(404);

        const jar = await login(await makeAgent(['support_agent']));
        await desk('post', `/tickets/${id}/messages`, jar).send({ body: 'Quel téléphone utilisez-vous ?', internal: false });
        await desk('post', `/tickets/${id}/messages`, jar).send({ body: 'Note pour l’équipe.', internal: true });
        expect((await chat('get', id, '', key)).body.data.messages.map((m: any) => m.body)).toEqual([valid.message, 'Quel téléphone utilisez-vous ?']);

        const up = await chat('post', id, '/attachments', key).attach('file', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]), { filename: 'capture.png', contentType: 'image/png' });
        expect(up.status).toBe(201);
        const reply = await chat('post', id, '/messages', key).send({ message: 'Un Samsung A12.', attachmentIds: [up.body.data.id] });
        expect(reply.status).toBe(200);
        expect(reply.body.data.messages.at(-1)).toMatchObject({ body: 'Un Samsung A12.', author: { type: 'member', name: 'Awa Diallo' }, attachments: [{ filename: 'capture.png' }] });
        expect(reply.body.data.status).toBe('ouvert');

        expect((await chat('post', id, '/close', key)).status).toBe(200);
        expect((await chat('post', id, '/messages', key).send({ message: 'Encore moi' })).body.code).toBe('TICKET_CLOSED');
    });
});

describe('contact details from a signed-in member', () => {
    it('are kept with the request, optional, and checked', async () => {
        const member = (body: object) => request(getApp()).post('/api/support/me/tickets').set('Authorization', `Bearer ${memberToken('64b000000000000000000a05')}`).send(body);
        const base = { category: 'retrait', subject: 'Retrait bloqué', message: 'Mon retrait est bloqué depuis hier.' };
        expect((await member({ ...base, contact: { name: 'Jean', phone: '+237675090755', email: 'jean@example.com' } })).status).toBe(201);
        expect((await member(base)).status).toBe(201);
        expect((await member({ ...base, contact: { email: 'pas-un-email' } })).body.code).toBe('BAD_CONTACT_EMAIL');
        const kept = await Ticket.find({ memberId: '64b000000000000000000a05' }).sort({ createdAt: 1 }).lean();
        expect(kept.map((t) => t.contact)).toEqual([{ name: 'Jean', phone: '+237675090755', email: 'jean@example.com' }, null]);
    });
});
