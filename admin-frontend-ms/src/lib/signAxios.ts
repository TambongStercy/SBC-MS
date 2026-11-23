import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { noteServerDate, signatureFor } from './requestSigning';

/** Signing waits at most this long; past it the request goes unsigned (Security plan Phase 9). */
const SIGN_BUDGET_MS = 300;

const isPlainBody = (d: unknown) =>
    d !== undefined && d !== null && typeof d === 'object'
    && !(d instanceof FormData) && !(d instanceof Blob) && !(d instanceof ArrayBuffer) && !(d instanceof URLSearchParams);

/**
 * Security plan Phase 9: requests carrying the admin token are signed with this browser's key
 * (lib/requestSigning.ts), like the member app's. Log-only on the gateway (BROWSER_CHECKS=log).
 * A plain object body is turned into its JSON text here, so the bytes signed are the bytes sent.
 * Added after the instance's own token interceptor (axios runs request interceptors last-added
 * first, so this one is registered FIRST and therefore runs after the token is set).
 */
export function attachSigning(instance: AxiosInstance): void {
    instance.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
        const auth = String(config.headers?.Authorization || '');
        if (!auth.startsWith('Bearer ')) return config;
        try {
            if (isPlainBody(config.data)) config.data = JSON.stringify(config.data);
            const sig = await Promise.race([
                signatureFor(String(config.method || 'get'), instance.getUri(config), auth, config.data as BodyInit | undefined),
                new Promise<null>(r => setTimeout(() => r(null), SIGN_BUDGET_MS)),
            ]);
            if (sig) config.headers['X-SBC-Signature'] = sig;
        } catch { /* never block a request for a signature */ }
        return config;
    });
    instance.interceptors.response.use(res => { noteServerDate(res.headers?.date ?? null); return res; });
}
