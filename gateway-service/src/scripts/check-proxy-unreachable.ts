/**
 * Asserts the gateway answers 503 SERVICE_UNAVAILABLE (not 500) when a proxied service is down,
 * through express-http-proxy and the real error middleware; a real bug still answers 500.
 *   npx ts-node --transpile-only src/scripts/check-proxy-unreachable.ts
 */
import express from 'express';
import proxy from 'express-http-proxy';
import { AddressInfo } from 'net';
import { errorHandler } from '../api/middleware/error.middleware';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`); if (!ok) failures++; };
(async () => {
    const app = express();
    app.use('/api/down', proxy('http://127.0.0.1:1', { parseReqBody: false }));
    app.get('/api/bug', () => { throw new Error('a real bug'); });
    app.use(errorHandler);
    const srv = app.listen(0);
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const r = await fetch(`${base}/api/down/x`);
    const b: any = await r.json();
    check('service down → 503 SERVICE_UNAVAILABLE, Retry-After', r.status === 503 && b.code === 'SERVICE_UNAVAILABLE' && r.headers.get('retry-after') === '30', `${r.status}`);
    const r2 = await fetch(`${base}/api/bug`);
    check('a real error still → 500', r2.status === 500);
    srv.close();
    console.log(failures ? `\n${failures} FAILED` : '\nall passed');
    process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
