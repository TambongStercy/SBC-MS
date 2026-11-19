import request from 'supertest';
import config from '../config';
import { getApp, memberToken, mockFetch, setupDb, teardown } from './helpers';

const MEMBER = '64b000000000000000000a21';
const saved = { ...config.ntfy };
beforeEach(setupDb);
afterEach(() => Object.assign(config.ntfy, saved));
afterAll(teardown);
const settle = () => new Promise((r) => setTimeout(r, 30));

describe('phone notification (ntfy) for each new request', () => {
    it('sends the request’s number, category, priority, name and text — never a phone or email', async () => {
        Object.assign(config.ntfy, { url: 'https://ntfy.test', topic: 'sbc-support-tests', token: 'tk' });
        const f = mockFetch({
            'ntfy.test': () => ({ json: { id: 'x' } }),
            '127.0.0.1:9/api/notifications': () => ({ json: { success: true } }),
            '127.0.0.1:9/api/users': () => ({ json: { success: true, data: [] } }),
        });
        try {
            const r = await request(getApp()).post('/api/support/me/tickets').set('Authorization', `Bearer ${memberToken(MEMBER)}`).send({
                category: 'retrait', subject: 'Retrait bloqué depuis hier', message: 'Mon retrait de ce matin est toujours en attente.',
                contact: { name: 'Jean Kamga', phone: '+237675090755', email: 'jean@example.com' },
            });
            expect(r.status).toBe(201);
            await settle();
            const sent = f.calls.filter((c) => c.url.startsWith('https://ntfy.test'));
            expect(sent).toHaveLength(1);
            expect(sent[0].headers.authorization).toBe('Bearer tk');
            expect(sent[0].body).toMatchObject({
                topic: 'sbc-support-tests', priority: 4, tags: ['warning', 'retrait'],
                title: expect.stringMatching(/^Nouvelle demande SUP-\d+ · Retrait$/),
                click: expect.stringMatching(/\/tickets\/[0-9a-f]{24}$/),
            });
            expect(sent[0].body.message).toContain('Jean Kamga (Membre)');
            expect(sent[0].body.message).toContain('« Retrait bloqué depuis hier »');
            expect(sent[0].body.message).toContain('toujours en attente');
            expect(JSON.stringify(sent[0].body)).not.toMatch(/675090755|jean@example\.com/);
        } finally {
            f.restore();
        }
    });

    it('sends nothing without NTFY_URL / NTFY_TOPIC, and the request is still created', async () => {
        Object.assign(config.ntfy, { url: '', topic: '', token: '' });
        const f = mockFetch({ '127.0.0.1:9/api/notifications': () => ({ json: { success: true } }), '127.0.0.1:9/api/users': () => ({ json: { success: true, data: [] } }) });
        try {
            const r = await request(getApp()).post('/api/support/me/tickets').set('Authorization', `Bearer ${memberToken(MEMBER)}`).send({ category: 'autre', subject: 'Une question', message: 'Une question sur mon compte.' });
            expect(r.status).toBe(201);
            await settle();
            expect(f.calls.some((c) => c.url.includes('ntfy'))).toBe(false);
        } finally {
            f.restore();
        }
    });
});
