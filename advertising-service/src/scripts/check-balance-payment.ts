/**
 * Asserts paying a campaign from the SBC balance (fully or partly).
 *
 * Real money in both directions: a reservation taken twice overdraws the
 * annonceur, one never given back keeps their money, one given back after the
 * campaign was paid hands them a free campaign. user-service and payment-service
 * are replaced by an in-memory wallet and ledger with the same rules (debit only
 * if the balance covers it, refund a reference at most once).
 *
 * Needs a Mongo instance. Uses its own database and drops it afterwards.
 *
 *   npx ts-node src/scripts/check-balance-payment.ts
 */
import mongoose, { Types } from 'mongoose';
import CampaignModel, { CampaignStatus, ICampaign } from '../database/models/campaign.model';

// --- In-memory wallet + ledger standing in for user-service / payment-service ---
const wallet = new Map<string, number>();
const spent = new Map<string, { userId: string; amount: number }>();
const refunded = new Set<string>();
let spendCalls = 0;
let failNextSpend = false;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const userClient = require('../services/clients/user.service.client');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const paymentClient = require('../services/clients/payment.service.client');
userClient.getSpendableBalance = async (userId: string) => wallet.get(userId) ?? 0;
paymentClient.spendFromBalance = async (args: { userId: string; amount: number; reference: string }) => {
    spendCalls++;
    await new Promise(r => setTimeout(r, 5)); // let concurrent callers interleave
    if (failNextSpend) { failNextSpend = false; throw new Error('payment-service down'); }
    if (spent.has(args.reference)) return true;
    const bal = wallet.get(args.userId) ?? 0;
    if (bal < args.amount) return false;
    wallet.set(args.userId, bal - args.amount);
    spent.set(args.reference, { userId: args.userId, amount: args.amount });
    return true;
};
paymentClient.refundBalanceSpend = async (args: { reference: string }) => {
    const s = spent.get(args.reference);
    if (!s || refunded.has(args.reference)) return;
    refunded.add(args.reference);
    wallet.set(s.userId, (wallet.get(s.userId) ?? 0) + s.amount);
};

process.env.BALANCE_RESERVATION_TTL_MS = String(60 * 60 * 1000);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const svc = require('../services/balance-payment.service');

const DB = process.env.BALANCE_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_advertising_balance_check';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

let n = 0;
const seed = (advertiserUserId: Types.ObjectId, over: Record<string, unknown> = {}): Promise<ICampaign> =>
    CampaignModel.create({
        advertiserUserId,
        title: `B${n}`,
        mediaFileId: 'f',
        mediaType: 'image',
        contactPhone: '+237600000000',
        landingPageSlug: `bp${n++}${Date.now()}`,
        amountPaid: 6000,
        pricePerUniqueView: 3,
        targetUniqueViews: 2000,
        status: CampaignStatus.DRAFT,
        ...over,
    });
const fresh = async (c: ICampaign) => (await CampaignModel.findById(c._id))!;

