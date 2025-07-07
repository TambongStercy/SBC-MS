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

// Country name variations mapping to ISO codes
const countryNameVariations: { [key: string]: string } = {
    // Cameroon variations
    'cameroon': 'CM', 'cameroun': 'CM', 'camerun': 'CM', 'kamerun': 'CM',

    // Other common variations
    'benin': 'BJ', 'bénin': 'BJ',
    'cote divoire': 'CI', "cote d'ivoire": 'CI', "côte d'ivoire": 'CI', 'ivory coast': 'CI',
    'democratic republic of congo': 'CD', 'dr congo': 'CD', 'drc': 'CD', 'congo kinshasa': 'CD', 'zaire': 'CD',
    'republic of congo': 'CG', 'congo brazzaville': 'CG', 'congo': 'CG',
    'senegal': 'SN', 'sénégal': 'SN',
    'burkina faso': 'BF', 'burkina': 'BF',
    'ghana': 'GH',
    'nigeria': 'NG', 'nigéria': 'NG',
    'kenya': 'KE',
    'guinea': 'GN', 'guinée': 'GN',
    'mali': 'ML',
    'niger': 'NE',
    'gabon': 'GA',
    'togo': 'TG',
};

// Reverse mapping: dialing code to country ISO
const dialingCodeToCountry: { [key: string]: string } = {};
Object.entries(countryDialingCodes).forEach(([iso, code]) => {
    dialingCodeToCountry[code] = iso;
});

/**
 * Determines the user's country code from country field or phone number
 * @param country - User's country field (could be name or code)
 * @param phoneNumber - User's phone number
 * @returns ISO country code (e.g., 'CM') or 'Autres' if undetermined
 */
export function determineUserCountryCode(country?: string, phoneNumber?: string | number): string {
    // 1. Try to normalize country field first
    if (country && typeof country === 'string') {
        const normalizedCountry = country.toLowerCase().trim();

        // Check if it's already a valid ISO code
        if (countryDialingCodes[normalizedCountry.toUpperCase()]) {
            return normalizedCountry.toUpperCase();
        }

        // Check country name variations
        if (countryNameVariations[normalizedCountry]) {
            return countryNameVariations[normalizedCountry];
        }
    }

    // 2. Try to extract from phone number
    if (phoneNumber) {
        const phoneStr = phoneNumber.toString().replace(/\D/g, ''); // Remove non-digits

        // Check each dialing code (longer codes first to avoid partial matches)
        const sortedCodes = Object.keys(dialingCodeToCountry).sort((a, b) => b.length - a.length);

        for (const code of sortedCodes) {
            if (phoneStr.startsWith(code)) {
                return dialingCodeToCountry[code];
            }
        }
    }

    // 3. Default fallback
    return 'Autres';
}

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