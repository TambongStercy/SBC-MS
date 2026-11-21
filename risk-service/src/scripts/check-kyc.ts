/**
 * Asserts Security plan Phase 8 (KYC level 1), risk-service side, against local
 * Mongo. Test databases only, dropped before and after:
 *   - hint route: service secret, validation, 202 + queued;
 *   - a batch: users read (read-only), worker called signed, results stored with
 *     signals and a score only (no email, number or name anywhere in kycresults),
 *     12-month expiry (TTL index);
 *   - address variants (Gmail dots, +tag) of one mailbox add points to both accounts;
 *   - unchanged details → no worker call; changed details → checked again;
 *     deleted member → dropped;
 *   - worker down → kept with a back-off, then checked; a hint arriving during a
 *     check makes it run again;
 *   - backfill rows only in the night window, live hints any time and first;
 *   - nightly refresh: missing and changed members queued, dry run queues nothing;
 *   - member view carries `kyc` without keys.
 * By default a fake worker (verifies the signature) answers; set
 * KYC_REAL_WORKER_URL + KYC_SHARED_SECRET to run against a real kyc-worker.
 *
 *   npx ts-node --transpile-only src/scripts/check-kyc.ts
 */
import express from 'express';
import axios from 'axios';
import mongoose, { Types } from 'mongoose';
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
process.env.KYC_WORKER_URL = REAL || 'http://127.0.0.1:1'; // fake worker's port set below
delete process.env.KYC_BACKFILL_ANYTIME;

const DAY = 86_400_000;
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};
/** The next h:30 Douala after now (rows queued now are due by then). */
const atDouala = (h: number) => { const d = new Date(); d.setUTCHours((h + 23) % 24, 30, 0, 0); if (d.getTime() <= Date.now() + 60_000) d.setTime(d.getTime() + DAY); return d; };

