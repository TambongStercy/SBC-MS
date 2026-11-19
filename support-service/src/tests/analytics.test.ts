import request from 'supertest';
import config from '../config';
import { AuditLog } from '../database/models/audit-log.model';
import { ClientErrorType } from '../database/models/client-error.model';
import { cleanMessage, normalizeRoute } from '../services/client-error.service';
import { desk, getApp, login, makeAgent, memberToken, mockFetch, setupDb, teardown } from './helpers';

const M1 = '64b000000000000000000b01';
const M2 = '64b000000000000000000b02';
const asMember = (who: string, method: 'get' | 'post', path: string) =>
    (request(getApp()) as any)[method](`/api/support/me${path}`).set('Authorization', `Bearer ${memberToken(who)}`) as request.Test;

let f: { restore: () => void };
beforeEach(async () => {
    await setupDb();
    f = mockFetch({ '127.0.0.1:9/api/notifications': () => ({ json: { success: true } }), '127.0.0.1:9/api/users': () => ({ json: { success: true, data: [] } }) });
});
afterEach(() => { f.restore(); config.openreplay.dashboardUrl = ''; });
afterAll(teardown);

describe('technical errors reported by the member app', () => {
    it('one type per call whatever the id, without personal data', () => {
        expect(normalizeRoute('/api/support/me/tickets/6afe3807894cae3a21143cfb?x=1')).toBe('/api/support/me/tickets/:id');
        expect(normalizeRoute('/api/payments/intents/abcdefghijklmnopqrstuv/status')).toBe('/api/payments/intents/:id/status');
        expect(normalizeRoute('https://evil.test/x')).toBeNull();
        expect(cleanMessage('Le numéro +237 675 09 07 55 de jean@gmail.com est déjà utilisé')).toBe('Le numéro +••• de •@• est déjà utilisé');
    });

    it('counts occurrences and members per type, ignores junk, and refuses huge batches', async () => {
        const err = (status: number, path = '/api/support/me/tickets/6afe3807894cae3a21143cfb') => ({ method: 'GET', path, status, message: 'Demande introuvable.' });
        expect((await asMember(M1, 'post', '/client-errors').send({ errors: [err(404), err(404), err(500, '/api/payments/x'), { method: 'GET', path: '/api/x', status: 200 }, err(404, '/api/support/me/client-errors')] })).body.data).toEqual({ recorded: 3 });
        await asMember(M2, 'post', '/client-errors').send({ errors: [err(404, '/api/support/me/tickets/6afe3807894cae3a21143cfc')] });
        const t = await ClientErrorType.findOne({ route: '/api/support/me/tickets/:id', status: 404 }).lean();
        expect(t).toMatchObject({ method: 'GET', total: 3, state: 'open', lastMessage: 'Demande introuvable.' });
        expect(await ClientErrorType.countDocuments()).toBe(2);
        expect((await asMember(M1, 'post', '/client-errors').send({ errors: Array.from({ length: 21 }, () => err(500)) })).status).toBe(400);
    });

    it('a type marked fixed that comes back is reopened as a regression (audited)', async () => {
        await asMember(M1, 'post', '/client-errors').send({ errors: [{ method: 'POST', path: '/api/payments/intents', status: 502 }] });
        const t = (await ClientErrorType.findOne({}).lean())!;
        const admin = await login(await makeAgent(['support_admin']));
        expect((await desk('post', `/analytics/errors/${t._id}/state`, admin).send({ state: 'resolved', note: 'Correctif déployé' })).status).toBe(200);
        expect(await AuditLog.countDocuments({ action: 'client_error.state' })).toBe(1);
        const agent = await login(await makeAgent(['support_agent']));
        expect((await desk('post', `/analytics/errors/${t._id}/state`, agent).send({ state: 'open' })).status).toBe(403);

        await asMember(M2, 'post', '/client-errors').send({ errors: [{ method: 'POST', path: '/api/payments/intents', status: 502 }] });
        expect(await ClientErrorType.findById(t._id).lean()).toMatchObject({ state: 'open', regressions: 1 });
    });
});

describe('analytics for the support administrator', () => {
    it('gives the KPIs of the period, the daily series, recurring categories and errors', async () => {
        const mk = (category: string, subject: string) => asMember(M1, 'post', '/tickets').send({ category, subject, message: 'Le problème décrit en quelques mots.' });
        const a = (await mk('retrait', 'Retrait bloqué')).body.data.id;
        await mk('retrait', 'Retrait pas reçu');
        await mk('technique', 'Écran blanc');
        await asMember(M2, 'post', '/client-errors').send({ errors: [{ method: 'GET', path: '/api/users/me', status: 500, message: 'Erreur interne' }] });

        const admin = await login(await makeAgent(['support_admin']));
        await desk('post', `/tickets/${a}/messages`, admin).send({ body: 'Nous regardons.', internal: false });
        await desk('post', `/tickets/${a}/status`, admin).send({ status: 'resolved', reason: 'Payé chez l’opérateur' });

        const r = await desk('get', '/analytics', admin);
        expect(r.status).toBe(200);
        const d = r.body.data;
        expect(d.kpis.tickets).toMatchObject({ created: 3, handled: 1, handledOfCreatedRate: 33.3 });
        expect(d.kpis.tickets.firstResponseMedianMin).toEqual(expect.any(Number));
        expect(d.kpis.backlog).toMatchObject({ now: 2, unassigned: 2 });
        expect(d.categories[0]).toMatchObject({ key: 'retrait', count: 2, share: 66.7 });
        expect(d.series.length).toBe(d.period.days);
        const today = d.series[d.series.length - 1];
        expect(today).toMatchObject({ created: 3, handled: 1, backlog: 2, errorsServer: 1 });
        expect(d.kpis.errors).toMatchObject({ total: 1, membersAffected: 1, typesOpen: 1 });
        expect(d.errorTypes[0]).toMatchObject({ method: 'GET', route: '/api/users/me', status: 500, count: 1, members: 1, state: 'open' });
        expect(d.agents[0]).toMatchObject({ handled: 1 });
        expect(d.insights.length).toBeGreaterThan(0);

        const agent = await login(await makeAgent(['support_agent']));
        expect((await desk('get', '/analytics', agent)).status).toBe(403);
    });

    it('opens a member session that hit an error only through an audited call', async () => {
        config.openreplay.dashboardUrl = 'https://replay.sbc.test';
        await asMember(M1, 'post', '/client-errors').send({ errors: [{ method: 'GET', path: '/api/users/me', status: 500, replay: { sessionId: '99', url: 'https://replay.sbc.test/1/session/99' } }] });
        const t = (await ClientErrorType.findOne({}).lean())!;
        const admin = await login(await makeAgent(['support_admin']));
        const r = await desk('post', `/analytics/errors/${t._id}/replay`, admin);
        expect(r.body.data.url).toBe('https://replay.sbc.test/1/session/99');
        expect(await AuditLog.countDocuments({ action: 'client_error.replay.opened' })).toBe(1);
    });
});
