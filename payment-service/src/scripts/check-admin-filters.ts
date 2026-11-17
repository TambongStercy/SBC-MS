/**
 * Asserts the admin filters ?country, ?from, ?to on payment-service admin lists
 * and stats (admin plan, phase 3). Read-only paths: nothing here moves money.
 *
 * Needs a local Mongo. Uses its own database and drops it afterwards. The
 * user-service member lookup is stubbed (setCountryMembersResolver).
 *
 *   mise exec node@22 -- npx ts-node src/scripts/check-admin-filters.ts
 */

// Config validation demands these before anything imports it. USER_SERVICE_URL
// points nowhere so enrichment calls fail fast instead of reaching a real service.
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.PORT = process.env.PORT || '3003';
process.env.HOST = process.env.HOST || '0.0.0.0';
process.env.MONGODB_URI_PROD = process.env.MONGODB_URI_PROD || 'mongodb://127.0.0.1:27017/unused';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'check';
process.env.FEEXPAY_API_KEY = process.env.FEEXPAY_API_KEY || 'check';
process.env.FEEXPAY_SHOP_ID = process.env.FEEXPAY_SHOP_ID || 'check';
process.env.MONEYFUSION_API_URL = process.env.MONEYFUSION_API_URL || 'http://localhost/unused';
process.env.NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY || 'check';
process.env.PAYMENT_SERVICE_BASE_URL = process.env.PAYMENT_SERVICE_BASE_URL || 'http://localhost:3003';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
process.env.SERVICE_SECRET = process.env.SERVICE_SECRET || 'check';
process.env.USER_SERVICE_URL = 'http://127.0.0.1:9';
process.env.ADVERTISING_SERVICE_URL = process.env.ADVERTISING_SERVICE_URL || 'http://localhost/unused';
process.env.TOMBOLA_SERVICE_URL = process.env.TOMBOLA_SERVICE_URL || 'http://localhost/unused';

import assert from 'assert';
import mongoose, { Types } from 'mongoose';

const DB = process.env.CHECK_MONGO_URI || 'mongodb://127.0.0.1:27017/sbc_payment_filters_check';

interface Res { statusCode: number; body: any; status(c: number): Res; json(b: any): Res }
const mkRes = (): Res => ({
    statusCode: 200, body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
});
const mkReq = (query: Record<string, string> = {}, params: Record<string, string> = {}) =>
    ({ query, params, body: {}, user: { userId: new Types.ObjectId().toString(), role: 'admin' } }) as any;

/** Calls an express-style handler and returns the response; `next(err)` rethrows. */
async function call(handler: (req: any, res: any, next?: any) => any, query: Record<string, string> = {}, params: Record<string, string> = {}) {
    const res = mkRes();
    let nextErr: unknown;
    await handler(mkReq(query, params), res, (e: unknown) => { nextErr = e; });
    if (nextErr) throw nextErr;
    return res;
}

