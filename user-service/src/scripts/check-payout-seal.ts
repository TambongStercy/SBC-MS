/**
 * Asserts the payout seal (utils/payout-seal.ts + services/payout-seal.service.ts) against a local
 * MongoDB, with fake payment-service and support-service:
 *   - every write through the model (create, updateOne, findOneAndUpdate, updateMany, save) seals;
 *   - a change made straight in the collection (no model) breaks the seal; the withdrawal check
 *     then freezes the money (lock = account_frozen) and files ONE critical case with the evidence
 *     (sealed vs current number, never used for a withdrawal, where the money really went);
 *   - a later app write on that member does NOT launder the tamper (no reseal), and is reported;
 *   - a seal copied from another member is refused; a removed seal counts once PAYOUT_SEAL_SINCE is set;
 *   - mode log: case, no freeze; the nightly sweep finds a tamper nobody withdrew on;
 *   - bootstrap seals the unsealed and lists a current number never used for withdrawals.
 *
 *   npx ts-node --transpile-only src/scripts/check-payout-seal.ts
 */
import http from 'http';
import { AddressInfo } from 'net';
import mongoose, { Types } from 'mongoose';

const DB = process.env.SEAL_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_users_payout_seal_check';
process.env.SERVICE_SECRET = 'check-secret';
process.env.PAYOUT_SEAL_KEY = 'k'.repeat(40);
delete process.env.PAYOUT_SEAL_SINCE;
delete process.env.PAYOUT_SEAL_MODE;
delete process.env.RISK_SERVICE_URL;

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`); if (!ok) failures++; };
const cases: any[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const fake = (handler: (url: string, body: any) => unknown) => new Promise<http.Server>((resolve) => {
    const srv = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => {
            const out = handler(req.url ?? '', raw ? JSON.parse(raw) : null);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(out));
        });
    }).listen(0, () => resolve(srv));
});

(async () => {
    const support = await fake((url, body) => { cases.push(body); return { success: true, data: { caseId: `c${cases.length}`, created: true } }; });
    const payment = await fake((_url, body) => ({ success: true, data: Object.fromEntries((body.userIds as string[]).map((id) => [id, { momo: [{ n: '670000011', at: '2026-10-01T00:00:00Z', count: 4 }], crypto: [] }])) }));
    process.env.SUPPORT_SERVICE_URL = `http://127.0.0.1:${(support.address() as AddressInfo).port}`;
    process.env.PAYMENT_SERVICE_URL = `http://127.0.0.1:${(payment.address() as AddressInfo).port}`;

    if (!/_check$/.test(new URL(DB).pathname.slice(1))) throw new Error('check databases only');
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();
    const { default: UserModel } = await import('../database/models/user.model');
    const svc = await import('../services/payout-seal.service');
    const { sealState } = await import('../utils/payout-seal');
    const { setTamperHandler } = await import('../utils/payout-seal');
    const { withdrawalLockStatus } = await import('../utils/withdrawal-lock');
    setTamperHandler((id, st, where) => { void svc.handleTamper(id, st, where); });
    const raw = UserModel.collection;
    const state = async (id: unknown) => sealState((await raw.findOne({ _id: id as any }, { projection: { momoNumber: 1, momoOperator: 1, cryptoWalletAddress: 1, cryptoWalletCurrency: 1, payoutSeal: 1 } })) as any);
    const mk = (i: number, over: object = {}) => UserModel.create({ name: `Seal ${i}`, email: `seal${i}@x.test`, phoneNumber: `23767000${String(i).padStart(4, '0')}`, password: 'x'.repeat(12), country: 'CM', momoNumber: '237670000011', momoOperator: 'MTN_MOMO_CMR', ...over } as any);

    const a = await mk(1);
    check('create seals', (await state(a._id)) === 'ok');
    await UserModel.updateOne({ _id: a._id }, { $set: { momoNumber: '237670000022' } });
    check('updateOne through the model reseals', (await state(a._id)) === 'ok');
    await UserModel.findOneAndUpdate({ _id: a._id }, { $set: { cryptoWalletAddress: 'TXyz1234567890abcd', cryptoWalletCurrency: 'TRX' } });
    check('findOneAndUpdate reseals', (await state(a._id)) === 'ok');
    const doc: any = await UserModel.findById(a._id);
    doc.momoOperator = 'ORANGE_CMR';
    await doc.save();
    check('save() reseals', (await state(a._id)) === 'ok');
    const b = await mk(2); const c = await mk(3);
    await UserModel.updateMany({ _id: { $in: [b._id, c._id] } }, { $set: { momoOperator: 'ORANGE_CMR' } });
    check('updateMany reseals each', (await state(b._id)) === 'ok' && (await state(c._id)) === 'ok');
    await UserModel.updateOne({ _id: b._id }, { $set: { name: 'Renamed' } });
    check('a write not touching the destination leaves the seal valid', (await state(b._id)) === 'ok');

    // tamper straight in the collection
    await raw.updateOne({ _id: b._id }, { $set: { momoNumber: '237699999999' } });
    check('a change straight in the database breaks the seal', (await state(b._id)) === 'mismatch');
    const st = await svc.checkPayoutSeal(b._id, 'withdrawal check');
    await sleep(100);
    const bAfter: any = await raw.findOne({ _id: b._id });
    check('withdrawal check: money frozen (by payout_seal) → lock account_frozen', st === 'mismatch' && !!bAfter.frozen?.at && bAfter.frozen.by === 'payout_seal' && withdrawalLockStatus(bAfter).reason === 'account_frozen');
    const k = cases.filter((x) => x.subject?.userId === String(b._id));
    check('one critical case with the evidence', k.length === 1 && k[0].severity === 'critical' && k[0].type === 'abnormal_behavior'
        && k[0].details.sealed.momo === '…011' && k[0].details.current.momo === '…999' && k[0].details.currentMomoUsedForAWithdrawal === false
        && k[0].details.withdrewTo.momo[0].number === '…011' && /jamais utilisé pour un retrait/.test(k[0].summary), JSON.stringify(k[0]?.summary));
    check('no full number in the case', !JSON.stringify(k).includes('699999999') && !JSON.stringify(k).includes('670000011'));
    await svc.checkPayoutSeal(b._id, 'withdrawal check');
    await sleep(100);
    check('a second check files no second case', cases.filter((x) => x.subject?.userId === String(b._id)).length === 1);

    await UserModel.updateOne({ _id: b._id }, { $set: { momoOperator: 'MTN_MOMO_CMR' } });
    await sleep(150);
    check('a later app write does not launder the tamper', (await state(b._id)) === 'mismatch');

    // a seal copied from another member
    const seal = (await raw.findOne({ _id: c._id }, { projection: { payoutSeal: 1 } }) as any).payoutSeal;
    await raw.updateOne({ _id: a._id }, { $set: { payoutSeal: seal, momoNumber: '237670000011', momoOperator: 'ORANGE_CMR', cryptoWalletAddress: null, cryptoWalletCurrency: null } });
    check('a seal copied from another member does not match', (await state(a._id)) === 'mismatch');

    // removed seal: ignored before bootstrap, a tamper after
    const d = await mk(4);
    await raw.updateOne({ _id: d._id }, { $unset: { payoutSeal: 1 }, $set: { momoNumber: '237655555555' } });
    check('no seal before PAYOUT_SEAL_SINCE → not judged', (await state(d._id)) === 'off');
    process.env.PAYOUT_SEAL_SINCE = '2026-11-22T00:00:00Z';
    check('no seal after PAYOUT_SEAL_SINCE → a tamper', (await state(d._id)) === 'missing');

    // log mode: a case, no freeze
    process.env.PAYOUT_SEAL_MODE = 'log';
    const e = await mk(5);
    await raw.updateOne({ _id: e._id }, { $set: { momoNumber: '237644444444' } });
    await svc.checkPayoutSeal(e._id, 'withdrawal check');
    const eAfter: any = await raw.findOne({ _id: e._id });
    check('mode log: case filed, nothing frozen', !eAfter.frozen && cases.some((x) => x.subject?.userId === String(e._id)));
    process.env.PAYOUT_SEAL_MODE = 'enforce';

    // nightly sweep: a tamper nobody withdrew on
    const f = await mk(6);
    await raw.updateOne({ _id: f._id }, { $set: { cryptoWalletAddress: 'TAttackerWallet0000' } });
    const sw = await svc.sweepPayoutSeals();
    const fAfter: any = await raw.findOne({ _id: f._id });
    check('nightly sweep finds it, freezes, files a case', sw.broken >= 1 && !!fAfter.frozen?.at && cases.some((x) => x.subject?.userId === String(f._id)));

    // bootstrap
    delete process.env.PAYOUT_SEAL_SINCE;
    const g = new Types.ObjectId();
    await raw.insertOne({ _id: g, name: 'Old', email: 'old@x.test', momoNumber: '237633333333', momoOperator: 'MTN_MOMO_CMR' } as any);
    const dry = await svc.bootstrapPayoutSeals(false, false);
    check('bootstrap dry run: counts, lists a number never used for withdrawals, seals nothing', dry.unsealed >= 2 && dry.sealed === 0 && dry.mismatches.some((m) => m.userId === String(g) && m.current === '…333') && !(await raw.findOne({ _id: g }) as any).payoutSeal);
    const before = cases.length;
    const ap = await svc.bootstrapPayoutSeals(true, true);
    check('bootstrap --apply --cases: sealed, warning case without alert', ap.sealed >= 2 && (await state(g)) === 'ok'
        && cases.slice(before).some((x) => x.subject?.userId === String(g) && x.severity === 'warning' && x.alert === false));

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    support.close(); payment.close();
    console.log(failures ? `\n${failures} FAILED` : '\nall passed');
    process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
