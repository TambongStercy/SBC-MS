/**
 * End-to-end money check for the monthly leaderboard bonus.
 *
 * Part 1 drives the service directly (tier maths, ledger, idempotency); part 2
 * drives the real admin endpoints through the API GATEWAY, exactly as an admin
 * would, and reads the result back through the member-facing activation-balance
 * endpoint — so the whole chain is exercised, not just the middle of it.
 *
 * Proves what matters: the bonus lands on the ACTIVATION balance and nowhere
 * else, the main balance is untouched, running twice pays once, a member below
 * the threshold is paid nothing, an open month is refused, and a non-admin
 * cannot trigger a payout.
 *
 * Run (local dev, full stack up): npx ts-node src/scripts/e2e-leaderboard-bonus.ts
 */
import mongoose, { Types } from 'mongoose';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import connectDB from '../database/connection';
import config from '../config';
import UserModel from '../database/models/user.model';
import ReferralModel from '../database/models/referral.model';
import SubscriptionModel, { SubscriptionType, SubscriptionStatus } from '../database/models/subscription.model';
import LeaderboardBonusModel from '../database/models/leaderboard-bonus.model';
import LeaderboardPayoutRunModel from '../database/models/leaderboard-payout-run.model';
import { leaderboardBonusService, tierForSales, monthKey, previousMonthStart } from '../services/leaderboard-bonus.service';
import { startOfNextMonthDouala, startOfCurrentMonthDouala } from '../database/repositories/referral.repository';

function assert(cond: any, label: string) {
    if (!cond) throw new Error(`FAIL: ${label}`);
    console.log(`  ok: ${label}`);
}

const TAG = 'e2e-bonus';

// Through the gateway, exactly like the admin console and the member app.
const GW = 'http://localhost:3000/api';
const sign = (userId: string, role: string) =>
    jwt.sign({ userId, id: userId, email: `${userId}@e2e.test`, role }, config.jwt.secret);
const adminAuth = { headers: { Authorization: `Bearer ${sign(new Types.ObjectId().toString(), 'admin')}` } };
const userAuth = (userId: string) => ({ headers: { Authorization: `Bearer ${sign(userId, 'user')}` } });
const TIER1 = config.leaderboardBonus.tiers[0];   // 30 sales → 2000 FCFA

/** A member with an active subscription, so they count as a ranked referrer. */
async function makeMember(name: string, phone: string, opts: { activationBalance?: number } = {}) {
    const id = new Types.ObjectId();
    await UserModel.collection.insertOne({
        _id: id, name: `${name} ${TAG}`, email: `${name.toLowerCase()}.${TAG}@test.local`,
        phoneNumber: phone, role: 'user', isVerified: true, blocked: false, deleted: false,
        balance: 5000, activationBalance: opts.activationBalance ?? 0,
        country: 'CM', region: 'Littoral', createdAt: new Date(), updatedAt: new Date(),
    } as any);
    await SubscriptionModel.collection.insertOne({
        user: id, subscriptionType: SubscriptionType.CLASSIQUE, status: SubscriptionStatus.ACTIVE,
        startDate: new Date(Date.now() - 90 * 864e5), endDate: new Date(Date.now() + 365 * 864e5),
        createdAt: new Date(Date.now() - 90 * 864e5), updatedAt: new Date(),
    } as any);
    return id;
}

/** `count` paid filleuls for `referrer`, inside the given month. */
async function givePaidReferrals(referrer: Types.ObjectId, count: number, paidAt: Date) {
    const users: any[] = [], subs: any[] = [], refs: any[] = [];
    for (let i = 0; i < count; i++) {
        const fid = new Types.ObjectId();
        users.push({
            _id: fid, name: `Filleul ${i} ${TAG}`, email: `f${i}.${referrer}.${TAG}@test.local`,
            phoneNumber: `+2376${String(referrer).slice(-6)}${String(i).padStart(3, '0')}`,
            role: 'user', isVerified: true, blocked: false, deleted: false, balance: 0, activationBalance: 0,
            createdAt: paidAt, updatedAt: paidAt,
        });
        subs.push({
            user: fid, subscriptionType: SubscriptionType.CLASSIQUE, status: SubscriptionStatus.ACTIVE,
            startDate: paidAt, endDate: new Date(paidAt.getTime() + 365 * 864e5),
            createdAt: paidAt, updatedAt: paidAt,   // the "sale" event the board counts
        });
        refs.push({
            referrer, referredUser: fid, referralLevel: 1, archived: false,
            createdAt: paidAt, updatedAt: paidAt,
        });
    }
    await UserModel.collection.insertMany(users);
    await SubscriptionModel.collection.insertMany(subs);
    await ReferralModel.collection.insertMany(refs);
}

