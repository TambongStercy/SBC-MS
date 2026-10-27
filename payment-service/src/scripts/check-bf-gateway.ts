/**
 * Burkina Faso moves to CinetPay operator by operator, once its CinetPay
 * account is configured (Rufus, 2026-10-26). CinetPay serves only Orange
 * Burkina for now, so Orange goes to CinetPay and Moov stays on MoneyFusion.
 * Without CINETPAY_BF_API_KEY / _PASSWORD everything BF stays on MoneyFusion.
 *
 * Run once with the BF credentials set and once without:
 *   CHECK_BF_CONFIGURED=1 CINETPAY_BF_API_KEY=k CINETPAY_BF_API_PASSWORD=p npx ts-node src/scripts/check-bf-gateway.ts
 *   npx ts-node src/scripts/check-bf-gateway.ts
 * (plus the usual required env; no database is used).
 */
import { PaymentGateway } from '../database/interfaces/IPaymentIntent';
import paymentService from '../services/payment.service';

const configured = process.env.CHECK_BF_CONFIGURED === '1';
const select = (cc: string, withdrawal: boolean, operator?: string): string =>
    (paymentService as any).selectGateway(cc, undefined, withdrawal, undefined, operator);

const { CINETPAY, MONEYFUSION, FEEXPAY } = PaymentGateway;
const orange = configured ? CINETPAY : MONEYFUSION;
const cases: Array<[string, boolean, string | undefined, string]> = [
    // country, payout?, operator, expected
    ['BF', true, 'ORANGE_BFA', orange],   // member withdrawal / admin approval
    ['BF', true, 'MOOV_BFA', MONEYFUSION],
    ['BF', false, 'orange_bf', orange],   // payment page choice
    ['BF', false, 'moov_bf', MONEYFUSION],
    ['BF', false, undefined, MONEYFUSION], // old page without the choice
    ['BF', true, 'OM_BF', orange],        // admin direct payout method
    ['BF', true, 'MOOV_BF', MONEYFUSION],
    ['CI', false, undefined, CINETPAY],
    ['CI', true, 'ORANGE_CIV', CINETPAY],
    ['CM', true, 'ORANGE_CMR', MONEYFUSION],
    ['SN', false, undefined, MONEYFUSION],
    ['BJ', true, 'MTN_BEN', FEEXPAY],
];

let failed = 0;
for (const [cc, withdrawal, operator, want] of cases) {
    const got = select(cc, withdrawal, operator);
    const ok = got === want;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${cc} ${withdrawal ? 'payout' : 'payin '} ${operator ?? '(no operator)'} -> ${got} (want ${want})`);
}

// The payment page offers the operator choice only once BF is split.
const choices = paymentService.payinOperatorChoices();
const choicesOk = configured
    ? JSON.stringify(choices.BF?.map(c => c.value)) === JSON.stringify(['orange_bf', 'moov_bf'])
    : Object.keys(choices).length === 0;
if (!choicesOk) failed++;
console.log(`${choicesOk ? 'PASS' : 'FAIL'}  payment page operator choices: ${JSON.stringify(choices)}`);

// The approval payout subtracts a fee stored to the centime; the result must
// be a clean multiple of 5 again, or CinetPay refuses it.
for (const net of [7995, 1500, 102500, 99995]) {
    const fee = parseFloat((net * 0.025).toFixed(2));
    const amount = net + fee;
    const paid = Math.round((amount - fee) * 100) / 100;
    const ok = paid === net && paid % 5 === 0;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  net ${net}: pays ${paid} (raw ${amount - fee})`);
}
process.exit(failed ? 1 : 0);
