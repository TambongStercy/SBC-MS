/**
 * Asserts what MoneyFusion is asked to pay for RDC, Guinée and Ghana.
 *
 * Until 2026-10 the payout sent our net XAF figure as-is, and MoneyFusion reads
 * `amount` in the country's own currency: 1,965 XAF went out as $1,965 on the
 * RDC channel. The user flow also read the amount typed in "F" as CDF/GHS, so
 * a Ghanaian asking for 2,000 F was debited 74,667 XAF.
 *
 * Rates are stubbed, so this runs offline:
 *   npx ts-node src/scripts/check-noncfa-payouts.ts
 */
import { currencyService } from '../services/currency.service';
import { toMoneyFusionPayoutAmount, moneyFusionService, getMoneyFusionPayinCurrency } from '../services/moneyfusion.service';
import { momoOperatorToCountryCode, momoOperatorToCurrency } from '../utils/operatorMaps';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};

// Approximate: 1 USD ≈ 560 XAF, 1 GHS ≈ 37.3 XAF, 1 GNF ≈ 0.065 XAF.
const RATES: Record<string, number> = { USD: 1 / 560, GHS: 1 / 37.3, GNF: 15.36 };
let rateAvailable = true;
(currencyService as any).getRate = async (from: string, to: string) => {
    if (from === to) return 1;
    if (!rateAvailable) return null;
    return from === 'XAF' ? RATES[to] ?? null : null;
};

const main = async () => {
    const cd = await toMoneyFusionPayoutAmount(10_000, 'CD');
    check('RDC: 10,000 XAF goes out in USD', cd.currency === 'USD', cd.currency);
    check('RDC: about $17.85, not $10,000', cd.amount === 17.85, `${cd.amount}`);

    const cdCents = await toMoneyFusionPayoutAmount(1_965, 'CD');
    check('RDC: kept to whole cents', Number.isInteger(Math.round(cdCents.amount * 100)) && cdCents.amount === 3.5,
        `${cdCents.amount}`);

    const gh = await toMoneyFusionPayoutAmount(2_000, 'GH');
    check('Ghana: 2,000 XAF is 53 GHS (rounded down)', gh.currency === 'GHS' && gh.amount === 53, `${gh.amount} ${gh.currency}`);

    const gn = await toMoneyFusionPayoutAmount(10_000, 'GN');
    check('Guinée: 10,000 XAF is 153,600 GNF', gn.currency === 'GNF' && gn.amount === 153_600, `${gn.amount}`);

    check('never pays more than debited', cd.amount / RATES.USD <= 10_000 && gh.amount / RATES.GHS <= 2_000);

    for (const cc of ['CM', 'SN', 'CI', 'GA', 'TD', 'ML', 'BF', 'NE']) {
        const r = await toMoneyFusionPayoutAmount(5_000, cc);
        check(`${cc}: CFA amount untouched`, r.amount === 5_000 && r.rate === 1, `${r.amount} ${r.currency}`);
    }

    rateAvailable = false;
    let threw = '';
    try { await toMoneyFusionPayoutAmount(10_000, 'CD'); } catch (e: any) { threw = e.message; }
    check('rate down: refuses instead of sending XAF as USD', threw.includes('unavailable'), threw || 'did not throw');
    const cfa = await toMoneyFusionPayoutAmount(5_000, 'CM');
    check('rate down: CFA payouts still go through', cfa.amount === 5_000);
    rateAvailable = true;

    threw = '';
    try { await toMoneyFusionPayoutAmount(10_000, 'ZW'); } catch (e: any) { threw = e.message; }
    check('unknown country refuses', threw.includes('No MoneyFusion currency'), threw || 'did not throw');

    threw = '';
    try { await toMoneyFusionPayoutAmount(1, 'CD'); } catch (e: any) { threw = e.message; }
    check('a payout that rounds to $0 is refused', threw.includes('refusing'), threw || 'did not throw');

    // Operator maps: RDC is USD like MoneyFusion says; Orange Guinée now routes.
    for (const op of ['VODACOM_MPESA_COD', 'AIRTEL_COD', 'ORANGE_COD']) {
        check(`${op} pays out in USD`, momoOperatorToCurrency[op] === 'USD', momoOperatorToCurrency[op]);
    }
    check('RDC map matches MoneyFusion', getMoneyFusionPayinCurrency('CD') === momoOperatorToCurrency.AIRTEL_COD);
    check('ORANGE_GN is Guinée', momoOperatorToCountryCode.ORANGE_GN === 'GN');
    check('ORANGE_GN pays out in GNF', momoOperatorToCurrency.ORANGE_GN === 'GNF');
    check('ORANGE_GN has a MoneyFusion slug', moneyFusionService.getWithdrawMode('GN', 'ORANGE_GN') === 'orange-gn');

    if (failures) {
        console.log(`\n${failures} check(s) failed`);
        process.exit(1);
    }
    console.log('\nAll checks passed');
};

main().catch(err => {
    console.error('Failed:', err.message);
    process.exit(1);
});
