/**
 * Asserts Security plan Phase 7 (dormant accounts), user-service side:
 *   - the nightly pass: status from the last sign of life (sign-in, token,
 *     IP, creation), only accounts holding money, total in XAF, flags
 *     (commissions without sign-in, authenticator, fraud = frozen), accounts
 *     that no longer hold money leave the list, deleted ones never enter it;
 *   - the snapshot: card = sum of the list (nightly check), breakdowns;
 *   - the list: biggest first, cursor pages with no duplicate, every filter,
 *     first-page totals equal the card;
 *   - actions: mark checked, freeze request (refusals);
 *   - coming back: log mode records without holding; on mode holds 72 h (the
 *     lock check names it, a contact change cannot shorten it), opens a case
 *     with a new country, once; a contact change during the hold opens one;
 *     an account only inactive (90–180 days) is not held;
 *   - the CSV export: built in the background, every row, no spreadsheet
 *     formula, removed after 24 h.
 *
 * Needs local Mongo; uses its own database and drops it.
 *
 *   npx ts-node --transpile-only src/scripts/check-dormancy.ts
 */
import http from 'http';
import { AddressInfo } from 'net';
import mongoose, { Types } from 'mongoose';

const DB = process.env.DORMANCY_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_users_dormancy_check';
process.env.SERVICE_SECRET = process.env.SERVICE_SECRET || 'check-secret';
process.env.DORMANCY_REACTIVATION_HOLD = 'log';
delete process.env.RISK_SERVICE_URL;
delete process.env.SUPPORT_SERVICE_URL;

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const fakeToken = (iat: Date) => `x.${Buffer.from(JSON.stringify({ userId: 'u', iat: Math.floor(iat.getTime() / 1000) })).toString('base64url')}.y`;
const streamText = (s: NodeJS.ReadableStream) => new Promise<string>((resolve, reject) => {
    let out = '';
    s.on('data', (c: Buffer) => { out += c.toString('utf8'); });
    s.on('end', () => resolve(out));
    s.on('error', reject);
});

