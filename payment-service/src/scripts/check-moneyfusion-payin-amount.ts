/**
 * MoneyFusion payins are sent in francs for every country (2026-11-19).
 *
 * MoneyFusion's totalPrice is always in XOF francs; its checkout converts it to
 * the payer's currency at its own rate (GET /api/v2/payment-methods:
 * exchangeRateFromXOF). We used to convert first, so it converted twice:
 * every RDC payin was refused ("Montant doit etre supérieur a 200 F" for
 * ~$3.84) and Guinée payers were asked ~14x the price. Ghana and Centrafrique
 * were refused by the input check before reaching MoneyFusion.
 *
 * Runs the real submitPaymentDetails path with MoneyFusion, the user lookup and
 * the rate API replaced. Needs a Mongo instance; uses its own database.
 *
 *   npx ts-node src/scripts/check-moneyfusion-payin-amount.ts
 */
import mongoose from 'mongoose';
import paymentService from '../services/payment.service';
import { moneyFusionService } from '../services/moneyfusion.service';
import { userServiceClient } from '../services/clients/user.service.client';
import { currencyService } from '../services/currency.service';
import PaymentIntentModel from '../database/models/PaymentIntent';
import { validatePaymentDetails } from '../api/middleware/validation';

const DB = process.env.MF_PAYIN_TEST_DB || 'mongodb://127.0.0.1:27017/sbc_payment_mf_payin_check';
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

const sent: any[] = [];
(moneyFusionService as any).initiatePayment = async (req: any) => {
    sent.push(req);
    return { success: true, token: `tok${sent.length}`, checkoutUrl: `https://payin.example/${sent.length}` };
};
(userServiceClient as any).getUserDetails = async () => ({ name: 'Membre', phoneNumber: '243810000000' });
let rateCalls = 0;
for (const fn of ['convert', 'convertStrict']) {
    const real = (currencyService as any)[fn].bind(currencyService);
    (currencyService as any)[fn] = async (...a: any[]) => { rateCalls++; return real(...a); };
}

const validates = (body: Record<string, unknown>) => new Promise<number>(resolve => {
    const res: any = { status: (c: number) => ({ json: () => resolve(c) }) };
    validatePaymentDetails({ body, params: { sessionId: "check" } } as any, res, () => resolve(200));
});

const intent = async (n: number) => (await PaymentIntentModel.create({
    sessionId: `mfcheck-${n}-${Date.now()}`, userId: new mongoose.Types.ObjectId(), amount: 2150, currency: 'XAF',
    status: 'PENDING_USER_INPUT', metadata: { planId: 'CLASSIQUE', paymentMethod: 'traditional' },
} as any)).sessionId;

const main = async () => {
    await mongoose.connect(DB);
    await mongoose.connection.dropDatabase();

    // The input check used to refuse Ghana and Centrafrique outright.
    check('Ghana (GHS) passes the input check', await validates({ countryCode: 'GH', paymentCurrency: 'GHS' }) === 200);
    check('Centrafrique (XAF) passes the input check', await validates({ countryCode: 'CF', paymentCurrency: 'XAF' }) === 200);
    check('an unknown country is still refused', await validates({ countryCode: 'ZZ', paymentCurrency: 'XAF' }) === 400);

    const cases: Array<[string, string]> = [['CD', 'CDF'], ['GN', 'GNF'], ['GH', 'GHS'], ['CM', 'XAF'], ['SN', 'XOF']];
    let n = 0;
    for (const [country, pageCurrency] of cases) {
        rateCalls = 0;
        const sid = await intent(n++);
        const done = await paymentService.submitPaymentDetails(sid, { countryCode: country, paymentCurrency: pageCurrency });
        const req = sent[sent.length - 1];
        check(`${country}: MoneyFusion gets 2150 francs, not a converted amount`, req?.amount === 2150, `sent ${req?.amount}`);
        check(`${country}: no exchange-rate lookup on the way`, rateCalls === 0, `${rateCalls} call(s)`);
        check(`${country}: recorded as XAF on the intent`, done.paidAmount === 2150 && done.paidCurrency === 'XAF' && done.metadata?.mfPayinCurrency === 'XAF',
            `${done.paidAmount} ${done.paidCurrency} / ${done.metadata?.mfPayinCurrency}`);
    }
    const rdc = await PaymentIntentModel.findOne({ countryCode: 'CD' }).lean() as any;
    check('RDC: the checkout currency is noted for reference (USD)', rdc?.metadata?.mfLocalCurrency === 'USD');

    // The MoneyFusion webhook books the paid amount in francs too.
    const gn = await PaymentIntentModel.findOne({ countryCode: 'GN' }).lean() as any;
    (paymentService as any).handlePaymentCompletion = async () => undefined;
    // Support phase 2: the webhook is a hint; MoneyFusion's status answer decides (and must match).
    (moneyFusionService as any).checkPaymentStatus = async () => ({ statut: 'paid', Montant: 2150, personal_Info: [{ sessionId: gn.sessionId }] });
    await paymentService.handleMoneyFusionPayinWebhook({ event: 'payin.session.completed', tokenPay: gn.gatewayPaymentId, Montant: 2150 });
    const gnAfter = await PaymentIntentModel.findById(gn._id).lean() as any;
    check('webhook books Guinée as 2150 XAF', gnAfter.status === 'SUCCEEDED' && gnAfter.paidAmount === 2150 && gnAfter.paidCurrency === 'XAF',
        `${gnAfter.status} ${gnAfter.paidAmount} ${gnAfter.paidCurrency}`);

    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(failures ? `\n${failures} FAILED` : '\nAll checks passed');
    process.exit(failures ? 1 : 0);
};

main().catch(async err => { console.error(err); await mongoose.disconnect().catch(() => undefined); process.exit(1); });
