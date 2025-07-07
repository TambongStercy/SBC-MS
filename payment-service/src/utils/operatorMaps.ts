// Mapping from our internal momoOperator slugs to standard ISO 3166-1 alpha-2 country codes
export const momoOperatorToCountryCode: { [key: string]: string } = {
    // Benin (BJ)
    'MTN_MOMO_BEN': 'BJ',
    'MOOV_BEN': 'BJ',
    // Cameroon (CM)
    'MTN_MOMO_CMR': 'CM',
    'ORANGE_CMR': 'CM',
    'ORANGE_MOMO_CMR': 'CM',
    // Burkina Faso (BF)
    'MOOV_BFA': 'BF',
    'ORANGE_BFA': 'BF',
    // Togo (TG) - Added for CinetPay support
    'TOGOCOM_TGO': 'TG',
    'MOOV_TGO': 'TG',
    // Togo (TG) - Added for FeexPay support (alternative naming)
    'TOGOCOM_TG': 'TG',
    'MOOV_TG': 'TG',
    // Mali (ML) - Added for CinetPay support
    'ORANGE_MLI': 'ML',
    'MOOV_MLI': 'ML',
    // Niger (NE) - Added for CinetPay support
    'ORANGE_NER': 'NE',
    'MOOV_NER': 'NE',
    // DRC (CD)
    'VODACOM_MPESA_COD': 'CD',
    'AIRTEL_COD': 'CD',
    'ORANGE_COD': 'CD',
    // Kenya (KE)
    'MPESA_KEN': 'KE',
    // Nigeria (NG)
    'MTN_MOMO_NGA': 'NG',
    'AIRTEL_NGA': 'NG',
    // Senegal (SN)
    'FREE_SEN': 'SN',
    'ORANGE_SEN': 'SN',
    // Republic of the Congo (CG)
    'AIRTEL_COG': 'CG',
    'MTN_MOMO_COG': 'CG',
    // Gabon (GA)
    'AIRTEL_GAB': 'GA',
    // Côte d'Ivoire (CI)
    'MTN_MOMO_CIV': 'CI',
    'ORANGE_CIV': 'CI',
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


// Helper to get prefix from our operator slug
export const getPrefixFromOperator = (operatorSlug: string): string | undefined => {
    const countryCode = momoOperatorToCountryCode[operatorSlug];
    if (countryCode) {
        return countryCodeToDialingPrefix[countryCode];
    }
    return undefined;
};


export const correspondents = {
    'BJ': {
        'operators': ['MTN_MOMO_BEN', 'MOOV_BEN'], // Benin
        'currencies': ['XOF']
    },
    'CM': {
        'operators': ['MTN_MOMO_CMR', 'ORANGE_CMR', 'ORANGE_MOMO_CMR'], // Cameroon
        'currencies': ['XAF']
    },
    'BF': {
        'operators': ['MOOV_BFA', 'ORANGE_BFA'], // Burkina Faso
        'currencies': ['XOF']
    },
    'TG': {
        'operators': ['TOGOCOM_TGO', 'MOOV_TGO', 'TOGOCOM_TG', 'MOOV_TG'], // Togo (support both naming conventions)
        'currencies': ['XOF']
    },
    'ML': {
        'operators': ['ORANGE_MLI', 'MOOV_MLI'], // Mali
        'currencies': ['XOF']
    },
    'NE': {
        'operators': ['ORANGE_NER', 'MOOV_NER'], // Niger
        'currencies': ['XOF']
    },
    'CD': {
        'operators': ['VODACOM_MPESA_COD', 'AIRTEL_COD', 'ORANGE_COD'], // DRC
        'currencies': ['CDF']
    },
    'KE': {
        'operators': ['MPESA_KEN'], // Kenya
        'currencies': ['KES']
    },
    'NG': {
        'operators': ['MTN_MOMO_NGA', 'AIRTEL_NGA'], // Nigeria
        'currencies': ['NGN']
    },
    'SN': {
        'operators': ['FREE_SEN', 'ORANGE_SEN'], // Senegal
        'currencies': ['XOF']
    },
    'CG': {
        'operators': ['AIRTEL_COG', 'MTN_MOMO_COG'], // Republic of the Congo
        'currencies': ['XAF']
    },
    'GA': {
        'operators': ['AIRTEL_GAB'], // Gabon
        'currencies': ['XAF']
    },
    'CI': {
        'operators': ['MTN_MOMO_CIV', 'ORANGE_CIV'], // Côte d'Ivoire
        'currencies': ['XOF']
    },
};

// NEW: Mapping from our internal momoOperator slugs to their corresponding currency
export const momoOperatorToCurrency: { [key: string]: string } = {
    'MTN_MOMO_BEN': 'XOF',
    'MOOV_BEN': 'XOF',
    'MTN_MOMO_CMR': 'XAF',
    'ORANGE_CMR': 'XAF',
    'ORANGE_MOMO_CMR': 'XAF',
    'MOOV_BFA': 'XOF',
    'ORANGE_BFA': 'XOF',
    // Togo (TG) - XOF
    'TOGOCOM_TGO': 'XOF',
    'MOOV_TGO': 'XOF',
    // Togo (TG) - XOF (alternative naming for FeexPay)
    'TOGOCOM_TG': 'XOF',
    'MOOV_TG': 'XOF',
    // Mali (ML) - XOF
    'ORANGE_MLI': 'XOF',
    'MOOV_MLI': 'XOF',
    // Niger (NE) - XOF
    'ORANGE_NER': 'XOF',
    'MOOV_NER': 'XOF',
    'VODACOM_MPESA_COD': 'CDF',
    'AIRTEL_COD': 'CDF',
    'ORANGE_COD': 'CDF',
    'MPESA_KEN': 'KES',
    'MTN_MOMO_NGA': 'NGN',
    'AIRTEL_NGA': 'NGN',
    'FREE_SEN': 'XOF',
    'ORANGE_SEN': 'XOF',
    'AIRTEL_COG': 'XAF',
    'MTN_MOMO_COG': 'XAF',
    'AIRTEL_GAB': 'XAF',
    'MTN_MOMO_CIV': 'XOF',
    'ORANGE_CIV': 'XOF',
};

// Mapping from our internal momoOperator slugs to CinetPay's specific payment_method slugs
// Refer to CinetPay's "Liste des indicatifs par pays" for exact `Payment_method` values.
export const momoOperatorToCinetpayPaymentMethod: { [key: string]: string } = {
    // Benin (BJ)
    'MTN_MOMO_BEN': 'MTNBJ',
    'MOOV_BEN': 'MOOVBJ',
    // Cameroon (CM)
    'MTN_MOMO_CMR': 'MTNCM',
    'ORANGE_CMR': 'OMCM',
    'ORANGE_MOMO_CMR': 'OMCM',
    // Burkina Faso (BF)
    'MOOV_BFA': 'MOOVBF',
    'ORANGE_BFA': 'OMBF',
    // Togo (TG) - Added for CinetPay support
    'TOGOCOM_TGO': 'TOGOCOM',
    'MOOV_TGO': 'MOOVTG',
    // Togo (TG) - Alternative naming for FeexPay (maps to same CinetPay methods)
    'TOGOCOM_TG': 'TOGOCOM',
    'MOOV_TG': 'MOOVTG',
    // Mali (ML) - Added for CinetPay support
    'ORANGE_MLI': 'OMML',
    'MOOV_MLI': 'MOOVML',
    // Niger (NE) - Added for CinetPay support
    'ORANGE_NER': 'OMNE',
    'MOOV_NER': 'MOOVNE',
    // DRC (CD) - assuming CDF currency for these as per docs
    'VODACOM_MPESA_COD': 'MPESACD',
    'AIRTEL_COD': 'AIRTELCD',
    'ORANGE_COD': 'OMCD',
    // Senegal (SN)
    'FREE_SEN': 'FREESN',
    'ORANGE_SEN': 'OMSN',
    // Côte d'Ivoire (CI)
    'MTN_MOMO_CIV': 'MOMO', // CinetPay uses 'MOMO' for MTN in CI
    'ORANGE_CIV': 'OM',     // CinetPay uses 'OM' for Orange in CI
    // Note: Wave CI and other specific operators from CinetPay docs are not in your `correspondents` list,
    // so not mapping them here unless they appear in your user profiles.

    // Operators for which CinetPay payout methods are not explicitly listed in provided docs
    // or are not yet supported for payout via CinetPay API:
    // 'MPESA_KEN': undefined, // Kenya (KE)
    // 'MTN_MOMO_NGA': undefined, // Nigeria (NG)
    // 'AIRTEL_NGA': undefined, // Nigeria (NG)
    // 'AIRTEL_COG': undefined, // Congo Brazzaville (CG)
    // 'MTN_MOMO_COG': undefined, // Congo Brazzaville (CG)
    // 'AIRTEL_GAB': undefined, // Gabon (GA)
};

