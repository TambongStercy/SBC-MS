export const momoOperatorToCountryCode: { [operatorSlug: string]: string } = {
    // Cameroon
    "MTN_MOMO_CMR": "CM",
    "ORANGE_MONEY_CMR": "CM",
    // Côte d'Ivoire
    "MTN_MOMO_CI": "CI",
    "ORANGE_MONEY_CI": "CI",
    "MOOV_MONEY_CI": "CI",
    "WAVE_CI": "CI",
    // Senegal
    "ORANGE_MONEY_SN": "SN",
    "FREE_MONEY_SN": "SN",
    "WAVE_SN": "SN",
    // Benin
    "MTN_MOMO_BJ": "BJ",
    "MOOV_MONEY_BJ": "BJ",
    // Togo
    "TOGOCOM_TOGO": "TG", // Assuming TMoney maps to this
    "MOOV_MONEY_TG": "TG",
    // Burkina Faso
    "ORANGE_MONEY_BF": "BF",
    "MOOV_MONEY_BF": "BF",
    // Add other mappings as needed
};

export const countryCodeToDialingPrefix: { [countryCode: string]: string } = {
    'BJ': '229', // Benin
    'CI': '225', // Côte d'Ivoire
    'SN': '221', // Senegal
    'CG': '242', // Congo Brazzaville
    'TG': '228', // Togo
    'CM': '237', // Cameroon
    'BF': '226', // Burkina Faso
    'GN': '224', // Guinea
    'ML': '223', // Mali
    'NE': '227', // Niger
    'GA': '241', // Gabon
    'CD': '243', // DRC
    'KE': '254', // Kenya
    // Add other mappings from your existing countryDialingCodes or CinetPay Annexes
};

export const momoOperatorToCinetpayPaymentMethod: { [operatorSlug: string]: string } = {
    "WAVE_CI": "WAVECI",
    "WAVE_SN": "WAVESN",
    // Other operators might not require a specific payment_method for CinetPay Transfer API
    // CinetPay will likely auto-detect based on the phone number's prefix and national conventions.
};

// Helper to get prefix from our operator slug
export const getPrefixFromOperator = (operatorSlug: string): string | undefined => {
    const countryCode = momoOperatorToCountryCode[operatorSlug];
    if (countryCode) {
        return countryCodeToDialingPrefix[countryCode];
    }
    return undefined;
}; 