/**
 * Asserts the payment sandbox.
 *
 * The sandbox fakes provider responses on the paths that move real money, so
 * two things must never be in doubt: it cannot run in production, and the
 * bookkeeping it drives is the genuine debit-on-success — wallet debited
 * exactly once on a completed payout, never touched on a failed one.
 *
 * Needs a Mongo instance. Uses its own database and drops it afterwards.
 *
 *   npx ts-node src/scripts/check-sandbox.ts
 */

// Config validation demands these before anything imports it.
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
process.env.USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost/unused';
process.env.ADVERTISING_SERVICE_URL = process.env.ADVERTISING_SERVICE_URL || 'http://localhost/unused';
process.env.TOMBOLA_SERVICE_URL = process.env.TOMBOLA_SERVICE_URL || 'http://localhost/unused';
process.env.PAYMENT_SANDBOX_ENABLED = 'true';
process.env.SANDBOX_COMPLETE_DELAY_MS = '0'; // sandbox refs are due immediately

import mongoose, { Types } from 'mongoose';

const DB = process.env.SANDBOX_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_payment_sandbox_check';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

const main = async () => {
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();

    /* eslint-disable @typescript-eslint/no-var-requires */
    const config = require('../config').default;
    const sandbox = require('../services/sandbox.service');

    // --- The guard is the whole safety story ---
    check('active in development when explicitly enabled', sandbox.isSandboxActive());

    config.sandboxEnabled = false;
    check('inactive when the flag is off', !sandbox.isSandboxActive());
    config.sandboxEnabled = true;

    const previousEnv = config.nodeEnv;
    config.nodeEnv = 'production';
    check('refused in production even when enabled', !sandbox.isSandboxActive(),
        'the flag alone must not be enough');
    config.nodeEnv = previousEnv;

    // --- Magic values ---
    check('phone ..00 → reject', sandbox.payinOutcomeForPhone('237650384100') === 'reject');
    check('phone ..11 → fail', sandbox.payinOutcomeForPhone('237650384111') === 'fail');
    check('phone ..22 → hang', sandbox.payinOutcomeForPhone('237650384122') === 'hang');
    check('any other phone → success', sandbox.payinOutcomeForPhone('237650384125') === 'success');
    check('amount ..01 → fail', sandbox.payoutOutcomeForAmount(2001) === 'fail');
    check('amount ..02 → hang', sandbox.payoutOutcomeForAmount(2002) === 'hang');
    check('amount ..03 → reject', sandbox.payoutOutcomeForAmount(2003) === 'reject');
    check('any other amount → success', sandbox.payoutOutcomeForAmount(2000) === 'success');

    // --- Self-describing references ---
    const ref = sandbox.makeSandboxRef('success');
    const parsed = sandbox.parseSandboxRef(ref);
    check('a reference round-trips its outcome', parsed?.outcome === 'success', ref);
    check('a due success reference reads completed', sandbox.refStatusNow(ref) === 'completed');
    const hangRef = sandbox.makeSandboxRef('hang');
    check('a hang reference reads pending forever', sandbox.refStatusNow(hangRef) === 'pending');
    check('a foreign reference is not a sandbox ref', !sandbox.isSandboxRef('MF-abc123'));

    // --- Wire up the service with recording stubs ---
    const { userServiceClient } = require('../services/clients/user.service.client');
    const notificationService = require('../services/clients/notification.service.client').default;

    const balanceCalls: Array<{ userId: string; amount: number }> = [];
    userServiceClient.updateUserBalance = async (userId: string, amount: number) => {
        balanceCalls.push({ userId, amount });
        return true;
    };
    userServiceClient.getUserDetails = async () => ({ email: null, name: 'Check' });
    notificationService.sendTransactionSuccessEmail = async () => true;
    notificationService.sendTransactionFailureEmail = async () => true;

    const paymentService = require('../services/payment.service').default;
    const { sandboxSweeper } = require('../jobs/sandbox-sweeper.job');
    const PaymentIntentModel = require('../database/models/PaymentIntent').default;
    const { PaymentStatus, PaymentGateway } = require('../database/interfaces/IPaymentIntent');
    const TransactionModel = require('../database/models/transaction.model').default;
    const { TransactionStatus, TransactionType, Currency } = require('../database/models/transaction.model');

    let n = 0;
    const seedIntent = (outcome: 'success' | 'fail' | 'hang') => PaymentIntentModel.create({
        sessionId: `sbx_check_${n++}`,
        userId: String(new Types.ObjectId()),
        paymentType: 'SUBSCRIPTION',
        amount: 2070,
        currency: 'XAF',
        gateway: PaymentGateway.MONEYFUSION,
        gatewayPaymentId: sandbox.makeSandboxRef(outcome),
        status: PaymentStatus.PENDING_PROVIDER,
    });

    // --- Payins resolve through the real completion path ---
    const okIntent = await seedIntent('success');
    const failIntent = await seedIntent('fail');
    const hangIntent = await seedIntent('hang');
    await sandboxSweeper.sweep();

    const okAfter = await PaymentIntentModel.findById(okIntent._id);
    const failAfter = await PaymentIntentModel.findById(failIntent._id);
    const hangAfter = await PaymentIntentModel.findById(hangIntent._id);
    check('a due success payin becomes SUCCEEDED', okAfter?.status === PaymentStatus.SUCCEEDED, okAfter?.status);
    check('its webhook history records the sandbox event',
        okAfter?.webhookHistory?.some((e: any) => e.providerData?.sandbox === true) === true);
    check('a due fail payin becomes FAILED', failAfter?.status === PaymentStatus.FAILED, failAfter?.status);
    check('a hang payin is never touched', hangAfter?.status === PaymentStatus.PENDING_PROVIDER, hangAfter?.status);

    // --- Payouts: debit-on-success is the genuine article ---
    const seedWithdrawal = (provider: string, outcome: 'success' | 'fail' | 'hang', gross: number) =>
        TransactionModel.create({
            transactionId: `sbx_wd_${n++}`,
            userId: new Types.ObjectId(),
            type: TransactionType.WITHDRAWAL,
            amount: gross,
            currency: Currency.XAF,
            fee: 55,
            status: TransactionStatus.PROCESSING,
            description: 'sandbox check withdrawal',
            externalTransactionId: sandbox.makeSandboxRef(outcome),
            serviceProvider: provider === 'CinetPay' ? undefined : provider, // CinetPay leaves it null in prod too
            metadata: {
                selectedPayoutService: provider,
                netAmountRequested: gross - 55,
                payoutCurrency: 'XAF',
            },
        });

    const mfOk = await seedWithdrawal('MoneyFusion', 'success', 2055);
    const mfFail = await seedWithdrawal('MoneyFusion', 'fail', 2056);
    const mfHang = await seedWithdrawal('MoneyFusion', 'hang', 2057);
    const feexOk = await seedWithdrawal('FeexPay', 'success', 3055);
    const cpOk = await seedWithdrawal('CinetPay', 'success', 4055);

    balanceCalls.length = 0;
    await sandboxSweeper.sweep();

    const mfOkAfter = await TransactionModel.findById(mfOk._id);
    const mfFailAfter = await TransactionModel.findById(mfFail._id);
    const mfHangAfter = await TransactionModel.findById(mfHang._id);
    const feexOkAfter = await TransactionModel.findById(feexOk._id);
    const cpOkAfter = await TransactionModel.findById(cpOk._id);

    check('MoneyFusion success → COMPLETED', mfOkAfter?.status === TransactionStatus.COMPLETED, mfOkAfter?.status);
    check('MoneyFusion failure → FAILED', mfFailAfter?.status === TransactionStatus.FAILED, mfFailAfter?.status);
    check('MoneyFusion hang stays PROCESSING', mfHangAfter?.status === TransactionStatus.PROCESSING, mfHangAfter?.status);
    check('FeexPay success → COMPLETED', feexOkAfter?.status === TransactionStatus.COMPLETED, feexOkAfter?.status);
    check('CinetPay success → COMPLETED via its own status-verify path',
        cpOkAfter?.status === TransactionStatus.COMPLETED, cpOkAfter?.status);

    const debits = balanceCalls.filter(c => c.amount < 0);
    check('exactly the three completed payouts debited a wallet', debits.length === 3,
        `${debits.length} debits: ${debits.map(d => d.amount).join(', ')}`);
    check('each debit is the gross amount', debits.every(d => [-2055, -3055, -4055].includes(d.amount)),
        debits.map(d => d.amount).join(', '));
    check('the failed payout never touched a wallet',
        !balanceCalls.some(c => String(c.userId) === String(mfFail.userId)));

    // --- Sweeping again must not double-debit ---
    balanceCalls.length = 0;
    await sandboxSweeper.sweep();
    check('a second sweep debits nothing', balanceCalls.filter(c => c.amount < 0).length === 0,
        `${balanceCalls.length} calls`);

    // --- Provider stubs answer for sandbox refs without calling out ---
    const { feexPayPayoutService } = require('../services/feexpay-payout.service');
    const feexStatus = await feexPayPayoutService.checkPayoutStatus(sandbox.makeSandboxRef('success'));
    check('FeexPay status check answers from the reference', feexStatus.status === 'completed');

    const { cinetpayPayoutService } = require('../services/cinetpay-payout.service');
    const cpStatus = await cinetpayPayoutService.checkPayoutStatus(cpOkAfter!.transactionId);
    check('CinetPay status check answers from the stored reference', cpStatus?.status === 'completed',
        cpStatus?.status);

    const { moneyFusionService } = require('../services/moneyfusion.service');
    const mfInit = await moneyFusionService.initiatePayout({
        countryCode: 'CM', phone: '237650384125', amount: 2000, withdrawMode: 'mtn-cm',
    });
    check('MoneyFusion payout initiation returns a sandbox token', sandbox.isSandboxRef(mfInit.tokenPay), mfInit.tokenPay);
    const mfReject = await moneyFusionService.initiatePayout({
        countryCode: 'CM', phone: '237650384125', amount: 2003, withdrawMode: 'mtn-cm',
    });
    check('amount ..03 is rejected at initiation', mfReject.success === false, mfReject.message);

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();

    console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`);
    process.exit(failures === 0 ? 0 : 1);
};

main().catch(async err => {
    console.error('Failed:', err);
    await mongoose.disconnect().catch(() => { });
    process.exit(1);
});
