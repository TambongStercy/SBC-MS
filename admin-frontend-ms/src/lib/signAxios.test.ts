import { describe, expect, it, vi } from 'vitest';
import axios from 'axios';

vi.mock('./requestSigning', () => ({
  noteServerDate: vi.fn(),
  signatureFor: vi.fn(async (method: string, url: string, auth: string, body: unknown) =>
    `v1;m=${method.toUpperCase()};u=${new URL(url).pathname}${new URL(url).search};a=${auth.slice(7)};b=${typeof body === 'string' ? body : typeof body}`),
}));

import { attachSigning } from './signAxios';

function client(token: string | null) {
  const seen: { headers: Record<string, unknown>; data: unknown }[] = [];
  const c = axios.create({ baseURL: 'https://api.example/api', adapter: async config => {
    seen.push({ headers: { ...config.headers }, data: config.data });
    return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
  } });
  attachSigning(c);
  c.interceptors.request.use(config => { if (token) config.headers.Authorization = `Bearer ${token}`; return config; });
  return { c, seen };
}

describe('admin request signing (Security plan Phase 9)', () => {
  it('signs after the token is set, over the exact URL and JSON text sent', async () => {
    const { c, seen } = client('tok');
    await c.post('/users/admin/users/1', { a: 1 }, { params: { x: 'y z' } });
    const sig = String(seen[0].headers['X-SBC-Signature']);
    expect(sig).toContain('m=POST');
    expect(sig).toContain('u=/api/users/admin/users/1?x=y+z');
    expect(sig).toContain('a=tok');
    expect(sig).toContain('b={"a":1}');
    expect(seen[0].data).toBe('{"a":1}');
  });

  it('leaves requests without the admin token unsigned', async () => {
    const { c, seen } = client(null);
    await c.post('/users/admin/login', { email: 'a' });
    expect(seen[0].headers['X-SBC-Signature']).toBeUndefined();
  });

  it('signs uploads without reading the form', async () => {
    const { c, seen } = client('tok');
    const f = new FormData(); f.append('file', 'x');
    await c.post('/storage/upload', f);
    expect(String(seen[0].headers['X-SBC-Signature'])).toContain('b=object');
  });
});
