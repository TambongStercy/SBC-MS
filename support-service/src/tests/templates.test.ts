import request from 'supertest';
import { cookieHeader, desk, getApp, login, makeAgent, ORIGIN, setupDb, teardown } from './helpers';

beforeEach(setupDb);
afterAll(teardown);

describe('ready-made replies', () => {
    it('keep their category, and a deleted one no longer comes back in the list', async () => {
        const jar = await login(await makeAgent(['support_admin']));
        const created = await desk('post', '/templates', jar).send({ title: 'Retrait en cours', body: 'Votre retrait est chez l’opérateur.', category: 'retrait', language: 'fr' });
        expect(created.status).toBe(201);
        expect(created.body.data.category).toBe('retrait');
        const id = created.body.data.id;

        const del = await (request(getApp()) as any).delete(`/api/support/desk/templates/${id}`)
            .set('Origin', ORIGIN).set('Cookie', cookieHeader(jar)).set('x-csrf-token', jar.sbc_sup_csrf);
        expect(del.status).toBeLessThan(300);

        const list = await desk('get', '/templates', jar);
        expect(list.body.data.map((t: any) => t.id)).not.toContain(id);
        // Still in the database, and visible on purpose to a manager who asks for it.
        const withDeleted = await desk('get', '/templates?includeInactive=1', jar);
        expect(withDeleted.body.data.map((t: any) => t.id)).toContain(id);
    });
});
