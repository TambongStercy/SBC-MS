import jwt from 'jsonwebtoken';
import config from '../config';
import { authenticateServiceRequest, authenticateServiceOrAdmin } from '../api/middleware/auth.middleware';

// The shared service secret is compared in constant time (secretEquals). These
// tests pin the behaviour: right secret passes, anything else is refused, and the
// service-or-admin gate still falls back to a signed-in admin.

const res = () => {
    const r: any = {};
    r.status = jest.fn(() => r);
    r.json = jest.fn(() => r);
    return r;
};
const req = (authorization?: string) => ({ headers: authorization ? { authorization } : {} }) as any;
const adminToken = () => jwt.sign({ userId: 'u1', email: 'a@example.com', role: 'admin' }, config.jwt.secret, { expiresIn: '5m' });
const memberToken = () => jwt.sign({ userId: 'u2', email: 'm@example.com', role: 'user' }, config.jwt.secret, { expiresIn: '5m' });

beforeAll(() => {
    config.services.serviceSecret = 'test-service-secret-0123456789';
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

describe('authenticateServiceRequest', () => {
    it('accepts the right secret', async () => {
        const next = jest.fn(); const r = res();
        await authenticateServiceRequest(req(`Bearer ${config.services.serviceSecret}`), r, next);
        expect(next).toHaveBeenCalled();
    });

    it.each([
        ['a wrong secret', 'Bearer wrong'],
        ['the secret with an extra character', `Bearer ${'test-service-secret-0123456789'}x`],
        ['a prefix of the secret', 'Bearer test-service-secret'],
        ['an empty token', 'Bearer '],
    ])('refuses %s', async (_label, header) => {
        const next = jest.fn(); const r = res();
        await authenticateServiceRequest(req(header), r, next);
        expect(next).not.toHaveBeenCalled();
        expect(r.status).toHaveBeenCalledWith(403);
    });

    it('refuses a missing header with 401', async () => {
        const next = jest.fn(); const r = res();
        await authenticateServiceRequest(req(), r, next);
        expect(next).not.toHaveBeenCalled();
        expect(r.status).toHaveBeenCalledWith(401);
    });

    it('refuses when no secret is configured', async () => {
        const saved = config.services.serviceSecret;
        config.services.serviceSecret = '';
        const next = jest.fn(); const r = res();
        await authenticateServiceRequest(req('Bearer '), r, next);
        expect(next).not.toHaveBeenCalled();
        config.services.serviceSecret = saved;
    });
});

describe('authenticateServiceOrAdmin', () => {
    it('accepts the right secret', () => {
        const next = jest.fn();
        authenticateServiceOrAdmin(req(`Bearer ${config.services.serviceSecret}`), res(), next);
        expect(next).toHaveBeenCalled();
    });

    it('accepts a signed-in admin', () => {
        const next = jest.fn();
        authenticateServiceOrAdmin(req(`Bearer ${adminToken()}`), res(), next);
        expect(next).toHaveBeenCalled();
    });

    it('refuses a member', () => {
        const next = jest.fn(); const r = res();
        authenticateServiceOrAdmin(req(`Bearer ${memberToken()}`), r, next);
        expect(next).not.toHaveBeenCalled();
        expect(r.status).toHaveBeenCalledWith(403);
    });

    it('refuses a wrong secret', () => {
        const next = jest.fn(); const r = res();
        authenticateServiceOrAdmin(req('Bearer not-the-secret'), r, next);
        expect(next).not.toHaveBeenCalled();
        expect(r.status).toHaveBeenCalledWith(401);
    });
});
