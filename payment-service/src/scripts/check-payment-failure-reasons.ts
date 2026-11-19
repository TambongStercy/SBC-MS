/**
 * Asserts Security plan Phase 10, "Why members do not pay": every unfinished
 * payment keeps a reason, grouped once (sbc_code, provider_api, member,
 * unknown) when it is recorded. Also asserts the FeexPay status-check fix: an
 * unreachable status API no longer turns a payment into ERROR (which took it
 * out of the payin reconciler for good) and no longer overwrites a SUCCEEDED.
 *
 * Needs a Mongo instance. Uses its own database and drops it afterwards.
 *
 *   npx ts-node src/scripts/check-payment-failure-reasons.ts
 */

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
process.env.NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost/unused';
process.env.PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL || 'http://localhost/unused';
process.env.PAYMENT_SANDBOX_ENABLED = 'false';

import mongoose from 'mongoose';
import axios from 'axios';
import { classifyText, failureFromError, failureFromProviderResult } from '../utils/payment-failure';

const DB = process.env.FAILURE_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_payment_failure_check';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};
const axiosError = (status: number, data: any) => Object.assign(new Error(`Request failed with status code ${status}`), { isAxiosError: true, response: { status, data } });

const main = async () => {
    // --- grouping, without a database ---
    const g = (t: string) => { const r = classifyText(t); return r ? `${r.group}/${r.code}` : 'none'; };
    check('« Solde insuffisant » is the member (low balance)', g('Solde insuffisant') === 'member/insufficient_balance');
    check('« Plafond atteint » / limit reached is the member', g('Plafond atteint') === 'member/limit_reached' && g('Transaction limit exceeded') === 'member/limit_reached');
    check('payer not found / numéro non reconnu is the member', g('Payer not found') === 'member/number_not_recognised' && g('Numéro non reconnu par l’opérateur') === 'member/number_not_recognised');
    check('cancelled / declined on the phone is the member', g('Transaction annulée par le client') === 'member/cancelled_by_payer' && g('Declined by user') === 'member/cancelled_by_payer');
    check('MoneyFusion « Montant doit etre supérieur a 200 F » is our code (amount sent)', g('Montant doit etre supérieur a 200 F') === 'sbc_code/amount_refused');
    check('IP allow-list refusal is a provider configuration problem', g('Adresse IP server non autorisée (172.70.1.1)') === 'provider_api/provider_config');
    check('a rate limit is the provider, not the member’s limit', g('Too many requests, rate limit exceeded') === 'provider_api/provider_rate_limited');
    check('a generic « ECHEC » matches no rule', g('ECHEC') === 'none');

    const timeout = failureFromError(Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' }), { step: 'initiate', gateway: 'moneyfusion' });
    check('an axios timeout is provider_api/provider_timeout', timeout.group === 'provider_api' && timeout.code === 'provider_timeout');
    const down = failureFromError(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }), { step: 'initiate' });
    check('a refused connection is provider_api/provider_unreachable', down.code === 'provider_unreachable');
    const http502 = failureFromError(axiosError(502, '<html>Bad gateway</html>'), { step: 'initiate', gateway: 'cinetpay' });
    check('an HTTP 502 is provider_api/provider_http_5xx with its status', http502.code === 'provider_http_5xx' && http502.httpStatus === 502);
    const lowBal = failureFromError(axiosError(400, { message: 'Solde insuffisant', code: 'E12' }), { step: 'initiate', gateway: 'feexpay' });
    check('an HTTP 400 saying « solde insuffisant » is the member, with provider code and message',
        lowBal.group === 'member' && lowBal.code === 'insufficient_balance' && lowBal.providerCode === 'E12' && lowBal.providerMessage === 'Solde insuffisant');
    const refused = failureFromError(Object.assign(new Error('Service indisponible pour ce pays'), { providerRefusal: true }), { step: 'initiate', gateway: 'moneyfusion' });
    check('a provider refusal with an unknown text is provider_api/provider_refused', refused.group === 'provider_api' && refused.code === 'provider_refused');
    const bug = failureFromError(new TypeError("Cannot read properties of undefined (reading 'name')"), { step: 'initiate' });
    check('an exception in our code is sbc_code/exception', bug.group === 'sbc_code' && bug.code === 'exception');
    const missing = failureFromError(new Error('Phone number is required for the selected country.'), { step: 'initiate' });
    check('a missing phone is the member (missing details)', missing.group === 'member' && missing.code === 'missing_details');

    const cp2010 = failureFromProviderResult({ gateway: 'cinetpay', status: 'FAILED', providerData: { verifiedStatus: { code: 2010, status: 'FAILED' } } });
    check('CinetPay 2010 without a message is unknown, code 2010 kept for a later rule', cp2010.group === 'unknown' && cp2010.providerCode === '2010');
    const cp2003 = failureFromProviderResult({ gateway: 'cinetpay', status: 'FAILED', providerData: { verifiedStatus: { code: 2003, status: 'EXPIRED' } } });
    check('CinetPay 2003 is the member (expired)', cp2003.group === 'member' && cp2003.code === 'expired');
    const mf = failureFromProviderResult({ gateway: 'moneyfusion', status: 'FAILED', providerData: { event: 'payin.session.cancelled', tokenPay: 't' } });
    check('MoneyFusion payin.session.cancelled is the member (cancelled)', mf.group === 'member' && mf.code === 'cancelled_by_payer');
    const np = failureFromProviderResult({ gateway: 'nowpayments', status: 'EXPIRED', providerData: { payment_status: 'expired' } });
    check('NOWPayments expired is the member (expired)', np.code === 'expired');
    const long = failureFromError(new Error('x'.repeat(1000)), { step: 'initiate' });
    check('a long message is cut to 300 characters', (long.providerMessage || '').length <= 301);

    // --- recorded on the payment ---
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();
    /* eslint-disable @typescript-eslint/no-var-requires */
    const PaymentIntentModel = require('../database/models/PaymentIntent').default;
    const repo = require('../database/repositories/paymentIntent.repository').default;
    const paymentService = require('../services/payment.service').default;
    (paymentService as any).notifyOriginatingService = async () => undefined;

    await PaymentIntentModel.create({ sessionId: 'S-FAIL', userId: 'u1', amount: 2150, currency: 'XAF', gateway: 'cinetpay', status: 'PENDING_PROVIDER', gatewayPaymentId: 'tok1', countryCode: 'CI' });
    const failed = await repo.addWebhookEvent('S-FAIL', 'FAILED', { verifiedStatus: { code: 2003, status: 'EXPIRED' } });
    await paymentService.handlePaymentCompletion(failed);
    const afterFail = await PaymentIntentModel.findOne({ sessionId: 'S-FAIL' }).lean();
    check('a provider’s FAILED answer records failure {group, code, step, gateway, at}',
        afterFail?.failure?.group === 'member' && afterFail.failure.code === 'expired' && afterFail.failure.step === 'provider_result'
        && afterFail.failure.gateway === 'cinetpay' && afterFail.failure.at instanceof Date, JSON.stringify(afterFail?.failure));
    await paymentService.handlePaymentCompletion({ ...failed.toObject(), failure: afterFail.failure });
    check('a replayed completion keeps the first reason', (await PaymentIntentModel.countDocuments({ 'failure.code': 'expired' })) === 1);

    await PaymentIntentModel.create({ sessionId: 'S-OK', userId: 'u1', amount: 2150, currency: 'XAF', gateway: 'feexpay', status: 'PENDING_PROVIDER', gatewayPaymentId: 'tok2', countryCode: 'BJ' });
    const ok = await repo.addWebhookEvent('S-OK', 'SUCCEEDED', { status: 'SUCCESSFUL' });
    await paymentService.handlePaymentCompletion(ok);
    check('a successful payment gets no failure', !(await PaymentIntentModel.findOne({ sessionId: 'S-OK' }).lean())?.failure);

    // --- FeexPay status check during an outage ---
    await PaymentIntentModel.create({
        sessionId: 'S-FX', userId: 'u1', amount: 2150, currency: 'XOF', gateway: 'feexpay', status: 'PENDING_PROVIDER',
        gatewayPaymentId: 'FX-REF-1', countryCode: 'BJ', metadata: { keep: 'me' },
    });
    const realGet = axios.get;
    (axios as any).get = async () => { throw axiosError(502, { message: 'Bad Gateway' }); };
    let threw = false;
    try { await paymentService.checkFeexpayTransactionStatus('FX-REF-1'); } catch { threw = true; }
    (axios as any).get = realGet;
    const fx = await PaymentIntentModel.findOne({ sessionId: 'S-FX' }).lean();
    check('FeexPay status API down: the payment stays PENDING_PROVIDER (was set to ERROR)', threw && fx?.status === 'PENDING_PROVIDER', fx?.status);
    check('the outage is noted in one metadata key, the rest of metadata kept',
        fx?.metadata?.keep === 'me' && !!fx?.metadata?.feexpayStatusCheckError);
    check('…and the payment is still picked by the payin reconciler query',
        (await PaymentIntentModel.countDocuments({ sessionId: 'S-FX', status: { $in: ['PENDING_PROVIDER', 'PROCESSING'] } })) === 1);

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
    process.exit(failures ? 1 : 0);
};

main().catch(async e => { console.error(e); await mongoose.disconnect(); process.exit(1); });
