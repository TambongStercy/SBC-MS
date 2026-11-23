/**
 * Asserts Security plan Phase 8, KYC level 2 (2026-11-23), main-server side. Local Mongo,
 * test databases only, dropped before and after; a fake secondary verifies signatures and
 * answers like kyc-worker (allowlist, off mode):
 *   - only flagged members are queued: score require_code / hold (sweep), a risky authenticator
 *     setup, a dormant account back, a contact change by a flagged member; never an allowed
 *     member's sign-up, phone change or plain setup;
 *   - the address is read at send time (read-only) and never stored on the main server;
 *   - the secondary's answer is recorded and decides when the member may be asked again
 *     (queued/fresh: 90 days; not_allowlisted/off: 1 day); deleted member dropped; no e-mail;
 *   - an e-mail change sends `forget` first, then (flagged) a new check;
 *   - secondary down → kept with a back-off;
 *   - KYC_L2_ONLY_EMAILS set: other addresses are skipped on the main server (never sent), not
 *     retried daily, and queued again once the list is emptied;
 *   - the member view carries `level2`.
 *
 *   npx ts-node --transpile-only src/scripts/check-kyc-l2.ts
 */
import express from 'express';
import mongoose from 'mongoose';
import { createHmac } from 'crypto';
import { AddressInfo } from 'net';

const BASE = process.env.RISK_TEST_MONGO || 'mongodb://127.0.0.1:27017';
process.env.MONGODB_URI = `${BASE}/sbc_risk_kyc_l2_test`;
process.env.SERVICE_SECRET = 'risk-check-secret-0123456789';
process.env.RISK_HASH_KEY = 'risk-check-hash-key';
process.env.SUPPORT_SERVICE_URL = 'http://127.0.0.1:9';
process.env.USERS_MONGODB_URI = `${BASE}/sbc_users_kyc_l2_test`;
process.env.KYC_SHARED_SECRET = 'k'.repeat(48);
process.env.KYC_WORKER_URL = 'http://127.0.0.1:1';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};
const DAY = 86_400_000;

