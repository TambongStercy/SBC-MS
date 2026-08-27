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

    // Alice: 3 x L1 + 2 x L2 + 1 x L3 this month  => 6 referrals, 3*1000+2*500+1*250 = 4250
    const alice = await makeUser('Alice'); await subscribe(alice);
    for (let i = 0; i < 3; i++) await refer(alice, 1, inMonth);
    for (let i = 0; i < 2; i++) await refer(alice, 2, inMonth);
    await refer(alice, 3, inMonth);

    // Bob: 2 x L1 this month => 2 referrals, 2000
    const bob = await makeUser('Bob'); await subscribe(bob);
    for (let i = 0; i < 2; i++) await refer(bob, 1, inMonth);

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

    const board = await referralRepository.getMonthlyAffiliateLeaderboard(10);
    const names = board.map(e => e.name);

    assert.deepStrictEqual(names, ['Alice', 'Bob'], `expected [Alice, Bob], got ${JSON.stringify(names)}`);
    assert.strictEqual(board[0].rank, 1);
    assert.strictEqual(board[1].rank, 2);
    assert.strictEqual(board[0].referralCount, 6, 'Alice counts all three levels');
    assert.strictEqual(board[0].level1, 3);
    assert.strictEqual(board[0].level2, 2);
    assert.strictEqual(board[0].level3, 1);
    assert.strictEqual(board[0].earnings, 3 * 1000 + 2 * 500 + 1 * 250);
    assert.strictEqual(board[1].earnings, 2 * 1000);
    assert.strictEqual(board[0].country, 'CM');

    // The monthly reset, proven without waiting for the 1st: ask for next
    // month's window and the board must be empty.
    const nextMonth = new Date(startOfCurrentMonthDouala().getTime() + 40 * 864e5);
    const future = await referralRepository.getMonthlyAffiliateLeaderboard(10, startOfCurrentMonthDouala(nextMonth));
    assert.deepStrictEqual(future, [], 'board must be empty for a future month');

    console.log('OK  leaderboard: ranking, all-levels count, earnings, month scoping,');
    console.log('    deleted/blocked/unsubscribed exclusion, and monthly reset all pass.');

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
})().catch(async (e) => { console.error('FAIL', e); await mongoose.disconnect(); process.exit(1); });
