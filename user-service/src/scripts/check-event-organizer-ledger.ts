/**
 * eventOrganizerBalance moves once per {reference, direction}, however often
 * event-service retries — on a replica set (transaction path) and on a
 * standalone server like prod (sequential path).
 *
 * Run against each:
 *   CHECK_MONGO_URI=mongodb://127.0.0.1:27017/sbc_ledger_check npx ts-node --transpile-only src/scripts/check-event-organizer-ledger.ts
 * Seeds its own throwaway database and drops it at the end.
 */
import assert from 'assert';
import mongoose, { Types } from 'mongoose';
import UserModel from '../database/models/user.model';
import EventOrganizerLedgerModel, { EventOrganizerLedgerDirection, EventOrganizerLedgerStatus } from '../database/models/event-organizer-ledger.model';
import { paymentService } from '../services/clients/payment.service.client';
import { eventOrganizerBalanceService } from '../services/event-organizer-balance.service';

const URI = process.env.CHECK_MONGO_URI || 'mongodb://127.0.0.1:27017/sbc_ledger_check';

// payment-service isn't running: the audit transaction is best-effort anyway.
(paymentService as any).recordActivationTransaction = async () => ({ transactionId: 'tx-check' });

const balanceOf = async (id: Types.ObjectId) =>
    (await UserModel.collection.findOne({ _id: id }))!.eventOrganizerBalance as number;

(async () => {
    await mongoose.connect(URI);
    await mongoose.connection.dropDatabase();
    await EventOrganizerLedgerModel.syncIndexes();

    const userId = new Types.ObjectId();
    await UserModel.collection.insertOne({ _id: userId, name: 'Organisateur', eventOrganizerBalance: 0, balance: 0 });

    // (a) the same credit, ten times at once → one movement
    const results = await Promise.allSettled(Array.from({ length: 10 }, () =>
        eventOrganizerBalanceService.credit(String(userId), 23750, 'event-order:A', 'Vente billets')));
    const fulfilled = results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    const applied = fulfilled.filter((r) => !r.value.alreadyApplied).length;
    assert.strictEqual(applied, 1, 'exactly one credit applies');
    assert.strictEqual(await balanceOf(userId), 23750, 'balance moved once');
    // On the sequential path a replay that lands between insert and $inc gets a 409 "pending" — never a second credit.
    for (const r of results) {
        if (r.status === 'rejected') assert.strictEqual((r.reason as any).statusCode, 409, 'only a pending conflict may refuse');
    }
    console.log(`ok  (a) 10 parallel credits → 1 applied (${fulfilled.length - applied} replays answered alreadyApplied, ${results.length - fulfilled.length} pending refusals)`);

    // (b) a later replay is a no-op that reports the current balance
    const replay = await eventOrganizerBalanceService.credit(String(userId), 23750, 'event-order:A', 'Vente billets');
    assert.strictEqual(replay.alreadyApplied, true);
    assert.strictEqual(replay.newEventOrganizerBalance, 23750);
    console.log('ok  (b) replay → alreadyApplied, balance unchanged');

    // (c) a debit may reuse the credit's reference string (different direction) and goes negative if needed
    await eventOrganizerBalanceService.debit(String(userId), 30000, 'event-order:A', 'Remboursement');
    await eventOrganizerBalanceService.debit(String(userId), 30000, 'event-order:A', 'Remboursement');
    assert.strictEqual(await balanceOf(userId), -6250, 'debit applied once, balance may go negative');
    console.log('ok  (c) debit applied once, may go negative');

    // (d) unknown user → 404 and no ledger row left behind
    await assert.rejects(
        eventOrganizerBalanceService.credit(String(new Types.ObjectId()), 100, 'event-order:ghost', 'x'),
        (err: any) => err.statusCode === 404,
    );
    assert.strictEqual(await EventOrganizerLedgerModel.countDocuments({ reference: 'event-order:ghost' }), 0);
    console.log('ok  (d) unknown user → 404, no ledger row');

    // (e) a stale PENDING row (crash mid-way on the sequential path) blocks a blind re-credit
    await EventOrganizerLedgerModel.create({
        reference: 'event-order:stuck', direction: EventOrganizerLedgerDirection.CREDIT,
        userId, amount: 500, status: EventOrganizerLedgerStatus.PENDING,
    });
    await assert.rejects(
        eventOrganizerBalanceService.credit(String(userId), 500, 'event-order:stuck', 'x'),
        (err: any) => err.statusCode === 409,
    );
    assert.strictEqual(await balanceOf(userId), -6250, 'nothing moved');
    console.log('ok  (e) stale PENDING → 409, nothing moved');

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log('\nAll ledger checks passed.');
})().catch(async (err) => {
    console.error(err);
    try { await mongoose.disconnect(); } catch { /* ignore */ }
    process.exit(1);
});
