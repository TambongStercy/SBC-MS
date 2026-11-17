import { describe, expect, it, vi } from 'vitest';
import { api, ApiError, onSessionExpired, request } from './http';
import { mockApi } from '../test/mockApi';

const setCsrf = (v = 'csrf-123') => { document.cookie = `sbc_sup_csrf=${v}; path=/`; };

describe('http client', () => {
  it('sends x-csrf-token from the sbc_sup_csrf cookie on every mutation, with credentials', async () => {
    setCsrf();
    const m = mockApi({ 'POST /tickets/t1/messages': { data: { id: 'm1' } }, 'PUT /templates/x': { data: {} }, 'DELETE /templates/x': { data: null }, 'PATCH /a': { data: null } });
    await api.post('/tickets/t1/messages', { body: 'hi', internal: false });
    await api.put('/templates/x', {});
    await api.del('/templates/x');
    await api.patch('/a', {});
    for (const c of m.calls) {
      expect(c.headers.get('x-csrf-token')).toBe('csrf-123');
      expect(c.credentials).toBe('include');
    }
  });

  it('does not send the CSRF header on GET', async () => {
    setCsrf();
    const m = mockApi({ 'GET /tickets': { data: { items: [], total: 0, page: 1, limit: 20 } } });
    await api.get('/tickets', { status: 'open', q: '' });
    expect(m.calls[0].headers.has('x-csrf-token')).toBe(false);
    expect(m.calls[0].credentials).toBe('include');
    expect(m.calls[0].query.get('status')).toBe('open');
    expect(m.calls[0].query.has('q')).toBe(false);
  });

  it('primes the CSRF cookie with GET /auth/csrf when it is missing', async () => {
    const m = mockApi({
      'GET /auth/csrf': () => { setCsrf('fresh'); return { data: null }; },
      'POST /auth/login': { data: { step: 'totp', challengeId: 'c' } },
    });
    await api.post('/auth/login', { email: 'a', password: 'b' });
    expect(m.calls.map(c => `${c.method} ${c.path}`)).toEqual(['GET /auth/csrf', 'POST /auth/login']);
    expect(m.calls[1].headers.get('x-csrf-token')).toBe('fresh');
  });

  it('on 401 refreshes silently, then retries the call once', async () => {
    setCsrf();
    const m = mockApi({
      'GET /tickets/queues': (_c, n) => (n === 1 ? { status: 401 } : { data: [{ key: 'q', label: 'Q', open: 1 }] }),
      'POST /auth/refresh': { data: null },
    });
    const data = await api.get<unknown[]>('/tickets/queues');
    expect(data).toHaveLength(1);
    expect(m.find('POST', '/auth/refresh')).toHaveLength(1);
    expect(m.find('GET', '/tickets/queues')).toHaveLength(2);
    expect(m.find('POST', '/auth/refresh')[0].headers.get('x-csrf-token')).toBe('csrf-123');
  });

  it('retries only once: a second 401 ends the session', async () => {
    setCsrf();
    const expired = vi.fn();
    const off = onSessionExpired(expired);
    const m = mockApi({ 'GET /tickets': { status: 401 }, 'POST /auth/refresh': { data: null } });
    await expect(api.get('/tickets')).rejects.toMatchObject({ status: 401, code: 'SESSION_EXPIRED' });
    expect(m.find('GET', '/tickets')).toHaveLength(2);
    expect(m.find('POST', '/auth/refresh')).toHaveLength(1);
    expect(expired).toHaveBeenCalledTimes(1);
    off();
  });

  it('a failed refresh ends the session without retrying', async () => {
    setCsrf();
    const expired = vi.fn();
    const off = onSessionExpired(expired);
    const m = mockApi({ 'GET /tickets': { status: 401 }, 'POST /auth/refresh': { status: 401 } });
    await expect(api.get('/tickets')).rejects.toBeInstanceOf(ApiError);
    expect(m.find('GET', '/tickets')).toHaveLength(1);
    expect(expired).toHaveBeenCalledTimes(1);
    off();
  });

  it('concurrent 401s share one refresh', async () => {
    setCsrf();
    const m = mockApi({
      'GET /a': (_c, n) => (n === 1 ? { status: 401 } : { data: 'a' }),
      'GET /b': (_c, n) => (n === 1 ? { status: 401 } : { data: 'b' }),
      'POST /auth/refresh': { data: null },
    });
    const [a, b] = await Promise.all([api.get('/a'), api.get('/b')]);
    expect([a, b]).toEqual(['a', 'b']);
    expect(m.find('POST', '/auth/refresh')).toHaveLength(1);
  });

  it('never refreshes on /auth routes (a wrong code is a plain 401)', async () => {
    setCsrf();
    const m = mockApi({ 'POST /auth/totp': { status: 401, message: 'Code invalide' } });
    await expect(api.post('/auth/totp', { challengeId: 'c', code: '000000' })).rejects.toMatchObject({ status: 401, message: 'Code invalide' });
    expect(m.find('POST', '/auth/refresh')).toHaveLength(0);
  });

  it('sends x-reauth-token for sensitive actions', async () => {
    setCsrf();
    const m = mockApi({ 'POST /approvals/a1/approve': { data: {} } });
    await request('POST', '/approvals/a1/approve', { body: {}, reauthToken: 'rt-1' });
    expect(m.calls[0].headers.get('x-reauth-token')).toBe('rt-1');
  });

  it('keeps no token in browser storage', async () => {
    setCsrf();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    mockApi({ 'POST /auth/totp': { data: { agent: { id: 'a' } } }, 'POST /auth/reauth': { data: { reauthToken: 'secret' } } });
    await api.post('/auth/totp', { challengeId: 'c', code: '123456' });
    await api.post('/auth/reauth', { code: '123456' });
    expect(setItem).not.toHaveBeenCalled();
  });

  it('reads the error envelope', async () => {
    setCsrf();
    mockApi({ 'POST /approvals/a/approve': { status: 409, code: 'STATE_CHANGED', message: 'Déjà traité' } });
    await expect(api.post('/approvals/a/approve')).rejects.toMatchObject({ status: 409, code: 'STATE_CHANGED', message: 'Déjà traité' });
  });
});
