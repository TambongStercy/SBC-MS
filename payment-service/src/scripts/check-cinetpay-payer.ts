/**
 * Asserts the payer fields we send CinetPay on every checkout.
 *
 * CinetPay (2026-10) asked all merchants to send the real payer. Their
 * dashboard showed `User-<id> SBC` for every SBC payment because the name,
 * surname and email were read from metadata nothing ever set.
 *
 *   npx ts-node src/scripts/check-cinetpay-payer.ts
 */
import { buildCinetPayPayer, toInternationalPhone } from '../utils/cinetpay-payer';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
    if (!ok) failures++;
};
const eq = (label: string, got: unknown, want: unknown) =>
    check(label, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}`);

const UID = '6a83ff8710d862e664f14fa7';

eq('real user fills every field',
    buildCinetPayPayer({ name: 'Paul Mbarga', email: 'paul@example.com', phoneNumber: '237670000000' }, UID, 'CM'),
    { client_first_name: 'Paul', client_last_name: 'Mbarga', client_email: 'paul@example.com', client_phone_number: '+237670000000' });

eq('three-word name keeps the rest as last name',
    buildCinetPayPayer({ name: '  Jean  Paul   Essomba ', email: 'j@example.com' }, UID, 'CM'),
    { client_first_name: 'Jean', client_last_name: 'Paul Essomba', client_email: 'j@example.com' });

eq('one-word name fills both',
    buildCinetPayPayer({ name: 'Rufus', email: 'r@example.com' }, UID, 'CM').client_last_name, 'Rufus');

eq('one-letter part keeps the whole real name',
    buildCinetPayPayer({ name: 'A Mbarga', email: 'a@example.com' }, UID, 'CM').client_first_name, 'A Mbarga');

eq('user not found falls back, never empty',
    buildCinetPayPayer(null, UID, 'CM'),
    { client_first_name: `User-${UID}`, client_last_name: 'SBC', client_email: 'no-email@sbc.com' });

eq('invalid email falls back', buildCinetPayPayer({ name: 'Paul Mbarga', email: 'paul@' }, UID, 'CM').client_email, 'no-email@sbc.com');

check('names capped at 255', buildCinetPayPayer({ name: `${'x'.repeat(300)} y${'z'.repeat(300)}`, email: 'a@b.co' }, UID, 'CM')
    .client_first_name.length === 255);

// Phone: `+` and 8-15 digits, and only with a dialling code we know.
eq('CM number', toInternationalPhone('237670000000'), '+237670000000');
eq('Congo keeps its 0', toInternationalPhone('242061234567'), '+242061234567');
eq('numeric phone', toInternationalPhone(22997000000), '+22997000000');
eq('already prefixed with +', toInternationalPhone('+225 07 07 00 00 00'), '+2250707000000');
eq('00 prefix', toInternationalPhone('00237670000000'), '+237670000000');
eq('legacy number without dialling code is dropped', toInternationalPhone('670000000'), undefined);
eq('too short dropped', toInternationalPhone('2376'), undefined);
eq('missing', toInternationalPhone(undefined), undefined);
check('no phone key when phone unusable',
    !('client_phone_number' in buildCinetPayPayer({ name: 'Paul Mbarga', email: 'p@example.com', phoneNumber: '670000000' }, UID, 'CM')));

check('phone from another country is not sent',
    !('client_phone_number' in buildCinetPayPayer({ name: 'Paul Mbarga', email: 'p@example.com', phoneNumber: '237670000000' }, UID, 'CI')));
eq('lowercase country still matches',
    buildCinetPayPayer({ name: 'Paul Mbarga', email: 'p@example.com', phoneNumber: '237670000000' }, UID, 'cm').client_phone_number, '+237670000000');

if (failures) {
    console.log(`\n${failures} check(s) failed`);
    process.exit(1);
}
console.log('\nAll checks passed');
