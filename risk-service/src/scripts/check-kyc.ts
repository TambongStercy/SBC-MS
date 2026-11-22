/**
 * Asserts Security plan Phase 8 (KYC level 1), main-server side, since KYC runs entirely
 * on the secondary server (2026-11-22). Local Mongo, test databases only, dropped before
 * and after:
 *   - hint route: service secret, validation, 202 + queued in the outbox;
 *   - forward: the members' fields read (read-only) and submitted signed, with their
 *     fingerprint and priority; deleted member dropped; nothing written on the main server
 *     but the outbox; the old kycresults untouched;
 *   - secondary down → kept with a back-off, then sent; a hint arriving while sending keeps
 *     the row for the next pass;
 *   - nightly sync: only {id, fingerprint} sent first, then the fields of the members the
 *     secondary needs; dry run submits nothing;
 *   - member view reads the secondary (no keys), falls back to the archived main result,
 *     marked, when the secondary has none or is down; status carries both sides.
 * By default a fake secondary (verifies the signature, keeps results in memory) answers;
 * set KYC_REAL_WORKER_URL + KYC_SHARED_SECRET to submit to a real kyc-worker (then only the
 * hint, forward and sync checks run; its kyc-runner does the checking).
 *
 *   npx ts-node --transpile-only src/scripts/check-kyc.ts
 */
import express from 'express';
import axios from 'axios';
import mongoose from 'mongoose';
import { createHmac } from 'crypto';
import { AddressInfo } from 'net';

const BASE = process.env.RISK_TEST_MONGO || 'mongodb://127.0.0.1:27017';
process.env.MONGODB_URI = `${BASE}/sbc_risk_kyc_test`;
process.env.SERVICE_SECRET = 'risk-check-secret-0123456789';
process.env.RISK_HASH_KEY = 'risk-check-hash-key';
process.env.SUPPORT_SERVICE_URL = 'http://127.0.0.1:9';
process.env.USERS_MONGODB_URI = `${BASE}/sbc_users_kyc_test`;
const REAL = process.env.KYC_REAL_WORKER_URL || '';
process.env.KYC_SHARED_SECRET = REAL ? (process.env.KYC_SHARED_SECRET || '') : 'k'.repeat(48);
process.env.KYC_WORKER_URL = REAL || 'http://127.0.0.1:1'; // fake secondary's port set below

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