const main = async () => {
    const { config } = await import('../config');
    const { KycL2QueueModel, KycL2RequestModel, RiskMemberModel, RiskEventModel } = await import('../database/models');
    const l2 = await import('../services/kyc-l2.service');
    const live = await import('../services/live.service');
    const kyc = await import('../services/kyc.service');

    // ---- fake secondary ----
    const allow = new Set(['test.allowed@example.org', 'flagged.new@example.org']);
    const calls: { path: string; body: any }[] = [];
    const level2 = new Map<string, any>();
    let down = false;
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
    fake.post('/v1/l2/enqueue', (req, res) => res.json({
        outcomes: Object.fromEntries((req as any).json.items.map((i: any) => [i.ref, allow.has(i.email) ? 'queued' : 'not_allowlisted'])),
    }));
    fake.post('/v1/l2/forget', (req, res) => { (req as any).json.refs.forEach((r: string) => level2.delete(r)); res.json({ forgotten: 1 }); });
    fake.post('/v1/results', (req, res) => res.json({
        results: Object.fromEntries((req as any).json.refs.filter((r: string) => level2.has(r)).map((r: string) => [r, {
            level: 2, score: 15, band: 'low', reasons: ['email_no_footprint'], signals: {}, variantAccounts: 0, checkedAt: new Date().toISOString(), level2: level2.get(r),
        }])),
    }));
    const fakeSrv = await new Promise<any>(r => { const s = fake.listen(0, '127.0.0.1', () => r(s)); });
    (config.kyc as any).workerUrl = `http://127.0.0.1:${(fakeSrv.address() as AddressInfo).port}`;

    await mongoose.connect(process.env.MONGODB_URI!);
    await mongoose.connection.dropDatabase();
    await KycL2QueueModel.syncIndexes(); await KycL2RequestModel.syncIndexes();
    const users = mongoose.createConnection(process.env.USERS_MONGODB_URI!);
    await users.asPromise();
    await users.dropDatabase();
    (await import('../lib/sources')).setSource('users', users);
    const U = users.collection('users');
    const mk = async (f: Record<string, unknown>) => String((await U.insertOne({ name: 'Membre Test', password: 'x', ...f })).insertedId);
    const member = (userId: string, decision: string, score: number) =>
        RiskMemberModel.updateOne({ userId }, { $set: { userId, groupId: userId, groupSize: 1, reasons: [], structuralScore: score, score, decision, scoredAt: new Date() } }, { upsert: true });

    const held = await mk({ email: 'test.allowed@example.org' });
    const coded = await mk({ email: 'real.member@gmail.com' });
    const fine = await mk({ email: 'fine@gmail.com' });
    const gone = await mk({ email: 'gone@gmail.com', deleted: true });
    const noMail = await mk({});
    await member(held, 'hold', 80); await member(coded, 'require_code', 45); await member(fine, 'allow', 0);
    await member(gone, 'hold', 90); await member(noMail, 'require_code', 40);

    // ---- sweep: flagged members only ----
    const now = new Date();
    check('sweep queues the 4 flagged members, not the allowed one', await l2.sweepFlagged(now) === 4 && !(await KycL2QueueModel.exists({ _id: fine })));
    check('triggers follow the decision', (await KycL2QueueModel.findById(held).lean() as any)?.trigger === 'score_hold'
        && (await KycL2QueueModel.findById(coded).lean() as any)?.trigger === 'score_require_code');
    check('a second sweep queues nothing new', await l2.sweepFlagged(now) === 0);

    // ---- forward ----
    const f = await l2.forwardL2(50, now);
    const sent = calls.filter(c => c.path === '/v1/l2/enqueue').flatMap(c => c.body.items);
    check('addresses read at send time, signed, lower case', sent.length === 2 && sent.some((i: any) => i.ref === held && i.email === 'test.allowed@example.org' && i.trigger === 'score_hold'));
    check('deleted member dropped, member without e-mail recorded', f.gone === 1 && (await KycL2RequestModel.findById(noMail).lean() as any)?.outcome === 'no_email');
    const rHeld: any = await KycL2RequestModel.findById(held).lean();
    const rCoded: any = await KycL2RequestModel.findById(coded).lean();
    check('queued → asked again in 90 days; not_allowlisted → tomorrow',
        rHeld?.outcome === 'queued' && Math.round((rHeld.retryAt - now.getTime()) / DAY) === 90
        && rCoded?.outcome === 'not_allowlisted' && Math.round((rCoded.retryAt - now.getTime()) / DAY) === 1);
    check('outbox empty after sending', await KycL2QueueModel.countDocuments({}) === 0);
    const stored = JSON.stringify([await KycL2QueueModel.find({}).lean(), await KycL2RequestModel.find({}).lean()]);
    check('no address stored on the main server', !stored.includes('@'));
    check('sweep the next minute: nothing (asked recently)', await l2.sweepFlagged(new Date(now.getTime() + 60_000)) === 0);
    check('sweep two days later: the not_allowlisted member is asked again', await l2.sweepFlagged(new Date(now.getTime() + 2 * DAY)) === 1);
    await KycL2QueueModel.deleteMany({});

    // ---- events ----
    const ev = async (type: any, userId: string, data: any = {}) => { await live.recordEvent({ type, userId, data }); await live.processEvents(); };
    const plain = await mk({ email: 'plain@gmail.com' });
    await ev('authenticator_change', plain, { kind: 'setup' });
    check('plain authenticator setup: no lookup', !(await KycL2QueueModel.exists({ _id: plain })));
    await ev('authenticator_change', plain, { kind: 'setup', review: true });
    check('risky authenticator setup → auth_setup_review', (await KycL2QueueModel.findById(plain).lean() as any)?.trigger === 'auth_setup_review');
    check('the review flag passes the event parser', (live.hintToEvent({ type: 'authenticator_change', userId: plain, kind: 'setup', review: true }, 'x') as any).data?.review === true);
    await KycL2QueueModel.deleteMany({});

    const sleeper = await mk({ email: 'sleeper@gmail.com' });
    await ev('dormant_reactivated', sleeper, { from: 'dormant' });
    check('dormant account back → dormant_reactivated', (await KycL2QueueModel.findById(sleeper).lean() as any)?.trigger === 'dormant_reactivated');
    await KycL2QueueModel.deleteMany({});

    await ev('contact_change', fine, { kind: 'phone' });
    check('allowed member changes phone: no lookup', !(await KycL2QueueModel.exists({ _id: fine })));
    await ev('contact_change', fine, { kind: 'email' });
    const fq: any = await KycL2QueueModel.findById(fine).lean();
    check('allowed member changes e-mail: forget only', fq?.action === 'forget' && fq?.trigger === 'forget');
    await KycL2QueueModel.deleteMany({});

    // flagged member (held) changes e-mail: forget, then a check with the new address
    await U.updateOne({ _id: new mongoose.Types.ObjectId(held) }, { $set: { email: 'flagged.new@example.org' } });
    level2.set(held, { found: [], asked: 20, answered: 12, gravatar: false });
    await ev('contact_change', held, { kind: 'email' });
    check('flagged member changes e-mail: forget queued, request record cleared',
        (await KycL2QueueModel.findById(held).lean() as any)?.action === 'forget' && !(await KycL2RequestModel.exists({ _id: held })));
    calls.length = 0;
    await l2.forwardL2(50, new Date());
    check('forget sent, then turned into a check', calls.some(c => c.path === '/v1/l2/forget' && c.body.refs.includes(held)) && !level2.has(held)
        && (await KycL2QueueModel.findById(held).lean() as any)?.action === 'check');
    await l2.forwardL2(50, new Date());
    check('check sent with the new address', calls.some(c => c.path === '/v1/l2/enqueue' && c.body.items.some((i: any) => i.ref === held && i.email === 'flagged.new@example.org' && i.trigger === 'contact_change_flagged')));
    await ev('contact_change', coded, { kind: 'momo' });
    check('flagged member asked about yesterday: a MoMo change does not ask again', !(await KycL2QueueModel.exists({ _id: coded })));
    await KycL2QueueModel.deleteMany({}); await KycL2RequestModel.deleteMany({ _id: coded });
    await ev('contact_change', coded, { kind: 'momo' });
    check('flagged member (not asked recently) changes MoMo → contact_change_flagged', (await KycL2QueueModel.findById(coded).lean() as any)?.trigger === 'contact_change_flagged');

    // ---- secondary down ----
    down = true;
    const d = await l2.forwardL2(50, new Date());
    const row: any = await KycL2QueueModel.findById(coded).lean();
    check('secondary down → kept with a back-off', d.failed === 1 && row?.attempts === 1 && row?.nextAt > new Date() && row?.claimToken === null);
    down = false;

    // ---- local allowlist: other addresses never leave the main server ----
    await KycL2QueueModel.deleteMany({}); await KycL2RequestModel.deleteMany({});
    (config.kycL2 as any).onlyEmails = new Set(['test.allowed@example.org']);
    const ok1 = await mk({ email: 'Test.Allowed@example.org' });
    const other = await mk({ email: 'someone.real@gmail.com' });
    await member(ok1, 'hold', 80); await member(other, 'hold', 80);
    await RiskMemberModel.updateMany({ userId: { $nin: [ok1, other] } }, { $set: { decision: 'allow' } });
    const t0 = new Date();
    await l2.sweepFlagged(t0);
    calls.length = 0;
    await l2.forwardL2(50, t0);
    const sentNow = calls.filter(c => c.path === '/v1/l2/enqueue').flatMap(c => c.body.items);
    check('allowlist set: only the allowlisted address is sent', sentNow.length === 1 && sentNow[0].ref === ok1, JSON.stringify(sentNow.map((i: any) => i.ref)));
    check('the other member is skipped here, without its address', (await KycL2RequestModel.findById(other).lean() as any)?.outcome === 'skipped_allowlist'
        && !JSON.stringify(await KycL2RequestModel.find({}).lean()).includes('@'));
    check('no daily loop: a sweep the next day does not queue the skipped member', await l2.sweepFlagged(new Date(t0.getTime() + 2 * DAY)) === 0);
    (config.kycL2 as any).onlyEmails = new Set();
    check('allowlist emptied: the skipped member is queued again', await l2.sweepFlagged(new Date(t0.getTime() + 2 * DAY)) === 1
        && await KycL2QueueModel.exists({ _id: other }) !== null);

    // ---- member view ----
    level2.set(held, { found: ['github'], asked: 20, answered: 9, gravatar: false, checkedAt: new Date().toISOString(), reasons: [], points: 0 });
    const v: any = await kyc.kycView(held);
    check('member view carries level2', v?.level2?.found?.[0] === 'github' && v?.source === 'secondary');
    const st: any = await kyc.kycStatus();
    check('status carries the level 2 outbox', typeof st.level2?.outbox === 'number');
    check('no event failed', await RiskEventModel.countDocuments({ status: { $ne: 'done' } }) === 0);

    fakeSrv.close();
    await users.dropDatabase(); await users.close();
    await mongoose.connection.dropDatabase(); await mongoose.disconnect();
    console.log(failures ? `\n${failures} FAILED` : '\nall passed');
    process.exit(failures ? 1 : 0);
};
main().catch((e) => { console.error(e); process.exit(1); });
