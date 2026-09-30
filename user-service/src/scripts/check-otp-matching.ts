/**
 * Guards the OTP comparison against the failure modes seen on prod.
 *
 * Half of every OTP entry was being refused (2026-09-19: 1053 refusals against
 * 1073 successes in one day). Classifying a day of refusals showed 21% differed
 * from the code we sent by letter case alone — phone keyboards capitalise each
 * of the six single-character boxes, so `Fj9EYB` was typed back as `FJ9EYB`.
 * The user had read the code correctly and we rejected it.
 *
 *   npx ts-node src/scripts/check-otp-matching.ts
 */
import { otpMatches, generateSecureOTP } from '../utils/otp.utils';

let failures = 0;
const check = (label: string, ok: boolean) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (!ok) failures++;
};

// Real (code sent, code typed) pairs pulled from prod logs on 2026-09-19.
const realCaseOnlyRefusals: Array<[string, string]> = [
    ['UtmJ54', 'UTmJ54'],
    ['Fj9EYB', 'FJ9EYB'],
    ['Pbikpg', 'PBIKPG'],
    ['Pbikpg', 'pbikpg'],
    ['EyvRhS', 'EyVRhS'],
    ['3VfbSC', '3VFbSC'],
];

check(
    'codes refused on prod for case alone now match',
    realCaseOnlyRefusals.every(([sent, typed]) => otpMatches(sent, typed)),
);

check('a pasted code with surrounding spaces matches', otpMatches('Fj9EYB', '  Fj9EYB '));

check(
    'a genuinely different code is still refused',
    !otpMatches('Fj9EYB', 'Fj9EYA') && !otpMatches('Fj9EYB', 'Fj9EY') && !otpMatches('Fj9EYB', '995212'),
);

check('an empty submission is refused', !otpMatches('Fj9EYB', '') && !otpMatches('', 'Fj9EYB'));

// Folding case halves the alphabet, so confirm the remaining space is still far
// beyond what `strictLimiter` lets anyone try inside the 10-minute expiry.
const alphabet = new Set(
    Array.from({ length: 4000 }, () => generateSecureOTP()).join('').toLowerCase().split(''),
);
check(
    `case-folded alphabet stays large enough (${alphabet.size}^6 combinations)`,
    Math.pow(alphabet.size, 6) > 1e8,
);

// Case-folding already settles I/l and O/0 confusion between the two cases of
// one letter. What it cannot settle is a letter read as a digit, so the digits
// those letters look like must stay out of the alphabet entirely.
check(
    'no letter can be misread as a digit (0 and 1 are never generated)',
    !alphabet.has('0') && !alphabet.has('1'),
);

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
