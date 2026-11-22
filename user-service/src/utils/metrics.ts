/**
 * Metrics for Prometheus (Security plan, cross-cutting items 10–11, 2026-11-22). The same file is
 * in gateway, user, payment, risk and support services; only SERVICE differs.
 *
 *   sbc_http_request_duration_seconds{service,method,route,code}  route = the Express pattern
 *        (`/api/users/:id`), never the raw URL, so the number of series stays bounded
 *   sbc_job_duration_seconds{service,task}, sbc_job_runs_total{service,task,result},
 *   sbc_job_last_success_timestamp_seconds{service,task}            via timeJob()
 *   sbc_process_*, sbc_nodejs_*                                     Node process (memory, CPU, event loop)
 *
 * GET /metrics answers only with `Authorization: Bearer <METRICS_TOKEN>` (constant-time compare);
 * without METRICS_TOKEN the route answers 404 and nothing is exposed. Nothing here ever holds a
 * member id, an email, a number or an amount.
 */
import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import client from 'prom-client';

const SERVICE = 'user';

export const registry = new client.Registry();
// `env` (preprod / prod) is added by Prometheus from the path it scrapes, never guessed here.
registry.setDefaultLabels({ service: SERVICE });
client.collectDefaultMetrics({ register: registry, prefix: 'sbc_' });

const httpDuration = new client.Histogram({
    name: 'sbc_http_request_duration_seconds',
    help: 'HTTP requests by route pattern, method and status class',
    labelNames: ['method', 'route', 'code'],
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    registers: [registry],
});
const jobDuration = new client.Histogram({
    name: 'sbc_job_duration_seconds', help: 'Duration of scheduled jobs', labelNames: ['task'],
    buckets: [0.1, 0.5, 1, 5, 15, 60, 300, 900, 3600], registers: [registry],
});
const jobRuns = new client.Counter({ name: 'sbc_job_runs_total', help: 'Scheduled job runs by result', labelNames: ['task', 'result'], registers: [registry] });
const jobLastSuccess = new client.Gauge({ name: 'sbc_job_last_success_timestamp_seconds', help: 'Last successful run of a job (unix time)', labelNames: ['task'], registers: [registry] });

const SKIP = new Set(['/metrics', '/health', '/api/health']);

/** The route pattern of a finished request; bounded, never the raw path. */
export function routeLabel(req: Request): string {
    const pattern = (req as any).route?.path;
    const base = req.baseUrl || '';
    if (typeof pattern === 'string') return (base + (pattern === '/' && base ? '' : pattern)).slice(0, 120) || '/';
    if (base) return base.slice(0, 120); // a router or proxy mount without a final route (e.g. the gateway's proxies)
    return 'unmatched';
}

/** First middleware: times every request (except /metrics and /health). */
export function httpMetrics(req: Request, res: Response, next: NextFunction): void {
    if (SKIP.has(req.path)) { next(); return; }
    const end = httpDuration.startTimer();
    res.once('finish', () => {
        end({ method: req.method, route: routeLabel(req), code: `${Math.floor(res.statusCode / 100)}xx` });
    });
    next();
}

/** Times a scheduled job; a throw is counted as a failure and re-thrown. */
export async function timeJob<T>(job: string, fn: () => Promise<T>): Promise<T> {
    const end = jobDuration.startTimer({ task: job });
    try {
        const out = await fn();
        jobRuns.inc({ task: job, result: 'ok' });
        jobLastSuccess.set({ task: job }, Date.now() / 1000);
        return out;
    } catch (err) {
        jobRuns.inc({ task: job, result: 'error' });
        throw err;
    } finally {
        end();
    }
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest();

/** GET /metrics, behind METRICS_TOKEN (404 when unset: nothing exposed by default). */
export async function metricsHandler(req: Request, res: Response): Promise<void> {
    const token = process.env.METRICS_TOKEN || '';
    if (token.length < 32) { res.status(404).end(); return; }
    const given = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!crypto.timingSafeEqual(sha(given), sha(token))) { res.status(401).end(); return; }
    res.set('Content-Type', registry.contentType);
    res.set('Cache-Control', 'no-store');
    res.end(await registry.metrics());
}
