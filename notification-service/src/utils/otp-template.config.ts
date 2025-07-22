/**
 * Language-specific template mapping for WhatsApp OTP
 */
export const OTP_TEMPLATE_CONFIG = {
    en_US: {
        templateName: 'connexion',
        languageCode: 'en_US'
    },
    fr: {
        templateName: 'connexionfr',
        languageCode: 'fr'
    },
    en: {
        templateName: 'connexion',
        languageCode: 'en_US'
    }
} as const;

/**
 * Language conversion mapping from simple codes to available template languages
 * Maps basic language codes (en, fr, es, etc.) to supported template language codes
 */
export const LANGUAGE_CONVERSION_MAP: Record<string, keyof typeof OTP_TEMPLATE_CONFIG> = {
    // English variants
    'en': 'en_US',
    'eng': 'en_US',
    'english': 'en_US',
    'en_GB': 'en_US',
    'en_CA': 'en_US',
    'en_AU': 'en_US',

    // French variants
    'fr': 'fr',
    'fra': 'fr',
    'french': 'fr',
    'fr_FR': 'fr',
    'fr_CA': 'fr',
    'fr_BE': 'fr',
    'fr_CH': 'fr',

    // Spanish (fallback to English since no Spanish template exists)
    'es': 'en_US',
    'esp': 'en_US',
    'spanish': 'en_US',
    'es_ES': 'en_US',
    'es_MX': 'en_US',
    'es_AR': 'en_US',

    // German (fallback to English)
    'de': 'en_US',
    'ger': 'en_US',
    'german': 'en_US',
    'de_DE': 'en_US',

    // Italian (fallback to English)
    'it': 'en_US',
    'ita': 'en_US',
    'italian': 'en_US',
    'it_IT': 'en_US',

    // Portuguese (fallback to English)
    'pt': 'en_US',
    'por': 'en_US',
    'portuguese': 'en_US',
    'pt_PT': 'en_US',
    'pt_BR': 'en_US',

    // Arabic (fallback to English)
    'ar': 'en_US',
    'ara': 'en_US',
    'arabic': 'en_US',
    'ar_SA': 'en_US',
    'ar_EG': 'en_US',
} as const;

export type SupportedLanguage = keyof typeof OTP_TEMPLATE_CONFIG;

/**
 * Converts any language code to a supported template language
 * @param inputLanguage The input language code (can be simple like 'en' or full like 'en_US')
 * @returns A supported language code from OTP_TEMPLATE_CONFIG
 */
export function convertLanguageCode(inputLanguage?: string): SupportedLanguage {
    if (!inputLanguage) {
        return 'en_US'; // Default fallback
    }

    // Normalize the input (lowercase, trim)
    const normalizedInput = inputLanguage.toLowerCase().trim();

    // First, check if it's already a supported language
    if (normalizedInput in OTP_TEMPLATE_CONFIG) {
        return normalizedInput as SupportedLanguage;
    }

    // Then, check the conversion map
    if (normalizedInput in LANGUAGE_CONVERSION_MAP) {
        return LANGUAGE_CONVERSION_MAP[normalizedInput];
    }

    // Extract just the language part if it's a locale (e.g., 'en-US' -> 'en')
    const languagePart = normalizedInput.split(/[-_]/)[0];
    if (languagePart in LANGUAGE_CONVERSION_MAP) {
        return LANGUAGE_CONVERSION_MAP[languagePart];
    }

    // Final fallback to English
    return 'en_US';
}

/**
 * Gets the appropriate WhatsApp template configuration for a given language
 * @param language The language code (will be converted if needed, defaults to 'en_US')
 * @returns Template configuration object
 */
export function getOtpTemplateConfig(language?: string) {
    const supportedLanguage = convertLanguageCode(language);
    return OTP_TEMPLATE_CONFIG[supportedLanguage];
} 