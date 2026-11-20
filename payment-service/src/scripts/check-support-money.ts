/**
 * Support phase 2 — money paths, end to end in one process:
 *   payment-service code  → sbc_payment_support_test
 *   user-service wallet   → sbc_users_support_test (its real reservation/ledger
 *                           code, behind its real HTTP routes on a random port)
 *   support-service       → a local recorder of POST /api/support/internal/cases
 * Every provider call is mocked; nothing leaves the machine. Both databases are
 * dropped before and after. Never point it at a dev or prod database.
 *
 *   SUPPORT_PAYMENT_TEST_DB=mongodb://127.0.0.1:27017/sbc_payment_support_test \
 *   SUPPORT_USERS_TEST_DB=mongodb://127.0.0.1:27017/sbc_users_support_test \
 *     npx ts-node --transpile-only src/scripts/check-support-money.ts
 */
// Withdrawals here are confirmed with the e-mailed code: this checks reservations; the
// authenticator path has its own check (check-withdrawal-authenticator.ts).
process.env.MEMBER_AUTHENTICATOR_REQUIRED = 'false';
process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.PORT = process.env.PORT || '59993';
process.env.HOST = process.env.HOST || '127.0.0.1';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'check-jwt';
process.env.FEEXPAY_API_KEY = process.env.FEEXPAY_API_KEY || 'check';
process.env.FEEXPAY_SHOP_ID = process.env.FEEXPAY_SHOP_ID || 'check';
process.env.NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY || 'check';
process.env.NOWPAYMENTS_IPN_SECRET = 'ipn-test-secret';
process.env.SERVICE_SECRET = process.env.SERVICE_SECRET || 'check-secret';
process.env.MONGODB_URI_PROD = process.env.MONGODB_URI_PROD || 'mongodb://127.0.0.1:27017/sbc_unused_test';
process.env.MONGODB_URI_DEV = process.env.MONGODB_URI_DEV || 'mongodb://127.0.0.1:27017/sbc_unused_test';
for (const v of ['USER_SERVICE_URL', 'PAYMENT_SERVICE_URL', 'NOTIFICATION_SERVICE_URL', 'SETTINGS_SERVICE_URL', 'PRODUCT_SERVICE_URL',
    'ADVERTISING_SERVICE_URL', 'TOMBOLA_SERVICE_URL', 'PAYMENT_SERVICE_BASE_URL', 'MONEYFUSION_API_URL', 'CINETPAY_BASE_URL', 'FEEXPAY_BASE_URL']) {
    process.env[v] = process.env[v] || 'http://127.0.0.1:1';
}
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
delete process.env.PAYMENT_SANDBOX_ENABLED;

import assert from 'assert';
import crypto from 'crypto';
import http from 'http';
import express from 'express';
import axios from 'axios';
import mongoose, { Types } from 'mongoose';

const PAY_DB = process.env.SUPPORT_PAYMENT_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_payment_support_test';
const USERS_DB = process.env.SUPPORT_USERS_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_users_support_test';
for (const uri of [PAY_DB, USERS_DB]) {
    if (!/_test$/.test(new URL(uri).pathname.slice(1))) {
        console.error(`Refusing to run against ${uri}: the database name must end in _test`);
        process.exit(2);
    }
}

let passed = 0;
const ok = (label: string) => { passed++; console.log(`ok  ${label}`); };
const listen = (app: express.Express) => new Promise<{ server: http.Server; port: number }>((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as any).port }));
});

