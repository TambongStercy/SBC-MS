import request from 'supertest';
import jwt from 'jsonwebtoken';
import { authenticator } from 'otplib';
import { AgentSession } from '../database/models/agent-session.model';
import { AuditLog } from '../database/models/audit-log.model';
import { Agent } from '../database/models/agent.model';
import { redis } from '../lib/redis';
import {
    csrfJar, desk, getApp, login, makeAgent, memberToken, mockFetch, PASSWORD, readCookies, reauthToken, setupDb, teardown, totp, cookieHeader, ORIGIN,
} from './helpers';

let fetchMock: ReturnType<typeof mockFetch>;

beforeEach(async () => {
    await setupDb();
    // Alert emails go to a mocked notification-service.
    fetchMock = mockFetch({ '127.0.0.1:9/api/notifications': () => ({ json: { success: true } }) });
});
afterEach(() => fetchMock.restore());
afterAll(teardown);

describe('login', () => {
    it('answers unknown email, wrong password and disabled account identically, with the same minimum delay', async () => {
        const ok = await makeAgent(['support_agent']);
        const disabled = await makeAgent(['support_agent'], { status: 'disabled' });
        const jar = await csrfJar();
        const attempts = [
            { email: 'nobody@agents.test', password: PASSWORD },
            { email: ok.email, password: 'wrong-password-123' },
            { email: disabled.email, password: PASSWORD },
        ];
        const answers = [];
        for (const a of attempts) {
            const start = Date.now();
            const r = await desk('post', '/auth/login', jar).send(a);
            answers.push({ status: r.status, body: r.body, ms: Date.now() - start });
        }
        for (const a of answers) {
            expect(a.status).toBe(401);
            expect(a.body).toEqual(answers[0].body);
            expect(a.body.code).toBe('INVALID_CREDENTIALS');
            expect(a.ms).toBeGreaterThanOrEqual(55);
        }
    });

    it('locks the account after 5 failures: even the right password is then refused, and the lock is audited and alerted', async () => {
        const a = await makeAgent(['support_agent']);
        const jar = await csrfJar();
        for (let i = 0; i < 5; i++) {
            const r = await desk('post', '/auth/login', jar).send({ email: a.email, password: `wrong-${i}-password` });
            expect(r.status).toBe(401);
        }
        const r = await desk('post', '/auth/login', jar).send({ email: a.email, password: PASSWORD });
        expect(r.status).toBe(401);
        expect(r.body.code).toBe('INVALID_CREDENTIALS');
        await new Promise((res) => setTimeout(res, 100));
        expect(await AuditLog.countDocuments({ action: 'auth.lockout', 'target.id': a.id })).toBe(1);
        const keys = await redis().keys('sbc-support:test:loginlock:*');
        expect(keys.length).toBe(1);
        expect(await redis().ttl(keys[0])).toBeGreaterThan(14 * 60);
        // The agent was warned by email (mocked notification-service).
        expect(fetchMock.calls.some((c) => c.url.includes('/internal/create') && c.body?.recipient === a.email)).toBe(true);
    });
});

