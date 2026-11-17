/**
 * Wallet reservations + ledger (support phase 2, user-service side).
 *
 * Runs against its own database (default sbc_users_support_test), drops it
 * before and after. Never point it at a dev or prod database.
 *   SUPPORT_USERS_TEST_DB=mongodb://127.0.0.1:27017/sbc_users_support_test \
 *     npx ts-node --transpile-only src/scripts/check-wallet-reservations.ts
 */
import assert from 'assert';
import mongoose, { Types } from 'mongoose';

const DB = process.env.SUPPORT_USERS_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_users_support_test';
if (!/_test$/.test(new URL(DB).pathname.slice(1))) {
    console.error(`Refusing to run against ${DB}: the database name must end in _test`);
    process.exit(2);
}
delete process.env.SUPPORT_SERVICE_URL; // cases are logged, never sent

import UserModel from '../database/models/user.model';
import WalletMovementModel, { WalletMovementStatus } from '../database/models/wallet-movement.model';
import BalanceReservationModel, { ReservationState } from '../database/models/balance-reservation.model';
import WalletOpeningBalanceModel from '../database/models/wallet-opening-balance.model';
import { balanceReservationService } from '../services/balance-reservation.service';
import { walletLedger } from '../services/wallet-ledger.service';
import { userRepository } from '../database/repositories/user.repository';
import { paymentService } from '../services/clients/payment.service.client';
import { runLedgerCheck } from '../jobs/ledger-check.job';
import { snapshotOpeningBalances } from './snapshot-opening-balances';

let passed = 0;
const ok = (label: string) => { passed++; console.log(`ok  ${label}`); };

