/**
 * Asserts the metrics module (utils/metrics.ts, the same in gateway/user/payment/risk/support)
 * and the Mongo collector, through a real Express app and a local MongoDB:
 *   - /metrics: 404 without METRICS_TOKEN, 401 with a wrong one, Prometheus text with the right one;
 *   - routes are labelled by their pattern (/api/users/:id), never by the raw path or an id;
 *     an unknown path is `unmatched`; /health and /metrics are not timed;
 *   - timeJob counts ok / error and keeps the last success, and re-throws;
 *   - sbc_mongo_* gauges come from serverStatus.
 *
 *   npx ts-node --transpile-only src/scripts/check-metrics.ts
 */
import express, { Router } from 'express';
import mongoose from 'mongoose';
import { AddressInfo } from 'net';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

const main = async () => {
    delete process.env.METRICS_TOKEN;
    const { httpMetrics, metricsHandler, timeJob } = await import('../utils/metrics');
    await import('../utils/mongo-metrics');
    await mongoose.connect(process.env.METRICS_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_metrics_check_test');

    const app = express();
    app.use(httpMetrics);
    app.get('/metrics', (req, res) => { void metricsHandler(req, res); });
    app.get('/health', (_req, res) => { res.json({ ok: true }); });
    const users = Router();
    users.get('/:id', (req, res) => { res.json({ id: req.params.id }); });
    users.post('/:id/fail', (_req, res) => { res.status(500).json({}); });
    app.use('/api/users', users);
    app.use((_req, res) => { res.status(404).json({}); });
    const srv = app.listen(0);
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const scrape = (token?: string) => fetch(`${base}/metrics`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

    check('no METRICS_TOKEN → /metrics answers 404 (nothing exposed)', (await scrape('x'.repeat(40))).status === 404);
    process.env.METRICS_TOKEN = 't'.repeat(40);
    check('wrong token → 401', (await scrape('u'.repeat(40))).status === 401);
    check('no token → 401', (await scrape()).status === 401);

    for (let i = 0; i < 3; i++) await fetch(`${base}/api/users/6e2e0000000000000000aa0${i}`);
    await fetch(`${base}/api/users/6e2e0000000000000000aa01/fail`, { method: 'POST' });
    await fetch(`${base}/nothing/here/9f8e7d`);
    await fetch(`${base}/health`);
    await timeJob('check_ok', async () => 1);
    let rethrown = false;
    try { await timeJob('check_err', async () => { throw new Error('boom'); }); } catch { rethrown = true; }

    const r = await scrape(process.env.METRICS_TOKEN);
    const text = await r.text();
    check('right token → 200 Prometheus text, no-store', r.status === 200 && /text\/plain/.test(r.headers.get('content-type') || '') && r.headers.get('cache-control') === 'no-store');
    check('route labelled by its pattern, 3 requests', /sbc_http_request_duration_seconds_count\{[^}]*route="\/api\/users\/:id"[^}]*code="2xx"[^}]*\} 3/.test(text));
    check('the 500 counted as 5xx under its pattern', /route="\/api\/users\/:id\/fail"[^}]*code="5xx"/.test(text));
    check('unknown path → unmatched', /route="unmatched"/.test(text));
    check('no raw id or path in any label', !/aa0[0-2]|9f8e7d|nothing\/here/.test(text));
    check('/health and /metrics not timed', !/route="\/health"|route="\/metrics"/.test(text));
    check('service label on every series, no env guessed', /service="user"/.test(text) && !/env="/.test(text));
    check('timeJob: ok and error counted, error re-thrown', rethrown && /sbc_job_runs_total\{[^}]*task="check_ok"[^}]*result="ok"[^}]*\} 1/.test(text) && /task="check_err"[^}]*result="error"[^}]*\} 1/.test(text));
    check('timeJob: last success kept for the ok job only', /sbc_job_last_success_timestamp_seconds\{[^}]*task="check_ok"/.test(text) && !/sbc_job_last_success_timestamp_seconds\{[^}]*task="check_err"/.test(text));
    check('process metrics present', /sbc_process_resident_memory_bytes/.test(text));
    const max = Number(/sbc_mongo_cache_bytes\{kind="max"[^}]*\} (\d+)/.exec(text)?.[1] ?? 0);
    check('Mongo: up, cache max and connections from serverStatus', /sbc_mongo_up\{[^}]*\} 1/.test(text) && max > 0 && /sbc_mongo_connections\{state="current"/.test(text), `cache max ${max}`);

    srv.close();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} FAILED` : '\nall passed');
    process.exit(failures ? 1 : 0);
};
main().catch((e) => { console.error(e); process.exit(1); });