describe('TOTP', () => {
    it('gives the same key to two enrolment starts sent at once, and accepts a code from it', async () => {
        const a = await makeAgent(['support_agent'], { enrolled: false });
        const jar = await csrfJar();
        const l = await desk('post', '/auth/login', jar).send({ email: a.email, password: PASSWORD });
        const challengeId = l.body.data.challengeId;
        const [s1, s2] = await Promise.all([
            desk('post', '/auth/enroll/start', jar).send({ challengeId }),
            desk('post', '/auth/enroll/start', jar).send({ challengeId }),
        ]);
        const k1 = new URL(s1.body.data.otpauthUrl).searchParams.get('secret')!;
        const k2 = new URL(s2.body.data.otpauthUrl).searchParams.get('secret')!;
        expect(k1).toBe(k2);
        const conf = await desk('post', '/auth/enroll/confirm', jar).send({ challengeId, code: authenticator.generate(k1) });
        expect(conf.status).toBe(200);
    });

    it('enrols at first sign-in, then accepts each backup code only once', async () => {
        const a = await makeAgent(['support_agent'], { enrolled: false });
        const jar = await csrfJar();
        const l = await desk('post', '/auth/login', jar).send({ email: a.email, password: PASSWORD });
        expect(l.body.data.step).toBe('enroll');
        const start = await desk('post', '/auth/enroll/start', jar).send({ challengeId: l.body.data.challengeId });
        expect(start.status).toBe(200);
        expect(start.body.data.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
        expect(start.body.data.qrDataUrl).toMatch(/^data:image\/png;base64,/);
        const secret = new URL(start.body.data.otpauthUrl).searchParams.get('secret')!;

        const bad = await desk('post', '/auth/enroll/confirm', jar).send({ challengeId: l.body.data.challengeId, code: '000000' });
        expect(bad.status).toBe(401);
        const conf = await desk('post', '/auth/enroll/confirm', jar).send({ challengeId: l.body.data.challengeId, code: authenticator.generate(secret) });
        expect(conf.status).toBe(200);
        expect(conf.body.data.backupCodes).toHaveLength(10);
        readCookies(conf, jar);
        expect(jar.sbc_sup_at).toBeTruthy();
        expect(jar.sbc_sup_rt).toBeTruthy();
        const stored = await Agent.findById(a.id).lean();
        expect(stored!.totp.secretEnc).not.toContain(secret); // encrypted at rest
        expect(JSON.stringify(stored!.backupCodes)).not.toContain(conf.body.data.backupCodes[0]);

        const backup = conf.body.data.backupCodes[0];
        const l2 = await desk('post', '/auth/login', jar).send({ email: a.email, password: PASSWORD });
        expect(l2.body.data.step).toBe('totp');
        const ok = await desk('post', '/auth/totp', jar).send({ challengeId: l2.body.data.challengeId, backupCode: backup.toLowerCase() });
        expect(ok.status).toBe(200);
        expect(ok.body.data.backupCodesRemaining).toBe(9);

        const l3 = await desk('post', '/auth/login', jar).send({ email: a.email, password: PASSWORD });
        const again = await desk('post', '/auth/totp', jar).send({ challengeId: l3.body.data.challengeId, backupCode: backup });
        expect(again.status).toBe(401);
    });

    it('refuses the same TOTP code twice (replay) and a reused challenge', async () => {
        const a = await makeAgent(['support_agent']);
        const jar = await csrfJar();
        const code = await totp(a);
        const l1 = await desk('post', '/auth/login', jar).send({ email: a.email, password: PASSWORD });
        expect((await desk('post', '/auth/totp', jar).send({ challengeId: l1.body.data.challengeId, code })).status).toBe(200);
        const l2 = await desk('post', '/auth/login', jar).send({ email: a.email, password: PASSWORD });
        expect((await desk('post', '/auth/totp', jar).send({ challengeId: l2.body.data.challengeId, code })).status).toBe(401);
        expect((await desk('post', '/auth/totp', jar).send({ challengeId: l1.body.data.challengeId, code: await totp(a) })).status).toBe(401);
    });
});

describe('sessions', () => {
    it('rotates the refresh token, and a reused one revokes every session of the agent', async () => {
        const a = await makeAgent(['support_agent']);
        const jar1 = await login(a);
        const jar2 = await login(a); // a second device
        const oldRt = jar1.sbc_sup_rt;

        const r1 = await desk('post', '/auth/refresh', jar1);
        expect(r1.status).toBe(200);
        readCookies(r1, jar1);
        expect(jar1.sbc_sup_rt).not.toBe(oldRt);

        const replay = await desk('post', '/auth/refresh', { ...jar1, sbc_sup_rt: oldRt });
        expect(replay.status).toBe(401);
        expect(await AgentSession.countDocuments({ agentId: a.id, revokedAt: null })).toBe(0);
        expect(await AuditLog.countDocuments({ action: 'auth.refresh_reuse' })).toBe(1);
        // Both devices are signed out, including the newest refresh token.
        expect((await desk('post', '/auth/refresh', jar1)).status).toBe(401);
        expect((await desk('get', '/auth/me', jar2)).status).toBe(401);
    });

    it('ends a session idle for more than 30 minutes', async () => {
        const a = await makeAgent(['support_agent']);
        const jar = await login(a);
        expect((await desk('get', '/auth/me', jar)).status).toBe(200);
        await AgentSession.updateMany({ agentId: a.id }, { $set: { lastActivityAt: new Date(Date.now() - 31 * 60_000) } });
        expect((await desk('get', '/auth/me', jar)).status).toBe(401);
        expect((await desk('post', '/auth/refresh', jar)).status).toBe(401);
    });

    it('refuses a mutation without the CSRF header, or from another origin', async () => {
        const a = await makeAgent(['support_agent']);
        const jar = await login(a);
        const noHeader = await request(getApp()).post('/api/support/desk/auth/logout').set('Origin', ORIGIN).set('Cookie', cookieHeader(jar));
        expect(noHeader.status).toBe(403);
        expect(noHeader.body.code).toBe('CSRF_REFUSED');
        const wrongToken = await desk('post', '/auth/logout', jar, { 'x-csrf-token': 'forged-token-value' });
        expect(wrongToken.status).toBe(403);
        const evil = await request(getApp()).post('/api/support/desk/auth/logout')
            .set('Origin', 'https://evil.example').set('Cookie', cookieHeader(jar)).set('x-csrf-token', jar.sbc_sup_csrf);
        expect(evil.status).toBe(403);
        expect(evil.body.code).toBe('ORIGIN_REFUSED');
        // The session is still alive.
        expect((await desk('get', '/auth/me', jar)).status).toBe(200);
    });

    it('refuses a member token on /desk, as bearer or as the session cookie', async () => {
        const token = memberToken();
        const bearer = await request(getApp()).get('/api/support/desk/auth/me').set('Authorization', `Bearer ${token}`);
        expect(bearer.status).toBe(401);
        const cookie = await request(getApp()).get('/api/support/desk/auth/me').set('Cookie', `sbc_sup_at=${token}`);
        expect(cookie.status).toBe(401);
        // Even a token signed with the member secret but claiming the support audience.
        const forged = jwt.sign({ sid: 'x', roles: ['support_admin'] }, process.env.JWT_SECRET!, { subject: 'x', audience: 'sbc-support', issuer: 'sbc-support' });
        expect((await request(getApp()).get('/api/support/desk/tickets').set('Cookie', `sbc_sup_at=${forged}`)).status).toBe(401);
    });

    it('requires a fresh, single-use reauth token for sensitive actions', async () => {
        const admin = await makeAgent(['support_admin']);
        const jar = await login(admin);
        const body = { email: 'new.agent@agents.test', name: 'Nouvel Agent', roles: ['support_agent'], delivery: 'manual' };
        const without = await desk('post', '/agents', jar).send(body);
        expect(without.status).toBe(401);
        expect(without.body.code).toBe('REAUTH_REQUIRED');
        const token = await reauthToken(admin, jar);
        const ok = await desk('post', '/agents', jar, { 'x-reauth-token': token }).send(body);
        expect(ok.status).toBe(201);
        expect(ok.body.data.activationUrl).toMatch(/^https:\/\/support\.test\/activate#/);
        const reused = await desk('post', '/agents', jar, { 'x-reauth-token': token }).send({ ...body, email: 'other@agents.test' });
        expect(reused.status).toBe(401);

        // The activation link sets a password once; common passwords are refused.
        const activationToken = ok.body.data.activationUrl.split('#')[1];
        const pub = await csrfJar();
        const weak = await desk('post', '/auth/activate', pub).send({ token: activationToken, password: 'password1234' });
        expect(weak.status).toBe(400);
        expect(weak.body.code).toBe('WEAK_PASSWORD');
        const good = await desk('post', '/auth/activate', pub).send({ token: activationToken, password: 'Tres-Longue-Phrase-Secrete-77' });
        expect(good.status).toBe(200);
        const twice = await desk('post', '/auth/activate', pub).send({ token: activationToken, password: 'Tres-Longue-Phrase-Secrete-78' });
        expect(twice.status).toBe(400);
    });
});