const main = async () => {
    const { config } = await import('../config');
    const { KycQueueModel, KycResultModel, KYC_BACKFILL, KYC_LIVE } = await import('../database/models');
    const kyc = await import('../services/kyc.service');
    const { createApp } = await import('../server');

    // ---- fake worker: checks the signature like kyc-worker, answers simple signals ----
    let workerCalls = 0;
    let workerDown = false;
    let duringCall: (() => Promise<void>) | null = null;
    const fake = express();
    fake.use(express.raw({ type: '*/*' }));
    fake.post('/v1/level1', async (req, res) => {
        workerCalls++;
        if (workerDown) return res.status(503).end();
        const raw = (req.body as Buffer).toString();
        const ts = String(req.header('x-kyc-timestamp'));
        const sig = createHmac('sha256', process.env.KYC_SHARED_SECRET!).update(`${ts}.${raw}`).digest('hex');
        if (sig !== req.header('x-kyc-signature')) return res.status(401).json({ error: 'unsigned' });
        if (duringCall) { const f = duringCall; duringCall = null; await f(); }
        const { items } = JSON.parse(raw);
        res.json({
            results: items.map((i: any) => {
                const [local = '', domain = ''] = String(i.email ?? '').toLowerCase().split('@');
                const norm = domain === 'gmail.com' ? `${local.split('+')[0].replace(/\./g, '')}@gmail.com` : `${local.split('+')[0]}@${domain}`;
                const disposable = domain === 'mailinator.com';
                const reasons = disposable ? ['email_disposable'] : [];
                return { ref: i.ref, signals: { email: { domain, disposable, mx: true }, phone: { valid: true, region: 'CM' } }, reasons, score: disposable ? 40 : 0, band: disposable ? 'medium' : 'low', emailNormalized: i.email ? norm : null };
            }),
        });
    });
    const fakeSrv = await new Promise<any>(r => { const s = fake.listen(0, '127.0.0.1', () => r(s)); });
    if (!REAL) (config.kyc as any).workerUrl = `http://127.0.0.1:${(fakeSrv.address() as AddressInfo).port}`;

    await mongoose.connect(process.env.MONGODB_URI!);
    await mongoose.connection.dropDatabase();
    await KycQueueModel.syncIndexes();
    await KycResultModel.syncIndexes();
    const users = mongoose.createConnection(process.env.USERS_MONGODB_URI!);
    await users.asPromise();
    await users.dropDatabase();
    kyc.setUsersDb(users);
    const U = users.collection('users');
    const mk = async (f: Record<string, unknown>) => (await U.insertOne({ name: 'Membre Test', password: 'x', ...f })).insertedId;

    const a = await mk({ email: 'john.doe@gmail.com', phoneNumber: '237670000001', country: 'CM', momoNumber: '237670000001', momoOperator: 'MTN_MOMO_CMR' });
    const b = await mk({ email: 'johndoe+sbc@gmail.com', phoneNumber: '237670000002', country: 'CM' });
    const c = await mk({ email: 'temp@mailinator.com', phoneNumber: '237670000003', country: 'CM' });
    const gone = await mk({ email: 'gone@gmail.com', phoneNumber: '237670000004', country: 'CM', deleted: true });

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
    check('4 hints → 4 queue rows, live', await KycQueueModel.countDocuments({ priority: KYC_LIVE }) === 4);
    await axios.post(`${base}/api/risk/internal/kyc/hint`, { userId: String(a), reason: 'signup' }, auth);
    check('a repeated hint stays one row', await KycQueueModel.countDocuments({}) === 4);

    // ---- first batch ----
    const day = atDouala(12);
    let o = await kyc.processBatch(50, day);
    check('batch: 3 checked, deleted one dropped', o.checked === 3 && o.gone === 1 && o.failed === 0, JSON.stringify(o));
    check('queue empty after the batch', await KycQueueModel.countDocuments({}) === 0);
    const ra: any = await KycResultModel.findOne({ userId: String(a) }).lean();
    const rb: any = await KycResultModel.findOne({ userId: String(b) }).lean();
    const rc: any = await KycResultModel.findOne({ userId: String(c) }).lean();
    check('Gmail dots and +tag: both accounts flagged as one mailbox', ra.variantAccounts === 1 && rb.variantAccounts === 1 && rb.reasons.includes('email_variant_shared'), `${ra.variantAccounts}/${rb.variantAccounts}`);
    check(`variant adds ${config.kyc.variantPoints} points`, rb.score === rb.workerScore + config.kyc.variantPoints);
    check('disposable address scored', rc.reasons.includes('email_disposable') && rc.score >= 40);
    check('expires in 12 months', Math.abs(ra.expiresAt.getTime() - day.getTime() - 365 * DAY) < 1000);
    const ttl = (await KycResultModel.collection.indexes()).find((i: any) => i.key.expiresAt === 1);
    check('TTL index on expiresAt', ttl?.expireAfterSeconds === 0);
    // Everything but the ids and HMACs (hex, may hold digit runs): no address, number or name.
    const all = JSON.stringify(await KycResultModel.find({}, { _id: 0, userId: 0, fingerprint: 0, emailKey: 0 }).lean());
    check('no email, phone number or name stored in kycresults', !/@|john|doe|temp|\d{8,}|Membre/.test(all.replace(/"domain":"[^"]*"/g, '')), all.slice(0, 160));

    // ---- unchanged / changed ----
    const callsBefore = workerCalls;
    await kyc.enqueue([String(a)], 'contact_change');
    o = await kyc.processBatch(50, day);
    check('unchanged details → no worker call', o.unchanged === 1 && workerCalls === callsBefore);
    await U.updateOne({ _id: a }, { $set: { email: 'jean.mbarga@yahoo.fr' } });
    await kyc.enqueue([String(a)], 'contact_change');
    o = await kyc.processBatch(50, day);
    const ra2: any = await KycResultModel.findOne({ userId: String(a) }).lean();
    check('changed email → checked again, new fingerprint', o.checked === 1 && ra2.fingerprint !== ra.fingerprint && ra2.trigger === 'contact_change');
    check('the variant link is gone for the new address', ra2.variantAccounts === 0);

    // ---- worker down, then back ----
    if (!REAL) {
        workerDown = true;
        await U.updateOne({ _id: b }, { $set: { phoneNumber: '237670000099' } });
        await kyc.enqueue([String(b)], 'contact_change');
        o = await kyc.processBatch(50, day);
        const row: any = await KycQueueModel.findById(String(b)).lean();
        check('worker down → kept, attempt counted, retried later', o.failed === 1 && row?.attempts === 1 && row.nextAt > day && !row.claimToken);
        workerDown = false;
        o = await kyc.processBatch(50, day);
        check('not due yet → not retried', o.claimed === 0);
        o = await kyc.processBatch(50, new Date(day.getTime() + 60 * 60_000));
        check('worker back, due → checked', o.checked === 1 && await KycQueueModel.countDocuments({}) === 0);

        // ---- a hint during a check ----
        await U.updateOne({ _id: c }, { $set: { phoneNumber: '237670000098' } });
        await kyc.enqueue([String(c)], 'contact_change');
        duringCall = async () => { await U.updateOne({ _id: c }, { $set: { email: 'claire@gmail.com' } }); await kyc.enqueue([String(c)], 'contact_change'); };
        o = await kyc.processBatch(50, day);
        check('hint during the check → stays queued', o.checked === 1 && await KycQueueModel.countDocuments({ _id: String(c) }) === 1);
        o = await kyc.processBatch(50, day);
        const rc2: any = await KycResultModel.findOne({ userId: String(c) }).lean();
        check('… and is checked again with the newest details', o.checked === 1 && !rc2.reasons.includes('email_disposable'));
    }

    // ---- refresh + night window ----
    const fresh = await mk({ email: 'nouveau@gmail.com', phoneNumber: '237670000010', country: 'BJ' });
    await U.updateOne({ _id: b }, { $set: { momoNumber: '237690000002', momoOperator: 'ORANGE_CMR' } });
    const dry = await kyc.refreshScan({ dryRun: true });
    check('refresh dry run: 1 never checked, 1 changed, nothing queued', dry.missing === 1 && dry.changed === 1 && dry.queued === 0 && await KycQueueModel.countDocuments({}) === 0, JSON.stringify(dry));
    const ref = await kyc.refreshScan();
    check('refresh: both queued as backfill', ref.queued === 2 && await KycQueueModel.countDocuments({ priority: KYC_BACKFILL }) === 2);
    o = await kyc.processBatch(50, day);
    check('backfill not processed at 12:00 Douala', o.claimed === 0);
    await kyc.enqueue([String(b)], 'contact_change');
    check('a live hint lifts a backfill row to live', (await KycQueueModel.findById(String(b)).lean() as any)?.priority === KYC_LIVE);
    o = await kyc.processBatch(50, day);
    check('… which is processed by day', o.checked === 1 && await KycQueueModel.countDocuments({}) === 1);
    o = await kyc.processBatch(50, atDouala(3));
    check('backfill processed at 03:30 Douala', o.checked === 1 && await KycResultModel.countDocuments({ userId: String(fresh) }) === 1);
    check('Douala hour helper', kyc.doualaHour(atDouala(3)) === 3 && kyc.inNightWindow(atDouala(2)) && !kyc.inNightWindow(atDouala(5)));

    // ---- member view ----
    const view = await axios.get(`${base}/api/risk/internal/members/${a}`, auth);
    const k = view.data?.data?.kyc;
    check('member view carries kyc (score, band, signals), no keys', !!k && typeof k.score === 'number' && !!k.signals && !('emailKey' in k) && !('fingerprint' in k));
    const st = await axios.get(`${base}/api/risk/internal/kyc/status`, auth);
    check('status: results counted, no member data', st.data?.data?.results === 4 && !JSON.stringify(st.data).includes('@'));

    // ---- throughput with the fake worker ----
    if (!REAL) {
        const many = Array.from({ length: 3000 }, (_, i) => ({ name: 'x', password: 'x', email: `m${i}@gmail.com`, phoneNumber: `2376800${String(i).padStart(5, '0')}`, country: 'CM' }));
        const ins = await U.insertMany(many);
        await kyc.enqueue(Object.values(ins.insertedIds).map(String), 'signup');
        const t0 = Date.now();
        let n = 0;
        while (n < 3000) { const r = await kyc.processBatch(500, day); if (!r.claimed) break; n += r.checked; }
        const ms = Date.now() - t0;
        check('3,000 members in batches of 500', n === 3000, `${ms} ms, ${Math.round(3000 / (ms / 1000))}/s on the risk side`);
    }

    srv.close(); fakeSrv.close();
    await users.dropDatabase(); await users.close();
    await mongoose.connection.dropDatabase(); await mongoose.disconnect();
    console.log(failures ? `\n${failures} FAILED` : '\nall passed');
    process.exit(failures ? 1 : 0);
};
main().catch((e) => { console.error(e); process.exit(1); });