(async () => {
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();

    const { setCountryMembersResolver, memberIdsForCountry } = require('../utils/country-members');
    const { paymentController } = require('../api/controllers/payment.controller');
    const { transactionController } = require('../api/controllers/transaction.controller');
    const { withdrawalApprovalController } = require('../api/controllers/withdrawal-approval.controller');
    const { recoveryController } = require('../api/controllers/recovery.controller');
    const { sbcLiveRefundController } = require('../api/controllers/sbc-live-refund.controller');
    const TransactionModel = require('../database/models/transaction.model').default;
    const PaymentIntentModel = require('../database/models/PaymentIntent').default;
    const RecoverModel = require('../database/models/recover-user-transaction.model').default;
    const SbcLiveRefund = require('../database/models/sbc-live-refund.model').default;
    // Name enrichment is not under test (and the history handler fails without it).
    const { userServiceClient } = require('../services/clients/user.service.client');
    userServiceClient.getUserDetails = async () => null;
    userServiceClient.getReferralStats = async () => null;
    userServiceClient.getUsersByIds = async () => [];
    // Build every index now: a late background build would recreate the DB after the final drop.
    await Promise.all(mongoose.modelNames().map(n => mongoose.model(n).init()));

    const cm = new Types.ObjectId(), bj = new Types.ObjectId(), sn = new Types.ObjectId();
    const members: Record<string, string[]> = { CM: [cm.toString()], BJ: [bj.toString()], SN: [sn.toString()], XX: [] };
    let lookups = 0;
    setCountryMembersResolver(async (c: string) => {
        lookups++;
        if (c === 'ER') throw new Error('user-service down');
        await new Promise(r => setTimeout(r, 20));
        return members[c] || [];
    });

    // --- cache: in-flight de-duplication + 5 min reuse ---
    await Promise.all([memberIdsForCountry('CM'), memberIdsForCountry('cm'), memberIdsForCountry('CM')]);
    await memberIdsForCountry('CM');
    assert.strictEqual(lookups, 1, 'one user-service call for concurrent + repeated CM lookups');

    // --- fixtures ---
    const d = (s: string) => new Date(s);
    const ai = (cc?: string) => (cc ? { accountInfo: { countryCode: cc } } : {});
    const tx = (o: Record<string, any>) => ({
        transactionId: new Types.ObjectId().toString(), currency: 'XAF', fee: 0, description: 'check',
        deleted: false, metadata: {}, updatedAt: o.createdAt, ...o,
    });
    await TransactionModel.collection.insertMany([
        tx({ userId: cm, type: 'deposit', status: 'completed', amount: 100, createdAt: d('2026-02-10T10:00:00Z') }),
        // legacy withdrawal without a country code: falls back to the member (CM)
        tx({ userId: cm, type: 'withdrawal', status: 'completed', amount: 50, createdAt: d('2026-02-11T10:00:00Z') }),
        // BJ member paid out to a CM number: CM for withdrawal lists, BJ for member stats
        tx({ userId: bj, type: 'withdrawal', status: 'completed', amount: 70, createdAt: d('2026-05-01T10:00:00Z'), metadata: ai('CM') }),
        // lower-case code, stuck at MoneyFusion
        tx({ userId: sn, type: 'withdrawal', status: 'processing', amount: 40, serviceProvider: 'MoneyFusion', createdAt: d('2026-03-01T10:00:00Z'), metadata: { ...ai('cm'), selectedPayoutService: 'MoneyFusion' } }),
        // CM member asking a payout to BJ, awaiting approval
        tx({ userId: cm, type: 'withdrawal', status: 'pending_admin_approval', amount: 30, createdAt: d('2026-04-01T10:00:00Z'), metadata: ai('BJ') }),
        // stuck at CinetPay
        tx({ userId: cm, type: 'withdrawal', status: 'processing', amount: 20, externalTransactionId: 'cp-1', createdAt: d('2026-03-15T10:00:00Z'), metadata: { ...ai('CM'), selectedPayoutService: 'CinetPay' } }),
        tx({ userId: bj, type: 'deposit', status: 'completed', amount: 30, createdAt: d('2026-06-01T10:00:00Z') }),
        tx({ userId: cm, type: 'payment', status: 'completed', amount: 500, createdAt: d('2026-02-20T10:00:00Z') }),
    ]);
    await PaymentIntentModel.collection.insertMany([
        { sessionId: 'pi1', userId: cm.toString(), status: 'SUCCEEDED', amount: 1, currency: 'XAF', createdAt: d('2026-02-01T00:00:00Z') },
        { sessionId: 'pi2', userId: bj.toString(), status: 'SUCCEEDED', amount: 1, currency: 'XAF', countryCode: 'CM', createdAt: d('2026-03-01T00:00:00Z') },
        { sessionId: 'pi3', userId: sn.toString(), status: 'FAILED', amount: 1, currency: 'XOF', countryCode: 'BJ', createdAt: d('2026-04-01T00:00:00Z') },
        { sessionId: 'pi4', userId: cm.toString(), status: 'FAILED', amount: 1, currency: 'XAF', countryCode: 'UNKNOWN', createdAt: d('2026-05-01T00:00:00Z') },
    ]);
    await RecoverModel.collection.insertMany([
        { transactionReference: 'r1', provider: 'cinetpay', transactionType: 'payment', amount: 1, currency: 'XAF', status: 'completed', recoveryStatus: 'not_restored', providerTransactionData: { country: 'CM' }, createdAt: d('2026-02-01T00:00:00Z') },
        { transactionReference: 'r2', provider: 'feexpay', transactionType: 'payment', amount: 1, currency: 'XAF', status: 'completed', recoveryStatus: 'restored', restoredUserId: cm, providerTransactionData: {}, createdAt: d('2026-03-01T00:00:00Z') },
        { transactionReference: 'r3', provider: 'cinetpay', transactionType: 'payout', amount: 1, currency: 'XOF', status: 'completed', recoveryStatus: 'not_restored', providerTransactionData: { country: 'GH' }, createdAt: d('2026-04-01T00:00:00Z') },
    ]);
    await SbcLiveRefund.collection.insertMany([
        { buyerUserId: cm, status: 'pending', createdAt: d('2026-02-01T00:00:00Z') },
        { buyerUserId: bj, status: 'pending', createdAt: d('2026-03-01T00:00:00Z') },
    ]);

    const Q1 = { from: '2026-01-01', to: '2026-03-31' };

    // --- bad input / member lookup down ---
    for (const h of [paymentController.adminListTransactions, transactionController.adminListAccountTransactions, paymentController.adminGetTotalWithdrawals]) {
        assert.strictEqual((await call(h, { country: 'zz9' })).statusCode, 400, 'bad country → 400');
        assert.strictEqual((await call(h, { to: '16/11/2026' })).statusCode, 400, 'bad date → 400');
    }
    const down = await call(transactionController.adminListAccountTransactions, { country: 'ER' });
    assert.strictEqual(down.statusCode, 502, 'user-service down → 502');
    assert.match(down.body.message, /Filtre pays indisponible/);
    assert.strictEqual((await call(paymentController.adminGetTotalDeposits, { country: 'ER' })).statusCode, 502);

    // --- payment intents: own countryCode, else the member's ---
    const piTotal = async (q: Record<string, string>) => (await call(paymentController.adminListTransactions, q)).body.pagination.totalCount;
    assert.strictEqual(await piTotal({}), 4);
    assert.strictEqual(await piTotal({ country: 'cm' }), 3, 'pi1 (member), pi2 (code), pi4 (UNKNOWN → member)');
    assert.strictEqual(await piTotal({ country: 'BJ' }), 1, 'pi3 only: the BJ member paid with a CM number');
    assert.strictEqual(await piTotal({ country: 'ALL' }), 4);
    assert.strictEqual(await piTotal({ country: 'XX' }), 0);
    assert.strictEqual(await piTotal({ country: 'CM', ...Q1 }), 2);
    assert.strictEqual(await piTotal({ from: '2026-03-01', startDate: '2026-01-01' }), 3, 'from narrows the older startDate');

    // --- account transactions: the member's country ---
    const txTotal = async (q: Record<string, string>) => (await call(transactionController.adminListAccountTransactions, q)).body.pagination.totalCount;
    assert.strictEqual(await txTotal({}), 8);
    assert.strictEqual(await txTotal({ country: 'CM' }), 5);
    assert.strictEqual(await txTotal({ country: 'BJ' }), 2);
    assert.strictEqual(await txTotal({ country: 'XX' }), 0);
    assert.strictEqual(await txTotal({ country: 'CM', ...Q1 }), 4);
    assert.strictEqual(await txTotal({ to: '2026-02-11' }), 2, 'bare `to` = end of that day');

    const ua = async (q: Record<string, string>) => (await call(transactionController.adminGetUserAnalytics, { minAmount: '0', ...q })).body;
    assert.strictEqual((await ua({})).pagination.total, 2, 'cm and bj (sn has no completed tx)');
    assert.deepStrictEqual((await ua({ country: 'CM' })).data.map((r: any) => r.total), [150]);
    assert.strictEqual((await ua({ country: 'XX' })).pagination.total, 0, 'a country without members is empty, not everyone');
    assert.deepStrictEqual((await ua({ country: 'BJ', from: '2026-05-15' })).data.map((r: any) => r.total), [30]);

    // --- stats (same handlers serve /internal/stats/*) ---
    const val = async (h: any, q: Record<string, string> = {}) => (await call(h, q)).body.data;
    assert.strictEqual(await val(paymentController.adminGetTotalWithdrawals), 120);
    assert.strictEqual(await val(paymentController.adminGetTotalWithdrawals, { country: 'CM' }), 50);
    assert.strictEqual(await val(paymentController.adminGetTotalWithdrawals, { country: 'BJ' }), 70);
    assert.strictEqual(await val(paymentController.adminGetTotalWithdrawals, Q1), 50);
    assert.strictEqual(await val(paymentController.adminGetTotalDeposits, { country: 'BJ' }), 30);
    assert.strictEqual(await val(paymentController.adminGetTotalRevenue, { country: 'CM' }), 500);
    assert.strictEqual(await val(paymentController.adminGetTotalRevenue, { country: 'BJ' }), 0);
    assert.strictEqual(await val(paymentController.adminGetTotalTransactionsCount, { country: 'CM', ...Q1 }), 4);
    const monthly = await val(paymentController.adminGetMonthlyRevenue, { country: 'CM', ...Q1 });
    assert.deepStrictEqual(monthly.map((m: any) => m.totalAmount), [0, 500, 0], 'Jan–Mar, Feb = 500');
    const activity = await val(paymentController.adminGetActivityOverview, { country: 'CM', ...Q1 });
    assert.deepStrictEqual(activity.map((m: any) => [m.deposits, m.withdrawals, m.payments]), [[0, 0, 0], [1, 1, 1], [0, 0, 0]]);
    assert.strictEqual((await val(paymentController.adminGetMonthlyRevenue)).length, 13, 'default window unchanged (12 months + current)');

    // --- withdrawal lists: stored destination code, else the member's ---
    const wd = async (h: any, q: Record<string, string> = {}, p: Record<string, string> = {}) => (await call(h, q, p)).body.data;
    assert.strictEqual((await wd(withdrawalApprovalController.getPendingWithdrawals, { country: 'CM' })).pagination.total, 0, 'pending t5 goes to BJ');
    assert.strictEqual((await wd(withdrawalApprovalController.getPendingWithdrawals, { country: 'BJ' })).pagination.total, 1);
    assert.strictEqual((await wd(withdrawalApprovalController.getValidatedWithdrawals)).pagination.total, 2);
    assert.strictEqual((await wd(withdrawalApprovalController.getValidatedWithdrawals, { country: 'CM' })).pagination.total, 2, 'legacy (member) + CM code');
    assert.strictEqual((await wd(withdrawalApprovalController.getValidatedWithdrawals, { country: 'BJ' })).pagination.total, 0);
    assert.strictEqual((await wd(withdrawalApprovalController.getValidatedWithdrawals, { country: 'CM', ...Q1 })).pagination.total, 1);
    assert.strictEqual((await wd(withdrawalApprovalController.getStuckMoneyFusionWithdrawals, { country: 'CM' })).pagination.total, 1, 'lower-case code');
    assert.strictEqual((await wd(withdrawalApprovalController.getStuckMoneyFusionWithdrawals, { country: 'SN' })).pagination.total, 0);
    assert.strictEqual((await wd(withdrawalApprovalController.getStuckCinetPayWithdrawals, { country: 'CM' })).pagination.total, 1);
    assert.strictEqual((await wd(withdrawalApprovalController.getStuckCinetPayWithdrawals, { country: 'CM', from: '2026-03-16' })).pagination.total, 0);
    const stats = await wd(withdrawalApprovalController.getWithdrawalStats, { country: 'CM' });
    assert.deepStrictEqual([stats.pendingApproval, stats.processing], [0, 2]);
    assert.strictEqual((await wd(withdrawalApprovalController.getWithdrawalStats, { from: '2026-03-10' })).processing, 1);
    assert.strictEqual((await wd(withdrawalApprovalController.getUserWithdrawalHistory, { country: 'CM' }, { userId: bj.toString() })).pagination.total, 1);
    assert.strictEqual((await wd(withdrawalApprovalController.getUserWithdrawalHistory, { to: '2026-01-31' }, { userId: cm.toString() })).pagination.total, 0);
    assert.strictEqual((await call(withdrawalApprovalController.getValidatedWithdrawals, { country: 'zz9' })).statusCode, 400);

    // --- recovery: provider country, else the restored member's ---
    const rec = await call(recoveryController.listRecoveryRecords, { country: 'CM' });
    assert.strictEqual(rec.body.pagination.totalRecords, 2);
    const recStats = (await call(recoveryController.getRecoveryStats, { country: 'cm', from: '2026-02-15' })).body.data;
    assert.deepStrictEqual([recStats.total, recStats.restored, recStats.byProvider], [1, 1, { feexpay: 1 }]);
    assert.strictEqual((await call(recoveryController.getRecoveryStats, {})).body.data.total, 3);

    // --- SBC Live refunds: buyer's country ---
    assert.strictEqual((await call(sbcLiveRefundController.listRefunds, { country: 'BJ' })).body.data.length, 1);
    assert.strictEqual((await call(sbcLiveRefundController.listRefunds, { to: '2026-01-31' })).body.data.length, 0);

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log('OK payment-service admin filters (country/from/to): lists, stats, withdrawals, recovery, refunds, cache, 400/502');
    process.exit(0);
})().catch(async (error) => {
    console.error('FAIL', error);
    await mongoose.connection.dropDatabase().catch(() => { });
    await mongoose.disconnect().catch(() => { });
    process.exit(1);
});
