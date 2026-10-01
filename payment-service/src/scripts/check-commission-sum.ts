/**
 * Asserts the commission sum behind relance's "gagné grâce à la relance".
 *
 * Commissions are completed internal deposits whose filleul is stored in
 * paymentProvider.metadata.sourceUserId (a string). The sum must count those
 * and nothing else: not another parrain's, not a pending or deleted one, not
 * an internal deposit that is not a commission, not a filleul outside the list.
 *
 * Needs a Mongo instance. Uses its own database and drops it afterwards.
 *
 *   npx ts-node src/scripts/check-commission-sum.ts
 */
import mongoose, { Types } from 'mongoose';
import TransactionModel from '../database/models/transaction.model';
import { sumCommissionsFromSources } from '../services/commission-sum.service';

const DB = process.env.COMMISSION_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_payment_commission_sum_check';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

const parrain = new Types.ObjectId();
const [a, b, outsider] = [new Types.ObjectId(), new Types.ObjectId(), new Types.ObjectId()].map(String);

const commission = (over: Record<string, unknown>, meta: Record<string, unknown> = {}) => ({
    userId: parrain, type: 'deposit', status: 'completed', amount: 1000, currency: 'XAF', deleted: false,
    paymentProvider: { provider: 'internal', transactionId: 'internal_x', metadata: { commissionLevel: 1, sourceUserId: a, ...meta } },
    ...over,
});

(async () => {
    await mongoose.connect(DB, { serverSelectionTimeoutMS: 3000 });
    await mongoose.connection.dropDatabase();
    await TransactionModel.collection.insertMany([
        commission({}),                                                     // A, level 1: 1000 XAF
        commission({ amount: 250 }, { commissionLevel: 3 }),                // A, level 3: 250 XAF
        commission({ amount: 2500 }, { sourceUserId: b }),                  // B: 2500 XAF
        commission({ amount: 2, currency: 'USD' }, { sourceUserId: b }),    // B paid in crypto: 2 USD
        commission({ amount: 9999 }, { sourceUserId: outsider }),           // not in the list
        commission({ amount: 9999, status: 'pending' }),                    // not completed
        commission({ amount: 9999, status: 'reconciled' }),                 // reversed by an admin
        commission({ amount: 9999, deleted: true }),                        // deleted
        commission({ amount: 9999, userId: new Types.ObjectId() }),         // another parrain's
        commission({ amount: 9999 }, { commissionLevel: undefined }),       // internal deposit, not a commission
        commission({ amount: 9999, type: 'withdrawal' }),                   // not a deposit
    ].map((d, i) => ({ ...JSON.parse(JSON.stringify(d), (k, v) => (k === "userId" && typeof v === "string" ? new Types.ObjectId(v) : v)), transactionId: `T${i}` })));

    const sum = await sumCommissionsFromSources(parrain.toString(), [a, b]);
    check('sums XAF commissions from the listed filleuls, every level', sum.XAF === 3750, `XAF=${sum.XAF}`);
    check('keeps USD (crypto) commissions apart', sum.USD === 2, `USD=${sum.USD}`);
    check('counts the commissions it summed', sum.commissions === 4, `commissions=${sum.commissions}`);

    const none = await sumCommissionsFromSources(parrain.toString(), [outsider.replace(/.$/, c => (c === '0' ? '1' : '0'))]);
    check('returns zero for filleuls who earned nothing', none.XAF === 0 && none.USD === 0 && none.commissions === 0);

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
})().catch(async err => {
    console.error(err);
    await mongoose.disconnect().catch(() => undefined);
    process.exit(1);
});
