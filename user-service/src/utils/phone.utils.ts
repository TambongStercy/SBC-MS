import logger from './logger';

const log = logger.getLogger('PhoneUtils');

// Map of country ISO codes to their international dialing codes
// All 54 African countries
export const countryDialingCodes: { [key: string]: string } = {
    // North Africa
    DZ: '213', // Algeria
    EG: '20',  // Egypt
    LY: '218', // Libya
    MA: '212', // Morocco
    SD: '249', // Sudan
    TN: '216', // Tunisia
    SS: '211', // South Sudan
    
    // West Africa
    BJ: '229', // Benin
    BF: '226', // Burkina Faso
    CV: '238', // Cape Verde
    CI: '225', // Côte d'Ivoire
    GM: '220', // Gambia
    GH: '233', // Ghana
    GN: '224', // Guinea
    GW: '245', // Guinea-Bissau
    LR: '231', // Liberia
    ML: '223', // Mali
    MR: '222', // Mauritania
    NE: '227', // Niger
    NG: '234', // Nigeria
    SN: '221', // Senegal
    SL: '232', // Sierra Leone
    TG: '228', // Togo
    
    // Central Africa
    AO: '244', // Angola
    CM: '237', // Cameroon
    CF: '236', // Central African Republic
    TD: '235', // Chad
    CG: '242', // Congo (Republic)
    CD: '243', // Congo (Democratic Republic)
    GQ: '240', // Equatorial Guinea
    GA: '241', // Gabon
    ST: '239', // São Tomé and Príncipe
    
    // East Africa
    BI: '257', // Burundi
    KM: '269', // Comoros
    DJ: '253', // Djibouti
    ER: '291', // Eritrea
    ET: '251', // Ethiopia
    KE: '254', // Kenya
    MG: '261', // Madagascar
    MW: '265', // Malawi
    MU: '230', // Mauritius
    MZ: '258', // Mozambique
    RW: '250', // Rwanda
    SC: '248', // Seychelles
    SO: '252', // Somalia
    TZ: '255', // Tanzania
    UG: '256', // Uganda
    
    // Southern Africa
    BW: '267', // Botswana
    SZ: '268', // Eswatini (Swaziland)
    LS: '266', // Lesotho
    NA: '264', // Namibia
    ZA: '27',  // South Africa
    ZM: '260', // Zambia
    ZW: '263', // Zimbabwe
};

