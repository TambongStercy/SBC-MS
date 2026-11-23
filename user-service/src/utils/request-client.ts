import { AsyncLocalStorage } from 'async_hooks';
import type { NextFunction, Request, Response } from 'express';

/**
 * Where the member's request came from (Security plan Phase 10, web/app split, 2026-11-23):
 * the apps send X-SBC-Client (`web`, or `app` when installed on the home screen); anything
 * else is `api`. Kept for the request's lifetime so the payment intents created while
 * handling it carry it (`metadata.clientSource`), without threading it through every call.
 * Reporting only: nothing is decided on it.
 */
type ClientSource = 'web' | 'app' | 'api';
const store = new AsyncLocalStorage<{ source: ClientSource }>();

export const clientSourceFromHeader = (v: unknown): ClientSource => (v === 'web' || v === 'app' ? v : 'api');

export function requestClientContext(req: Request, _res: Response, next: NextFunction): void {
    store.run({ source: clientSourceFromHeader(req.headers['x-sbc-client']) }, next);
}

/** The current request's source, or undefined outside a request (jobs, scripts). */
export const currentClientSource = (): ClientSource | undefined => store.getStore()?.source;
