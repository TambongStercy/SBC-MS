/**
 * Asserts banked-credit reservation and release.
 *
 * Credit is money the annonceur has already paid. Losing a reservation costs
 * them real value; double-spending one activates a campaign nobody paid for.
 * These checks cover both directions.
 *
 * Needs a Mongo instance. Uses its own database and drops it afterwards.
 *
 *   npx ts-node src/scripts/check-credit.ts
 */
import mongoose, { Types } from 'mongoose';
import CampaignModel, { CampaignStatus, ICampaign } from '../database/models/campaign.model';
import {
    availableCredit,
    reserveCredit,
    releaseCredit,
    sweepStaleCreditReservations,
} from '../services/credit.service';

const DB = process.env.CREDIT_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_advertising_credit_check';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

let n = 0;
const seed = async (
    advertiserUserId: Types.ObjectId,
    over: Partial<Record<string, unknown>> = {},
): Promise<ICampaign> =>
    CampaignModel.create({
        advertiserUserId,
        title: `C${n}`,
        mediaFileId: 'f',
        mediaType: 'image',
        contactPhone: '+237600000000',
        landingPageSlug: `cr${n++}${Date.now()}`,
        amountPaid: 6000,
        pricePerUniqueView: 3,
        targetUniqueViews: 2000,
        status: CampaignStatus.APPROVED,
        ...over,
    });

const banked = (userId: Types.ObjectId, amount: number, completedAt = new Date()) =>
    seed(userId, { status: CampaignStatus.BANKED, bankedAmount: amount, completedAt });

const main = async () => {
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();

    // --- Available credit ---
    const userA = new Types.ObjectId();
    await banked(userA, 2000);
    await banked(userA, 1500);
    await banked(userA, 0);
    // Another annonceur's credit must never be visible here.
    await banked(new Types.ObjectId(), 9999);

    check('sums an annonceur\'s banked credit', await availableCredit(userA) === 3500,
        `got ${await availableCredit(userA)}`);
    check('credit is scoped to its owner', await availableCredit(new Types.ObjectId()) === 0);

    // --- Partial cover ---
    const partial = await seed(userA);
    const appliedPartial = await reserveCredit(partial);
    check('applies all available credit when it is short of the price', appliedPartial === 3500, `got ${appliedPartial}`);
    check('leaves the annonceur with no credit afterwards', await availableCredit(userA) === 0);
    check('records where the credit came from', (partial.creditSources?.length ?? 0) === 2);

    // --- Release puts it back exactly ---
    await releaseCredit(partial);
    check('release returns the full amount to the vouchers', await availableCredit(userA) === 3500,
        `got ${await availableCredit(userA)}`);
    check('release clears the reservation', !partial.creditApplied && !partial.creditReservedAt);
    check('releasing twice is harmless', await releaseCredit(partial) === 0);

    // --- Full cover, and only what is needed is taken ---
    const userB = new Types.ObjectId();
    await banked(userB, 10000);
    const covered = await seed(userB);
    const appliedFull = await reserveCredit(covered);
    check('takes only what the campaign costs', appliedFull === 6000, `got ${appliedFull}`);
    check(
        'leaves the rest of the voucher spendable',
        await availableCredit(userB) === 4000,
        `got ${await availableCredit(userB)}`,
    );

    // --- A reservation is not taken twice ---
    const again = await reserveCredit(covered);
    check('re-reserving returns the existing reservation', again === 6000, `got ${again}`);
    check('re-reserving does not take more credit', await availableCredit(userB) === 4000);

    // --- Two campaigns cannot spend the same credit ---
    const userC = new Types.ObjectId();
    await banked(userC, 6000);
    const first = await seed(userC);
    const second = await seed(userC);
    const [a, b] = await Promise.all([reserveCredit(first), reserveCredit(second)]);
    check(
        'concurrent reservations never overdraw',
        a + b <= 6000,
        `took ${a} and ${b} from 6000`,
    );
    check('the credit is fully accounted for', a + b + (await availableCredit(userC)) === 6000);

    // --- Stale reservations come back ---
    const userD = new Types.ObjectId();
    await banked(userD, 6000);
    const abandoned = await seed(userD);
    await reserveCredit(abandoned);
    check('abandoned reservation holds the credit', await availableCredit(userD) === 0);

    // Not yet stale: the sweep must leave a payment still in progress alone.
    check('does not release a fresh reservation', await sweepStaleCreditReservations() === 0);

    await CampaignModel.updateOne(
        { _id: abandoned._id },
        { $set: { creditReservedAt: new Date(Date.now() - 3 * 60 * 60 * 1000) } },
    );
    const swept = await sweepStaleCreditReservations();
    check('releases a reservation whose payment never arrived', swept === 1, `released ${swept}`);
    check('the credit is spendable again', await availableCredit(userD) === 6000,
        `got ${await availableCredit(userD)}`);

    // --- An activated campaign keeps its credit ---
    const userE = new Types.ObjectId();
    await banked(userE, 6000);
    const live = await seed(userE);
    await reserveCredit(live);
    await CampaignModel.updateOne(
        { _id: live._id },
        {
            $set: {
                status: CampaignStatus.ACTIVE,
                creditReservedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
            },
        },
    );
    await sweepStaleCreditReservations();
    check(
        'never claws credit back from a live campaign',
        await availableCredit(userE) === 0,
        'it was spent, not abandoned',
    );

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();

    console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`);
    process.exit(failures === 0 ? 0 : 1);
};

main().catch(async err => {
    console.error('Failed:', err.message);
    await mongoose.disconnect().catch(() => { });
    process.exit(1);
});
