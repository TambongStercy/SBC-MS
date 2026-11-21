/**
 * Asserts Security plan Phase 2 (second ledger, Blnk) on the user-service side,
 * against a REAL local Blnk (infra/blnk/docker-compose.local.yml) and a test
 * Mongo database (dropped before and after):
 *   - a commission replayed 10 times moves Mongo and Blnk once;
 *   - movements inside the opening snapshot and credits that only paid debt are
 *     not posted; the opening is posted once, before the member's first movement;
 *   - A = B = C after credits and a withdrawal;
 *   - drill: a balance edited directly in Mongo is caught (A ≠ B) by the
 *     triple check and the nightly shadow comparison;
 *   - drill: Blnk down → the sync stops without skipping, then catches up;
 *   - a debit Blnk cannot cover is recorded `rejected`;
 *   - a fresh PENDING claim holds the cursor, a stale one is skipped;
 *   - counterpart accounts per source.
 *
 *   BLNK_URL=http://127.0.0.1:5101 BLNK_API_KEY=… npx ts-node --transpile-only src/scripts/check-blnk-ledger.ts
 */
import mongoose, { Types } from 'mongoose';

const DB = process.env.BLNK_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_users_blnk_test';
if (!/_test$/.test(new URL(DB).pathname.slice(1))) { console.error('The database name must end in _test'); process.exit(2); }
if (!process.env.BLNK_URL || !process.env.BLNK_API_KEY) { console.error('Set BLNK_URL and BLNK_API_KEY (local Blnk)'); process.exit(2); }
delete process.env.SUPPORT_SERVICE_URL; // cases are logged, never sent
process.env.BLNK_LEDGER_NAME = `check-${Date.now()}`;
// Blnk keeps every reference it has seen, test runs included: each run uses its own.
const RUN = Date.now().toString(36);

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

