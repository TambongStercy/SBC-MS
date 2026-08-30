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

/**
 * A referrer needs an active registration sub to appear on the board — this
 * seeds one dated well in the past so it counts as "already active".
 */
async function subscribeReferrer(user: Types.ObjectId) {
    // Dated well before the current month so the referrer's OWN sub can't leak
    // into this month's "paid filleul" set and skew the assertions.
    const wayBack = daysAgo(120);
    await SubscriptionModel.collection.insertOne({
        user, subscriptionType: SubscriptionType.CLASSIQUE, status: SubscriptionStatus.ACTIVE,
        startDate: wayBack, endDate: new Date(Date.now() + 30 * 864e5),
        createdAt: wayBack, updatedAt: wayBack,
    } as any);
}

/**
 * The board counts referrals whose FILLEUL paid this month. `paidAt` controls
 * that — pass a date inside the window to count, outside to exclude, or null to
 * seed a referral whose filleul never paid at all.
 */
async function refer(referrer: Types.ObjectId, level: number, referralCreatedAt: Date, paidAt: Date | null) {
    const referredUser = await makeUser(`filleul-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
    await ReferralModel.collection.insertOne({
        referrer, referredUser, referralLevel: level, archived: false,
        createdAt: referralCreatedAt, updatedAt: referralCreatedAt,
    } as any);
    if (paidAt) {
        await SubscriptionModel.collection.insertOne({
            user: referredUser, subscriptionType: SubscriptionType.CLASSIQUE, status: SubscriptionStatus.ACTIVE,
            startDate: paidAt, endDate: new Date(paidAt.getTime() + 365 * 864e5),
            createdAt: paidAt, updatedAt: paidAt,
        } as any);
    }
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

    // Alice: 3 direct filleuls paid this month (+ 2 L2 + 1 L3 also paid, must
    // NOT count) => 3 direct, 3000
    const alice = await makeUser('Alice'); await subscribeReferrer(alice);
    for (let i = 0; i < 3; i++) await refer(alice, 1, inMonth, inMonth);
    for (let i = 0; i < 2; i++) await refer(alice, 2, inMonth, inMonth);
    await refer(alice, 3, inMonth, inMonth);

    // Bob: 2 direct filleuls paid this month => 2 direct, 2000
    const bob = await makeUser('Bob'); await subscribeReferrer(bob);
    for (let i = 0; i < 2; i++) await refer(bob, 1, inMonth, inMonth);

    // Zoe: 40 INDIRECT paid + a single direct paid one. Under the old
    // all-levels rule she would top the board; ranking direct-only she must sit
    // below Alice and Bob.
    const zoe = await makeUser('Zoe'); await subscribeReferrer(zoe);
    await refer(zoe, 1, inMonth, inMonth);
    for (let i = 0; i < 25; i++) await refer(zoe, 2, inMonth, inMonth);
    for (let i = 0; i < 15; i++) await refer(zoe, 3, inMonth, inMonth);

    // Carol: 99 direct filleuls, all PAID LAST month => must not appear.
    // The whole point of the monthly reset — proves we key on paid-date, not
    // referral-created-date.
    const carol = await makeUser('Carol'); await subscribeReferrer(carol);
    for (let i = 0; i < 99; i++) await refer(carol, 1, lastMonth, lastMonth);

    // Dave: 50 direct paid this month but soft-deleted => must not appear
    const dave = await makeUser('Dave', { deleted: true }); await subscribeReferrer(dave);
    for (let i = 0; i < 50; i++) await refer(dave, 1, inMonth, inMonth);

    // Erin: 40 direct paid this month but blocked => must not appear
    const erin = await makeUser('Erin', { blocked: true }); await subscribeReferrer(erin);
    for (let i = 0; i < 40; i++) await refer(erin, 1, inMonth, inMonth);

    // Frank: 30 direct paid this month but NO active subscription of his own
    // => must not appear (referrer must be a subscriber to be ranked)
    const frank = await makeUser('Frank');
    for (let i = 0; i < 30; i++) await refer(frank, 1, inMonth, inMonth);

    // Grace: 20 direct SIGNUPS this month but NONE of them paid => must not
    // appear. This is the headline product rule for this change — signups
    // alone are worthless, only paid activations count.
    const grace = await makeUser('Grace'); await subscribeReferrer(grace);
    for (let i = 0; i < 20; i++) await refer(grace, 1, inMonth, null);

    // Henri: 5 direct signups this month, only 2 of them paid this month, the
    // other 3 paid LAST month => board must show 2, not 5, not 3.
    const henri = await makeUser('Henri'); await subscribeReferrer(henri);
    for (let i = 0; i < 2; i++) await refer(henri, 1, inMonth, inMonth);
    for (let i = 0; i < 3; i++) await refer(henri, 1, inMonth, lastMonth);

    // Veteran: a huge LIFETIME history but only 4 direct paid THIS month. Even
    // the 5000 old direct signups WITH paid subs from years ago don't count —
    // the board is scoped to this month's paid activations.
    const veteran = await makeUser('Veteran'); await subscribeReferrer(veteran);
    for (let i = 0; i < 4; i++) await refer(veteran, 1, inMonth, inMonth);
    for (let i = 0; i < 5000; i++) {
        const oldDate = new Date(startOfCurrentMonthDouala().getTime() - (90 + (i % 300)) * 864e5);
        await refer(veteran, 1, oldDate, oldDate);
    }

    const { top: board, counts } = await referralRepository.getMonthlyAffiliateLeaderboard(10);
    const names = board.map(e => e.name);

    // Bob and Henri both have 2 paid — the _id tiebreak puts the earlier-created
    // referrer first, and Bob is inserted before Henri. Alice(3) > Bob(2) = Henri(2) > Zoe(1).
    assert.deepStrictEqual(names, ['Veteran', 'Alice', 'Bob', 'Henri', 'Zoe'], `expected [Veteran, Alice, Bob, Henri, Zoe], got ${JSON.stringify(names)}`);
    // The headline assertion: 5004 lifetime paid referrals, 4 of them paid this month.
    assert.strictEqual(board[0].referralCount, 4, 'MUST show THIS MONTH paid only, not lifetime');
    assert.strictEqual(board[0].earnings, 4 * 1000, 'earnings follow the monthly paid count');
    assert.strictEqual(board[0].rank, 1);
    assert.strictEqual(board[1].referralCount, 3, 'only DIRECT paid referrals count (Alice)');
    assert.strictEqual(board[2].referralCount, 2, 'Bob');
    assert.strictEqual(board[3].referralCount, 2, 'Henri: only the 2 paid THIS month, not the 3 paid last month');
    assert.strictEqual(board[4].referralCount, 1, 'Zoe: 40 indirect paid referrals are ignored');
    assert.strictEqual(board[1].earnings, 3 * 1000, 'earnings follow the direct paid count');
    assert.strictEqual(board[0].country, 'CM');
    assert.ok(!names.includes('Grace'), 'Grace has 20 unpaid signups, must not appear');
    assert.ok(!names.includes('Carol'), 'Carol paid all last month, must not appear this month');
    assert.ok(!names.includes('Frank'), 'Frank has no active referrer sub, must not appear');
    assert.ok(!names.includes('Dave'), 'Dave is soft-deleted');
    assert.ok(!names.includes('Erin'), 'Erin is blocked');

    // The monthly reset, proven without waiting for the 1st: ask for next
    // month's window and the board must be empty.
    const nextMonth = new Date(startOfCurrentMonthDouala().getTime() + 40 * 864e5);
    const nextStart = startOfCurrentMonthDouala(nextMonth);
    const future = await referralRepository.getMonthlyAffiliateLeaderboard(10, nextStart, startOfNextMonthDouala(nextStart));
    assert.deepStrictEqual(future.top, [], 'board must be empty for a future month');

    // Admin past-month view: Carol's 99 direct paid referrals sit in LAST month,
    // so querying that window must return her and exclude this month's users.
    const lastStart = startOfCurrentMonthDouala(new Date(startOfCurrentMonthDouala().getTime() - 5 * 864e5));
    const past = (await referralRepository.getMonthlyAffiliateLeaderboard(10, lastStart, startOfNextMonthDouala(lastStart))).top;
    const pastNames = past.map(e => e.name);
    assert.ok(pastNames.includes('Carol'), `past month should include Carol, got ${JSON.stringify(pastNames)}`);
    assert.strictEqual(past.find(e => e.name === 'Carol')!.referralCount, 99, 'past-month counts are that month only');

    // counts drives "your rank" without a per-user aggregation
    assert.deepStrictEqual(counts, [4, 3, 2, 2, 1], `counts should be [4,3,2,2,1] desc, got ${JSON.stringify(counts)}`);
    const rankFor = (n: number) => counts.filter(c => c > n).length + 1;
    assert.strictEqual(rankFor(4), 1, 'top score ranks 1');
    assert.strictEqual(rankFor(3), 2);
    assert.strictEqual(rankFor(2), 3, 'ties share a rank');
    assert.strictEqual(rankFor(1), 5, 'past the two 2s');
    assert.strictEqual(rankFor(0), 6, 'unranked user sits just past the field');

    // countMonthlyDirectReferrals must key on paid-date too, not referral-date.
    // Grace has 20 unpaid signups this month → 0. Henri has 2 paid this month → 2.
    const graceCount = await referralRepository.countMonthlyDirectReferrals(grace);
    const henriCount = await referralRepository.countMonthlyDirectReferrals(henri);
    const veteranCount = await referralRepository.countMonthlyDirectReferrals(veteran);
    assert.strictEqual(graceCount, 0, 'Grace: 20 signups, 0 paid this month');
    assert.strictEqual(henriCount, 2, 'Henri: 2 paid this month (not 5 signups, not 3 paid last month)');
    assert.strictEqual(veteranCount, 4, 'Veteran: only this month, not the lifetime 5000+');

    console.log('OK  leaderboard: PAID-this-month direct-only, 5004 lifetime paid -> 4 shown,');
    console.log('    unpaid signups excluded (Grace), past-month payments excluded (Carol/Henri partial),');
    console.log('    earnings aligned, admin past-month view, deleted/blocked/unsubscribed exclusion,');
    console.log('    and monthly reset all pass.');

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
})().catch(async (e) => { console.error('FAIL', e); await mongoose.disconnect(); process.exit(1); });
