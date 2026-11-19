/**
 * The one HTTP client of the app (CONTRACT.md §3.1).
 *
 * - Cookies only: the session lives in httpOnly cookies set by the server.
 *   Nothing is ever written to localStorage/sessionStorage, and responses are
 *   never logged.
 * - CSRF: every non-GET carries `x-csrf-token`, read from the readable
 *   `sbc_sup_csrf` cookie (double submit).
 * - A 401 outside /auth triggers ONE silent refresh (shared by concurrent
 *   calls), then the call is retried once. If the refresh fails, the session
 *   is over: `onSessionExpired` listeners are told and the error is thrown.
 * - Sensitive actions pass `reauthToken`, sent as `x-reauth-token`.
 */

export const API_BASE = '/api/support/desk';
export const CSRF_COOKIE = 'sbc_sup_csrf';
export const CSRF_HEADER = 'x-csrf-token';
export const REAUTH_HEADER = 'x-reauth-token';

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  body?: unknown;
  query?: Query;
  reauthToken?: string;
  signal?: AbortSignal;
  /** Return the raw Response (downloads); no envelope parsing. */
  raw?: boolean;
}

/** Reads one cookie by name (the CSRF cookie is the only one JS can see). */
export function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  for (const part of document.cookie.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

type Listener = () => void;
const expiredListeners = new Set<Listener>();

/** Called when the session can no longer be refreshed (the app goes back to sign-in). */
export function onSessionExpired(fn: Listener): () => void {
  expiredListeners.add(fn);
  return () => { expiredListeners.delete(fn); };
}

export function buildUrl(path: string, query?: Query): string {
  const url = `${API_BASE}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

const isMutation = (method: string) => !['GET', 'HEAD', 'OPTIONS'].includes(method);

let csrfPrimed: Promise<void> | null = null;

/**
 * Before the first mutation of a visit (the login form), there may be no CSRF
 * cookie yet. A GET to /auth/csrf lets the server set it; any failure is
 * ignored (the server then answers the mutation itself).
 */
async function ensureCsrfCookie(): Promise<void> {
  if (readCookie(CSRF_COOKIE)) return;
  csrfPrimed ??= fetch(buildUrl('/auth/csrf'), { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' } })
    .then(() => undefined, () => undefined)
    .finally(() => { csrfPrimed = null; });
  await csrfPrimed;
}

function headersFor(method: string, body: unknown, reauthToken?: string): Headers {
  const h = new Headers({ Accept: 'application/json' });
  if (body !== undefined && !(body instanceof FormData)) h.set('Content-Type', 'application/json');
  if (isMutation(method)) {
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf) h.set(CSRF_HEADER, csrf);
  }
  if (reauthToken) h.set(REAUTH_HEADER, reauthToken);
  return h;
}

async function send(method: string, path: string, opts: RequestOptions): Promise<Response> {
  if (isMutation(method)) await ensureCsrfCookie();
  const body = opts.body === undefined ? undefined : opts.body instanceof FormData ? opts.body : JSON.stringify(opts.body);
  return fetch(buildUrl(path, opts.query), {
    method,
    credentials: 'include',
    headers: headersFor(method, opts.body, opts.reauthToken),
    body,
    signal: opts.signal,
  });
}

let refreshing: Promise<boolean> | null = null;

/** POST /auth/refresh once, shared by every call that got a 401 at the same time. */
export function refreshSession(): Promise<boolean> {
  refreshing ??= send('POST', '/auth/refresh', {})
    .then(r => r.ok, () => false)
    .finally(() => { refreshing = null; });
  return refreshing;
}

const GENERIC_ERROR = 'Le serveur n’a pas pu traiter la demande. Réessayez.';
const STATUS_MESSAGES: Record<number, string> = {
  401: 'Votre session a expiré. Reconnectez-vous.',
  403: 'Vous n’avez pas le droit de faire cette action.',
  404: 'Élément introuvable.',
  409: 'L’élément a changé entre-temps. Rechargez la page.',
  429: 'Trop de tentatives. Patientez un moment.',
};

async function parse<T>(res: Response): Promise<T> {
  let payload: { success?: boolean; data?: unknown; message?: string; code?: string } | null = null;
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    try { payload = await res.json(); } catch { payload = null; }
  }
  if (!res.ok || payload?.success === false) {
    const message = (typeof payload?.message === 'string' && payload.message.trim()) || STATUS_MESSAGES[res.status] || GENERIC_ERROR;
    throw new ApiError(res.status, message, payload?.code);
  }
  // Envelope { success, data } (CONTRACT §2); a bare body is accepted too.
  if (payload && typeof payload === 'object' && 'data' in payload) return payload.data as T;
  return (payload ?? undefined) as T;
}

/** One API call, with the refresh-and-retry-once rule. */
export async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  let res: Response;
  try {
    res = await send(method, path, opts);
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new ApiError(0, 'Connexion impossible. Vérifiez le réseau, puis réessayez.', 'NETWORK');
  }

  // /auth/* answers 401 on purpose (wrong code, no session): never refresh there.
  if (res.status === 401 && !path.startsWith('/auth/')) {
    const refreshed = await refreshSession();
    if (refreshed) {
      res = await send(method, path, opts);
    }
    if (!refreshed || res.status === 401) {
      expiredListeners.forEach(fn => fn());
      throw new ApiError(401, STATUS_MESSAGES[401], 'SESSION_EXPIRED');
    }
  }

  if (opts.raw) {
    if (!res.ok) return parse<T>(res);
    return res as unknown as T;
  }
  return parse<T>(res);
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) => request<T>('GET', path, { query, signal }),
  post: <T>(path: string, body?: unknown, opts: Omit<RequestOptions, 'body'> = {}) => request<T>('POST', path, { ...opts, body }),
  put: <T>(path: string, body?: unknown, opts: Omit<RequestOptions, 'body'> = {}) => request<T>('PUT', path, { ...opts, body }),
  patch: <T>(path: string, body?: unknown, opts: Omit<RequestOptions, 'body'> = {}) => request<T>('PATCH', path, { ...opts, body }),
  del: <T>(path: string, opts: Omit<RequestOptions, 'body'> = {}) => request<T>('DELETE', path, opts),
};

/** A paginated list (invented shape; see the report for the backend). */
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

/** The message to show for any error thrown by the client. */
export function errorMessage(e: unknown, fallback = GENERIC_ERROR): string {
  if (e instanceof ApiError) return e.message;
  return fallback;
}
