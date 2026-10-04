/**
 * Mobile-money operators per country, exactly as the member app saves them
 * (SBC-WEB-UI src/utils/countriesData.ts) — payouts are routed on these codes,
 * so an admin edit must store the same values.
 */
export const OPERATORS_BY_COUNTRY: Record<string, string[]> = {
    BJ: ['MTN_MOMO_BEN', 'MOOV_BEN'],
    CM: ['MTN_MOMO_CMR', 'ORANGE_CMR'],
    BF: ['MOOV_BFA', 'ORANGE_BFA'],
    CD: ['VODACOM_MPESA_COD', 'AIRTEL_COD', 'ORANGE_COD'],
    KE: ['MPESA_KEN'],
    NG: ['MTN_MOMO_NGA', 'AIRTEL_NGA'],
    SN: ['FREE_SEN', 'ORANGE_SEN', 'WAVE_SEN'],
    CG: ['AIRTEL_COG', 'MTN_MOMO_COG'],
    GA: ['AIRTEL_GAB'],
    CI: ['MTN_MOMO_CIV', 'ORANGE_CIV', 'WAVE_CIV'],
    ML: ['ORANGE_MLI', 'MOOV_MLI'],
    NE: ['ORANGE_NER', 'MOOV_NER'],
    GH: ['MTN_MOMO_GHA', 'VODAFONE_GHA'],
    TG: ['TOGOCOM_TG', 'MOOV_TG'],
};

export const OPERATOR_NAME: Record<string, string> = {
    MTN_MOMO_BEN: 'MTN MoMo Bénin', MOOV_BEN: 'Moov Bénin',
    MTN_MOMO_CMR: 'MTN MoMo Cameroun', ORANGE_CMR: 'Orange Money Cameroun',
    MOOV_BFA: 'Moov Burkina Faso', ORANGE_BFA: 'Orange Burkina Faso',
    VODACOM_MPESA_COD: 'Vodacom M-Pesa RDC', AIRTEL_COD: 'Airtel RDC', ORANGE_COD: 'Orange RDC',
    MPESA_KEN: 'M-Pesa Kenya',
    MTN_MOMO_NGA: 'MTN MoMo Nigeria', AIRTEL_NGA: 'Airtel Nigeria',
    FREE_SEN: 'Free Money Sénégal', ORANGE_SEN: 'Orange Money Sénégal', WAVE_SEN: 'Wave Sénégal',
    AIRTEL_COG: 'Airtel Congo', MTN_MOMO_COG: 'MTN MoMo Congo',
    AIRTEL_GAB: 'Airtel Gabon',
    MTN_MOMO_CIV: 'MTN MoMo Côte d’Ivoire', ORANGE_CIV: 'Orange Money Côte d’Ivoire', WAVE_CIV: 'Wave Côte d’Ivoire',
    ORANGE_MLI: 'Orange Money Mali', MOOV_MLI: 'Moov Mali',
    ORANGE_NER: 'Orange Money Niger', MOOV_NER: 'Moov Niger',
    MTN_MOMO_GHA: 'MTN MoMo Ghana', VODAFONE_GHA: 'Vodafone Ghana',
    TOGOCOM_TG: 'Togocom', MOOV_TG: 'Moov Togo',
};

export const countryOfOperator = (op?: string | null) =>
    op ? Object.entries(OPERATORS_BY_COUNTRY).find(([, ops]) => ops.includes(op))?.[0] : undefined;