// Country name variations mapping to ISO codes
const countryNameVariations: { [key: string]: string } = {
    // North Africa
    'algeria': 'DZ', 'algérie': 'DZ', 'algerian': 'DZ', 'algérien': 'DZ',
    'democratic and popular republic of algeria': 'DZ',
    
    'egypt': 'EG', 'égypte': 'EG', 'egyptian': 'EG', 'égyptien': 'EG',
    'arab republic of egypt': 'EG', 'united arab republic': 'EG',
    
    'libya': 'LY', 'libye': 'LY', 'libyan': 'LY', 'libyen': 'LY',
    'state of libya': 'LY', 'great socialist people\'s libyan arab jamahiriya': 'LY',
    
    'morocco': 'MA', 'maroc': 'MA', 'moroccan': 'MA', 'marocain': 'MA',
    'kingdom of morocco': 'MA', 'royaume du maroc': 'MA',
    
    'sudan': 'SD', 'soudan': 'SD', 'sudanese': 'SD', 'soudanais': 'SD',
    'republic of sudan': 'SD', 'république du soudan': 'SD',
    
    'tunisia': 'TN', 'tunisie': 'TN', 'tunisian': 'TN', 'tunisien': 'TN',
    'republic of tunisia': 'TN', 'république tunisienne': 'TN',
    
    'south sudan': 'SS', 'soudan du sud': 'SS', 'south sudanese': 'SS',
    'republic of south sudan': 'SS',

    // West Africa
    'benin': 'BJ', 'bénin': 'BJ', 'béninoise': 'BJ', 'beninoise': 'BJ',
    'republic of benin': 'BJ', 'république du bénin': 'BJ',
    
    'burkina faso': 'BF', 'burkina': 'BF', 'burkina-faso': 'BF', 'burkinabe': 'BF',
    'burkinafaso': 'BF', 'burkina_faso': 'BF', 'upper volta': 'BF',
    
    'cape verde': 'CV', 'cap-vert': 'CV', 'cabo verde': 'CV', 'cape verdean': 'CV',
    'republic of cape verde': 'CV',
    
    'cote divoire': 'CI', "cote d'ivoire": 'CI', "côte d'ivoire": 'CI', 'ivory coast': 'CI',
    'cote-d\'ivoire': 'CI', 'cote-divoire': 'CI', 'cotedivoire': 'CI', 'ivorian': 'CI',
    'republic of côte d\'ivoire': 'CI',
    
    'gambia': 'GM', 'gambie': 'GM', 'gambian': 'GM', 'gambien': 'GM',
    'republic of the gambia': 'GM',
    
    'ghana': 'GH', 'ghanaian': 'GH', 'gold coast': 'GH',
    'republic of ghana': 'GH',
    
    'guinea': 'GN', 'guinée': 'GN', 'guinea conakry': 'GN', 'guinée-conakry': 'GN',
    'republic of guinea': 'GN', 'republique de guinee': 'GN',
    
    'guinea bissau': 'GW', 'guinea-bissau': 'GW', 'guiné-bissau': 'GW',
    'republic of guinea-bissau': 'GW',
    
    'liberia': 'LR', 'libéria': 'LR', 'liberian': 'LR', 'libérien': 'LR',
    'republic of liberia': 'LR',
    
    'mali': 'ML', 'malian': 'ML', 'republic of mali': 'ML', 'republique du mali': 'ML',
    
    'mauritania': 'MR', 'mauritanie': 'MR', 'mauritanian': 'MR', 'mauritanien': 'MR',
    'islamic republic of mauritania': 'MR',
    
    'niger': 'NE', 'nigerien': 'NE', 'republic of niger': 'NE', 'republique du niger': 'NE',
    
    'nigeria': 'NG', 'nigéria': 'NG', 'nigerian': 'NG', 'nigérian': 'NG',
    'federal republic of nigeria': 'NG',
    
    'senegal': 'SN', 'sénégal': 'SN', 'senegalese': 'SN', 'sénégalais': 'SN',
    'republic of senegal': 'SN',
    
    'sierra leone': 'SL', 'sierra léone': 'SL', 'sierra leonean': 'SL',
    'republic of sierra leone': 'SL',
    
    'togo': 'TG', 'togolese': 'TG', 'togolais': 'TG', 'republic of togo': 'TG',
    'republique togolaise': 'TG',

    // Central Africa
    'angola': 'AO', 'angolan': 'AO', 'angolais': 'AO',
    'republic of angola': 'AO',
    
    'cameroon': 'CM', 'cameroun': 'CM', 'camerun': 'CM', 'kamerun': 'CM',
    'republic of cameroon': 'CM',
    
    'central african republic': 'CF', 'republique centrafricaine': 'CF',
    'central african empire': 'CF', 'car': 'CF',
    
    'chad': 'TD', 'tchad': 'TD', 'chadian': 'TD', 'tchadien': 'TD',
    'republic of chad': 'TD',
    
    'republic of congo': 'CG', 'congo brazzaville': 'CG', 'congo': 'CG', 'congo-brazzaville': 'CG',
    'republique du congo': 'CG', 'congo republic': 'CG',
    
    'democratic republic of congo': 'CD', 'dr congo': 'CD', 'drc': 'CD', 'congo kinshasa': 'CD',
    'zaire': 'CD', 'congo-kinshasa': 'CD', 'rdc': 'CD', 'republique democratique du congo': 'CD',
    
    'equatorial guinea': 'GQ', 'guinée équatoriale': 'GQ', 'guinea ecuatorial': 'GQ',
    'republic of equatorial guinea': 'GQ',
    
    'gabon': 'GA', 'gabonese': 'GA', 'gabonais': 'GA', 'republic of gabon': 'GA',
    'republique gabonaise': 'GA',
    
    'sao tome and principe': 'ST', 'são tomé and príncipe': 'ST', 'sao tome': 'ST',
    'democratic republic of são tomé and príncipe': 'ST',

    // East Africa
    'burundi': 'BI', 'burundian': 'BI', 'burundais': 'BI',
    'republic of burundi': 'BI',
    
    'comoros': 'KM', 'comores': 'KM', 'comorian': 'KM', 'comorien': 'KM',
    'union of the comoros': 'KM',
    
    'djibouti': 'DJ', 'djiboutian': 'DJ', 'djiboutien': 'DJ',
    'republic of djibouti': 'DJ',
    
    'eritrea': 'ER', 'érythrée': 'ER', 'eritrean': 'ER', 'érythréen': 'ER',
    'state of eritrea': 'ER',
    
    'ethiopia': 'ET', 'éthiopie': 'ET', 'ethiopian': 'ET', 'éthiopien': 'ET',
    'federal democratic republic of ethiopia': 'ET',
    
    'kenya': 'KE', 'kenyan': 'KE', 'republic of kenya': 'KE',
    
    'madagascar': 'MG', 'malagasy': 'MG', 'malgache': 'MG',
    'republic of madagascar': 'MG',
    
    'malawi': 'MW', 'malawian': 'MW', 'malawien': 'MW',
    'republic of malawi': 'MW',
    
    'mauritius': 'MU', 'maurice': 'MU', 'mauritian': 'MU', 'mauricien': 'MU',
    'republic of mauritius': 'MU',
    
    'mozambique': 'MZ', 'mozambican': 'MZ', 'mozambicain': 'MZ',
    'republic of mozambique': 'MZ',
    
    'rwanda': 'RW', 'rwandan': 'RW', 'rwandais': 'RW',
    'republic of rwanda': 'RW',
    
    'seychelles': 'SC', 'seychellois': 'SC',
    'republic of seychelles': 'SC',
    
    'somalia': 'SO', 'somalie': 'SO', 'somali': 'SO', 'somalien': 'SO',
    'federal republic of somalia': 'SO',
    
    'tanzania': 'TZ', 'tanzanie': 'TZ', 'tanzanian': 'TZ', 'tanzanien': 'TZ',
    'united republic of tanzania': 'TZ',
    
    'uganda': 'UG', 'ouganda': 'UG', 'ugandan': 'UG', 'ougandais': 'UG',
    'republic of uganda': 'UG',

    // Southern Africa
    'botswana': 'BW', 'batswana': 'BW', 'republic of botswana': 'BW',
    
    'eswatini': 'SZ', 'swaziland': 'SZ', 'swazi': 'SZ',
    'kingdom of eswatini': 'SZ', 'kingdom of swaziland': 'SZ',
    
    'lesotho': 'LS', 'basotho': 'LS', 'kingdom of lesotho': 'LS',
    
    'namibia': 'NA', 'namibie': 'NA', 'namibian': 'NA', 'namibien': 'NA',
    'republic of namibia': 'NA',
    
    'south africa': 'ZA', 'afrique du sud': 'ZA', 'south african': 'ZA',
    'republic of south africa': 'ZA',
    
    'zambia': 'ZM', 'zambie': 'ZM', 'zambian': 'ZM', 'zambien': 'ZM',
    'republic of zambia': 'ZM',
    
    'zimbabwe': 'ZW', 'zimbabwean': 'ZW', 'zimbabwéen': 'ZW',
    'republic of zimbabwe': 'ZW', 'rhodesia': 'ZW',
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

/**
 * Normalizes country name to ISO code for registration/profile updates
 * @param countryInput - User's country input (could be name or code)
 * @returns Normalized ISO country code or original input if no match
 */
export function normalizeCountryName(countryInput?: string): string {
    if (!countryInput || typeof countryInput !== 'string') {
        return countryInput || '';
    }

    const normalized = countryInput.toLowerCase().trim();

    // Check if it's already a valid ISO code (uppercase)
    if (countryDialingCodes[countryInput.toUpperCase()]) {
        return countryInput.toUpperCase();
    }

    // Check country name variations  
    if (countryNameVariations[normalized]) {
        return countryNameVariations[normalized];
    }

    // Return original input if no match found
    return countryInput;
} 