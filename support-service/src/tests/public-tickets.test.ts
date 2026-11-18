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
afterEach(() => { f.restore(); config.turnstileSecret = ''; });
afterAll(teardown);

describe('« Signaler un problème » without an account', () => {
    it('creates a request with the contact details, shown to agents as unverified', async () => {
        const r = await report(valid);
        expect(r.status).toBe(201);
        expect(r.body.data).toEqual({ number: expect.stringMatching(/^SUP-/) });

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

    it('requires the anti-robot check when Turnstile is configured', async () => {
        config.turnstileSecret = 'ts-secret';
        f.restore();
        f = mockFetch({ 'challenges.cloudflare.com': () => ({ json: { success: false } }) });
        const r = await report(valid);
        expect(r.status).toBe(400);
        expect(r.body.code).toBe('TURNSTILE_FAILED');
        expect(await Ticket.countDocuments()).toBe(0);
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
        expect(mail?.body.data.body).toContain('Votre compte est débloqué, reconnectez-vous.');
        expect(mail?.body.data.subject).toContain(t.number);
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
