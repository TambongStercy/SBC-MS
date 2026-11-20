/**
 * Asserts Security plan Phase 10, second part: French reason + next step for
 * the member, the Mobile Money number check (log / enforce), team alerts
 * (provider drop, spikes, stuck payments; open once, close by themselves),
 * the archive of abandoned payments (moved, never deleted, still counted),
 * and the payment page rendering of failed / archived payments.
 *
 * Needs a Mongo instance; uses its own database and drops it.
 *
 *   npx ts-node --transpile-only src/scripts/check-payment-conversion-2.ts
 */
export {};

process.env.NODE_ENV = 'development';
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
process.env.USER_SERVICE_URL = 'http://localhost/unused';
process.env.ADVERTISING_SERVICE_URL = 'http://localhost/unused';
process.env.TOMBOLA_SERVICE_URL = 'http://localhost/unused';
process.env.NOTIFICATION_SERVICE_URL = 'http://localhost/unused';
process.env.PRODUCT_SERVICE_URL = 'http://localhost/unused';
process.env.PAYMENT_SANDBOX_ENABLED = 'true';
process.env.PAYMENT_ALERT_EMAILS = '';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};
const refusal = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e: any) { return e; } };
const DB = process.env.CONVERSION_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_payment_conversion_check2';

const main = async () => {
    // --- pure helpers ---
    const { memberFailureText } = await import('../utils/member-failure-text');
    const { checkPayinNumber } = await import('../utils/payin-number');
    check('low balance → recharge text', /solde/i.test(memberFailureText({ group: 'member', code: 'insufficient_balance' }).reason));
    check('number not recognised → check number text', /numéro/i.test(memberFailureText({ group: 'member', code: 'number_not_recognised' }).nextStep));
    check('provider error without a dedicated text → provider-side text', /service de paiement/.test(memberFailureText({ group: 'provider_api', code: 'provider_http_5xx' }).reason));
    check('our error → our-side text with support', /notre côté/.test(memberFailureText({ group: 'sbc_code', code: 'exception' }).reason));
    check('no failure recorded → generic text', /n'a pas abouti/.test(memberFailureText(null).reason));

    check('BJ 10 digits starting 01 passes', checkPayinNumber('BJ', '2290197000000').ok);
    check('BJ old 8 digits passes', checkPayinNumber('BJ', '22997000000').ok);
    check('BJ 9 digits refused', !checkPayinNumber('BJ', '229970000001'.slice(0, 12)).ok, checkPayinNumber('BJ', '229970000001'.slice(0, 12)).national);
    check('BJ dialling code typed twice refused', !checkPayinNumber('BJ', '22922997000000').ok);
    check('TG 8 digits starting 9 passes', checkPayinNumber('TG', '22890000000').ok);
    check('TG starting 6 refused', !checkPayinNumber('TG', '22860000000').ok);
    check('CG keeps its 0: 9 digits starting 0 passes', checkPayinNumber('CG', '242061234567').ok);
    check('CG without the 0 refused', !checkPayinNumber('CG', '24261234567').ok);
    check('a country without a rule passes (CM via hosted checkout)', checkPayinNumber('CM', '123').ok);
    check('00-prefixed international form is understood', checkPayinNumber('TG', '0022890000000').ok);

    const mongoose = (await import('mongoose')).default;
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();
    const paymentService = (await import('../services/payment.service')).default;
    const PI = (await import('../database/models/PaymentIntent')).default;
    const Alert = (await import('../database/models/PaymentAlert')).default;
    const { PaymentStatus } = await import('../database/interfaces/IPaymentIntent');
    const { detectAlerts, applyAlerts } = await import('../jobs/payment-alerts.job');
    const { archiveAbandoned, archiveCollection } = await import('../jobs/payin-archive.job');
    const { conversionSummary, paymentAlerts } = await import('../services/payment-conversion.service');
    await PI.syncIndexes();
    await Alert.syncIndexes();

    const U = 'aaaaaaaaaaaaaaaaaaaaaaaa';
    const base = { userId: U, amount: 2070, currency: 'XAF', paymentType: 'SUBSCRIPTION', metadata: { originatingService: 'user-service', callbackPath: 'http://x/subscriptions/webhooks/payment-confirmation', planType: 'CLASSIQUE', planId: 'CLASSIQUE' } };
    const submit = (sessionId: string, phone: string) => paymentService.submitPaymentDetails(sessionId, { phoneNumber: phone, countryCode: 'BJ', paymentCurrency: 'XOF', operator: 'mtn' });

    // --- number check: enforce ---
    process.env.PAYIN_NUMBER_CHECK = 'enforce';
    const e1 = await paymentService.createPaymentIntent({ ...base, amount: 101 } as any, { reuseAndLimit: false });
    const bad = await refusal(() => submit(e1.sessionId, '9700001'));
    const e1After: any = await PI.findOne({ sessionId: e1.sessionId }).lean();
    check('enforce: a 7-digit BJ number is refused with 400 and a French text', bad?.statusCode === 400 && /format/.test(bad?.memberText?.reason || ''), bad?.message);
    check('enforce: the payment stays open (same payment, corrected number)', e1After.status === PaymentStatus.PENDING_USER_INPUT && (!e1After.gateway || e1After.gateway === 'none') && e1After.metadata?.numberRefusals === 1);
    const good = await submit(e1.sessionId, '0197000055');
    check('enforce: the corrected number goes through on the same payment', good.status === PaymentStatus.PENDING_PROVIDER && good.sessionId === e1.sessionId);

    // --- number check: log ---
    process.env.PAYIN_NUMBER_CHECK = 'log';
    const l1 = await paymentService.createPaymentIntent({ ...base, amount: 102 } as any, { reuseAndLimit: false });
    const logged = await submit(l1.sessionId, '9700055');
    const l1After: any = await PI.findOne({ sessionId: l1.sessionId }).lean();
    check('log: a bad number is still sent, and recorded', logged.status === PaymentStatus.PENDING_PROVIDER && l1After.metadata?.numberCheck?.ok === false && l1After.metadata?.numberCheck?.refused === false);

    // --- French text on an initiation failure (sandbox ..00 = refused by the operator) ---
    const r1 = await paymentService.createPaymentIntent({ ...base, amount: 103 } as any, { reuseAndLimit: false });
    const rejected = await refusal(() => submit(r1.sessionId, '0197000000'));
    check('initiation failure carries the member text (refused on the phone)', /annulé ou refusé/.test(rejected?.memberText?.reason || ''), rejected?.memberText?.reason);

    // --- alerts ---
    await PI.deleteMany({});
    const now = new Date();
    const ago = (min: number) => new Date(now.getTime() - min * 60_000);
    const docs: any[] = [];
    let n = 0;
    const add = (o: any) => docs.push({ sessionId: `al-${n++}`, userId: U, amount: 100, currency: 'XAF', paymentType: 'SUBSCRIPTION', status: PaymentStatus.PENDING_USER_INPUT, gateway: 'none', ...o });
    // FeexPay: 40 % over the week, 5 % in the last hour → drop.
    for (let i = 0; i < 100; i++) add({ gateway: 'feexpay', countryCode: 'BJ', status: i < 40 ? PaymentStatus.SUCCEEDED : PaymentStatus.FAILED, createdAt: ago(60 * 24 + i * 30) });
    for (let i = 0; i < 20; i++) add({ gateway: 'feexpay', countryCode: 'BJ', status: i < 1 ? PaymentStatus.SUCCEEDED : PaymentStatus.FAILED, createdAt: ago(20 + i * 2) });
    // CinetPay: steady 30 % both windows → no drop.
    for (let i = 0; i < 100; i++) add({ gateway: 'cinetpay', countryCode: 'CI', status: i % 10 < 3 ? PaymentStatus.SUCCEEDED : PaymentStatus.FAILED, createdAt: ago(60 * 24 + i * 30) });
    for (let i = 0; i < 30; i++) add({ gateway: 'cinetpay', countryCode: 'CI', status: i % 10 < 3 ? PaymentStatus.SUCCEEDED : PaymentStatus.FAILED, createdAt: ago(20 + i) });
    // MoneyFusion outage: 12 provider_api failures in the last hour, CM.
    for (let i = 0; i < 12; i++) add({ gateway: 'moneyfusion', countryCode: 'CM', status: PaymentStatus.ERROR, createdAt: ago(5 + i), failure: { group: 'provider_api', code: 'provider_unreachable', step: 'initiate', at: ago(5 + i) } });
    // A bad deploy: 11 sbc_code failures in the last hour.
    for (let i = 0; i < 11; i++) add({ gateway: 'moneyfusion', countryCode: 'GA', status: PaymentStatus.ERROR, createdAt: ago(3 + i), failure: { group: 'sbc_code', code: 'exception', step: 'initiate', at: ago(3 + i) } });
    // 5 stuck MoneyFusion payments (threshold set to 5 below).
    for (let i = 0; i < 5; i++) add({ gateway: 'moneyfusion', countryCode: 'CM', status: PaymentStatus.PENDING_PROVIDER, createdAt: ago(180 + i) });
    await PI.collection.insertMany(docs.map(d => ({ ...d, updatedAt: d.createdAt })));

    const settings = { minAttempts: 20, spikeMin: 10, spikeFactor: 3, stuckThreshold: 5 };
    const conds = await detectAlerts(now, settings);
    const keys = conds.map(c => c.key).sort();
    check('provider drop detected for FeexPay only', keys.includes('provider_drop:feexpay') && !keys.includes('provider_drop:cinetpay'), keys.join(','));
    check('provider API spike detected for MoneyFusion', keys.includes('provider_api_spike:moneyfusion'));
    check('SBC code spike detected', keys.includes('sbc_code_spike'));
    check('country spike detected for CM and GA', keys.includes('country_error_spike:CM') && keys.includes('country_error_spike:GA'));
    check('stuck payments detected for MoneyFusion', keys.includes('stuck_payments:moneyfusion'));

    const first = await applyAlerts(conds, now);
    const again = await applyAlerts(conds, new Date(now.getTime() + 5 * 60_000));
    check('alerts open once, not again while still true', first.opened.length === conds.length && again.opened.length === 0 && await Alert.countDocuments({ open: true }) === conds.length);
    const cleared = await applyAlerts(conds.filter(c => c.key !== 'sbc_code_spike'), new Date(now.getTime() + 10 * 60_000));
    const shown = await paymentAlerts();
    check('a cleared alert closes and shows in the history', cleared.closed === 1 && shown.recent.some(a => a.key === 'sbc_code_spike') && !shown.open.some(a => a.key === 'sbc_code_spike'));
    const back = await applyAlerts(conds, new Date(now.getTime() + 15 * 60_000));
    check('the same condition coming back opens a new alert', back.opened.length === 1 && back.opened[0].key === 'sbc_code_spike' && await Alert.countDocuments({ key: 'sbc_code_spike' }) === 2);

    // --- archive ---
    await PI.deleteMany({});
    const old = (d: number) => new Date(Date.now() - d * 86400_000);
    await PI.collection.insertMany([
        { sessionId: 'ab-1', userId: U, amount: 100, currency: 'XAF', paymentType: 'SUBSCRIPTION', status: PaymentStatus.PENDING_USER_INPUT, gateway: 'none', createdAt: old(10), updatedAt: old(10), metadata: { pageOpenedAt: old(10) } },
        { sessionId: 'ab-2', userId: U, amount: 100, currency: 'XAF', paymentType: 'SUBSCRIPTION', status: PaymentStatus.PENDING_USER_INPUT, gateway: 'none', createdAt: old(8), updatedAt: old(8) },
        { sessionId: 'ab-recent', userId: U, amount: 100, currency: 'XAF', paymentType: 'SUBSCRIPTION', status: PaymentStatus.PENDING_USER_INPUT, gateway: 'none', createdAt: old(2), updatedAt: old(2) },
        { sessionId: 'ab-paid', userId: U, amount: 100, currency: 'XAF', paymentType: 'SUBSCRIPTION', status: PaymentStatus.SUCCEEDED, gateway: 'feexpay', createdAt: old(10), updatedAt: old(10) },
        { sessionId: 'ab-waiting', userId: U, amount: 100, currency: 'XAF', paymentType: 'SUBSCRIPTION', status: PaymentStatus.PENDING_PROVIDER, gateway: 'moneyfusion', createdAt: old(10), updatedAt: old(10) },
    ]);
    const from = new Date(Date.now() - 12 * 86400_000 + 3600_000).toISOString().slice(0, 10);
    const before = await conversionSummary({ from, country: 'none', gateway: 'none' } as any);
    const dry = await archiveAbandoned({ dryRun: true });
    check('dry run counts 2 abandoned payments older than 7 days and moves nothing', dry.candidates === 2 && dry.moved === 0 && await PI.countDocuments() === 5);
    const run = await archiveAbandoned();
    const liveIds = (await PI.find({}).select('sessionId').lean()).map((x: any) => x.sessionId).sort();
    const archived: any[] = await archiveCollection().find({}).toArray();
    check('the 2 abandoned payments are moved, whole, to the archive', run.moved === 2 && archived.length === 2 && archived.every(a => a.archivedAt && a.amount === 100) && archived.some(a => a.metadata?.pageOpenedAt));
    check('recent, paid and waiting payments stay live', JSON.stringify(liveIds) === JSON.stringify(['ab-paid', 'ab-recent', 'ab-waiting']));
    const rerun = await archiveAbandoned();
    check('a second run moves nothing and duplicates nothing', rerun.moved === 0 && await archiveCollection().countDocuments() === 2);
    const after = await conversionSummary({ from, to: undefined, country: 'none', gateway: 'none', _: 'after' } as any);
    const beforeAbandoned = before.totals.attempts;
    check('archived payments still count in the funnel', after.totals.attempts === 3 && beforeAbandoned === 3 && after.totals.opened === 1, `before ${beforeAbandoned}, after ${after.totals.attempts}`);

    // --- page rendering ---
    const ejs = (await import('ejs')).default ?? (await import('ejs'));
    const path = await import('path');
    const view = path.join(__dirname, '../views/payment.ejs');
    const common = { sessionId: 'S-1', amount: 2070, currency: 'XAF', assetBasePath: '/api/payments/static', gateway: '', gatewayPaymentId: '', isCryptoPayment: false, cryptoBetaEnabled: false, operatorChoices: {}, phoneNumber: undefined, countryCode: undefined, operator: undefined, errorMessage: undefined, cryptoAddress: undefined, payAmount: undefined, payCurrency: undefined, paymentType: undefined, subscriptionType: undefined, subscriptionPlan: undefined, paidAmount: undefined, paidCurrency: undefined, cryptoQrCodeBase64: undefined, cryptoUsdAmount: undefined, };
    const failedHtml: string = await (ejs as any).renderFile(view, { ...common, paymentStatus: 'FAILED', failureText: memberFailureText({ group: 'member', code: 'insufficient_balance' }) });
    check('failed payment page shows the reason and the next step', failedHtml.includes('solde de votre compte Mobile Money') && failedHtml.includes('Rechargez votre compte') && failedHtml.includes('Référence : S-1'));
    const archivedHtml: string = await (ejs as any).renderFile(view, { ...common, paymentStatus: 'EXPIRED', failureText: { reason: 'Ce paiement a expiré : il n’a pas été utilisé pendant plus de 7 jours.', nextStep: 'Relancez le paiement depuis l’application SBC.' } });
    check('archived payment page renders as expired', archivedHtml.includes('Paiement Expiré') && archivedHtml.includes('Relancez le paiement'));

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
};

main().catch(e => { console.error(e); process.exit(1); });
