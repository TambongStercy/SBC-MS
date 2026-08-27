/**
 * Self-check for the monthly affiliate leaderboard aggregation.
 *
 * Runs against a scratch database, seeds the cases that matter, and asserts.
 * The smallest thing that fails if the pipeline breaks.
 *
 *   npx ts-node src/scripts/check-leaderboard.ts
 */
import assert from 'assert';
import mongoose, { Types } from 'mongoose';
import ReferralModel from '../database/models/referral.model';
import UserModel from '../database/models/user.model';
import SubscriptionModel, { SubscriptionStatus, SubscriptionType } from '../database/models/subscription.model';
import {
    referralRepository,
    startOfCurrentMonthDouala,
    startOfNextMonthDouala,
} from '../database/repositories/referral.repository';

const URI = process.env.CHECK_MONGO_URI || 'mongodb://127.0.0.1:27017/sbc_leaderboard_check';

const oid = () => new Types.ObjectId();
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

async function makeUser(name: string, extra: Record<string, unknown> = {}) {
    const _id = oid();
    await UserModel.collection.insertOne({
        _id, name, email: `${_id}@t.io`, phoneNumber: `${Date.now()}${Math.floor(Math.random() * 1e5)}`,
        password: 'x', country: 'CM', city: 'Douala', deleted: false, blocked: false, ...extra,
    } as any);
    return _id;
}

async function subscribe(user: Types.ObjectId) {
    await SubscriptionModel.collection.insertOne({
        user, subscriptionType: SubscriptionType.CLASSIQUE, status: SubscriptionStatus.ACTIVE,
        startDate: daysAgo(30), endDate: new Date(Date.now() + 30 * 864e5),
    } as any);
}

async function refer(referrer: Types.ObjectId, level: number, createdAt: Date) {
    await ReferralModel.collection.insertOne({
        referrer, referredUser: oid(), referralLevel: level, archived: false, createdAt, updatedAt: createdAt,
    } as any);
}