const main = async () => {
    /* eslint-disable @typescript-eslint/no-var-requires */
    // ── user-service (its own mongoose instance, its real wallet routes) ──
    const userMongoose = require('../../../user-service/node_modules/mongoose');
    await userMongoose.connect(USERS_DB);
    await userMongoose.connection.dropDatabase();
    const UserModel = require('../../../user-service/src/database/models/user.model').default;
    const WalletMovementModel = require('../../../user-service/src/database/models/wallet-movement.model').default;
    const BalanceReservationModel = require('../../../user-service/src/database/models/balance-reservation.model').default;
    await Promise.all([WalletMovementModel.syncIndexes(), BalanceReservationModel.syncIndexes()]);
    const walletRoutes = require('../../../user-service/src/api/routes/wallet-internal.routes').default;
    const userApp = express();
    userApp.use(express.json());
    userApp.use('/api/users/internal/wallet', walletRoutes);
    const { userController } = require('../../../user-service/src/api/controllers/user.controller');
    userApp.post('/api/users/internal/:userId/spend-balance', (req, res) => userController.spendBalance(req, res));
    userApp.post('/api/users/internal/:userId/balance', (req, res) => userController.updateUserBalance(req, res));
    const userSrv = await listen(userApp);

    // ── support-service stand-in: records the cases it is sent ──
    const cases: any[] = [];
    const supportApp = express();
    supportApp.use(express.json());
    supportApp.post('/api/support/internal/cases', (req, res) => {
        assert.strictEqual(req.header('authorization'), `Bearer ${process.env.SERVICE_SECRET}`);
        cases.push(req.body);
        res.json({ success: true, data: { caseId: `c${cases.length}`, created: true } });
    });
    const supportSrv = await listen(supportApp);
    process.env.SUPPORT_SERVICE_URL = `http://127.0.0.1:${supportSrv.port}`;

    // ── payment-service ──
    await mongoose.connect(PAY_DB);
    await mongoose.connection.dropDatabase();
    const TransactionModel = require('../database/models/transaction.model').default;
    const { TransactionStatus, TransactionType, Currency } = require('../database/models/transaction.model');
    const PaymentIntentModel = require('../database/models/PaymentIntent').default;
    const { PaymentStatus } = require('../database/interfaces/IPaymentIntent');
    await Promise.all([TransactionModel.syncIndexes(), PaymentIntentModel.syncIndexes(), require('../database/models/manual-ref-claim.model').default.syncIndexes()]);

    const { userServiceClient } = require('../services/clients/user.service.client');
    (userServiceClient as any).baseUrl = `http://127.0.0.1:${userSrv.port}/api`;
    const notificationService = require('../services/clients/notification.service.client').default;
    for (const m of ['sendTransactionNotification', 'sendVerificationOTP', 'sendTransactionFailureEmail', 'sendTransactionSuccessEmail', 'sendPush']) {
        (notificationService as any)[m] = async () => true;
    }
    const balances = new Map<string, number>();
    userServiceClient.getWithdrawalLock = async () => ({ locked: false });
    userServiceClient.getUserDetails = async (id: string) => ({ _id: id, name: 'Membre', email: null, phoneNumber: '237650000000' });
    userServiceClient.getUserDetailsWithMomo = async (id: string) => ({ _id: id, name: 'Membre', momoNumber: '237650000000', momoOperator: 'MTN_MOMO_CMR' });
    userServiceClient.getBalance = async (id: string) => {
        const u = await UserModel.findById(id).lean();
        return (u?.balance ?? 0) - Math.max(0, u?.debt ?? 0);
    };
    userServiceClient.getUsdBalance = async (id: string) => (await UserModel.findById(id).lean())?.usdBalance ?? 0;

    const config = require('../config').default;
    config.withdrawalsEnabled = true;
    config.feexpay.withdrawalsEnabled = true;
    config.cinetpay.withdrawalsEnabled = true;
    config.nowpayments.withdrawalsEnabled = true;
    const paymentService = require('../services/payment.service').default;
    const { moneyFusionService } = require('../services/moneyfusion.service');
    const { feexPayPayoutService } = require('../services/feexpay-payout.service');
    const { supportFinanceService } = require('../services/support-finance.service');
    const { runFinanceReconciliation } = require('../jobs/finance-reconciliation.job');
    const transactionRepository = require('../database/repositories/transaction.repository').default;
    const AppErrorCls = require('../utils/errors').AppError;

    // Provider mocks: any real HTTP call would fail loudly.
    const realGet = axios.get;
    const axiosRoutes: Array<{ match: RegExp; reply: (url: string) => any }> = [];
    (axios as any).get = async (url: string, cfg?: any) => {
        const route = axiosRoutes.find((r) => r.match.test(url));
        if (route) return route.reply(url);
        if (url.startsWith(`http://127.0.0.1:`)) return realGet(url, cfg);
        throw new Error(`Unexpected outbound GET ${url}`);
    };

    let n = 0;
    const member = async (fields: Record<string, unknown>) => {
        const _id = new Types.ObjectId();
        await UserModel.collection.insertOne({ _id, name: `Membre ${n}`, email: `m${n}@test.local`, phoneNumber: `2376500${String(n++).padStart(5, '0')}`, referralCode: `ref${_id}`, balance: 0, debt: 0, usdBalance: 0, ...fields });
        return String(_id);
    };
    const userDoc = async (id: string) => UserModel.findById(id).lean();
    const tx = async (id: string) => TransactionModel.findOne({ transactionId: id }).lean();

    // (1) 20 concurrent withdrawal requests on a balance that covers one
    const u1 = await member({ balance: 10000 });
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => paymentService.initiateWithdrawal(u1, 6000, '127.0.0.1', 'check')));
    const reservations = await BalanceReservationModel.find({ userId: new Types.ObjectId(u1) }).lean();
    assert.strictEqual(reservations.filter((r: any) => r.state === 'held').length, 1, 'exactly one reservation held');
    const live = await TransactionModel.find({ userId: new Types.ObjectId(u1), status: TransactionStatus.PENDING_OTP_VERIFICATION }).lean();
    assert.strictEqual(live.length, 1, 'exactly one request awaits its code');
    const u1d = await userDoc(u1);
    assert.strictEqual(u1d.balance, 10000, 'nothing debited at request');
    assert.strictEqual(u1d.reservedBalance, live[0].amount, 'gross amount reserved');
    const reasons = results.filter((r) => r.status === 'rejected').map((r: any) => r.reason?.message);
    assert.ok(reasons.every((m) => /insuffisant|Insufficient/i.test(m)), `others refused for balance or pointed at the live request: ${reasons.join(' | ')}`);
    ok(`(1) 20 concurrent requests on a balance for one → 1 reserved (${live[0].amount} XAF), balance untouched`);

    // (2) Idempotency-Key: the same key returns the same request
    const u2 = await member({ balance: 50000 });
    const k1 = await paymentService.initiateWithdrawal(u2, 2000, '127.0.0.1', 'check', 'key-abcdef-001');
    const k2 = await paymentService.initiateWithdrawal(u2, 2000, '127.0.0.1', 'check', 'key-abcdef-001');
    assert.strictEqual(k1.transactionId, k2.transactionId);
    assert.strictEqual(await TransactionModel.countDocuments({ userId: new Types.ObjectId(u2) }), 1);
    await assert.rejects(TransactionModel.create({ transactionId: 'dup-key', userId: new Types.ObjectId(u2), type: 'withdrawal', amount: 1, currency: 'XAF', status: 'failed', description: 'x', idempotencyKey: 'key-abcdef-001' }), /E11000/);
    ok('(2) Idempotency-Key: a repeated request returns the first; unique {userId, idempotencyKey}');

    // (3) OTP → approval → payout → MoneyFusion webhook replayed 5× and out of order → one debit
    const live1 = live[0];
    const withCode = await TransactionModel.findOne({ transactionId: live1.transactionId }).select('+verificationCode').lean();
    await paymentService.verifyWithdrawal(live1.transactionId, withCode.verificationCode);
    assert.strictEqual((await tx(live1.transactionId)).status, TransactionStatus.PENDING_ADMIN_APPROVAL);
    moneyFusionService.initiatePayout = async () => ({ success: true, tokenPay: 'MF-TOKEN-1', message: 'ok' });
    const approved = await Promise.all([paymentService.approveWithdrawal(live1.transactionId, String(new Types.ObjectId())), paymentService.approveWithdrawal(live1.transactionId, String(new Types.ObjectId()))]);
    assert.strictEqual(approved.filter((a: any) => a.success).length, 1, 'two concurrent approvals → one');
    const processing = await tx(live1.transactionId);
    assert.strictEqual(processing.status, TransactionStatus.PROCESSING);
    const net = Math.round((processing.amount - processing.fee) * 100) / 100;
    const done = { event: 'payout.session.completed', tokenPay: 'MF-TOKEN-1', Montant: net, numeroSend: '650000000' };
    const cancelled = { event: 'payout.session.cancelled', tokenPay: 'MF-TOKEN-1' };
    await Promise.all([...Array.from({ length: 5 }, () => paymentService.handleMoneyFusionPayoutWebhook(done))]);
    await paymentService.handleMoneyFusionPayoutWebhook(cancelled); // late, out of order
    await paymentService.handleMoneyFusionPayoutWebhook(done);
    const after3 = await userDoc(u1);
    assert.strictEqual((await tx(live1.transactionId)).status, TransactionStatus.COMPLETED, 'a late cancel does not undo a completion');
    assert.strictEqual(after3.balance, 10000 - processing.amount, 'debited exactly once');
    assert.strictEqual(after3.reservedBalance, 0, 'reservation converted');
    assert.strictEqual(await WalletMovementModel.countDocuments({ reference: `withdrawal:${live1.transactionId}` }), 1);
    ok('(3) OTP → approval (once) → MoneyFusion webhook ×5 + late cancel → one debit, reservation converted');

    // (4) MoneyFusion webhook without concordant amount/number → review, not completed
    const u4 = await member({ balance: 20000 });
    const r4 = await paymentService.initiateWithdrawal(u4, 3000, '127.0.0.1', 'check');
    const c4 = await TransactionModel.findOne({ transactionId: r4.transactionId }).select('+verificationCode').lean();
    await paymentService.verifyWithdrawal(r4.transactionId, c4.verificationCode);
    moneyFusionService.initiatePayout = async () => ({ success: true, tokenPay: 'MF-TOKEN-4', message: 'ok' });
    await paymentService.approveWithdrawal(r4.transactionId, String(new Types.ObjectId()));
    await paymentService.handleMoneyFusionPayoutWebhook({ event: 'payout.session.completed', tokenPay: 'MF-TOKEN-4' });
    await paymentService.handleMoneyFusionPayoutWebhook({ event: 'payout.session.completed', tokenPay: 'MF-TOKEN-4', Montant: 99999, numeroSend: '650000000' });
    assert.strictEqual((await tx(r4.transactionId)).status, TransactionStatus.PROCESSING);
    assert.strictEqual((await userDoc(u4)).balance, 20000);
    assert.ok(cases.some((c) => c.type === 'amount_mismatch' && c.subject.transactionId === r4.transactionId));
    ok('(4) MoneyFusion success without amount+number, or with a wrong amount → stays processing, case opened');

    // (5) approval re-checks the reservation
    const u5 = await member({ balance: 1000 });
    const legacy = await TransactionModel.create({
        transactionId: `legacy-${n++}`, userId: new Types.ObjectId(u5), type: TransactionType.WITHDRAWAL, amount: 5000, fee: 125,
        currency: Currency.XAF, status: TransactionStatus.PENDING_ADMIN_APPROVAL, description: 'legacy request',
        metadata: { accountInfo: { fullMomoNumber: '237650000001', momoOperator: 'MTN_MOMO_CMR', countryCode: 'CM' }, withdrawalType: 'mobile_money' },
    });
    const refused = await paymentService.approveWithdrawal(legacy.transactionId, String(new Types.ObjectId()));
    assert.strictEqual(refused.success, false);
    assert.strictEqual((await tx(legacy.transactionId)).status, TransactionStatus.PENDING_ADMIN_APPROVAL, 'left pending, never paid');
    await UserModel.updateOne({ _id: u5 }, { $set: { balance: 9000 } });
    moneyFusionService.initiatePayout = async () => ({ success: true, tokenPay: 'MF-TOKEN-5', message: 'ok' });
    assert.strictEqual((await paymentService.approveWithdrawal(legacy.transactionId, String(new Types.ObjectId()))).success, true);
    assert.strictEqual((await userDoc(u5)).reservedBalance, 5000, 'reserved at approval');
    ok('(5) approval of a pending_admin_approval re-checks the reservation (refused when the money is gone, reserved otherwise)');

    // (6) release on failure (FeexPay payout, status API says failed)
    const u6 = await member({ balance: 8000 });
    const fx = await TransactionModel.create({
        transactionId: `fx-${n++}`, userId: new Types.ObjectId(u6), type: TransactionType.WITHDRAWAL, amount: 4100, fee: 100,
        currency: Currency.XAF, status: TransactionStatus.PROCESSING, description: 'feexpay payout', externalTransactionId: 'FX-REF-6',
        serviceProvider: 'FeexPay', metadata: { selectedPayoutService: 'FeexPay', netAmountRequested: 4000, accountInfo: { countryCode: 'BJ' } },
    });
    const { reserveForWithdrawal } = require('../services/withdrawal-lifecycle');
    assert.ok(await reserveForWithdrawal(fx));
    assert.strictEqual((await userDoc(u6)).reservedBalance, 4100);

    // (7) FeexPay payout webhook: the status API says "pending" → nothing completes
    let feexAnswer: any = { transactionId: 'FX-REF-6', feexpayReference: 'FX-REF-6', status: 'pending', amount: 4000, recipient: 'x' };
    feexPayPayoutService.checkPayoutStatus = async () => feexAnswer;
    await paymentService.processFeexPayPayoutWebhook({ reference: 'FX-REF-6', status: 'SUCCESSFUL', amount: 4000, callback_info: { client_transaction_id: fx.transactionId } });
    assert.strictEqual((await tx(fx.transactionId)).status, TransactionStatus.PROCESSING);
    assert.strictEqual((await userDoc(u6)).balance, 8000);
    ok('(7) FeexPay payout webhook claiming success while the status API says "pending" → nothing completes');

    feexAnswer = { ...feexAnswer, status: 'failed' };
    await Promise.all([1, 2, 3].map(() => paymentService.processFeexPayPayoutWebhook({ reference: 'FX-REF-6', status: 'FAILED', callback_info: { client_transaction_id: fx.transactionId } })));
    assert.strictEqual((await tx(fx.transactionId)).status, TransactionStatus.FAILED);
    const u6d = await userDoc(u6);
    assert.strictEqual(u6d.reservedBalance, 0, 'reservation released');
    assert.strictEqual(u6d.balance, 8000, 'no refund, no debit');
    ok('(6) confirmed failure releases the reservation once; balance untouched');

    // (8) regularize: wrong state → 409 STATE_CHANGED; in flight → completes once
    const supportRoutes = require('../api/routes/support.routes').default;
    const payApp = express();
    payApp.use(express.json({ verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));
    payApp.use('/api/internal/support', supportRoutes);
    const { paymentController } = require('../api/controllers/payment.controller');
    payApp.post('/api/payments/webhooks/nowpayments/payout', paymentController.handleNowPaymentsPayoutWebhook);
    const paySrv = await listen(payApp);
    const call = (method: 'get' | 'post', path: string, data?: any, headers: Record<string, string> = {}) => axios({
        method, url: `http://127.0.0.1:${paySrv.port}${path}`, data, validateStatus: () => true,
        headers: { Authorization: `Bearer ${process.env.SERVICE_SECRET}`, 'x-service-name': 'support-service', 'x-request-id': 'req-check-0001', 'x-support-actor': 'agent1|finance_manager', ...headers },
    });
    const regBody = { action: 'complete', reason: 'Vérifié sur le tableau de bord', evidence: ['capture-123'], approvalId: 'appr-1' };
    const wrong = await call('post', `/api/internal/support/withdrawals/${live1.transactionId}/regularize`, regBody);
    assert.strictEqual(wrong.status, 409);
    assert.strictEqual(wrong.data.code, 'STATE_CHANGED');
    assert.strictEqual((await call('post', `/api/internal/support/withdrawals/${r4.transactionId}/regularize`, { ...regBody, approvalId: '' })).status, 400);
    assert.strictEqual((await call('post', `/api/internal/support/withdrawals/${r4.transactionId}/regularize`, regBody, { Authorization: 'Bearer nope' })).status, 401);
    const good = await Promise.all([1, 2].map(() => call('post', `/api/internal/support/withdrawals/${r4.transactionId}/regularize`, regBody)));
    assert.deepStrictEqual(good.map((g) => g.status).sort(), [200, 409]);
    const r4tx = await tx(r4.transactionId);
    assert.strictEqual(r4tx.status, TransactionStatus.COMPLETED);
    assert.strictEqual((await userDoc(u4)).balance, 20000 - r4tx.amount, 'regularization debits once');
    assert.strictEqual(r4tx.metadata.regularization.approvalId, 'appr-1');
    ok('(8) regularize: completed → 409 STATE_CHANGED; missing approval → 400; bad secret → 401; two calls → one completion');

    // (9) manual activation: provider must confirm, a reference serves once
    axiosRoutes.push({ match: /transactions\/public\/single\/status\/FX-PAY-OK/, reply: () => ({ data: { status: 'SUCCESSFUL', amount: 2150, currency: 'XOF' } }) });
    axiosRoutes.push({ match: /transactions\/public\/single\/status\/FX-PAY-PENDING/, reply: () => ({ data: { status: 'PENDING', amount: 2070 } }) });
    let callbacks = 0;
    paymentService.notifyOriginatingService = async () => { callbacks++; };
    const u9 = await member({ balance: 0 });
    await PaymentIntentModel.create({ userId: u9, paymentType: 'SUBSCRIPTION', amount: 2070, currency: 'XAF', gateway: 'feexpay', gatewayPaymentId: 'FX-PAY-USED', status: PaymentStatus.SUCCEEDED });
    const act = (ref: string) => call('post', '/api/internal/support/activation/manual', { userId: u9, gateway: 'feexpay', externalRef: ref, plan: 'CLASSIQUE', approvalId: 'appr-9' });
    const used = await act('FX-PAY-USED');
    assert.strictEqual(used.status, 409); assert.strictEqual(used.data.code, 'REF_ALREADY_USED');
    const pending = await act('FX-PAY-PENDING');
    assert.strictEqual(pending.status, 422); assert.strictEqual(pending.data.code, 'PROVIDER_NOT_CONFIRMED');
    const [a1, a2] = await Promise.all([act('FX-PAY-OK'), act('FX-PAY-OK')]);
    assert.deepStrictEqual([a1.status, a2.status].sort(), [201, 409]);
    const again = await act('FX-PAY-OK');
    assert.strictEqual(again.status, 409); assert.strictEqual(again.data.code, 'REF_ALREADY_USED');
    const created = await PaymentIntentModel.findOne({ gatewayPaymentId: 'FX-PAY-OK' }).lean();
    assert.strictEqual(created.metadata.callbackPath.endsWith('/subscriptions/webhooks/payment-confirmation'), true);
    assert.strictEqual(callbacks, 1, 'one activation callback');
    ok('(9) manual activation: reused ref → 409 REF_ALREADY_USED, unconfirmed → 422, a verified ref activates once');

    // (9b) amount, payer and every provider id
    axiosRoutes.push({ match: /single\/status\/FX-PAY-LOW/, reply: () => ({ data: { status: 'SUCCESSFUL', amount: 2000 } }) });
    axiosRoutes.push({ match: /single\/status\/FX-PAY-NOAMOUNT/, reply: () => ({ data: { status: 'SUCCESSFUL' } }) });
    axiosRoutes.push({ match: /single\/status\/FX-PAY-OTHER/, reply: () => ({ data: { status: 'SUCCESSFUL', amount: 5300, callback_info: { userId: String(new Types.ObjectId()) } } }) });
    const low = await act('FX-PAY-LOW');
    assert.strictEqual(low.status, 422); assert.strictEqual(low.data.code, 'AMOUNT_TOO_LOW');
    assert.strictEqual((await act('FX-PAY-NOAMOUNT')).data.code, 'AMOUNT_UNVERIFIED');
    assert.strictEqual((await act('FX-PAY-OTHER')).data.code, 'PAID_FOR_ANOTHER_ACCOUNT');
    assert.strictEqual((await act('FX-PAY-LOW')).data.code, 'AMOUNT_TOO_LOW', 'a refused reference is not burnt');
    const { cinetpayPayoutService } = require('../services/cinetpay-payout.service');
    cinetpayPayoutService.getAccessToken = async () => 'token';
    axiosRoutes.push({ match: /\/v1\/payment\/CP-TOKEN-1/, reply: () => ({ data: { code: 100, status: 'SUCCESS', data: { amount: 5300, currency: 'XAF', transaction_id: 'CP-TX-1', payment_token: 'CP-TOKEN-1' } } }) });
    const cp = (ref: string) => call('post', '/api/internal/support/activation/manual', { userId: u9, gateway: 'cinetpay', externalRef: ref, plan: 'CIBLE', approvalId: 'appr-9b', countryCode: 'CI' });
    assert.strictEqual((await cp('CP-TOKEN-1')).status, 201);
    const byTxId = await cp('CP-TX-1');
    assert.strictEqual(byTxId.status, 409, 'the same CinetPay payment by its transaction id is refused');
    assert.strictEqual(byTxId.data.code, 'REF_ALREADY_USED');
    ok('(9b) manual activation: amount below the pack price, unknown amount, paid for another account → 422; CinetPay token and transaction id both claimed');

    // (10) NOWPayments payout webhook: signature mandatory
    const npBody = { id: 'NP-1', status: 'finished', amount: '10' };
    const noSig = await call('post', '/api/payments/webhooks/nowpayments/payout', npBody);
    assert.strictEqual(noSig.status, 401);
    const badSig = await call('post', '/api/payments/webhooks/nowpayments/payout', npBody, { 'x-nowpayments-sig': 'ab'.repeat(64) });
    assert.strictEqual(badSig.status, 401);
    const sig = crypto.createHmac('sha512', process.env.NOWPAYMENTS_IPN_SECRET!).update(JSON.stringify({ amount: '10', id: 'NP-1', status: 'finished' })).digest('hex');
    const goodSig = await call('post', '/api/payments/webhooks/nowpayments/payout', npBody, { 'x-nowpayments-sig': sig });
    assert.notStrictEqual(goodSig.status, 401, 'a valid signature passes the gate');
    ok('(10) NOWPayments webhook without / with a wrong signature → 401; a valid HMAC passes');

    // (11) finance board: business status and age buckets
    await TransactionModel.create({
        transactionId: `old-${n++}`, userId: new Types.ObjectId(u6), type: TransactionType.WITHDRAWAL, amount: 3000, fee: 75,
        currency: Currency.XAF, status: TransactionStatus.PROCESSING, description: 'stuck', externalTransactionId: 'X',
        metadata: { selectedPayoutService: 'MoneyFusion', accountInfo: { countryCode: 'CM' } },
        createdAt: new Date(Date.now() - 80 * 3600 * 1000), approvedAt: new Date(Date.now() - 79 * 3600 * 1000),
    });
    const summary = await call('get', '/api/internal/support/finance/summary?from=2020-01-01');
    assert.strictEqual(summary.status, 200);
    assert.ok(summary.data.data.byBusinessStatus.SUCCEEDED.count >= 2);
    assert.ok(summary.data.data.byBusinessStatus.UNKNOWN.count >= 1);
    assert.ok(summary.data.data.openByAge['>72h'].count >= 1);
    const list = await call('get', '/api/internal/support/finance/withdrawals?status=UNKNOWN&ageBucket=%3E72h&gateway=moneyfusion');
    assert.strictEqual(list.data.data.total, 1);
    const mine = await call('get', `/api/internal/support/members/${u1}/withdrawals`);
    assert.ok(mine.data.data.some((w: any) => w.businessStatus === 'SUCCEEDED'));
    const look = await call('get', `/api/internal/support/payins/lookup?ref=FX-PAY-OK&userId=${new Types.ObjectId()}`);
    assert.strictEqual(look.status, 404, 'lookup hides an intent of another member');
    ok('(11) finance summary / list / member withdrawals with business statuses and age buckets; lookup scoped to the member');

    // (12) daily reconciliation: unknown status case, success without debit settled, never a release on a timeout
    const u12 = await member({ balance: 6000 });
    const nodebit = await TransactionModel.create({
        transactionId: `nodebit-${n++}`, userId: new Types.ObjectId(u12), type: TransactionType.WITHDRAWAL, amount: 2050, fee: 50,
        currency: Currency.XAF, status: TransactionStatus.COMPLETED, description: 'completed, debit lost',
        metadata: { reservation: { amount: 2050, currency: 'XAF', state: 'held' }, balanceUpdateFailed: true },
    });
    const report = await runFinanceReconciliation(new Date());
    assert.ok(report.unknownStatus >= 1);
    assert.strictEqual((await userDoc(u12)).balance, 6000 - 2050, 'success without debit is settled once');
    await runFinanceReconciliation(new Date());
    assert.strictEqual((await userDoc(u12)).balance, 6000 - 2050, 'and only once');
    assert.ok(cases.some((c) => c.type === 'unknown_status'));
    assert.ok(cases.some((c) => c.type === 'debit_missing' && c.subject.transactionId === nodebit.transactionId));
    const stuck = await tx(legacy.transactionId);
    assert.notStrictEqual(stuck.status, TransactionStatus.FAILED, 'nothing failed on a timeout');
    ok('(12) daily reconciliation: unknown_status + debit_missing cases, missing debit settled once, no timeout release');

    // (13) indexes build on data that already holds duplicate references
    await PaymentIntentModel.collection.insertMany([
        { sessionId: 'old-a', userId: 'u', gateway: 'cinetpay', gatewayPaymentId: 'DUP', status: 'SUCCEEDED', createdAt: new Date('2025-09-01') },
        { sessionId: 'old-b', userId: 'u', gateway: 'cinetpay', gatewayPaymentId: 'DUP', status: 'SUCCEEDED', createdAt: new Date('2025-09-02') },
    ]);
    await PaymentIntentModel.collection.dropIndex('uniq_gateway_ref_since_20261118');
    await PaymentIntentModel.syncIndexes();
    const { REF_UNIQUE_SINCE } = require('../database/models/PaymentIntent');
    const afterCutoff = new Date(Math.max(Date.now(), REF_UNIQUE_SINCE.getTime() + 1000));
    await PaymentIntentModel.collection.insertOne({ sessionId: 'new-a', userId: 'u', gateway: 'cinetpay', gatewayPaymentId: 'NEW-REF', status: 'SUCCEEDED', createdAt: afterCutoff });
    await assert.rejects(PaymentIntentModel.collection.insertOne({ sessionId: 'new-b', userId: 'u', gateway: 'cinetpay', gatewayPaymentId: 'NEW-REF', status: 'SUCCEEDED', createdAt: afterCutoff }), /E11000/);
    ok('(13) partial unique {gateway, gatewayPaymentId} builds over old duplicates and refuses new ones');

    // (14) payin recheck: provider confirms → the real handler completes the intent once
    axiosRoutes.push({ match: /transactions\/public\/single\/status\/FX-PAY-RECHECK/, reply: () => ({ data: { status: 'SUCCESSFUL', amount: 2070 } }) });
    const u14 = await member({});
    const pi14 = await PaymentIntentModel.create({ userId: u14, paymentType: 'SUBSCRIPTION', amount: 2070, currency: 'XAF', gateway: 'feexpay', gatewayPaymentId: 'FX-PAY-RECHECK', status: PaymentStatus.PENDING_PROVIDER });
    const before14 = callbacks;
    const rechecks = await Promise.all([1, 2, 3].map(() => call('post', `/api/internal/support/payins/${pi14.sessionId}/recheck`)));
    assert.ok(rechecks.every((r) => r.status === 200 && r.data.data.result === 'confirmed' && r.data.data.requestId === 'req-check-0001'));
    assert.strictEqual((await PaymentIntentModel.findById(pi14._id).lean()).status, PaymentStatus.SUCCEEDED);
    assert.strictEqual(callbacks - before14, 1, 'completion ran once for three concurrent rechecks');
    const recheckDone = await call('post', `/api/internal/support/payins/${pi14.sessionId}/recheck`);
    assert.strictEqual(recheckDone.data.data.applied, false);
    assert.strictEqual(callbacks - before14, 1, 'a succeeded intent is never replayed');
    ok('(14) payin recheck: 3 concurrent rechecks → one completion; a succeeded intent is not replayed');

    // (15) MoneyFusion payin webhook: MF's status endpoint decides, amount must match
    const u15 = await member({});
    const pi15 = await PaymentIntentModel.create({ userId: u15, paymentType: 'SUBSCRIPTION', amount: 2070, currency: 'XAF', gateway: 'moneyfusion', gatewayPaymentId: 'MF-IN-1', status: PaymentStatus.PENDING_PROVIDER, metadata: { mfPayinAmount: 2070 } });
    let mfStatus: any = { statut: 'paid', Montant: 1000, personal_Info: [{ sessionId: pi15.sessionId, userId: u15 }] };
    moneyFusionService.checkPaymentStatus = async () => mfStatus;
    const before15 = callbacks;
    await paymentService.handleMoneyFusionPayinWebhook({ event: 'payin.session.completed', tokenPay: 'MF-IN-1', Montant: 2070 });
    assert.strictEqual((await PaymentIntentModel.findById(pi15._id).lean()).status, PaymentStatus.PENDING_PROVIDER, 'a paid amount below the price is not applied');
    assert.ok(cases.some((c) => c.type === 'amount_mismatch' && c.subject.sessionId === pi15.sessionId));
    mfStatus = { statut: 'pending', Montant: 2070 };
    await paymentService.handleMoneyFusionPayinWebhook({ event: 'payin.session.completed', tokenPay: 'MF-IN-1', Montant: 2070 });
    assert.strictEqual((await PaymentIntentModel.findById(pi15._id).lean()).status, PaymentStatus.PENDING_PROVIDER, 'a forged "completed" is not applied while MF says pending');
    mfStatus = { statut: 'paid', Montant: 2070, personal_Info: [{ sessionId: pi15.sessionId, userId: u15 }] };
    await Promise.all([1, 2, 3].map(() => paymentService.handleMoneyFusionPayinWebhook({ event: 'payin.session.completed', tokenPay: 'MF-IN-1' })));
    assert.strictEqual((await PaymentIntentModel.findById(pi15._id).lean()).status, PaymentStatus.SUCCEEDED);
    assert.strictEqual(callbacks - before15, 1);
    ok('(15) MoneyFusion payin: webhook is a hint; MF status + amount decide; 3 concurrent deliveries → one completion');

    // (16) admin create-manual-intent / recover-payment-intent: verified, single-use reference, callback fixed
    payApp.post('/admin/create-manual-intent', paymentController.createManualPaymentIntent);
    payApp.post('/admin/recover-payment-intent', paymentController.recoverExistingPaymentIntent);
    payApp.use((err: any, _req: any, res: any, _next: any) => res.status(err.statusCode || 500).json({ success: false, message: err.message }));
    axiosRoutes.push({ match: /transactions\/public\/single\/status\/FX-ADMIN-OK/, reply: () => ({ data: { status: 'SUCCESSFUL', amount: 5300 } }) });
    const u16 = await member({});
    const admin = (body: any) => call('post', '/admin/create-manual-intent', { userId: u16, amount: 5300, provider: 'feexpay', force: true, ...body });
    assert.strictEqual((await admin({})).status, 400, 'reference required');
    assert.strictEqual((await admin({ externalReference: 'FX-PAY-USED' })).status, 409, 'reused reference refused');
    assert.strictEqual((await admin({ externalReference: 'FX-PAY-PENDING' })).status, 422, 'unconfirmed reference refused');
    const ok16 = await admin({ externalReference: 'FX-ADMIN-OK', metadata: { subscriptionType: 'CIBLE', callbackPath: 'https://evil.example/steal', originatingService: 'evil' } });
    assert.strictEqual(ok16.status, 201);
    const pi16 = await PaymentIntentModel.findOne({ gatewayPaymentId: 'FX-ADMIN-OK' }).lean();
    assert.ok(pi16.metadata.callbackPath.endsWith('/subscriptions/webhooks/payment-confirmation'), 'metadata cannot redirect the callback');
    assert.strictEqual(pi16.metadata.originatingService, 'user-service');
    assert.strictEqual((await admin({ externalReference: 'FX-ADMIN-OK' })).status, 409, 'second use refused');
    const pi16b = await PaymentIntentModel.create({ userId: u16, paymentType: 'SUBSCRIPTION', amount: 2070, currency: 'XAF', gateway: 'feexpay', gatewayPaymentId: 'FX-PAY-PENDING', status: PaymentStatus.PENDING_PROVIDER });
    assert.strictEqual((await call('post', '/admin/recover-payment-intent', { sessionId: pi16b.sessionId })).status, 422, 'recovery needs the provider to confirm');
    ok('(16) admin create-manual-intent / recover: reference required, verified, single use; metadata cannot override callbackPath');

    // ─── review fixes ───
    const config2 = require('../config').default;
    const lifecycle = require('../services/withdrawal-lifecycle');
    const { runFinanceReconciliation: reconcile } = require('../jobs/finance-reconciliation.job');
    const approvedMf = async (uid: string, net: number, token: string, onInitiate?: (txId: string) => Promise<void>) => {
        const r = await paymentService.initiateWithdrawal(uid, net, '127.0.0.1', 'check');
        const c = await TransactionModel.findOne({ transactionId: r.transactionId }).select('+verificationCode').lean();
        await paymentService.verifyWithdrawal(r.transactionId, c.verificationCode);
        moneyFusionService.initiatePayout = async () => { if (onInitiate) await onInitiate(r.transactionId); return { success: true, tokenPay: token, message: 'ok' }; };
        const a = await paymentService.approveWithdrawal(r.transactionId, String(new Types.ObjectId()));
        assert.strictEqual(a.success, true, a.error);
        return tx(r.transactionId);
    };
    const mfDone = (t: any) => ({ event: 'payout.session.completed', tokenPay: t.externalTransactionId, Montant: Math.round((t.amount - t.fee) * 100) / 100, numeroSend: '650000000' });

    // (17) forged MoneyFusion "cancelled": no failure, no release, case; the real success still completes
    const u17 = await member({ balance: 30000 });
    const t17 = await approvedMf(u17, 5000, 'MF-TOKEN-17');
    await paymentService.handleMoneyFusionPayoutWebhook({ event: 'payout.session.cancelled', tokenPay: 'MF-TOKEN-17' });
    assert.strictEqual((await tx(t17.transactionId)).status, TransactionStatus.PROCESSING);
    assert.strictEqual((await userDoc(u17)).reservedBalance, t17.amount, 'still reserved');
    assert.ok(cases.some((c) => c.dedupKey === `withdrawal:${t17.transactionId}:mf-cancelled`));
    await paymentService.handleMoneyFusionPayoutWebhook(mfDone(t17));
    assert.strictEqual((await tx(t17.transactionId)).status, TransactionStatus.COMPLETED);
    assert.strictEqual((await userDoc(u17)).balance, 30000 - t17.amount);
    ok('(17) MoneyFusion "cancelled" is a hint: stays processing and reserved, review case; the real success then completes');

    // (18) a success after an admin "mark failed" still completes and debits once
    const u18 = await member({ balance: 30000 });
    const t18 = await approvedMf(u18, 5000, 'MF-TOKEN-18');
    assert.strictEqual((await paymentService.manualFailMoneyFusionWithdrawal(t18.transactionId, 'admin1', 'absent du tableau de bord')).success, true);
    assert.strictEqual((await userDoc(u18)).reservedBalance, 0, 'released on the manual failure');
    await Promise.all([1, 2, 3].map(() => paymentService.handleMoneyFusionPayoutWebhook(mfDone(t18))));
    assert.strictEqual((await tx(t18.transactionId)).status, TransactionStatus.COMPLETED);
    assert.strictEqual((await userDoc(u18)).balance, 30000 - t18.amount, 'debited once after the release');
    assert.strictEqual(await WalletMovementModel.countDocuments({ reference: `withdrawal:${t18.transactionId}` }), 1);
    assert.ok(cases.some((c) => c.type === 'withdrawal_divergence' && c.subject.transactionId === t18.transactionId && c.severity === 'critical'));
    ok('(18) admin "mark failed" then the real MoneyFusion success ×3 → completed, debited once, critical divergence case');

    // (19) support regularize "complete" on a failed withdrawal (after a regularize "fail")
    const u19 = await member({ balance: 30000 });
    const t19 = await approvedMf(u19, 5000, 'MF-TOKEN-19');
    const fail19 = await call('post', `/api/internal/support/withdrawals/${t19.transactionId}/regularize`, { ...regBody, action: 'fail', approvalId: 'appr-19a' });
    assert.strictEqual(fail19.status, 200);
    const comp19 = await call('post', `/api/internal/support/withdrawals/${t19.transactionId}/regularize`, { ...regBody, approvalId: 'appr-19b' });
    assert.strictEqual(comp19.status, 200);
    assert.strictEqual((await tx(t19.transactionId)).status, TransactionStatus.COMPLETED);
    assert.strictEqual((await userDoc(u19)).balance, 30000 - t19.amount);
    ok('(19) regularize fail then regularize complete (approved) → FAILED → COMPLETED, debited once');

    // (20) error after the provider accepted: stays processing; a webhook's metadata written meanwhile survives
    const u20 = await member({ balance: 30000 });
    const realReplay = paymentService.replayBufferedPayoutWebhook;
    paymentService.replayBufferedPayoutWebhook = async () => { throw new Error('mongo hiccup after MF accepted'); };
    const t20 = await approvedMf(u20, 5000, 'MF-TOKEN-20', async (txId) => {
        await TransactionModel.updateOne({ transactionId: txId }, { $set: { 'metadata.earlyWebhook': 'kept' } });
    });
    paymentService.replayBufferedPayoutWebhook = realReplay;
    const after20 = await tx(t20.transactionId);
    assert.strictEqual(after20.status, TransactionStatus.PROCESSING);
    assert.strictEqual(after20.metadata.earlyWebhook, 'kept', 'named-key writes do not wipe metadata');
    assert.strictEqual(after20.metadata.moneyFusionTokenPay, 'MF-TOKEN-20');
    assert.strictEqual((await userDoc(u20)).reservedBalance, after20.amount);
    ok('(20) an error after MoneyFusion accepted keeps the withdrawal processing and reserved; metadata written meanwhile kept');

    // (21) MONEYFUSION_PAYOUT_STRICT_MATCH=false: tokenPay alone completes (as before)
    process.env.MONEYFUSION_PAYOUT_STRICT_MATCH = 'false';
    await paymentService.handleMoneyFusionPayoutWebhook({ event: 'payout.session.completed', tokenPay: 'MF-TOKEN-20' });
    delete process.env.MONEYFUSION_PAYOUT_STRICT_MATCH;
    assert.strictEqual((await tx(t20.transactionId)).status, TransactionStatus.COMPLETED);
    ok('(21) MONEYFUSION_PAYOUT_STRICT_MATCH=false accepts a tokenPay-only success');

    // (22) member views never carry provider references
    const { transactionController } = require('../api/controllers/transaction.controller');
    let body22: any;
    const fakeRes: any = { status() { return this; }, json(b: any) { body22 = b; return this; } };
    await transactionController.getTransaction({ params: { transactionId: t17.transactionId }, user: { userId: u17 } } as any, fakeRes);
    const dumped = JSON.stringify(body22);
    assert.ok(body22.success && !dumped.includes('MF-TOKEN-17'), 'no tokenPay in the member view');
    assert.ok(!dumped.includes('externalTransactionId') && !dumped.includes('reservation'));
    ok('(22) GET /transactions/:id hides provider references (tokenPay, external ids) and internal notes');

    // (23) approval refused when the balance no longer covers what is reserved
    const u23 = await member({ balance: 30000 });
    const r23 = await paymentService.initiateWithdrawal(u23, 5000, '127.0.0.1', 'check');
    const c23 = await TransactionModel.findOne({ transactionId: r23.transactionId }).select('+verificationCode').lean();
    await paymentService.verifyWithdrawal(r23.transactionId, c23.verificationCode);
    await UserModel.collection.updateOne({ _id: new Types.ObjectId(u23) }, { $set: { balance: 100 } }); // drained outside the ledger
    const a23 = await paymentService.approveWithdrawal(r23.transactionId, String(new Types.ObjectId()));
    assert.strictEqual(a23.success, false);
    assert.strictEqual((await tx(r23.transactionId)).status, TransactionStatus.PENDING_ADMIN_APPROVAL);
    assert.ok(cases.some((c) => c.subject.transactionId === r23.transactionId && c.type === 'withdrawal_divergence'));
    assert.strictEqual(await paymentService.checkUserHasPendingTransactions(u23), true, 'pending_admin_approval counts as pending');
    ok('(23) approval refused (kept, case) when balance < reserved; pending_admin_approval blocks conversions');

    // (24) reserve outcome unknown → released; release failing → "unknown", retried by the daily reconciliation
    const u24 = await member({ balance: 30000 });
    const realReserve = userServiceClient.reserveWithdrawalFunds;
    const realRelease = userServiceClient.releaseWithdrawalFunds;
    userServiceClient.reserveWithdrawalFunds = async (i: any) => { await realReserve.call(userServiceClient, i); throw Object.assign(new Error('socket hang up'), {}); };
    await assert.rejects(paymentService.initiateWithdrawal(u24, 5000, '127.0.0.1', 'check'), (e: any) => e.statusCode === 503);
    assert.strictEqual((await userDoc(u24)).reservedBalance, 0, 'the reserve that landed was released');
    userServiceClient.releaseWithdrawalFunds = async () => { throw new Error('down'); };
    await assert.rejects(paymentService.initiateWithdrawal(u24, 5000, '127.0.0.1', 'check'));
    userServiceClient.reserveWithdrawalFunds = realReserve;
    userServiceClient.releaseWithdrawalFunds = realRelease;
    const unknown24 = await TransactionModel.findOne({ userId: new Types.ObjectId(u24), 'metadata.reservation.state': 'unknown' }).lean();
    assert.ok(unknown24, 'marked unknown when the release could not be confirmed');
    assert.ok((await userDoc(u24)).reservedBalance > 0);
    await reconcile(new Date());
    assert.strictEqual((await userDoc(u24)).reservedBalance, 0, 'daily reconciliation released it');
    ok('(24) ambiguous reserve error → release; release failing → state unknown → released by the daily reconciliation');

    // (25) a reservation still held for a withdrawal that is final is found from user-service
    const u25 = await member({ balance: 30000 });
    const t25 = await TransactionModel.create({
        transactionId: `final-${n++}`, userId: new Types.ObjectId(u25), type: TransactionType.WITHDRAWAL, amount: 3000, fee: 75,
        currency: Currency.XAF, status: TransactionStatus.CANCELLED, description: 'cancelled, reservation left behind',
    });
    await realReserve.call(userServiceClient, { transactionId: t25.transactionId, userId: u25, amount: 3000, currency: 'XAF' });
    await BalanceReservationModel.collection.updateOne({ transactionId: t25.transactionId }, { $set: { updatedAt: new Date(Date.now() - 2 * 3600 * 1000) } });
    const rep25 = await reconcile(new Date());
    assert.ok(rep25.heldOnFinal >= 1);
    assert.strictEqual((await userDoc(u25)).reservedBalance, 0);
    assert.ok(cases.some((c) => c.dedupKey === `withdrawal:${t25.transactionId}:held-on-final`));
    ok('(25) held reservation of a final (cancelled) withdrawal → released by the daily reconciliation, case opened');

    // (26) member transfer: unclear credit → never refunded; definite refusal → refunded
    const s26 = await member({ balance: 10000 });
    const r26 = await member({ balance: 0 });
    const realCredit = userServiceClient.updateUserBalance;
    userServiceClient.updateUserBalance = async (id: string, amt: number, mv: any) => {
        if (id === r26) throw new AppErrorCls('upstream timeout', 503);
        return realCredit.call(userServiceClient, id, amt, mv);
    };
    await assert.rejects(paymentService.processPayment(s26, r26, 1000, Currency.XAF, 'test'), (e: any) => e.statusCode === 502);
    assert.strictEqual((await userDoc(s26)).balance, 9000, 'sender not refunded on doubt');
    assert.ok(cases.some((c) => c.type === 'ledger_mismatch' && c.subject.userId === s26));
    userServiceClient.updateUserBalance = realCredit;
    const ghost = String(new Types.ObjectId());
    await assert.rejects(paymentService.processPayment(s26, ghost, 1000, Currency.XAF, 'test'), (e: any) => e.statusCode === 400);
    assert.strictEqual((await userDoc(s26)).balance, 9000, 'definite refusal (unknown recipient) → sender refunded');
    ok('(26) member transfer: unclear credit → no refund + case; unknown recipient → sender refunded');

    // (27) balance spend undone after a recording failure cannot be replayed as paid
    const u27 = await member({ balance: 5000 });
    const realCreate = transactionRepository.create;
    transactionRepository.create = async () => { throw new Error('insert failed'); };
    await assert.rejects(paymentService.spendFromBalance({ userId: u27, amount: 1000, description: 'Campagne', reference: 'ads-R27' }));
    transactionRepository.create = realCreate;
    assert.strictEqual((await userDoc(u27)).balance, 5000, 'undone');
    await assert.rejects(paymentService.spendFromBalance({ userId: u27, amount: 1000, description: 'Campagne', reference: 'ads-R27' }), (e: any) => e.statusCode === 409);
    assert.strictEqual(await TransactionModel.countDocuments({ 'metadata.balanceSpendRef': 'ads-R27' }), 0, 'no free purchase recorded');
    ok('(27) balance spend undone after a failure: retry with the same reference refused (409), never a free purchase');

    // (28) user-service without the wallet routes (rolling deploy) → clear 503
    const bare = await listen(express());
    const savedBase = (userServiceClient as any).baseUrl;
    (userServiceClient as any).baseUrl = `http://127.0.0.1:${bare.port}/api`;
    const u28 = await member({ balance: 30000 });
    await assert.rejects(paymentService.initiateWithdrawal(u28, 5000, '127.0.0.1', 'check'), (e: any) => e.statusCode === 503 && /mise à jour/.test(e.message));
    (userServiceClient as any).baseUrl = savedBase;
    bare.server.close();
    ok('(28) an older user-service without the reservation route → withdrawal refused with 503');
    void config2; void lifecycle;

    // (29) admin manual intent: the exact plan granted is the one priced; amount must be a number
    axiosRoutes.push({ match: /single\/status\/FX-ADMIN-2150/, reply: () => ({ data: { status: 'SUCCESSFUL', amount: 2150 } }) });
    const u29 = await member({});
    const admin29 = (body: any) => call('post', '/admin/create-manual-intent', { userId: u29, provider: 'feexpay', force: true, externalReference: 'FX-ADMIN-2150', ...body });
    const winner = await admin29({ amount: 2150, metadata: { subscriptionType: 'WINNER' } });
    assert.strictEqual(winner.status, 400); assert.strictEqual(winner.data.code, 'UNKNOWN_PLAN');
    assert.strictEqual((await admin29({ amount: 2150, metadata: { subscriptionType: 'VISIBILITE_MAX' } })).status, 400);
    assert.strictEqual((await admin29({ amount: 'abc' })).status, 400, 'non-numeric amount refused');
    assert.strictEqual((await admin29({ amount: -5 })).status, 400);
    const cible = await admin29({ amount: 2150, metadata: { subscriptionType: 'CIBLE' } });
    assert.strictEqual(cible.status, 422); assert.strictEqual(cible.data.code, 'AMOUNT_TOO_LOW', 'a CLASSIQUE-priced payment cannot buy CIBLE');
    const classic = await admin29({ amount: '2150', metadata: { subscriptionType: 'classique', product: 'WINNER', planId: 'WINNER', isUpgrade: true } });
    assert.strictEqual(classic.status, 201);
    const pi29 = await PaymentIntentModel.findOne({ gatewayPaymentId: 'FX-ADMIN-2150' }).lean();
    assert.strictEqual(pi29.metadata.planId, 'CLASSIQUE', 'granted plan = priced plan');
    assert.strictEqual(pi29.metadata.isUpgrade, false);
    assert.strictEqual(pi29.metadata.product, undefined, 'product key stripped');
    assert.strictEqual(pi29.amount, 2150);
    ok('(29) admin manual intent: WINNER/VISIBILITE_MAX refused, NaN/negative amount refused, CIBLE needs the CIBLE price, plan fields come from the priced plan');

    // (30) transaction-recovery script settles through withdrawal:<txId>, once
    const { settleRecoveredWithdrawal } = require('./transaction-recovery.script');
    const u30 = await member({ balance: 10000 });
    const t30 = await TransactionModel.create({
        transactionId: `recovered-${n++}`, userId: new Types.ObjectId(u30), type: TransactionType.WITHDRAWAL, amount: 3075, fee: 75,
        currency: Currency.XAF, status: TransactionStatus.COMPLETED, description: 'restored by the recovery script',
    });
    await settleRecoveredWithdrawal(t30);
    await settleRecoveredWithdrawal(t30);
    await lifecycle.settleCompletedWithdrawal(t30.toObject(), 'later-reconciliation');
    assert.strictEqual((await userDoc(u30)).balance, 10000 - 3075, 'debited once');
    assert.strictEqual(await WalletMovementModel.countDocuments({ reference: `withdrawal:${t30.transactionId}` }), 1);
    ok('(30) recovery-script debits go through settlement (withdrawal:<txId>): a later settlement does not debit again');

    console.log(`\nALL PASSED (${passed})`);
    for (const s of [userSrv.server, supportSrv.server, paySrv.server]) s.close();
};

main().then(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    const um = require('../../../user-service/node_modules/mongoose');
    await um.connection.dropDatabase();
    await um.disconnect();
    process.exit(0);
}).catch(async (err) => {
    console.error('FAILED:', err);
    await mongoose.connection.dropDatabase().catch(() => undefined);
    process.exit(1);
});