const user = async (fields: Record<string, unknown>) => {
    const _id = new Types.ObjectId();
    await UserModel.collection.insertOne({ _id, name: 'Membre test', email: `${_id}@test.local`, phoneNumber: `2376${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, referralCode: `t${_id}`, balance: 0, usdBalance: 0, debt: 0, ...fields });
    return _id;
};
const doc = async (id: Types.ObjectId) => (await UserModel.collection.findOne({ _id: id })) as any;

(async () => {
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();
    await Promise.all([WalletMovementModel.syncIndexes(), BalanceReservationModel.syncIndexes(), WalletOpeningBalanceModel.syncIndexes()]);

    // (1) 20 concurrent withdrawals on a balance that covers only one → exactly one reservation
    const u1 = await user({ balance: 10000, debt: 0 });
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) =>
        balanceReservationService.reserve({ transactionId: `tx-race-${i}`, userId: String(u1), amount: 7000, currency: 'XAF' })));
    assert.strictEqual(results.filter((r) => r.status === 'reserved').length, 1, 'exactly one reserved');
    assert.strictEqual(results.filter((r) => r.status === 'insufficient').length, 19);
    assert.strictEqual((await doc(u1)).reservedBalance, 7000);
    assert.strictEqual((await doc(u1)).balance, 10000, 'reservation does not debit');
    assert.strictEqual(await BalanceReservationModel.countDocuments({ state: ReservationState.HELD }), 1);
    assert.strictEqual(await BalanceReservationModel.countDocuments({}), 1, 'refused claims leave no row');
    ok('(1) 20 concurrent reservations on a balance for one → 1 reserved, 19 refused, balance untouched');

    // (2) debt and existing reservations reduce what is available
    const u2 = await user({ balance: 10000, debt: 4000 });
    assert.strictEqual((await balanceReservationService.reserve({ transactionId: 'tx-debt-1', userId: String(u2), amount: 6001, currency: 'XAF' })).status, 'insufficient');
    assert.strictEqual((await balanceReservationService.reserve({ transactionId: 'tx-debt-2', userId: String(u2), amount: 6000, currency: 'XAF' })).status, 'reserved');
    assert.strictEqual((await balanceReservationService.reserve({ transactionId: 'tx-debt-2', userId: String(u2), amount: 6000, currency: 'XAF' })).status, 'already_reserved');
    assert.strictEqual((await doc(u2)).reservedBalance, 6000, 'a replayed reserve holds once');
    ok('(2) available = balance - debt - reserved; reserve is idempotent per transactionId');

    // (3) balance spends and activation transfers cannot use reserved money
    assert.strictEqual(await userRepository.spendBalance(u1, 3001), null, 'spend beyond available refused');
    assert.ok(await userRepository.spendBalance(u1, 3000), 'spend within available allowed');
    assert.strictEqual(await userRepository.transferToActivationBalance(u1, 1), null, 'transfer of reserved money refused');
    assert.strictEqual((await doc(u1)).balance, 7000);
    ok('(3) spendBalance / activation transfer respect reservedBalance');

    // (4) release on failure frees the money once
    const rel1 = await balanceReservationService.release('tx-debt-2', 'provider failed');
    const rel2 = await balanceReservationService.release('tx-debt-2', 'provider failed again');
    assert.strictEqual(rel1.status, 'released');
    assert.strictEqual(rel2.status, 'already_released');
    assert.strictEqual((await doc(u2)).reservedBalance, 0);
    assert.strictEqual((await doc(u2)).balance, 10000, 'release never credits');
    assert.strictEqual((await balanceReservationService.release('tx-unknown', 'x')).status, 'not_reserved');
    ok('(4) release on failure: reservedBalance back to 0 once, balance unchanged');

    // (5) convert on success: one write, replays are no-ops, then release is refused
    const winner = results.find((r) => r.status === 'reserved') as any;
    const txId = winner.reservation.transactionId;
    const conv = await Promise.all(Array.from({ length: 5 }, () =>
        balanceReservationService.convert({ transactionId: txId, userId: String(u1), amount: 7000, currency: 'XAF' })));
    assert.strictEqual(conv.filter((c) => c.status === 'converted').length, 1, 'converted once');
    const after = await doc(u1);
    assert.strictEqual(after.balance, 0, '10000 - 3000 spent - 7000 withdrawn');
    assert.strictEqual(after.reservedBalance, 0);
    assert.strictEqual(await WalletMovementModel.countDocuments({ reference: `withdrawal:${txId}` }), 1);
    assert.strictEqual((await balanceReservationService.release(txId, 'late fail')).status, 'conflict');
    assert.strictEqual((await doc(u1)).reservedBalance, 0, 'a converted reservation is never released');
    ok('(5) convert: balance and reservedBalance drop together once, 5 replays, release refused afterwards');

    // (6) a withdrawal without reservation (created before this release) is debited once
    const u3 = await user({ balance: 5000 });
    const legacy = await Promise.all(Array.from({ length: 5 }, () =>
        balanceReservationService.convert({ transactionId: 'tx-legacy', userId: String(u3), amount: 2000, currency: 'XAF' })));
    assert.strictEqual(legacy.filter((c) => c.status === 'debited_unreserved').length, 1);
    assert.ok(legacy.every((c) => c.status === 'debited_unreserved' || c.status === 'already_converted'));
    assert.strictEqual((await doc(u3)).balance, 3000, 'debited exactly once');
    ok('(6) legacy withdrawal without reservation: 5 concurrent settlements → one debit');

    // (7) ledger: a reference moves the balance once; every change leaves one APPLIED row
    const u4 = await user({ balance: 0, debt: 1000 });
    const { UserService } = require('../services/user.service');
    const userService = new UserService();
    const credits = await Promise.all(Array.from({ length: 5 }, () => userService.updateBalance(u4, 2500, { reference: 'deposit:TX1', source: 'test' })));
    assert.ok(credits.every((b: number) => b === 1500), 'debt paid first, then the rest, once');
    assert.strictEqual(await WalletMovementModel.countDocuments({ reference: 'deposit:TX1' }), 1);
    await assert.rejects(WalletMovementModel.create({ reference: 'deposit:TX1', direction: 'CREDIT', userId: u4, currency: 'XAF', amount: 1, requestedAmount: 1, source: 'x', status: 'APPLIED' }), /E11000/);
    const many = await Promise.all(Array.from({ length: 20 }, (_, i) => userService.updateBalance(u4, 100, { reference: `commission:${i}`, source: 'test' })));
    assert.ok(many.every((b: any) => typeof b === 'number'));
    assert.strictEqual((await doc(u4)).balance, 3500, 'no lost update between 20 concurrent credits');
    assert.strictEqual(await WalletMovementModel.countDocuments({ userId: u4, status: WalletMovementStatus.APPLIED }), 21);
    ok('(7) ledger: unique reference, replay no-op, 20 concurrent debt-aware credits all counted');

    // (8) USD reservations (crypto withdrawals)
    const u5 = await user({ usdBalance: 50, balance: 0 });
    assert.strictEqual((await balanceReservationService.reserve({ transactionId: 'tx-usd', userId: String(u5), amount: 51.25, currency: 'USD' })).status, 'insufficient');
    assert.strictEqual((await balanceReservationService.reserve({ transactionId: 'tx-usd', userId: String(u5), amount: 41, currency: 'USD' })).status, 'reserved');
    await balanceReservationService.convert({ transactionId: 'tx-usd', userId: String(u5), amount: 41, currency: 'USD' });
    const u5d = await doc(u5);
    assert.strictEqual(u5d.usdBalance, 9);
    assert.strictEqual(u5d.reservedUsdBalance, 0);
    ok('(8) USD reservation and conversion');

    // (9) admin adjust-balance records a transaction and one movement
    const recorded: any[] = [];
    (paymentService as any).recordAdjustmentTransaction = async (p: any) => { recorded.push(p); return { transactionId: 'adj-tx' }; };
    const u6 = await user({ balance: 100 });
    const nb = await userService.adminAdjustBalance(u6, 250, 'Correction test', new Types.ObjectId(), 'main');
    assert.strictEqual(nb, 350);
    assert.deepStrictEqual(recorded.map((r) => r.status), ['pending', 'completed']);
    assert.strictEqual(await WalletMovementModel.countDocuments({ userId: u6, source: 'admin-adjust', status: 'APPLIED' }), 1);
    (paymentService as any).recordAdjustmentTransaction = async () => { throw new Error('payment-service down'); };
    await assert.rejects(userService.adminAdjustBalance(u6, 10, 'Correction', new Types.ObjectId(), 'main'));
    assert.strictEqual((await doc(u6)).balance, 350, 'no transaction → no adjustment');
    ok('(9) admin adjust-balance writes a transaction + a movement; refused when the transaction cannot be recorded');

    // (10) snapshot (dry run writes nothing) + nightly check
    const dry = await snapshotOpeningBalances({ apply: false, log: () => undefined });
    assert.ok(dry.written > 0);
    assert.strictEqual(await WalletOpeningBalanceModel.countDocuments({}), 0, 'dry run writes nothing');
    await snapshotOpeningBalances({ apply: true, log: () => undefined });
    await new Promise((r) => setTimeout(r, 5));
    await userService.updateBalance(u6, -50, { reference: 'withdrawal:after-snapshot', source: 'test' });
    let findings = await runLedgerCheck();
    assert.deepStrictEqual(findings.filter((f) => f.kind === 'balance'), [], 'balances agree with opening + movements');
    await UserModel.collection.updateOne({ _id: u6 }, { $inc: { balance: 1000 } }); // a write that bypassed the ledger
    await UserModel.collection.updateOne({ _id: u3 }, { $set: { reservedBalance: 500 } }); // reserved without a reservation
    findings = await runLedgerCheck();
    assert.ok(findings.some((f) => f.kind === 'balance' && f.userId === String(u6) && f.actual === 1300 && f.expected === 300));
    assert.ok(findings.some((f) => f.kind === 'reserved' && f.userId === String(u3)));
    ok('(10) snapshot dry run writes nothing; nightly check finds a balance moved outside the ledger and a stray reservation');

    // (11) a stale PENDING movement is reported, and a replay of its reference refuses
    await WalletMovementModel.collection.insertOne({ reference: 'deposit:CRASHED', direction: 'CREDIT', userId: u6, currency: 'XAF', amount: 0, requestedAmount: 10, source: 'test', status: 'PENDING', createdAt: new Date(Date.now() - 3600_000), updatedAt: new Date() });
    const replay = await walletLedger.applyInc({ userId: u6, currency: 'XAF', delta: 10, reference: 'deposit:CRASHED', source: 'test' });
    assert.strictEqual(replay.pendingConflict, true);
    findings = await runLedgerCheck();
    assert.ok(findings.some((f) => f.kind === 'pending_movement' && f.reference === 'deposit:CRASHED'));
    ok('(11) a crashed movement stays PENDING: replays refuse, the nightly check reports it');

    // (12) currency conversion cannot spend reserved money
    (paymentService as any).hasPendingTransactions = async () => false;
    (paymentService as any).createConversionTransaction = async () => ({});
    const u12 = await user({ balance: 10000, usdBalance: 50 });
    await balanceReservationService.reserve({ transactionId: 'tx-conv-xaf', userId: String(u12), amount: 8000, currency: 'XAF' });
    await balanceReservationService.reserve({ transactionId: 'tx-conv-usd', userId: String(u12), amount: 45, currency: 'USD' });
    assert.strictEqual((await userService.convertXafToUsd(u12, 3000)).success, false, 'XAF conversion of reserved money refused');
    assert.strictEqual((await userService.convertUsdToXaf(u12, 10)).success, false, 'USD conversion of reserved money refused');
    let d12 = await doc(u12);
    assert.strictEqual(d12.balance, 10000); assert.strictEqual(d12.usdBalance, 50);
    assert.strictEqual((await userService.convertXafToUsd(u12, 1500)).success, true, 'available money converts');
    d12 = await doc(u12);
    assert.strictEqual(d12.balance, 8500);
    assert.strictEqual(await WalletMovementModel.countDocuments({ userId: u12, source: 'conversion', status: 'APPLIED' }), 2, 'both legs journalled');
    ok('(12) conversions XAF→USD and USD→XAF cannot use reserved money; available money converts, both legs journalled');

    // (13) every other debit path is guarded: debt-aware updateBalance, repository debits, admin adjust
    const u13 = await user({ balance: 5000, debt: 1000 });
    await balanceReservationService.reserve({ transactionId: 'tx-guard', userId: String(u13), amount: 3000, currency: 'XAF' });
    await assert.rejects(userService.updateBalance(u13, -1001, { source: 'test' }), (e: any) => e.statusCode === 409);
    await assert.rejects(userRepository.updateBalance(u13, -1001), (e: any) => e.code === 'INSUFFICIENT_AVAILABLE_BALANCE');
    (paymentService as any).recordAdjustmentTransaction = async () => ({ transactionId: 'adj' });
    await assert.rejects(userService.adminAdjustBalance(u13, -1500, 'Correction', new Types.ObjectId(), 'main'), /insuffisant/i);
    assert.strictEqual((await doc(u13)).balance, 5000, 'nothing taken');
    assert.strictEqual(await userService.updateBalance(u13, -1000, { source: 'test' }), 3000, 'available money (5000 - 1000 debt - 3000 reserved) can leave; the debt is then settled as before');
    assert.strictEqual(await WalletMovementModel.countDocuments({ userId: u13, status: 'PENDING' }), 0, 'refusals leave no claim');
    ok('(13) negative updateBalance (service + repository) and admin debit refused beyond balance - debt - reserved');

    // (14) a spend undone under its reference cannot be replayed as paid
    const u14 = await user({ balance: 1000 });
    assert.ok(await userRepository.spendBalance(u14, 400, { reference: 'spend:ads-R1', source: 'test' }));
    await userService.updateBalance(u14, 400, { reference: 'spend:ads-R1', source: 'balance-spend-undo' }); // undo, same reference
    await assert.rejects(userRepository.spendBalance(u14, 400, { reference: 'spend:ads-R1', source: 'test' }), (e: any) => e.code === 'MOVEMENT_UNDONE');
    assert.strictEqual((await doc(u14)).balance, 1000);
    assert.ok(await userRepository.spendBalance(u14, 400, { reference: 'spend:ads-R2', source: 'test' }), 'a new reference pays normally');
    ok('(14) spend → undo → retry with the same reference is refused (MOVEMENT_UNDONE), never reported as paid');

    // (15) pending-transactions check fails closed when payment-service does not answer
    const realClient = Object.getPrototypeOf(paymentService);
    const probe = Object.create(realClient);
    probe.apiClient = (paymentService as any).apiClient;
    probe.log = (paymentService as any).log;
    const savedBase = probe.apiClient.defaults.baseURL;
    probe.apiClient.defaults.baseURL = 'http://127.0.0.1:1';
    assert.strictEqual(await realClient.hasPendingTransactions.call(probe, String(u12)), true);
    probe.apiClient.defaults.baseURL = savedBase;
    ok('(15) hasPendingTransactions fails closed (true) when payment-service is unreachable');

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(`\nALL PASSED (${passed})`);
    process.exit(0);
})().catch(async (err) => {
    console.error('FAILED:', err);
    await mongoose.connection.dropDatabase().catch(() => undefined);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
});