(async () => {
    await mongoose.connect(URI);
    await Promise.all([
        ReferralModel.collection.deleteMany({}),
        UserModel.collection.deleteMany({}),
        SubscriptionModel.collection.deleteMany({}),
    ]);

    const inMonth = new Date(startOfCurrentMonthDouala().getTime() + 60_000);
    const lastMonth = new Date(startOfCurrentMonthDouala().getTime() - 864e5);

    // Alice: 3 x L1 (+ 2 x L2 + 1 x L3 that must NOT count) => 3 direct, 3000
    const alice = await makeUser('Alice'); await subscribe(alice);
    for (let i = 0; i < 3; i++) await refer(alice, 1, inMonth);
    for (let i = 0; i < 2; i++) await refer(alice, 2, inMonth);
    await refer(alice, 3, inMonth);

    // Bob: 2 x L1 this month => 2 direct, 2000
    const bob = await makeUser('Bob'); await subscribe(bob);
    for (let i = 0; i < 2; i++) await refer(bob, 1, inMonth);

    // Zoe: 40 INDIRECT referrals and a single direct one. Under the old
    // all-levels rule she would top the board; ranking direct-only she must sit
    // below Alice and Bob.
    const zoe = await makeUser('Zoe'); await subscribe(zoe);
    await refer(zoe, 1, inMonth);
    for (let i = 0; i < 25; i++) await refer(zoe, 2, inMonth);
    for (let i = 0; i < 15; i++) await refer(zoe, 3, inMonth);

    // Carol: 99 referrals but all LAST month => must not appear
    const carol = await makeUser('Carol'); await subscribe(carol);
    for (let i = 0; i < 99; i++) await refer(carol, 1, lastMonth);

    // Dave: 50 this month but soft-deleted => must not appear
    const dave = await makeUser('Dave', { deleted: true }); await subscribe(dave);
    for (let i = 0; i < 50; i++) await refer(dave, 1, inMonth);

    // Erin: 40 this month but blocked => must not appear
    const erin = await makeUser('Erin', { blocked: true }); await subscribe(erin);
    for (let i = 0; i < 40; i++) await refer(erin, 1, inMonth);

    // Frank: 30 this month but NO active subscription => must not appear
    const frank = await makeUser('Frank');
    for (let i = 0; i < 30; i++) await refer(frank, 1, inMonth);

    // Veteran: a huge LIFETIME history but only 4 direct referrals this month.
    // The board must show 4, not 5000 — this is the "is it global or monthly?"
    // case in one assertion.
    const veteran = await makeUser('Veteran'); await subscribe(veteran);
    for (let i = 0; i < 4; i++) await refer(veteran, 1, inMonth);
    for (let i = 0; i < 5000; i++) {
        // 90+ days back, so they land well before last month and cannot
        // pollute the admin past-month assertion below.
        await refer(veteran, 1, new Date(startOfCurrentMonthDouala().getTime() - (90 + (i % 300)) * 864e5));
    }

    const { top: board, counts } = await referralRepository.getMonthlyAffiliateLeaderboard(10);
    const names = board.map(e => e.name);

    assert.deepStrictEqual(names, ['Veteran', 'Alice', 'Bob', 'Zoe'], `expected [Veteran, Alice, Bob, Zoe], got ${JSON.stringify(names)}`);
    // The headline assertion: 5004 lifetime referrals, 4 of them this month.
    assert.strictEqual(board[0].referralCount, 4, 'MUST show this month only, not the lifetime total');
    assert.strictEqual(board[0].earnings, 4 * 1000, 'earnings follow the monthly count');
    assert.strictEqual(board[0].rank, 1);
    assert.strictEqual(board[1].referralCount, 3, 'only DIRECT referrals count');
    assert.strictEqual(board[2].referralCount, 2);
    assert.strictEqual(board[3].referralCount, 1, 'Zoe: 40 indirect referrals are ignored');
    assert.strictEqual(board[1].earnings, 3 * 1000, 'earnings follow the direct count');
    assert.strictEqual(board[0].country, 'CM');

    // The monthly reset, proven without waiting for the 1st: ask for next
    // month's window and the board must be empty.
    const nextMonth = new Date(startOfCurrentMonthDouala().getTime() + 40 * 864e5);
    const nextStart = startOfCurrentMonthDouala(nextMonth);
    const future = await referralRepository.getMonthlyAffiliateLeaderboard(10, nextStart, startOfNextMonthDouala(nextStart));
    assert.deepStrictEqual(future.top, [], 'board must be empty for a future month');

    // Admin past-month view: Carol's 99 direct referrals sit in LAST month, so
    // querying that window must return her and exclude this month's users.
    const lastStart = startOfCurrentMonthDouala(new Date(startOfCurrentMonthDouala().getTime() - 5 * 864e5));
    const past = (await referralRepository.getMonthlyAffiliateLeaderboard(10, lastStart, startOfNextMonthDouala(lastStart))).top;
    assert.deepStrictEqual(past.map(e => e.name), ['Carol'], `past month should be [Carol], got ${JSON.stringify(past.map(e => e.name))}`);
    assert.strictEqual(past[0].referralCount, 99, 'past-month counts are that month only');

    // counts drives "your rank" without a per-user aggregation
    assert.deepStrictEqual(counts, [4, 3, 2, 1], `counts should be [3,2,1] desc, got ${JSON.stringify(counts)}`);
    const rankFor = (n: number) => counts.filter(c => c > n).length + 1;
    assert.strictEqual(rankFor(4), 1, 'top score ranks 1');
    assert.strictEqual(rankFor(3), 2);
    assert.strictEqual(rankFor(1), 4);
    assert.strictEqual(rankFor(0), 5, 'unranked user sits just past the field');

    console.log('OK  leaderboard: MONTH-scoped (5004 lifetime -> 4 shown), direct-only,');
    console.log('    earnings aligned, month window bounded both ends, admin past-month view,');
    console.log('    deleted/blocked/unsubscribed exclusion, and monthly reset all pass.');

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
})().catch(async (e) => { console.error('FAIL', e); await mongoose.disconnect(); process.exit(1); });
