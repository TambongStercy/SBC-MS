import crypto from 'crypto';
import config from '../../config';
import { DependencyError } from '../../utils/errors';
import { currentActor, currentRequestId } from '../../utils/request-context';
import logger from '../../utils/logger';

const log = logger.getLogger('ServiceClient');

export type ServiceName = 'user' | 'payment' | 'advertising' | 'notification';

export interface ServiceResponse<T = any> {
    ok: boolean;
    status: number;
    data?: T;
    code?: string;
    message?: string;
}

/**
 * Calls an owner service with the contract headers (§2): service secret,
 * service name, request id, and the acting agent. Network errors and 5xx
 * become DependencyError (503 "service indisponible"); 4xx are returned to
 * the caller, who decides.
 */
export async function serviceRequest<T = any>(
    service: ServiceName,
    method: 'GET' | 'POST',
    path: string,
    opts: { body?: unknown; query?: Record<string, string | number | undefined | null>; timeoutMs?: number; actor?: string } = {},
): Promise<ServiceResponse<T>> {
    const base = config.services[service];
    const qs = opts.query
        ? Object.entries(opts.query).filter(([, v]) => v !== undefined && v !== null && v !== '')
            .map(([kk, v]) => `${encodeURIComponent(kk)}=${encodeURIComponent(String(v))}`).join('&')
        : '';
    const url = `${base}${path}${qs ? `?${qs}` : ''}`;
    const headers: Record<string, string> = {
        Authorization: `Bearer ${config.secrets.service}`,
        'x-service-name': config.serviceName,
        'x-request-id': currentRequestId() || crypto.randomUUID(),
        Accept: 'application/json',
    };
    const actor = opts.actor ?? currentActor();
    if (actor) headers['x-support-actor'] = actor;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

    let res: Response;
    try {
        res = await fetch(url, {
            method,
            headers,
            body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
            signal: AbortSignal.timeout(opts.timeoutMs ?? config.services.timeoutMs),
        });
    } catch (err) {
        log.warn(`${service} unreachable`, { path, message: (err as Error).message });
        throw new DependencyError(service);
    }
    let json: any = null;
    try { json = await res.json(); } catch { json = null; }
    if (res.status >= 500) {
        log.warn(`${service} answered ${res.status}`, { path });
        throw new DependencyError(service, res.status);
    }
    return {
        ok: res.ok && json?.success !== false,
        status: res.status,
        data: json?.data,
        code: json?.code,
        message: json?.message,
    };
}

/**
 * True when a 404 means "this route is not deployed" (the owner branch is
 * built in parallel) rather than "no such record": Express's default 404 has
 * no JSON body, and the services' catch-all says "Resource not found".
 */
export function isRouteMissing(r: ServiceResponse): boolean {
    return r.status === 404 && !r.code && (!r.message || /resource not found|endpoint not found|cannot (get|post)/i.test(r.message));
}

/** The data of a successful answer; anything else becomes "service indisponible". */
export function requireOk<T>(service: ServiceName, r: ServiceResponse<T>): T {
    if (r.ok) return r.data as T;
    throw Object.assign(new DependencyError(service, r.status), { upstreamCode: r.code, upstreamMessage: r.message });
}
