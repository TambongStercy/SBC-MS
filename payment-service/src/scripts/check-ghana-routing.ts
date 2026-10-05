/**
 * Walks a Ghanaian payin and withdrawal through the real code paths, short of
 * calling MoneyFusion itself.
 *
 * Ghana settles in GHS, not XAF, so the parts that can quietly go wrong are the
 * ones no type checker sees: the country never reaching MoneyFusion at all, the
 * operator resolving to no withdraw slug, or an amount being sent unconverted —
 * which is how a 2150 XAF subscription would be billed as 2150 GHS, roughly 100x
 * what the user owes.
 *
 *   npx ts-node src/scripts/check-ghana-routing.ts
 */
import { moneyFusionService, getMoneyFusionPayinCurrency } from '../services/moneyfusion.service';
import { momoOperatorToCountryCode, momoOperatorToCurrency, countryCodeToDialingPrefix } from '../utils/operatorMaps';
import currencyService from '../services/currency.service';
import paymentService from '../services/payment.service';
import { PaymentGateway } from '../database/interfaces/IPaymentIntent';

/** selectGateway is private; this is the real method, reached the only way a script can. */
const gatewayFor = (countryCode: string, isWithdrawal: boolean): string => {
    try {
        return (paymentService as any).selectGateway(countryCode, undefined, isWithdrawal, undefined);
    } catch (err: any) {
        return `THROW: ${err.message}`;
    }
};

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

const GHANA_OPERATORS = ['MTN_MOMO_GHA', 'TELECEL_GHA', 'AIRTEL_GHA', 'VODAFONE_GHA'];

const main = async () => {
    for (const operator of GHANA_OPERATORS) {
        check(`${operator} resolves to Ghana`, momoOperatorToCountryCode[operator] === 'GH',
            momoOperatorToCountryCode[operator] ?? 'no country');
        check(`${operator} pays out in GHS`, momoOperatorToCurrency[operator] === 'GHS',
            momoOperatorToCurrency[operator] ?? 'no currency');
        const mode = moneyFusionService.getWithdrawMode('GH', operator);
        check(`${operator} has a withdraw slug`, !!mode, mode ?? 'none — withdrawal would be refused');
    }

    check('Vodafone and Telecel are the same network',
        moneyFusionService.getWithdrawMode('GH', 'VODAFONE_GHA') === moneyFusionService.getWithdrawMode('GH', 'TELECEL_GHA'));

    check('a Ghanaian payin reaches MoneyFusion', gatewayFor('GH', false) === PaymentGateway.MONEYFUSION,
        gatewayFor('GH', false));
    check('a Ghanaian withdrawal reaches MoneyFusion', gatewayFor('GH', true) === PaymentGateway.MONEYFUSION,
        gatewayFor('GH', true));
    check('an unrouted country still throws rather than guessing',
        gatewayFor('ZW', false).startsWith('THROW'), gatewayFor('ZW', false));

    check('Ghana is a supported withdrawal country', moneyFusionService.isCountrySupported('GH'));
    check('Ghana has a dialing prefix', countryCodeToDialingPrefix['GH'] === '233',
        countryCodeToDialingPrefix['GH'] ?? 'missing — payout would abort on invalid country config');
    check('MoneyFusion expects GHS for Ghana payins', getMoneyFusionPayinCurrency('GH') === 'GHS',
        getMoneyFusionPayinCurrency('GH') ?? 'none — we would send XAF as-is');

    // Centrafrique: payins yes, payouts no. Asserted so nobody "fixes" one half.
    check('Centrafrique still takes payins in XAF', getMoneyFusionPayinCurrency('CF') === 'XAF');
    check('Centrafrique withdrawals are refused, not sent on a made-up slug',
        !moneyFusionService.isCountrySupported('CF'),
        'MoneyFusion lists no payout method for CF');

    // The conversion is what stops a Ghanaian being asked for 2150 GHS.
    const subscription = 2150;
    const inGhs = await currencyService.convertStrict(subscription, 'XAF', 'GHS');
    check(`${subscription} XAF converts to a sane GHS amount`,
        inGhs > 10 && inGhs < 200, `${inGhs} GHS`);
    check('conversion actually moved the number', Math.round(inGhs) !== subscription);

    const backToXaf = await currencyService.convertStrict(inGhs, 'GHS', 'XAF');
    check('the conversion round-trips', Math.abs(backToXaf - subscription) / subscription < 0.02,
        `${subscription} -> ${inGhs} GHS -> ${backToXaf} XAF`);

    console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`);
    process.exit(failures === 0 ? 0 : 1);
};

main().catch(err => {
    console.error('Failed:', err.message);
    process.exit(1);
});