const main = async () => {
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();

    // --- Paid entirely from the balance ---
    const rich = new Types.ObjectId();
    wallet.set(String(rich), 10000);
    const full = await seed(rich);
    check('takes the whole price when the balance covers it', await svc.reserveBalance(full, 6000) === 6000);
    check('the wallet is debited once', wallet.get(String(rich)) === 4000, String(wallet.get(String(rich))));
    check('the campaign records it', (await fresh(full)).balanceApplied === 6000);

    // --- Partly: the balance completes the payment ---
    const modest = new Types.ObjectId();
    wallet.set(String(modest), 2500);
    const partial = await seed(modest);
    check('takes what the balance has, no more', await svc.reserveBalance(partial, 6000) === 2500);
    check('balance emptied, not overdrawn', wallet.get(String(modest)) === 0);
    check('a second "Payer" reuses the reservation', await svc.reserveBalance(await fresh(partial), 6000) === 2500);
    check('and takes nothing more', wallet.get(String(modest)) === 0);

    // --- Two taps at once debit once ---
    const racer = new Types.ObjectId();
    wallet.set(String(racer), 6000);
    const raced = await seed(racer);
    const before = spendCalls;
    const [a, b] = await Promise.all([svc.reserveBalance(await fresh(raced), 6000), svc.reserveBalance(await fresh(raced), 6000)]);
    check('concurrent taps: one debit', spendCalls - before === 1, `${spendCalls - before} debits`);
    check('concurrent taps: wallet never overdrawn', wallet.get(String(racer)) === 0, String(wallet.get(String(racer))));
    check('concurrent taps: both report the amount, so neither opens a full-price payment page', a === 6000 && b === 6000, `${a}/${b}`);

    // --- Empty balance: nothing taken, nothing left claimed ---
    const broke = new Types.ObjectId();
    const empty = await seed(broke);
    check('empty balance takes nothing', await svc.reserveBalance(empty, 6000) === 0);
    check('and leaves no claim behind', !(await fresh(empty)).balanceRef);

    // --- Given back, once ---
    check('release gives the balance part back', await svc.releaseBalance(await fresh(partial)) === 2500);
    check('wallet restored', wallet.get(String(modest)) === 2500);
    check('remembers what was given back', (await fresh(partial)).balanceReleasedAmount === 2500);
    await svc.releaseBalance(await fresh(partial));
    check('releasing twice gives nothing more', wallet.get(String(modest)) === 2500);

    // --- A paid campaign keeps its money ---
    await CampaignModel.updateOne({ _id: full._id }, { $set: { paidAt: new Date(), status: CampaignStatus.PAID } });
    check('never released once paid', await svc.releaseBalance(await fresh(full)) === 0);
    check('wallet unchanged for the paid campaign', wallet.get(String(rich)) === 4000);

    // --- The sweep: only stale, only unpaid ---
    const sleeper = new Types.ObjectId();
    wallet.set(String(sleeper), 3000);
    const abandoned = await seed(sleeper);
    await svc.reserveBalance(abandoned, 6000);
    const recent = await seed(sleeper, {});
    wallet.set(String(sleeper), (wallet.get(String(sleeper)) ?? 0) + 1000);
    await svc.reserveBalance(recent, 6000);
    await CampaignModel.updateOne({ _id: abandoned._id }, { $set: { balanceReservedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) } });
    await CampaignModel.updateOne({ _id: full._id }, { $set: { balanceReservedAt: new Date(Date.now() - 3 * 60 * 60 * 1000) } });
    const swept = await svc.sweepStaleBalanceReservations();
    check('sweep gives back the abandoned one only', swept === 1, String(swept));
    check('the abandoned 3,000 are back', wallet.get(String(sleeper)) === 3000, String(wallet.get(String(sleeper))));
    check('a fresh reservation is left alone', (await fresh(recent)).balanceApplied === 1000);
    check('a paid campaign is never swept', (await fresh(full)).balanceApplied === 6000);

    // --- Mobile money counts once, and the campaign moves only when fully paid ---
    const mmUser = new Types.ObjectId();
    const mmFull = await seed(mmUser, { paymentSessions: [{ sessionId: 'S1', amount: 6000 }] });
    let r = await svc.recordMobileMoneyPayment(String(mmFull._id), 'S1');
    check('a full mobile-money payment leaves nothing to pay', r.known && r.remaining === 0, JSON.stringify(r));
    r = await svc.recordMobileMoneyPayment(String(mmFull._id), 'S1');
    check('a repeated callback is not counted twice', (await fresh(mmFull)).mobileMoneyPaid === 6000, String((await fresh(mmFull)).mobileMoneyPaid));

    wallet.set(String(mmUser), 2500);
    const mix = await seed(mmUser);
    await svc.reserveBalance(mix, 6000);
    await CampaignModel.updateOne({ _id: mix._id }, { $push: { paymentSessions: { sessionId: 'S2', amount: 3500 } } });
    r = await svc.recordMobileMoneyPayment(String(mix._id), 'S2');
    check('balance + mobile money together cover it', r.remaining === 0, JSON.stringify(r));

    // Late: the balance part was given back and the balance is now empty.
    const lateUser = new Types.ObjectId();
    const late = await seed(lateUser, { balanceReleasedAmount: 2500, paymentSessions: [{ sessionId: 'S3', amount: 3500 }] });
    r = await svc.recordMobileMoneyPayment(String(late._id), 'S3');
    check('late payment, balance gone: 2,500 still to pay, the campaign does not move', r.remaining === 2500, JSON.stringify(r));
    check('the 3,500 received are kept on the campaign', (await fresh(late)).mobileMoneyPaid === 3500);
    wallet.set(String(lateUser), 2500);
    await svc.reserveBalance(await fresh(late), svc.outstandingAmount(await fresh(late)));
    check('paying the rest from the balance completes it', svc.outstandingAmount(await fresh(late)) === 0);

    // Late, and the balance still has it: taken again, nothing left.
    const lucky = new Types.ObjectId();
    wallet.set(String(lucky), 2500);
    const relate = await seed(lucky, { balanceReleasedAmount: 2500, paymentSessions: [{ sessionId: 'S4', amount: 3500 }] });
    r = await svc.recordMobileMoneyPayment(String(relate._id), 'S4');
    check('late payment, balance still there: taken again, fully paid', r.remaining === 0 && wallet.get(String(lucky)) === 0, JSON.stringify(r));

    r = await svc.recordMobileMoneyPayment(String(mmFull._id), 'OLD');
    check('a session opened before this rule is left to the old behaviour', r.known === false);

    // --- The debit call fails ---
    const unlucky = new Types.ObjectId();
    wallet.set(String(unlucky), 6000);
    const errored = await seed(unlucky);
    failNextSpend = true;
    let threw = false;
    try { await svc.reserveBalance(errored, 6000); } catch { threw = true; }
    check('a failed debit call is reported', threw);
    check('and leaves no claim, so a retry can pay', !(await fresh(errored)).balanceRef);
    check('and no money moved', wallet.get(String(unlucky)) === 6000);

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
};

main().catch(async err => {
    console.error(err);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
});
