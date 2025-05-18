import logger from './logger';

const log = logger.getLogger('PhoneUtils');

// Map of country ISO codes to their international dialing codes
const countryDialingCodes: { [key: string]: string } = {
    CM: '237', BJ: '229', CG: '242', GH: '233',
    CI: '225', SN: '221', TG: '228', BF: '226',
    GN: '224', ML: '223', NE: '227', GA: '241',
    CD: '243', KE: '254',
    // Add all countries your application supports
};

/**
 * Normalizes a phone number to an international format (e.g., 237691767754).
 *
 * @param rawPhoneNumber The phone number string to normalize.
 * @param countryCodeISO The ISO 3166-1 alpha-2 country code (e.g., "CM", "BJ").
 * @returns The normalized phone number string, or null if critical info is missing or formatting fails.
 */
export function normalizePhoneNumber(rawPhoneNumber: string | undefined | null, countryCodeISO?: string | undefined | null): string | null {
    if (!rawPhoneNumber || typeof rawPhoneNumber !== 'string' || rawPhoneNumber.trim() === '') {
        log.debug('normalizePhoneNumber: Raw phone number is empty or not a string.');
        return null;
    }

    const cleanedPhone = rawPhoneNumber.replace(/\D/g, ''); // Remove all non-digit characters
    if (!cleanedPhone) {
        log.debug('normalizePhoneNumber: Cleaned phone number is empty.');
        return null;
    }

    const upperCountryCodeISO = countryCodeISO?.toUpperCase();
    const expectedDialingCode = upperCountryCodeISO ? countryDialingCodes[upperCountryCodeISO] : null;

    log.debug(`normalizePhoneNumber - Input: raw='${rawPhoneNumber}', country='${upperCountryCodeISO}', Cleaned: '${cleanedPhone}', ExpectedDialingCode: '${expectedDialingCode}'`);

    if (expectedDialingCode) {
        // Case 1: Cleaned phone number already starts with the correct dialing code.
        if (cleanedPhone.startsWith(expectedDialingCode)) {
            const doubleCode = expectedDialingCode + expectedDialingCode;
            if (cleanedPhone.startsWith(doubleCode)) {
                const finalNumber = cleanedPhone.substring(expectedDialingCode.length);
                log.debug(`normalizePhoneNumber: Removed duplicate prefix. Result: '${finalNumber}'`);
                return finalNumber;
            }
            log.debug(`normalizePhoneNumber: Already correctly prefixed. Result: '${cleanedPhone}'`);
            return cleanedPhone;
        }
        // Case 2: Cleaned phone number does NOT start with the correct dialing code.
        else {
            let nationalPart = cleanedPhone;
            for (const knownISO in countryDialingCodes) {
                const knownDialingCode = countryDialingCodes[knownISO];
                if (nationalPart.startsWith(knownDialingCode)) {
                    nationalPart = nationalPart.substring(knownDialingCode.length);
                    log.debug(`normalizePhoneNumber: Stripped other known prefix '${knownDialingCode}'. National part now: '${nationalPart}'`);
                    break;
                }
            }
            const finalNumber = expectedDialingCode + nationalPart;
            log.debug(`normalizePhoneNumber: Prepended expected prefix. Result: '${finalNumber}'`);
            return finalNumber;
        }
    } else {
        // Case 3: No country code provided or country not in map.
        for (const knownISO in countryDialingCodes) {
            const knownDialingCode = countryDialingCodes[knownISO];
            if (cleanedPhone.startsWith(knownDialingCode)) {
                log.debug(`normalizePhoneNumber: No country context, but starts with known prefix '${knownDialingCode}'. Result: '${cleanedPhone}'`);
                return cleanedPhone;
            }
        }
        log.warn(`normalizePhoneNumber: No country context and doesn't start with known prefix. Cannot reliably format. RawCleaned: '${cleanedPhone}'`);
        return null;
    }
} 