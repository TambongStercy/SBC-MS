/**
 * Asserts the wallet journal for the four extra balances (Security plan Phase 2 leftover,
 * 2026-11-23): activation, advertising, event organiser, SBC Live. Against a test Mongo
 * (dropped before and after) and, when BLNK_URL/BLNK_API_KEY are set, a REAL local Blnk.
 *   - main → activation and back: one write, two rows (XAF + ACTIVATION), refs never mistaken for an undo;
 *   - activation P2P: debit + credit rows; a missing recipient gives the money back (undo row);
 *   - activation debits never go below zero (sponsor flow), the undo reference restores it once;
 *   - admin adjust of the activation balance, leaderboard bonus: journalled;
 *   - advertising credit replayed: moves once; transfer to main: two rows;
 *   - event organiser movement replayed: once; a debit may go negative; transfer to main;
 *   - SBC Live credit with a reference replayed: once; a debit beyond the balance is refused;
 *   - a write that bypasses the journal is caught by the nightly check (per balance);
 *   - a journalled balance passed as extraInc is refused;
 *   - snapshot with --balances; the nightly check finds nothing on honest data;
 *   - with Blnk: every movement posted under its own balance, A = B = C for each balance
 *     (the event-organiser balance below zero included).
 *
 *   npx ts-node --transpile-only src/scripts/check-ledger-other-balances.ts
 *   BLNK_URL=http://127.0.0.1:5101 BLNK_API_KEY=… npx ts-node --transpile-only src/scripts/check-ledger-other-balances.ts
 */
import mongoose, { Types } from 'mongoose';

const DB = process.env.LEDGER2_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_users_ledger2_test';
if (!/_test$/.test(new URL(DB).pathname.slice(1))) { console.error('The database name must end in _test'); process.exit(2); }
delete process.env.SUPPORT_SERVICE_URL; // cases are logged, never sent
const withBlnk = !!process.env.BLNK_URL && !!process.env.BLNK_API_KEY;
process.env.BLNK_LEDGER_NAME = `check2-${Date.now()}`;
const RUN = Date.now().toString(36);

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};
const refused = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e: any) { return e; } };