async function cleanup() {
    const tagged = await UserModel.collection.find({ name: new RegExp(TAG) }, { projection: { _id: 1 } }).toArray();
    const ids = tagged.map(u => u._id);
    await Promise.all([
        SubscriptionModel.collection.deleteMany({ user: { $in: ids } }),
        ReferralModel.collection.deleteMany({ $or: [{ referrer: { $in: ids } }, { referredUser: { $in: ids } }] }),
        LeaderboardBonusModel.collection.deleteMany({ userId: { $in: ids } }),
        UserModel.collection.deleteMany({ _id: { $in: ids } }),
    ]);
}

async function main() {
    await connectDB();
    await cleanup(); // re-runnable

    // Tier selection is pure, so check every boundary without touching the DB.
    assert(tierForSales(TIER1.minSales - 1) === null, `below ${TIER1.minSales} sales earns no bonus`);
    assert(tierForSales(TIER1.minSales)?.key === 'leader', 'the first threshold earns the leader tier');
    assert(tierForSales(config.leaderboardBonus.tiers[1].minSales)?.key === 'gold', 'the second threshold earns gold');
    assert(tierForSales(999_999)?.key === 'elite', 'a huge month earns elite, not leader');

    // A closed month, so the payout is allowed to pay it.
    const monthStart = previousMonthStart();
    const month = monthKey(monthStart);
    const paidAt = new Date(monthStart.getTime() + 5 * 864e5); // mid-month

    const winner = await makeMember('Winner', '+237699111001', { activationBalance: 1500 });
    const nearMiss = await makeMember('NearMiss', '+237699111002');
    await givePaidReferrals(winner, TIER1.minSales, paidAt);
    await givePaidReferrals(nearMiss, TIER1.minSales - 1, paidAt);

    const before = await UserModel.collection.findOne({ _id: winner }, { projection: { balance: 1, activationBalance: 1 } });

    // The programme starts in a fixed month (2026-09 in config). The seeded
    // history is a closed month in the past, so the guard is asserted against
    // the real setting first, then pinned to the seeded month for the flow.
    const configuredFirstMonth = config.leaderboardBonus.firstPaidMonth;

    try {
        // The programme's start month is a hard floor on every path. Asserted
        // against a month that is unambiguously before it, whatever it is set to.
        const wayBack = new Date(Date.UTC(2020, 0, 1) - 60 * 60 * 1000);
        let refusedEarly = '';
        try {
            await leaderboardBonusService.payoutForMonth(wayBack, { dryRun: true, triggeredBy: 'e2e' });
        } catch (e: any) { refusedEarly = e.message; }
        assert(/starts with/.test(refusedEarly), `a month before ${configuredFirstMonth} is never paid (2020-01 refused)`);

        // The seeded month must itself be payable for the rest of the run.
        config.leaderboardBonus.firstPaidMonth = month;

        // A dry run must not move a franc.
        const dry = await leaderboardBonusService.payoutForMonth(monthStart, { dryRun: true, triggeredBy: 'e2e' });
        assert(dry.qualifiers === 1 && dry.paid === 1, 'dry run finds exactly the one qualifier');
        assert((await LeaderboardBonusModel.countDocuments({ month })) === 0, 'dry run writes no ledger row');
        const untouched = await UserModel.collection.findOne({ _id: winner }, { projection: { activationBalance: 1 } });
        assert(untouched!.activationBalance === before!.activationBalance, 'dry run credits nothing');

        // The real run.
        const first = await leaderboardBonusService.payoutForMonth(monthStart, { triggeredBy: 'e2e' });
        assert(first.paid === 1 && first.amountPaid === TIER1.amountXaf, `paid one bonus of ${TIER1.amountXaf} FCFA`);

        const after = await UserModel.collection.findOne({ _id: winner }, { projection: { balance: 1, activationBalance: 1 } });
        assert(after!.activationBalance === before!.activationBalance + TIER1.amountXaf, 'the ACTIVATION balance received the bonus');
        assert(after!.balance === before!.balance, 'the main balance was NOT touched');

        const missed = await UserModel.collection.findOne({ _id: nearMiss }, { projection: { balance: 1, activationBalance: 1 } });
        assert(missed!.activationBalance === 0 && missed!.balance === 5000, 'a member one sale short is paid nothing');

        const row = await LeaderboardBonusModel.findOne({ userId: winner, month }).lean();
        assert(row?.status === 'paid' && row?.tier === 'leader' && row?.amount === TIER1.amountXaf, 'the ledger records the payment');

        // Idempotency — the property that keeps this safe to retry.
        const second = await leaderboardBonusService.payoutForMonth(monthStart, { triggeredBy: 'e2e-again' });
        assert(second.paid === 0 && second.skipped === 1, 'a second run pays nobody again');
        const afterTwice = await UserModel.collection.findOne({ _id: winner }, { projection: { activationBalance: 1 } });
        assert(afterTwice!.activationBalance === after!.activationBalance, 'the balance is unchanged after the replay');
        assert((await LeaderboardBonusModel.countDocuments({ userId: winner, month })) === 1, 'only one ledger row exists for the member and month');

        // The window really is the month we asked for.
        assert(startOfNextMonthDouala(monthStart) > monthStart, 'month window is well formed');

        // ── Part 2: the same flow over HTTP, through the gateway ────────────
        console.log('\n  — over HTTP (gateway → user-service) —');

        // A second qualifier, untouched by part 1, so the HTTP run has real work.
        const httpWinner = await makeMember('HttpWinner', '+237699111003', { activationBalance: 500 });
        await givePaidReferrals(httpWinner, TIER1.minSales, paidAt);
        const httpBefore = await UserModel.collection.findOne({ _id: httpWinner }, { projection: { balance: 1, activationBalance: 1 } });

        const dryHttp = (await axios.post(`${GW}/users/admin/leaderboard-bonus/run`, { month, dryRun: true }, adminAuth)).data;
        assert(dryHttp.success && dryHttp.data.qualifiers === 2, 'HTTP dry run sees both qualifiers');
        assert((await LeaderboardBonusModel.countDocuments({ userId: httpWinner })) === 0, 'HTTP dry run writes nothing');

        const runHttp = (await axios.post(`${GW}/users/admin/leaderboard-bonus/run`, { month }, adminAuth)).data;
        assert(runHttp.data.paid === 1 && runHttp.data.skipped === 1, 'HTTP run pays only the member part 1 had not paid');
        assert(runHttp.data.amountPaid === TIER1.amountXaf, `HTTP run moved ${TIER1.amountXaf} FCFA`);

        const httpAfter = await UserModel.collection.findOne({ _id: httpWinner }, { projection: { balance: 1, activationBalance: 1 } });
        assert(httpAfter!.activationBalance === httpBefore!.activationBalance + TIER1.amountXaf, 'HTTP: activation balance credited');
        assert(httpAfter!.balance === httpBefore!.balance, 'HTTP: main balance untouched');

        // The member's own view of their wallet must show it.
        const memberView = (await axios.get(`${GW}/activation-balance`, userAuth(httpWinner.toString()))).data;
        const shown = memberView.data?.activationBalance ?? memberView.data?.balance;
        assert(shown === httpBefore!.activationBalance + TIER1.amountXaf, 'the member sees the bonus in their activation balance');

        // The ledger, as the admin console reads it.
        const ledger = (await axios.get(`${GW}/users/admin/leaderboard-bonus?month=${month}`, adminAuth)).data;
        assert(ledger.data.length === 2 && ledger.pagination.totalPages === 1, 'HTTP: the ledger lists both payments, paginated');
        assert(ledger.data.every((b: any) => b.status === 'paid' && b.amount === TIER1.amountXaf), 'HTTP: every ledger row is paid');

        // Replay: still exactly one payment each.
        const replay = (await axios.post(`${GW}/users/admin/leaderboard-bonus/run`, { month }, adminAuth)).data;
        assert(replay.data.paid === 0 && replay.data.skipped === 2, 'HTTP replay pays nobody again');
        const httpTwice = await UserModel.collection.findOne({ _id: httpWinner }, { projection: { activationBalance: 1 } });
        assert(httpTwice!.activationBalance === httpAfter!.activationBalance, 'HTTP replay leaves the balance alone');

        // Guards.
        let openMonth = 0;
        try {
            await axios.post(`${GW}/users/admin/leaderboard-bonus/run`, { month: monthKey(startOfCurrentMonthDouala()) }, adminAuth);
        } catch (e: any) { openMonth = e.response?.status; }
        assert(openMonth === 400, 'a month that has not closed is refused');

        // Same refusal over HTTP, with the real setting back in place.
        config.leaderboardBonus.firstPaidMonth = configuredFirstMonth;
        let beforeStart = 0;
        try {
            await axios.post(`${GW}/users/admin/leaderboard-bonus/run`, { month: '2020-01' }, adminAuth);
        } catch (e: any) { beforeStart = e.response?.status; }
        assert(beforeStart === 400, 'HTTP: a month before the programme start is refused (400)');
        config.leaderboardBonus.firstPaidMonth = month;

        let badMonth = 0;
        try {
            await axios.post(`${GW}/users/admin/leaderboard-bonus/run`, { month: 'juillet' }, adminAuth);
        } catch (e: any) { badMonth = e.response?.status; }
        assert(badMonth === 400, 'a malformed month is refused');

        let notAdmin = 0;
        try {
            await axios.post(`${GW}/users/admin/leaderboard-bonus/run`, { month }, userAuth(httpWinner.toString()));
        } catch (e: any) { notAdmin = e.response?.status; }
        assert(notAdmin === 403 || notAdmin === 401, 'a plain member cannot trigger a payout');

        // ── Part 3: the scheduled path (what the cron actually calls) ──────
        console.log('\n  — scheduled run (cron path) —');

        // The kill switch first: config is read from env at import, so flip the
        // live object to exercise both sides without a second process.
        const wasEnabled = config.leaderboardBonus.enabled;
        config.leaderboardBonus.enabled = false;
        assert((await leaderboardBonusService.runScheduledPayout('e2e')) === null, 'disabled: the scheduled run does nothing');

        config.leaderboardBonus.enabled = true;
        await LeaderboardPayoutRunModel.deleteMany({ month });
        const scheduled = await leaderboardBonusService.runScheduledPayout('e2e-cron');
        assert(scheduled !== null && scheduled.month === month, 'the scheduled run targets the month that just closed');
        assert(scheduled!.paid === 0 && scheduled!.skipped === 2, 'the scheduled run pays nobody twice');

        const runDoc = await LeaderboardPayoutRunModel.findOne({ month }).lean();
        assert(!!runDoc?.finishedAt && runDoc?.qualifiers === 2, 'the run is recorded with its outcome');

        // Second replica firing the same cron minute must stand down.
        assert((await leaderboardBonusService.runScheduledPayout('e2e-replica-2')) === null, 'a second replica stands down instead of re-running');
        config.leaderboardBonus.enabled = wasEnabled;
        config.leaderboardBonus.firstPaidMonth = configuredFirstMonth;

        console.log('\nleaderboard bonus checks passed');
    } finally {
        await LeaderboardPayoutRunModel.collection.deleteMany({ month: monthKey(previousMonthStart()) });
        await cleanup();
    }
}

main()
    .catch((e) => { console.error(e.message || e); process.exitCode = 1; })
    .finally(() => mongoose.disconnect());
