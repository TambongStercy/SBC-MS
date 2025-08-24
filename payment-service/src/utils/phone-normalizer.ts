/**
 * Phone number normalization utility for recovery matching
 */

/**
 * Normalize phone number to different formats for comparison
 * @param phoneNumber - Phone number in various formats (+229xxxx, 229xxxx, xxxx)
 * @returns Object with different normalized formats
 */
export function normalizePhoneNumber(phoneNumber: string): {
    withPlus: string;
    withoutPlus: string;
    localOnly: string;
    countryCode?: string;
    variations: string[];
} {
    if (!phoneNumber) {
        return {
            withPlus: '',
            withoutPlus: '',
            localOnly: '',
            variations: []
        };
    }

    // Clean the phone number (remove spaces, dashes, etc.)
    const cleaned = phoneNumber.replace(/[\s\-\(\)\.]/g, '');
    
    let withPlus = cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
    let withoutPlus = cleaned.replace(/^\+/, '');
    let countryCode: string | undefined;
    let localOnly = '';

    // Extract country code and local number for common African countries
    const countryCodePatterns = [
        { code: '229', length: 8 }, // Benin
        { code: '228', length: 8 }, // Togo  
        { code: '225', length: 8 }, // Ivory Coast
        { code: '226', length: 8 }, // Burkina Faso
        { code: '233', length: 9 }, // Ghana
        { code: '234', length: 10 }, // Nigeria
        { code: '237', length: 9 }, // Cameroon
    ];

    // Try to extract country code and local number
    for (const pattern of countryCodePatterns) {
        if (withoutPlus.startsWith(pattern.code) && 
            withoutPlus.length === (pattern.code.length + pattern.length)) {
            countryCode = pattern.code;
            localOnly = withoutPlus.substring(pattern.code.length);
            break;
        }
    }

    // If no country code detected, treat as local number
    if (!countryCode) {
        localOnly = withoutPlus;
    }

    // Generate all possible variations for matching
    const variations: string[] = [
        withPlus,
        withoutPlus,
        localOnly
    ];

    // Add leading zeros variations for local numbers
    if (localOnly && !localOnly.startsWith('0')) {
        variations.push(`0${localOnly}`);
    }

    // Remove duplicates and empty strings
    const uniqueVariations = [...new Set(variations)].filter(v => v && v.length > 0);

    return {
        withPlus,
        withoutPlus,
        localOnly,
        countryCode,
        variations: uniqueVariations
    };
}

/**
 * Check if two phone numbers match (considering different formats)
 * @param phone1 - First phone number
 * @param phone2 - Second phone number
 * @returns True if they match in any format
 */
export function phoneNumbersMatch(phone1: string, phone2: string): boolean {
    if (!phone1 || !phone2) return false;

    const normalized1 = normalizePhoneNumber(phone1);
    const normalized2 = normalizePhoneNumber(phone2);

    // Check if any variation of phone1 matches any variation of phone2
    for (const variation1 of normalized1.variations) {
        for (const variation2 of normalized2.variations) {
            if (variation1 === variation2) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Generate MongoDB query conditions for phone number matching
 * @param phoneNumber - Phone number to search for
 * @returns MongoDB query conditions
 */
export function generatePhoneMatchQuery(phoneNumber: string): any[] {
    const normalized = normalizePhoneNumber(phoneNumber);
    const conditions: any[] = [];

    // Match against userPhoneNumber field
    normalized.variations.forEach(variation => {
        conditions.push({ userPhoneNumber: variation });
    });

    // Match against nested provider data
    normalized.variations.forEach(variation => {
        conditions.push({ 'providerTransactionData.phoneNumber': variation });
        conditions.push({ 'providerTransactionData.normalizedPhone': variation });
    });

    return conditions;
}