const main = async () => {
    const UserModel = (await import('../database/models/user.model')).default;
    const WalletMovementModel = (await import('../database/models/wallet-movement.model')).default;
    const WalletOpeningBalanceModel = (await import('../database/models/wallet-opening-balance.model')).default;
    const { BlnkBalanceModel, BlnkSyncModel } = await import('../database/models/blnk.model');
    const { userService } = await import('../services/user.service');
    const { snapshotOpeningBalances } = await import('./snapshot-opening-balances');
    const sync = await import('../services/blnk/blnk-sync.service');
    const { blnk, PRECISION } = await import('../services/blnk/blnk.client');

    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();
    await Promise.all([WalletMovementModel.syncIndexes(), WalletOpeningBalanceModel.syncIndexes(), BlnkBalanceModel.syncIndexes(), BlnkSyncModel.syncIndexes()]);

    const user = async (fields: Record<string, unknown>) => {
        const _id = new Types.ObjectId();
        await UserModel.collection.insertOne({ _id, name: 'Membre test', email: `${_id}@test.local`, phoneNumber: `2376${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, referralCode: `t${_id}`, balance: 0, usdBalance: 0, debt: 0, ...fields });
        return _id;
    };
    const blnkBalance = async (u: Types.ObjectId, currency = 'XAF') => {
        const row = await BlnkBalanceModel.findOne({ userId: u, currency }).lean();
        return row ? (await blnk.getBalance(row.balanceId)).balance / PRECISION : null;
    };
    const drain = async () => { for (let i = 0; i < 20; i++) { const r = await sync.syncBatch(200); if (!r.processed || r.stopped) return r; } return null; };

    // ---- counterparts ----
    const cp = (source: string, reference = 'x:1') => sync.counterpartFor({ source, reference, direction: 'CREDIT' } as any);
    check('counterparts: commission, deposit, withdrawal, spend, transfer, conversion, admin, unknown',
        cp('commission') === '@Commissions' && cp('deposit') === '@Deposits' && cp('withdrawal') === '@Withdrawals'
        && cp('balance-spend') === '@Purchases' && cp('member-transfer-undo') === '@Transfers' && cp('conversion') === '@Conversions'
        && cp('admin-adjust') === '@Adjustments' && cp('payment-service', 'payment-service:abc') === '@Unclassified');

    // ---- the ledger is created once, however many callers arrive together ----
    const { BlnkStateModel } = await import('../database/models/blnk.model');
    const crowd = await Promise.all(Array.from({ length: 10 }, () => user({ balance: 0 })));
    await Promise.all(crowd.map(u => sync.ensureMemberBalance(u, 'XAF')));
    const ledgerIds = new Set((await Promise.all((await BlnkBalanceModel.find({ userId: { $in: crowd } }).lean()).map(r => blnk.getBalance(r.balanceId)))).map(b => b.ledger_id));
    check('10 members at once → one ledger', ledgerIds.size === 1 && ledgerIds.has(String((await BlnkStateModel.findById('ledgerId').lean())?.value)), `${ledgerIds.size} ledger(s)`);

    // ---- before the snapshot: u2 moves money, then the snapshot is taken ----
    const u1 = await user({ balance: 10000 });
    const u2 = await user({ balance: 0 });
    await userService.updateBalance(String(u2), 500, { reference: `deposit:BEFORE-${RUN}`, source: 'deposit' });
    await new Promise(r => setTimeout(r, 20));
    await snapshotOpeningBalances({ apply: true, log: () => undefined });

    // ---- after the snapshot ----
    await Promise.all(Array.from({ length: 10 }, () => userService.updateBalance(String(u1), 2500, { reference: `commission:sub1:L1-${RUN}`, source: 'commission' })));
    await userService.updateBalance(String(u1), -3000, { reference: `withdrawal:TX9-${RUN}`, source: 'withdrawal' });
    const u3 = await user({ balance: 0, debt: 1000 });
    await userService.updateBalance(String(u3), 400, { reference: `commission:debt-only-${RUN}`, source: 'commission' });

    await drain();
    check('commission replayed 10 times: Mongo +2500 once', (await UserModel.findById(u1).lean())!.balance === 9500);
    check('Blnk: opening 10000 + 2500 − 3000 = 9500', (await blnkBalance(u1)) === 9500, String(await blnkBalance(u1)));
    for (let i = 0; i < 10; i++) await sync.syncBatch(200);
    const replayed = await BlnkSyncModel.countDocuments({ reference: `commission:sub1:L1-${RUN}` });
    check('…and replaying the sync 10 times changes nothing (one sync row, balance 9500)', replayed === 1 && (await blnkBalance(u1)) === 9500);
    const t1 = await sync.tripleCheck(String(u1));
    check('triple check: A = B = C = 9500, agree', t1.agree && t1.a === 9500 && t1.b === 9500 && t1.c === 9500, JSON.stringify(t1));
    check('movement inside the opening is not posted; the opening carries it', (await BlnkSyncModel.findOne({ reference: `deposit:BEFORE-${RUN}` }).lean())?.status === 'skipped_in_opening' && (await blnkBalance(u2)) === null);
    await sync.ensureMemberBalance(u2, 'XAF');
    await sync.ensureMemberBalance(u2, 'XAF');
    check('opening posted once from @OpeningBalances (twice asked)', (await blnkBalance(u2)) === 500);
    check('a credit that only paid debt is not posted', (await BlnkSyncModel.findOne({ reference: `commission:debt-only-${RUN}` }).lean())?.status === 'skipped_zero' && (await sync.tripleCheck(String(u3))).agree);

    // ---- a reference already used by another balance is never counted as synced ----
    const other = await user({ balance: 0 });
    await sync.ensureMemberBalance(other, 'XAF');
    const victim = (await BlnkBalanceModel.findOne({ userId: other, currency: 'XAF' }).lean())!;
    await blnk.post({ amount: 1, reference: `mv:deposit:COLLIDE-${RUN}:CREDIT`, currency: 'XAF', source: '@Deposits', destination: victim.balanceId, description: 'test', allow_overdraft: true, skip_queue: true });
    await userService.updateBalance(String(u2), 7, { reference: `deposit:COLLIDE-${RUN}`, source: 'deposit' });
    await drain();
    const col = await BlnkSyncModel.findOne({ reference: `deposit:COLLIDE-${RUN}` }).lean();
    check('a reference already used by another balance → rejected (REFERENCE_COLLISION), not synced', col?.status === 'rejected' && /REFERENCE_COLLISION/.test(String(col?.error)), String(col?.status));
    await UserModel.collection.updateOne({ _id: u2 }, { $inc: { balance: -7 } });

    // ---- drill: a balance edited directly in Mongo ----
    await UserModel.collection.updateOne({ _id: u1 }, { $inc: { balance: 5000 } });
    const t2 = await sync.tripleCheck(String(u1));
    check('drill: Mongo edited by hand → A ≠ B, not agreed', !t2.agree && t2.reason === 'a_differs_from_b' && t2.a === 14500, JSON.stringify(t2));
    const shadow = await sync.shadowCompare({ batch: 2 });
    check('drill: the nightly shadow comparison reports it', shadow.differences.some(d => d.userId === String(u1)), `${shadow.checked} checked`);

    // ---- a debit Blnk cannot cover ----
    await userService.updateBalance(String(u1), -12000, { reference: `withdrawal:TOO-BIG-${RUN}`, source: 'withdrawal' });
    await drain();
    check('a debit Mongo allowed but Blnk cannot cover → rejected (C now differs)', (await BlnkSyncModel.findOne({ reference: `withdrawal:TOO-BIG-${RUN}` }).lean())?.status === 'rejected' && (await blnkBalance(u1)) === 9500);

    // ---- drill: Blnk down ----
    const realUrl = process.env.BLNK_URL;
    await userService.updateBalance(String(u2), 300, { reference: `deposit:WHILE-DOWN-${RUN}`, source: 'deposit' });
    process.env.BLNK_URL = 'http://127.0.0.1:9';
    const down = await sync.syncBatch(200);
    check('drill: Blnk down → the sync stops, nothing skipped', down.stopped === 'blnk_unavailable' && !(await BlnkSyncModel.exists({ reference: `deposit:WHILE-DOWN-${RUN}` })));
    check('…the lag is visible', (await sync.syncLagMs()) >= 0 && (await sync.syncLagMs(new Date(Date.now() + 10 * 60_000))) > sync.LAG_ALERT_MS);
    let threw = false;
    try { await sync.tripleCheck(String(u2)); } catch { threw = true; }
    check('…and the triple check cannot answer (the payout pre-check refuses in enforce mode)', threw);
    process.env.BLNK_URL = realUrl;
    await drain();
    check('Blnk back: the waiting movement is posted', (await blnkBalance(u2)) === 800 && (await sync.syncLagMs()) === 0);

    // ---- pending claims ----
    const fresh = await WalletMovementModel.create({ reference: `deposit:FRESH-${RUN}`, direction: 'CREDIT', userId: u2, currency: 'XAF', amount: 1, requestedAmount: 1, source: 'deposit', status: 'PENDING' });
    const r1 = await sync.syncBatch(200);
    check('a fresh PENDING claim holds the cursor', r1.stopped === 'pending');
    await WalletMovementModel.collection.updateOne({ _id: fresh._id as any }, { $set: { createdAt: new Date(Date.now() - 20 * 60_000) } });
    await sync.syncBatch(200);
    check('a stale PENDING claim (crash leftover) is skipped', (await BlnkSyncModel.findOne({ movementId: fresh._id }).lean())?.status === 'skipped_stuck_pending');

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
};

main().catch(e => { console.error(e); process.exit(1); });