const main = async () => {
    const UserModel = (await import('../database/models/user.model')).default;
    const WalletMovementModel = (await import('../database/models/wallet-movement.model')).default;
    const { MemberAuthModel } = await import('../database/models/member-auth.model');
    const { DormancySnapshotModel, DormancyReturnModel, DormancyExportModel } = await import('../database/models/dormancy.model');
    const dz = await import('../services/dormancy.service');
    const { withdrawalLockStatus, withdrawalLockFields } = await import('../utils/withdrawal-lock');

    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();
    await UserModel.syncIndexes();
    await DormancyReturnModel.syncIndexes();

    let n = 0;
    const mk = async (extra: Record<string, unknown>, createdDaysAgo = 30) => {
        n += 1;
        const u = await UserModel.create({
            name: `Dorm ${n}`, email: `dorm.${n}@e2e.test`, phoneNumber: `2376780${String(n).padStart(5, '0')}`, password: 'Secret123!',
            country: 'CM', referralCode: `DORMREF${n}`, ...extra,
        } as any);
        await UserModel.collection.updateOne({ _id: u._id }, { $set: { createdAt: ago(createdDaysAgo) } });
        return u._id as Types.ObjectId;
    };
    const A = await mk({ balance: 10_000, dormancy: { lastSignInAt: ago(10) } }, 400);
    const B = await mk({ balance: 3_000, ipLastUpdated: ago(100) }, 400);
    const C = await mk({ usdBalance: 100, token: fakeToken(ago(200)) }, 600);
    const D = await mk({ balance: 250_000, country: 'CONGO-BRAZZAVILLE' }, 500);
    const E = await mk({ balance: 0, dormancy: { status: 'dormant', heldXaf: 5000, runId: 'old' } }, 500);
    const F = await mk({ balance: 9_000, deleted: true }, 500);
    const G = await mk({ balance: 40_000, frozen: { at: new Date(), reason: 'check' } }, 300);
    const H = await mk({ balance: 20_000, activationBalance: 5_000, name: '=HYPERLINK("x")' }, 250);
    await MemberAuthModel.create({ userId: C, totpSecretEnc: 'enc', totpEnrolledAt: new Date() });
    await WalletMovementModel.create([
        { reference: 'commission:c1', direction: 'CREDIT', userId: C, currency: 'XAF', amount: 1000, requestedAmount: 1000, source: 'commission', status: 'APPLIED', appliedAt: ago(30) },
        { reference: 'withdrawal:d1', direction: 'DEBIT', userId: D, currency: 'XAF', amount: 5000, requestedAmount: -5000, source: 'withdrawal', status: 'APPLIED', appliedAt: ago(400) },
    ]);

    // ---- nightly pass ----
    const run = await dz.runDormancyPass(new Date(), { batch: 2 });
    const get = async (id: Types.ObjectId) => (await UserModel.collection.findOne({ _id: id })) as any;
    const [a, b, c, d, e, f, g, h] = await Promise.all([A, B, C, D, E, F, G, H].map(get));
    check('pass ran, 6 accounts holding money (deleted one left out)', run?.accounts === 6, JSON.stringify(run));
    check('A signed in 10 days ago → active (basis signin)', a.dormancy.status === 'active' && a.dormancy.basis === 'signin');
    check('B: IP date 100 days ago → inactive', b.dormancy.status === 'inactive' && b.dormancy.basis === 'ip');
    check('C: token issued 200 days ago → dormant (basis token)', c.dormancy.status === 'dormant' && c.dormancy.basis === 'token');
    check('D: nothing but creation 500 days ago → long_dormant', d.dormancy.status === 'long_dormant' && d.dormancy.basis === 'created');
    check('C: 100 USD = 66,000 F at 660', c.dormancy.heldXaf === 66_000);
    check('H: two balances added up (created 250 days ago → dormant)', h.dormancy.heldXaf === 25_000 && h.dormancy.status === 'dormant');
    check('C: commission 30 days ago with no sign-in → flagged', c.dormancy.commissionsNoLogin === true && !!c.dormancy.lastCommissionAt);
    check('A: active → never flagged', a.dormancy.commissionsNoLogin === false);
    check('C: authenticator set up, D not', c.dormancy.authenticator === true && d.dormancy.authenticator === false);
    check('D: last withdrawal from the ledger', d.dormancy.lastWithdrawalAt?.getTime() === ago(400).setHours(0, 0, 0, 0) || !!d.dormancy.lastWithdrawalAt);
    check('G: frozen → fraud flag (risk-service unreachable)', g.dormancy.fraudFlag === true && c.dormancy.fraudFlag === false);
    check('E: no money any more → status removed', !e.dormancy?.status && e.dormancy?.heldXaf === undefined);
    check('F: deleted → no status', !f.dormancy?.status);

    const snap: any = await DormancySnapshotModel.findOne({}).lean();
    check('snapshot: all = 6 accounts', snap.all.count === 6);
    check('snapshot: dormant card = B+C+D+G+H (5) = 384,000 F', snap.dormant.count === 5 && snap.dormant.xafEq === 3_000 + 66_000 + 250_000 + 40_000 + 25_000, `${snap.dormant.count} / ${snap.dormant.xafEq}`);
    check('nightly check: card = list', snap.check?.ok === true, JSON.stringify(snap.check));
    check('by country: Congo name read as CG', snap.dormant.byCountry.some((x: any) => x.country === 'CG' && x.xafEq === 250_000));
    check('by size: one above 200,000', snap.dormant.bySize.find((x: any) => x.key === 'gt200k').count === 1);
    check('by balance: USD counted in XAF', snap.dormant.byBalance.usdBalance === 66_000 && snap.dormant.byBalance.activationBalance === 5_000);
    check('flags: 1 commission-without-sign-in, 1 fraud', snap.dormant.flags.commissionsNoLogin.count === 1 && snap.dormant.flags.fraudFlag.count === 1);

    const sum = await dz.dormancySummary();
    check('summary ready, share = dormant / all', sum.ready && Math.abs(sum.share - Math.round((384_000 / 394_000) * 100) / 100) < 0.01, String(sum.share));
    check('summary: one month in the trend, no previous month yet', sum.trend.length === 1 && sum.previous === null);

    // ---- list ----
    const all = await dz.listDormant({});
    check('list: biggest first', all.items.map(i => i._id).join() === [D, C, G, H, B].map(String).join());
    check('list: first-page totals = the card', all.totals?.count === snap.dormant.count && all.totals?.xafEq === snap.dormant.xafEq);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
        const p: any = await dz.listDormant({}, { cursor, limit: 2 });
        seen.push(...p.items.map((i: any) => i._id));
        cursor = p.nextCursor;
    } while (cursor);
    check('list: cursor pages of 2, every row once', seen.length === 5 && new Set(seen).size === 5);
    const ids = async (f: Record<string, string>) => (await dz.listDormant(dz.parseDormantFilters(f))).items.map(i => i._id).sort().join();
    const s = (...x: Types.ObjectId[]) => x.map(String).sort().join();
    check('filter status=dormant', await ids({ status: 'dormant' }) === s(C, G, H));
    check('filter country=CG', await ids({ country: 'cg' }) === s(D));
    check('filter minXaf=50000', await ids({ minXaf: '50000' }) === s(C, D));
    check('filter authenticator=yes / no', await ids({ authenticator: 'yes' }) === s(C) && !(await ids({ authenticator: 'no' })).includes(String(C)));
    check('filter fraud=yes', await ids({ fraud: 'yes' }) === s(G));
    check('filter withdrawal=never leaves D out', !(await ids({ withdrawal: 'never' })).includes(String(D)) && await ids({ withdrawal: 'over_90d' }) === s(D));
    check('filter commissionsNoLogin', await ids({ commissionsNoLogin: 'yes' }) === s(C));
    check('unknown filter values ignored', await ids({ status: 'active', country: 'Cameroun' }) === s(B, C, D, G, H));

    // ---- actions ----
    await dz.markChecked(String(D), 'admin1', 'Vu avec la famille');
    check('mark checked → filter checked=yes', await ids({ checked: 'yes' }) === s(D));
    let refused = '';
    try { await dz.markChecked(String(A), 'admin1', null); } catch (err: any) { refused = err.message; }
    check('mark checked: an active account is not in the list → refused', refused.includes('pas dans la liste'));
    refused = '';
    try { await dz.requestFreeze(String(D), 'admin1', 'court'); } catch (err: any) { refused = err.message; }
    check('freeze request: short reason refused', refused.includes('10 caractères'));
    refused = '';
    try { await dz.requestFreeze(String(G), 'admin1', 'Déjà gelé, on redemande'); } catch (err: any) { refused = String(err.status); }
    check('freeze request: already frozen → 409', refused === '409');

    // ---- export ----
    const ex = await dz.startExport({}, 'admin1');
    let st: any = null;
    for (let i = 0; i < 50; i++) {
        st = await dz.exportStatus(ex.id);
        if (st?.status !== 'running') break;
        await new Promise(r => setTimeout(r, 50));
    }
    check('export done in the background, 5 rows', st?.status === 'done' && st.rows === 5, JSON.stringify(st));
    const file = await dz.openExportFile(ex.id);
    const csv = file ? await streamText(file.stream) : '';
    const lines = csv.trim().split('\n');
    check('CSV: header + 5 lines, biggest first', lines.length === 6 && lines[0].includes('statut') && lines[1].startsWith(String(D)));
    check('CSV: a name starting with = is not a formula', csv.includes(`"'=HYPERLINK(""x"")"`) && !csv.includes(',=HYPERLINK'));
    let busy = '';
    await DormancyExportModel.create({ createdBy: 'admin2', status: 'running' });
    try { await dz.startExport({}, 'admin2'); } catch (err: any) { busy = String(err.status); }
    check('one running export per admin', busy === '409');
    check('exports removed after 24 h', (await dz.clearOldExports(new Date(Date.now() + 25 * 3_600_000))) === 2 && !(await dz.openExportFile(ex.id)));

    // ---- coming back: log mode ----
    await dz.noteSignIn(String(D), { country: 'CG' });
    d.x = await get(D);
    check('log mode: D active again, return recorded, nothing held', d.x.dormancy.status === 'active' && !!d.x.dormancy.reactivatedAt && !d.x.dormancy.holdUntil && d.x.dormancy.reactivatedFrom === 'long_dormant'
        && !withdrawalLockStatus(d.x).locked);
    await dz.noteSignIn(String(D), { country: 'CG' });
    check('a second sign-in is not a second return', (await DormancyReturnModel.countDocuments({ userId: D })) === 1);
    await dz.noteSignIn(String(B), { country: 'CM' });
    b.x = await get(B);
    check('inactive (90–180 days) is not a return', b.x.dormancy.status === 'inactive' && !b.x.dormancy.reactivatedAt && !!b.x.dormancy.lastSignInAt);
    const fresh = await mk({ balance: 1 });
    await dz.noteSignIn(String(fresh));
    check('every sign-in records its date', !!(await get(fresh)).dormancy?.lastSignInAt);

    // ---- coming back: hold on, support receives the cases ----
    const received: any[] = [];
    const fake = http.createServer((req, res) => {
        let body = '';
        req.on('data', ch => { body += ch; });
        req.on('end', () => { received.push(JSON.parse(body)); res.writeHead(201, { 'content-type': 'application/json' }); res.end('{"success":true,"data":{"caseId":"c1","created":true}}'); });
    }).listen(0);
    process.env.SUPPORT_SERVICE_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
    process.env.DORMANCY_REACTIVATION_HOLD = 'on';

    await dz.noteSignIn(String(C), { country: 'BJ', deviceId: 'dev-1' });
    c.x = await get(C);
    const hold = c.x.dormancy.holdUntil ? (new Date(c.x.dormancy.holdUntil).getTime() - Date.now()) / 3_600_000 : 0;
    check('on: withdrawals held ~72 h', hold > 71.9 && hold <= 72);
    const lock = withdrawalLockStatus(c.x);
    check('lock check names the return hold', lock.locked && lock.reason === 'dormant_reactivation');
    const ret: any = await DormancyReturnModel.findOne({ userId: C }).lean();
    check('return: new country BJ (declared CM), no device known before', ret.signals.newCountry && ret.signals.country === 'BJ' && ret.signals.newDevice === null && ret.held && ret.caseOpened);
    check('case sent to support: dormant_reactivation, with the amount', received.length === 1 && received[0].type === 'dormant_reactivation' && received[0].amount === 66_000 && received[0].subject.userId === String(C), JSON.stringify(received[0]));

    await UserModel.updateOne({ _id: C }, { $set: withdrawalLockFields('momo_change') });
    c.y = await get(C);
    check('a 48 h MoMo lock cannot shorten the 72 h hold', withdrawalLockStatus(c.y).reason === 'dormant_reactivation');
    check('a contact change during the hold opens its own case, once', (await dz.watchHolds()) === 1 && (await dz.watchHolds()) === 0
        && received.length === 2 && received[1].dedupKey.endsWith(':contact'));
    await UserModel.updateOne({ _id: C }, { $set: withdrawalLockFields('email_change', new Date(), 100) });
    check('a longer timed lock shows instead', withdrawalLockStatus(await get(C)).reason === 'email_change');

    await dz.noteSignIn(String(H), { country: 'CM' });
    const hRet: any = await DormancyReturnModel.findOne({ userId: H }).lean();
    check('on, nothing unusual: held but no case', hRet.held && !hRet.caseOpened && received.length === 2);

    fake.close();
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
};

main().catch(err => { console.error(err); process.exit(1); });