const main = async () => {
    const { config } = await import('../config');
    const { KycQueueModel, KycResultModel, KYC_LIVE } = await import('../database/models');
    const kyc = await import('../services/kyc.service');
    const { createApp } = await import('../server');

    // ---- fake secondary: checks signatures like kyc-worker, keeps queue + results in memory ----
    const fakeQueue = new Map<string, any>();
    const fakeResults = new Map<string, any>();
    const calls: { path: string; body: any }[] = [];
    let down = false;
    let duringEnqueue: (() => Promise<void>) | null = null;
    const fake = express();
    fake.use(express.raw({ type: '*/*', limit: '512kb' }));
    fake.use((req, res, next) => {
        if (down) return res.status(503).end();
        const raw = (req.body as Buffer).toString();
        const ts = String(req.header('x-kyc-timestamp'));
        const sig = createHmac('sha256', process.env.KYC_SHARED_SECRET!).update(`${ts}.${raw}`).digest('hex');
        if (sig !== req.header('x-kyc-signature')) return res.status(401).json({ error: 'unsigned' });
        (req as any).json = JSON.parse(raw || '{}');
        calls.push({ path: req.path, body: (req as any).json });
        next();
    });
    fake.post('/v1/enqueue', async (req, res) => {
        if (duringEnqueue) { const f = duringEnqueue; duringEnqueue = null; await f(); }
        let queued = 0;
        for (const i of (req as any).json.items) {
            if (fakeResults.get(i.ref)?.fingerprint === i.fingerprint) continue;
            fakeQueue.set(i.ref, i); queued++;
        }
        res.json({ queued });
    });
    fake.post('/v1/needed', (req, res) => res.json({
        refs: (req as any).json.items.filter((i: any) => fakeResults.get(i.ref)?.fingerprint !== i.fingerprint && fakeQueue.get(i.ref)?.fingerprint !== i.fingerprint).map((i: any) => i.ref),
    }));
    fake.post('/v1/results', (req, res) => res.json({
        results: Object.fromEntries((req as any).json.refs.filter((r: string) => fakeResults.has(r)).map((r: string) => {
            const { fingerprint, ...rest } = fakeResults.get(r); return [r, rest];
        })),
    }));
    fake.post('/v1/status', (_req, res) => res.json({ queued: fakeQueue.size, live: 0, results: fakeResults.size, bands: { high: 0, medium: 0, low: fakeResults.size }, retrying: 0 }));
    /** What kyc-runner does, reduced to the contract: queue → result. */
    const runFake = () => {
        for (const [ref, i] of fakeQueue) {
            const disposable = String(i.fields.email ?? '').endsWith('@mailinator.com');
            fakeResults.set(ref, { fingerprint: i.fingerprint, level: 1, score: disposable ? 40 : 0, band: disposable ? 'medium' : 'low', reasons: disposable ? ['email_disposable'] : [], signals: { email: { disposable } }, variantAccounts: 0, checkedAt: new Date().toISOString() });
        }
        fakeQueue.clear();
    };
    const fakeSrv = await new Promise<any>(r => { const s = fake.listen(0, '127.0.0.1', () => r(s)); });
    if (!REAL) (config.kyc as any).workerUrl = `http://127.0.0.1:${(fakeSrv.address() as AddressInfo).port}`;

    await mongoose.connect(process.env.MONGODB_URI!);
    await mongoose.connection.dropDatabase();
    await KycQueueModel.syncIndexes();
    await KycResultModel.syncIndexes();
    const users = mongoose.createConnection(process.env.USERS_MONGODB_URI!);
    await users.asPromise();
    await users.dropDatabase();
    (await import('../lib/sources')).setSource('users', users);
    const U = users.collection('users');
    const mk = async (f: Record<string, unknown>) => (await U.insertOne({ name: 'Membre Test', password: 'x', ...f })).insertedId;

    const a = await mk({ email: 'john.doe@gmail.com', phoneNumber: '237670000001', country: 'CM', momoNumber: '237670000001', momoOperator: 'MTN_MOMO_CMR', geo: { lastCountry: 'CM' } });
    const b = await mk({ email: 'johndoe+sbc@gmail.com', phoneNumber: '237670000002', country: 'CM' });
    const c = await mk({ email: 'temp@mailinator.com', phoneNumber: '237670000003', country: 'CM' });
    const gone = await mk({ email: 'gone@gmail.com', phoneNumber: '237670000004', country: 'CM', deleted: true });
    // A result computed on the main server before the move (kept, never written again).
    await KycResultModel.create({ userId: String(b), fingerprint: 'old', score: 20, band: 'medium', reasons: ['email_variant_shared'], signals: {}, variantAccounts: 1, checkedAt: new Date('2026-11-21'), expiresAt: new Date(Date.now() + 300 * 86_400_000), emailKey: 'k' });

    // ---- hint route ----
    const app = createApp();
    const srv = await new Promise<any>(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const auth = { headers: { Authorization: `Bearer ${process.env.SERVICE_SECRET}` }, validateStatus: () => true };
    check('hint without the service secret → 401', (await axios.post(`${base}/api/risk/internal/kyc/hint`, { userId: String(a), reason: 'signup' }, { validateStatus: () => true })).status === 401);
    check('hint with a bad reason → 400', (await axios.post(`${base}/api/risk/internal/kyc/hint`, { userId: String(a), reason: 'whatever' }, auth)).status === 400);
    for (const id of [a, b, c, gone]) {
        const r = await axios.post(`${base}/api/risk/internal/kyc/hint`, { userId: String(id), reason: 'signup' }, auth);
        if (r.status !== 202) check(`hint ${id} → 202`, false, String(r.status));
    }
    check('4 hints → 4 outbox rows, live', await KycQueueModel.countDocuments({ priority: KYC_LIVE }) === 4);
    await axios.post(`${base}/api/risk/internal/kyc/hint`, { userId: String(a), reason: 'signup' }, auth);
    check('a repeated hint stays one row', await KycQueueModel.countDocuments({}) === 4);

    // ---- forward ----
    let o = await kyc.forwardBatch();
    check('forward: 3 sent, deleted member dropped', o.sent === 3 && o.gone === 1 && o.failed === 0, JSON.stringify(o));
    check('outbox empty once sent', await KycQueueModel.countDocuments({}) === 0);
    if (!REAL) {
        const sent = calls.filter(x => x.path === '/v1/enqueue').flatMap(x => x.body.items);
        const ia = sent.find((i: any) => i.ref === String(a));
        check('submitted with fields, fingerprint, live priority, reason', ia?.fields.email === 'john.doe@gmail.com' && ia.fields.geoCountry === 'CM' && ia.fields.momoOperator === 'MTN_MOMO_CMR'
            && /^[a-f0-9]{32}$/.test(ia.fingerprint) && ia.priority === 'live' && ia.reason === 'signup');
        check('never the password or the name', !JSON.stringify(sent).includes('Membre') && !JSON.stringify(sent).includes('password'));
        check('no result written on the main server', await KycResultModel.countDocuments({}) === 1);
        runFake();

        // ---- secondary down, then back ----
        down = true;
        await U.updateOne({ _id: b }, { $set: { phoneNumber: '237670000099' } });
        await kyc.enqueue([String(b)], 'contact_change');
        const t0 = new Date();
        o = await kyc.forwardBatch(500, t0);
        const row: any = await KycQueueModel.findById(String(b)).lean();
        check('secondary down → kept, attempt counted, retried later', o.failed === 1 && row?.attempts === 1 && row.nextAt > t0 && !row.claimToken);
        down = false;
        o = await kyc.forwardBatch(500, t0);
        check('not due yet → not resent', o.claimed === 0);
        o = await kyc.forwardBatch(500, new Date(t0.getTime() + 60 * 60_000));
        check('secondary back, due → sent', o.sent === 1 && await KycQueueModel.countDocuments({}) === 0);

        // ---- a hint while sending ----
        await kyc.enqueue([String(c)], 'contact_change');
        duringEnqueue = async () => { await U.updateOne({ _id: c }, { $set: { email: 'claire@gmail.com' } }); await kyc.enqueue([String(c)], 'contact_change'); };
        o = await kyc.forwardBatch();
        check('hint while sending → stays in the outbox', o.sent === 1 && await KycQueueModel.countDocuments({ _id: String(c) }) === 1);
        o = await kyc.forwardBatch();
        check('… and is sent again with the newest details', o.sent === 1 && fakeQueue.get(String(c))?.fields.email === 'claire@gmail.com');
        runFake();
    }

    // ---- nightly sync ----
    const fresh = await mk({ email: 'nouveau@gmail.com', phoneNumber: '237670000010', country: 'BJ' });
    await U.updateOne({ _id: a }, { $set: { momoNumber: '237690000002', momoOperator: 'ORANGE_CMR' } });
    const before = calls.length;
    const dry = await kyc.syncScan({ dryRun: true });
    check('sync dry run: 1 never checked + 1 changed needed, nothing submitted', REAL ? dry.scanned === 4 : (dry.needed === 2 && dry.queued === 0 && !calls.slice(before).some(x => x.path === '/v1/enqueue')), JSON.stringify(dry));
    if (!REAL) check('the first phase sends ids and fingerprints only', calls.slice(before).every(x => x.path === '/v1/needed' && x.body.items.every((i: any) => Object.keys(i).sort().join() === 'fingerprint,ref')));
    const sync = await kyc.syncScan();
    if (!REAL) {
        const subs = calls.slice(before).filter(x => x.path === '/v1/enqueue').flatMap(x => x.body.items);
        check('sync: only those two submitted, as backfill', sync.queued === 2 && subs.length === 2 && subs.every((i: any) => i.priority === 'backfill' && i.reason === 'refresh')
            && subs.some((i: any) => i.ref === String(fresh)), JSON.stringify(sync));
        runFake();
        const again = await kyc.syncScan();
        check('next night: nothing needed', again.needed === 0 && again.scanned === 4);
    } else {
        check('sync against the real worker submits', sync.scanned === 4 && sync.needed >= 0, JSON.stringify(sync));
    }

    // ---- member view + status ----
    if (!REAL) {
        const view = (await axios.get(`${base}/api/risk/internal/members/${c}`, auth)).data?.data?.kyc;
        check('member view reads the secondary (score, band, signals), no keys', view?.source === 'secondary' && typeof view.score === 'number' && !!view.signals && !('fingerprint' in view) && !('emailKey' in view));
        fakeResults.delete(String(b));
        const vb = (await axios.get(`${base}/api/risk/internal/members/${b}`, auth)).data?.data?.kyc;
        check('no result on the secondary yet → archived main result, marked', vb?.source === 'archive' && vb.band === 'medium' && !('emailKey' in vb));
        down = true;
        const t0 = Date.now();
        const vc = (await axios.get(`${base}/api/risk/internal/members/${c}`, auth)).data?.data;
        check('secondary down → member view still answers (fast)', vc?.kyc === null && Date.now() - t0 < 2500, `${Date.now() - t0} ms`);
        const stDown = (await axios.get(`${base}/api/risk/internal/kyc/status`, auth)).data?.data;
        check('status says the secondary is unreachable', stDown?.secondary === null && stDown.secondaryError === '503');
        down = false;
        const st = (await axios.get(`${base}/api/risk/internal/kyc/status`, auth)).data?.data;
        check('status: outbox here + secondary counts, no member data', st?.outbox === 0 && st.secondary?.results === 3 && !JSON.stringify(st).includes('@'));
    }

    // ---- throughput: forwarding 3,000 members ----
    if (!REAL) {
        const many = Array.from({ length: 3000 }, (_, i) => ({ name: 'x', password: 'x', email: `m${i}@gmail.com`, phoneNumber: `2376800${String(i).padStart(5, '0')}`, country: 'CM' }));
        const ins = await U.insertMany(many);
        await kyc.enqueue(Object.values(ins.insertedIds).map(String), 'signup');
        const t0 = Date.now();
        let n = 0;
        while (n < 3000) { const r = await kyc.forwardBatch(); if (!r.claimed) break; n += r.sent; }
        const ms = Date.now() - t0;
        check('3,000 members forwarded in batches of 500', n === 3000, `${ms} ms`);
    }

    srv.close(); fakeSrv.close();
    await users.dropDatabase(); await users.close();
    await mongoose.connection.dropDatabase(); await mongoose.disconnect();
    console.log(failures ? `\n${failures} FAILED` : '\nall passed');
    process.exit(failures ? 1 : 0);
};
main().catch((e) => { console.error(e); process.exit(1); });
