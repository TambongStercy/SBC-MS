/**
 * Checks every MoneyFusion withdraw slug we ship against their live list.
 *
 * Guessed slugs have failed silently on prod more than once: `airtel-money-ga`
 * (10 failed payouts, 0 completed), `airtel-money-cd` (8/0), the whole of Niger
 * (9/0), and Ghana shipped with `airtel-money-gh` and `vodafone-gh`, neither of
 * which exists. A wrong slug is not rejected at deploy time — it fails on a real
 * user's withdrawal, one at a time.
 *
 * Also flags countries we route to MoneyFusion that it has no payout method for
 * at all (Centrafrique today), because those users can pay in but never cash out.
 *
 *   npx ts-node src/scripts/check-mf-withdraw-modes.ts
 */
import axios from 'axios';
import { moneyFusionService } from '../services/moneyfusion.service';
import { momoOperatorToCountryCode } from '../utils/operatorMaps';

const METHODS_URL = 'https://pay.moneyfusion.net/api/v1/withdraw/methods';

/** Countries payment.service.ts sends to MoneyFusion. */
const ROUTED_TO_MF = ['BF', 'SN', 'ML', 'CD', 'GA', 'NE', 'GN', 'TD', 'CM', 'CF', 'GH'];

interface MfCountry {
    country: string;
    code: string;
    currency: string;
    paymentMethods: Array<{ key: string; name: string }>;
}

let failures = 0;
const fail = (msg: string) => { console.log(`FAIL  ${msg}`); failures++; };

const main = async () => {
    const { data } = await axios.get<{ success: boolean; data: MfCountry[] }>(METHODS_URL, { timeout: 20000 });
    if (!data?.success || !Array.isArray(data.data)) throw new Error('Unexpected response shape from MoneyFusion');

    const live = new Map(data.data.map(c => [c.code.toUpperCase(), c]));

    for (const country of ROUTED_TO_MF) {
        const entry = live.get(country);
        const ourModes = moneyFusionService.getSupportedWithdrawModes(country);
        const ourSlugs = new Set(Object.values(ourModes));

        if (!entry) {
            fail(`${country}: routed to MoneyFusion but absent from their country list`);
            continue;
        }

        const theirSlugs = new Set(entry.paymentMethods.map(m => m.key));

        if (theirSlugs.size === 0) {
            console.log(`WARN  ${country} (${entry.country}): MoneyFusion lists no payout method — payins only, withdrawals will be refused`);
            if (ourSlugs.size > 0) {
                fail(`${country}: we map ${[...ourSlugs].join(', ')} but MoneyFusion offers nothing there`);
            }
            continue;
        }

        const unknown = [...ourSlugs].filter(s => !theirSlugs.has(s));
        if (unknown.length) {
            fail(`${country}: slug(s) MoneyFusion does not offer — ${unknown.join(', ')} (live: ${[...theirSlugs].join(', ')})`);
        } else if (ourSlugs.size === 0) {
            console.log(`WARN  ${country}: MoneyFusion offers ${[...theirSlugs].join(', ')} but we map none of them`);
        } else {
            console.log(`PASS  ${country}: ${[...ourSlugs].join(', ')}`);
        }

        // An operator we let users register but cannot pay out to is a dead end for
        // whoever picked it. Not a slug bug — MoneyFusion simply does not serve that
        // network — so it warns rather than failing, but it should stay visible.
        const storedForCountry = Object.entries(momoOperatorToCountryCode)
            .filter(([, c]) => c === country)
            .map(([operator]) => operator);
        const unreachable = storedForCountry.filter(op => !ourModes[op]);
        if (unreachable.length) {
            console.log(`WARN  ${country}: users can register ${unreachable.join(', ')} but MoneyFusion cannot pay out to it`);
        }
    }

    console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`);
    process.exit(failures === 0 ? 0 : 1);
};

main().catch(err => {
    console.error('Failed:', err.message);
    process.exit(1);
});