const main = async () => {
    const UserModel = (await import('../database/models/user.model')).default;
    const WalletMovementModel = (await import('../database/models/wallet-movement.model')).default;
    const WalletOpeningBalanceModel = (await import('../database/models/wallet-opening-balance.model')).default;
    const { EventOrganizerLedgerDirection } = await import('../database/models/event-organizer-ledger.model');
    const EventOrganizerLedgerModel = (await import('../database/models/event-organizer-ledger.model')).default;
    const { BlnkBalanceModel, BlnkSyncModel } = await import('../database/models/blnk.model');
    const { userRepository } = await import('../database/repositories/user.repository');
    const { walletLedger } = await import('../services/wallet-ledger.service');
    const { paymentService } = await import('../services/clients/payment.service.client');
    const { userService } = await import('../services/user.service');
    const { snapshotOpeningBalances } = await import('./snapshot-opening-balances');
    const { runLedgerCheck, ledgerBalances } = await import('../jobs/ledger-check.job');
    (paymentService as any).recordAdjustmentTransaction = async () => ({ transactionId: 'T' });

    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();
    await Promise.all([WalletMovementModel.syncIndexes(), WalletOpeningBalanceModel.syncIndexes(), EventOrganizerLedgerModel.syncIndexes(), BlnkBalanceModel.syncIndexes(), BlnkSyncModel.syncIndexes()]);

    const user = async (fields: Record<string, unknown> = {}) => {
        const _id = new Types.ObjectId();
        await UserModel.collection.insertOne({
            _id, name: 'Membre test', email: `${_id}@test.local`, phoneNumber: `2376${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
            referralCode: `t${_id}`, balance: 0, usdBalance: 0, debt: 0, activationBalance: 0, advertisingBalance: 0, eventOrganizerBalance: 0, sbcLiveBalance: 0, ...fields,
        });
        return _id;
    };
    const doc = async (id: Types.ObjectId) => (await UserModel.findById(id).lean()) as any;
    const rows = (userId: Types.ObjectId, currency?: string) => WalletMovementModel.find({ userId, ...(currency ? { currency } : {}), status: 'APPLIED' }).lean();

    // Opening snapshot first (members start with money in the extra balances), then every write is journalled.
    const a = await user({ balance: 10000, activationBalance: 3000, advertisingBalance: 2000, eventOrganizerBalance: 1500, sbcLiveBalance: 800 });
    const b = await user({ activationBalance: 100 });
    // The release lands while the Blnk worker runs: an extra balance moves before its first snapshot…
    const e = await user({ activationBalance: 50 });
    await userRepository.updateActivationBalance(e, 100, { reference: `early:${RUN}`, source: 'test' });
    const sync = withBlnk ? await import('../services/blnk/blnk-sync.service') : null;
    if (sync) {
        for (let i = 0; i < 5; i++) { const r = await sync.syncBatch(200); if (!r.processed || r.stopped) break; }
        const early = await BlnkSyncModel.findOne({ reference: `act:early:${RUN}` }).lean();
        check('before its first snapshot, an extra balance movement is not posted (it will be inside the opening)',
            early?.status === 'skipped_in_opening' && !(await BlnkBalanceModel.exists({ userId: e })), String(early?.status));
    }
    const dry = await snapshotOpeningBalances({ apply: false, balances: ['ACTIVATION'], log: () => undefined });
    check('snapshot --balances=ACTIVATION dry run: one row per member, nothing written',
        dry.written === 3 && (await WalletOpeningBalanceModel.countDocuments({})) === 0, JSON.stringify(dry.byBalance));
    // …and while the snapshot runs, a member without an opening yet holds the sync back.
    const { markOpeningSnapshot } = await import('../services/blnk/blnk-sync.service');
    await markOpeningSnapshot('ACTIVATION', 'startedAt');
    const n = await user({});
    await userRepository.updateActivationBalance(n, 70, { reference: `during:${RUN}`, source: 'test' });
    if (sync) {
        const r = await sync.syncBatch(200);
        check('while the snapshot runs: the sync waits (nothing skipped, nothing posted)',
            r.stopped === 'opening_snapshot_running' && !(await BlnkSyncModel.exists({ reference: `act:during:${RUN}` })), JSON.stringify(r));
    }
    await new Promise(r => setTimeout(r, 15));
    await snapshotOpeningBalances({ apply: true, log: () => undefined });
    check('snapshot done: openings for every member, including one who moved during it', (await WalletOpeningBalanceModel.findOne({ userId: n, currency: 'ACTIVATION' }).lean())?.amount === 70
        && (await WalletOpeningBalanceModel.findOne({ userId: e, currency: 'ACTIVATION' }).lean())?.amount === 150);
    check('snapshot: six balances per member', (await WalletOpeningBalanceModel.countDocuments({ userId: a })) === 6
        && (await WalletOpeningBalanceModel.findOne({ userId: a, currency: 'SBC_LIVE' }).lean())?.amount === 800);
    await new Promise(r => setTimeout(r, 15));

    // ---- main ↔ activation ----
    await userRepository.transferToActivationBalance(a, 1000);
    let d = await doc(a);
    const tIn = (await rows(a)).filter(r => r.source === 'activation-transfer-in');
    check('main → activation: balance −1000, activation +1000, two rows (XAF debit, ACTIVATION credit)',
        d.balance === 9000 && d.activationBalance === 4000 && tIn.length === 2
        && tIn.some(r => r.currency === 'XAF' && r.direction === 'DEBIT') && tIn.some(r => r.currency === 'ACTIVATION' && r.direction === 'CREDIT' && r.reference.startsWith('act:')));
    await userRepository.transferFromActivationToMain(a, 500, `activation-reversal:X-${RUN}`);
    const again = await userRepository.transferFromActivationToMain(a, 500, `activation-reversal:X-${RUN}`);
    d = await doc(a);
    check('activation → main under one reference: once (a replay returns null and moves nothing), two rows',
        d.balance === 9500 && d.activationBalance === 3500 && again === null
        && (await WalletMovementModel.countDocuments({ reference: { $in: [`activation-reversal:X-${RUN}`, `act:activation-reversal:X-${RUN}`] } })) === 2);
    const bad = await refused(() => walletLedger.applyInc({ userId: a, currency: 'XAF', delta: 1, source: 'test', extraInc: { activationBalance: 1 } }));
    check('a journalled balance passed as extraInc is refused', !!bad && /journalled/.test(bad.message));

    // ---- activation P2P ----
    const p2p = await userRepository.transferActivationBetweenUsers(a, b, 700, `activation-p2p:P-${RUN}`);
    check('activation P2P: sender −700, recipient +700, rows :out and :in',
        p2p.success && (await doc(a)).activationBalance === 2800 && (await doc(b)).activationBalance === 800
        && !!(await WalletMovementModel.exists({ reference: `act:activation-p2p:P-${RUN}:out`, direction: 'DEBIT', userId: a }))
        && !!(await WalletMovementModel.exists({ reference: `act:activation-p2p:P-${RUN}:in`, direction: 'CREDIT', userId: b })));
    const ghost = new Types.ObjectId();
    const p2pGhost = await userRepository.transferActivationBetweenUsers(a, ghost, 300, `activation-p2p:G-${RUN}`);
    check('activation P2P to an unknown member: refused, sender given back (debit + undo rows)',
        !p2pGhost.success && (await doc(a)).activationBalance === 2800
        && (await WalletMovementModel.countDocuments({ reference: `act:activation-p2p:G-${RUN}:out`, status: 'APPLIED' })) === 2);
    const tooMuch = await userRepository.transferActivationBetweenUsers(b, a, 5000);
    check('activation P2P beyond the balance: refused, nothing moved', !tooMuch.success && (await doc(b)).activationBalance === 800);

    // ---- sponsor debit (guarded) + undo ----
    const none = await userRepository.updateActivationBalance(b, -900, { reference: `sponsor-activation:S1-${RUN}`, source: 'sponsor-activation' });
    check('sponsor debit beyond the activation balance: null, never below zero', none === null && (await doc(b)).activationBalance === 800);
    await userRepository.updateActivationBalance(b, -500, { reference: `sponsor-activation:S2-${RUN}`, source: 'sponsor-activation' });
    await userRepository.updateActivationBalance(b, 500, { reference: `sponsor-activation:S2-${RUN}`, source: 'sponsor-activation-undo' });
    const replayDebit = await refused(() => userRepository.updateActivationBalance(b, -500, { reference: `sponsor-activation:S2-${RUN}`, source: 'sponsor-activation' }));
    check('sponsor debit then undo under one reference: back to 800; replaying the debit is refused (undone)',
        (await doc(b)).activationBalance === 800 && replayDebit?.code === 'MOVEMENT_UNDONE');

    // ---- admin adjust (activation) ----
    const adj = await userService.adminAdjustBalance(String(b), 250, 'Correction du solde d’activation (test)', new Types.ObjectId(), 'activation');
    check('admin adjust of the activation balance: journalled under admin-adjust-activation:…',
        adj === 1050 && (await WalletMovementModel.countDocuments({ userId: b, currency: 'ACTIVATION', source: 'admin-adjust-activation', status: 'APPLIED' })) === 1);
    const adjNeg = await refused(() => userService.adminAdjustBalance(String(b), -5000, 'Correction du solde d’activation (test)', new Types.ObjectId(), 'activation'));
    check('admin adjust below zero refused', !!adjNeg && (await doc(b)).activationBalance === 1050);

    // ---- advertising ----
    await userRepository.creditAdvertisingBalance(a, 400, `campaign-participation:C-${RUN}`);
    await userRepository.creditAdvertisingBalance(a, 400, `campaign-participation:C-${RUN}`);
    check('advertising credit replayed: once', (await doc(a)).advertisingBalance === 2400
        && (await WalletMovementModel.countDocuments({ reference: `adv:advertising-credit:campaign-participation:C-${RUN}` })) === 1);
    await userRepository.transferFromAdvertisingToMain(a, 1000);
    d = await doc(a);
    check('advertising → main: two rows', d.advertisingBalance === 1400 && d.balance === 10500
        && (await rows(a, 'ADVERTISING')).filter(r => r.direction === 'DEBIT').length === 1);

    // ---- event organiser ----
    const ev = { userId: String(a), amount: 600, reference: `ticket:E-${RUN}`, direction: EventOrganizerLedgerDirection.CREDIT, description: 'Vente billet' };
    const e1 = await userRepository.applyEventOrganizerMovement(ev);
    const e2 = await userRepository.applyEventOrganizerMovement(ev);
    check('event organiser credit replayed: applied once, event ledger row APPLIED',
        e1.applied && !e2.applied && (await doc(a)).eventOrganizerBalance === 2100
        && (await EventOrganizerLedgerModel.findOne({ reference: ev.reference }).lean())?.status === 'APPLIED'
        && (await WalletMovementModel.countDocuments({ reference: `evt:ticket:E-${RUN}` })) === 1);
    await userRepository.transferEventOrganizerToMain(a, 2100);
    const neg = await userRepository.applyEventOrganizerMovement({ ...ev, reference: `refund:E-${RUN}`, direction: EventOrganizerLedgerDirection.DEBIT, amount: 300 });
    check('event organiser: transfer to main, then a refund debit may go negative (as before)',
        neg.applied && (await doc(a)).eventOrganizerBalance === -300 && (await doc(a)).balance === 12600);
    const evGhost = await userRepository.applyEventOrganizerMovement({ ...ev, userId: String(ghost), reference: `ticket:GHOST-${RUN}` });
    check('event organiser movement for an unknown member: nothing, claim removed',
        !evGhost.applied && !(await EventOrganizerLedgerModel.exists({ reference: `ticket:GHOST-${RUN}` })));

    // ---- SBC Live ----
    await userRepository.updateSbcLiveBalance(a, 750, `sbc-live-split:L-${RUN}`);
    await userRepository.updateSbcLiveBalance(a, 750, `sbc-live-split:L-${RUN}`);
    const liveDebit = await userRepository.updateSbcLiveBalance(a, -5000, `sbc-live-refund:R-${RUN}`);
    check('SBC Live credit replayed: once; a clawback beyond the balance: null', (await doc(a)).sbcLiveBalance === 1550 && liveDebit === null);
    await userRepository.updateSbcLiveBalance(a, -50); // no reference (an older payment-service): still journalled
    check('SBC Live without reference: still journalled', (await doc(a)).sbcLiveBalance === 1500
        && (await WalletMovementModel.countDocuments({ userId: a, currency: 'SBC_LIVE', status: 'APPLIED' })) === 2);

    // ---- leaderboard bonus (activation credit) ----
    await userRepository.updateActivationBalance(b, 1000, { reference: `leaderboard-bonus:${b}:2026-10`, source: 'leaderboard-bonus' });
    await userRepository.updateActivationBalance(b, 1000, { reference: `leaderboard-bonus:${b}:2026-10`, source: 'leaderboard-bonus' });
    check('leaderboard bonus to the activation balance: once per month', (await doc(b)).activationBalance === 2050);

    // ---- nightly check: honest → nothing; a bypass → found on that balance ----
    let findings = (await runLedgerCheck()).filter(f => f.kind === 'balance');
    check('nightly check: every balance agrees with opening + movements', findings.length === 0, JSON.stringify(findings));
    const cards = await ledgerBalances([String(a)]);
    check('support card: six balances, all A = B', (cards.get(String(a)) ?? []).length === 6 && (cards.get(String(a)) ?? []).every(l => l.matches));
    await UserModel.collection.updateOne({ _id: b }, { $inc: { activationBalance: 999 } });
    findings = (await runLedgerCheck()).filter(f => f.kind === 'balance');
    check('nightly check: a write that bypassed the journal is found on ACTIVATION',
        findings.length === 1 && findings[0].currency === 'ACTIVATION' && findings[0].actual === 3049 && findings[0].expected === 2050);
    await UserModel.collection.updateOne({ _id: b }, { $inc: { activationBalance: -999 } });

    // ---- Blnk ----
    if (sync) {
        const { blnk, PRECISION } = await import('../services/blnk/blnk.client');
        for (let i = 0; i < 30; i++) { const r = await sync.syncBatch(200); if (!r.processed || r.stopped) break; }
        const rejected = await BlnkSyncModel.find({ status: 'rejected' }).lean();
        check('Blnk: nothing refused (the event-organiser balance may go below zero there too)', rejected.length === 0,
            JSON.stringify(rejected.map(r => [r.currency, r.reference, r.error])));
        const kinds = ['XAF', 'ACTIVATION', 'ADVERTISING', 'EVENT_ORGANIZER', 'SBC_LIVE'] as const;
        const t = await Promise.all(kinds.map(k => sync.tripleCheck(String(a), k)));
        check('Blnk: A = B = C for main, activation, advertising, event organiser (−300), SBC Live', t.every(x => x.agree), JSON.stringify(t.map(x => [x.currency, x.a, x.b, x.c, x.reason])));
        const actRow = await BlnkBalanceModel.findOne({ userId: a, currency: 'ACTIVATION' }).lean();
        const actBal = actRow ? await blnk.getBalance(actRow.balanceId) : null;
        check('Blnk: the activation balance is its own XAF balance', !!actBal && actBal.currency === 'XAF' && actBal.balance / PRECISION === (await doc(a)).activationBalance);
        const tb = await sync.tripleCheck(String(b), 'ACTIVATION');
        check('Blnk: P2P recipient agrees too (activation)', tb.agree, JSON.stringify(tb));
        // scripts/blnk-post-openings.ts does this for every member with a non-zero opening.
        await sync.ensureMemberBalance(e, 'ACTIVATION');
        await sync.ensureMemberBalance(n, 'ACTIVATION');
        const te = await sync.tripleCheck(String(e), 'ACTIVATION');
        const tn = await sync.tripleCheck(String(n), 'ACTIVATION');
        check('Blnk: members who moved before / during the snapshot agree (150, 70)', te.agree && te.c === 150 && tn.agree && tn.c === 70,
            JSON.stringify([te, tn]));
    } else {
        console.log('SKIP  Blnk checks (set BLNK_URL and BLNK_API_KEY for a local Blnk)');
    }

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
};
main().catch(async (e) => { console.error(e); await mongoose.disconnect().catch(() => undefined); process.exit(1); });
