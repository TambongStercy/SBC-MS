/**
 * Burkina Faso moves to CinetPay only once its CinetPay account is configured
 * (Rufus, 2026-10-26). Without CINETPAY_BF_API_KEY / _PASSWORD every BF payment
 * would fail, so BF must stay on MoneyFusion until they are set.
 *
 * Run once with the BF credentials set and once without:
 *   CHECK_EXPECT_BF=CINETPAY   CINETPAY_BF_API_KEY=k CINETPAY_BF_API_PASSWORD=p npx ts-node src/scripts/check-bf-gateway.ts
 *   CHECK_EXPECT_BF=MONEYFUSION npx ts-node src/scripts/check-bf-gateway.ts
 * (plus the usual required env; no database is used).
 */
import { PaymentGateway } from '../database/interfaces/IPaymentIntent';
import paymentService from '../services/payment.service';

const expectBf = process.env.CHECK_EXPECT_BF as PaymentGateway | undefined;
const select = (cc: string, withdrawal: boolean): string =>
    (paymentService as any).selectGateway(cc, undefined, withdrawal, undefined);

const cases: Array<[string, string, boolean]> = [
    ['BF', expectBf || '', false],
    ['BF', expectBf || '', true],
    ['CI', PaymentGateway.CINETPAY, false],
    ['CI', PaymentGateway.CINETPAY, true],
    ['CM', PaymentGateway.MONEYFUSION, true],
    ['SN', PaymentGateway.MONEYFUSION, false],
    ['BJ', PaymentGateway.FEEXPAY, true],
];

let failed = 0;
for (const [cc, want, withdrawal] of cases) {
    const got = select(cc, withdrawal);
    const ok = got === want;
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${cc} ${withdrawal ? 'payout' : 'payin '} -> ${got} (want ${want})`);
}

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
