import { vi } from 'vitest';

/** One recorded call to the API. */
export interface Call {
  method: string;
  /** Path after /api/support/desk, without the query string. */
  path: string;
  query: URLSearchParams;
  headers: Headers;
  body: unknown;
  credentials?: RequestCredentials;
}

type Reply = { status?: number; data?: unknown; message?: string; code?: string; raw?: BodyInit };
type Handler = Reply | ((call: Call, n: number) => Reply);

/**
 * Replaces fetch with a small router keyed by "METHOD /path" (path after
 * /api/support/desk). Unknown routes answer 404. Every call is recorded.
 */
export function mockApi(routes: Record<string, Handler>) {
  const calls: Call[] = [];
  const counts = new Map<string, number>();
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init.method ?? 'GET').toUpperCase();
    const path = url.pathname.replace(/^\/api\/support\/desk/, '');
    const headers = new Headers(init.headers);
    let body: unknown = init.body;
    if (typeof init.body === 'string') { try { body = JSON.parse(init.body); } catch { /* text */ } }
    const call: Call = { method, path, query: url.searchParams, headers, body, credentials: init.credentials };
    calls.push(call);
    const key = `${method} ${path}`;
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    const handler = routes[key];
    const reply: Reply = !handler ? { status: 404, message: 'Not found' } : typeof handler === 'function' ? handler(call, n) : handler;
    const status = reply.status ?? 200;
    if (reply.raw !== undefined) return new Response(reply.raw, { status });
    const ok = status >= 200 && status < 300;
    const payload = ok ? { success: true, data: reply.data } : { success: false, message: reply.message ?? 'Erreur', code: reply.code };
    return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    calls,
    fetchMock,
    find: (method: string, path: string) => calls.filter(c => c.method === method && c.path === path),
  };
}
