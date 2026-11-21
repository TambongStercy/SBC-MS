import axios, { AxiosError, AxiosInstance } from 'axios';

/**
 * Security plan Phase 2: client for Blnk (second, independent ledger), pinned
 * to v0.15.9. Listens on 127.0.0.1 only; every call carries the API key
 * (`server.secure: true` in blnk.json, otherwise Blnk accepts anyone).
 *
 * Settings (user-service .env): BLNK_URL, BLNK_API_KEY, BLNK_LEDGER_NAME.
 * Without BLNK_URL nothing is sent and the sync worker idles.
 */
export const blnkConfig = () => ({
    url: (process.env.BLNK_URL || '').replace(/\/+$/, ''),
    key: process.env.BLNK_API_KEY || '',
    ledgerName: process.env.BLNK_LEDGER_NAME || 'SBC members',
});
export const blnkEnabled = () => !!blnkConfig().url && !!blnkConfig().key;

/** Amounts go in hundredths (precision 100), as the plan says for XAF and USD. */
export const PRECISION = 100;

export class BlnkError extends Error {
    constructor(public status: number | null, public code: string, message: string) { super(message); }
    /** Network error, timeout or 5xx: try again later, never skip. */
    get retryable() { return this.status === null || this.status >= 500 || this.status === 429; }
}

export interface BlnkBalance {
    balance_id: string; ledger_id: string; currency: string;
    balance: number; inflight_balance: number; credit_balance: number; debit_balance: number;
    meta_data?: Record<string, unknown> | null;
}
export interface BlnkTransaction {
    transaction_id: string; reference: string; status: string; amount: number; precise_amount: number; currency: string;
    source: string; destination: string; meta_data?: Record<string, unknown> | null;
}

let http: AxiosInstance | null = null;
let httpFor = '';
function client(): AxiosInstance {
    const c = blnkConfig();
    if (!http || httpFor !== `${c.url}|${c.key}`) {
        http = axios.create({ baseURL: c.url, timeout: 8000, headers: { 'X-Blnk-Key': c.key, 'Content-Type': 'application/json' } });
        httpFor = `${c.url}|${c.key}`;
    }
    return http;
}

async function call<T>(method: 'get' | 'post', path: string, body?: unknown): Promise<T> {
    try {
        const r = method === 'get' ? await client().get(path) : await client().post(path, body);
        return r.data as T;
    } catch (err) {
        const e = err as AxiosError<any>;
        const status = e.response?.status ?? null;
        const code = e.response?.data?.error_detail?.code || e.code || 'BLNK_ERROR';
        const message = e.response?.data?.error || e.message;
        throw new BlnkError(status, String(code), String(message).slice(0, 300));
    }
}

export const blnk = {
    health: () => call<unknown>('get', '/health'),
    createLedger: (name: string, meta: Record<string, unknown>) => call<{ ledger_id: string }>('post', '/ledgers', { name, meta_data: meta }),
    createBalance: (ledgerId: string, currency: string, meta: Record<string, unknown>) =>
        call<BlnkBalance>('post', '/balances', { ledger_id: ledgerId, currency, meta_data: meta }),
    getBalance: (balanceId: string) => call<BlnkBalance>('get', `/balances/${encodeURIComponent(balanceId)}`),
    byReference: (reference: string) => call<BlnkTransaction>('get', `/transactions/reference/${encodeURIComponent(reference)}`),
    post: (tx: {
        amount: number; reference: string; currency: string; source: string; destination: string; description: string;
        allow_overdraft?: boolean; skip_queue?: boolean; meta_data?: Record<string, unknown>;
    }) => call<BlnkTransaction>('post', '/transactions', { precision: PRECISION, ...tx }),
};
