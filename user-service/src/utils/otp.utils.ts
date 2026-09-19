import crypto from 'crypto';
import logger from './logger';

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

export type SupportedLanguage = keyof typeof OTP_TEMPLATE_CONFIG;

/**
 * Gets the appropriate WhatsApp template configuration for a given language
 * @param language The language code (defaults to 'en_US')
 * @returns Template configuration object
 */
export function getOtpTemplateConfig(language: SupportedLanguage = 'en_US') {
    return OTP_TEMPLATE_CONFIG[language] || OTP_TEMPLATE_CONFIG.en_US;
}

/**
 * Generates a secure random OTP.
 * @param length The desired length of the OTP (default: 6).
 * @returns A string containing the generated OTP.
 */
export function generateSecureOTP(length = 6): string {
    // Define characters to use (alphanumeric excluding similar-looking: I, l, 1, O, 0)
    const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghijkmnopqrstuvwxyz';
    let result = '';

    try {
        // Use Node.js crypto module for better randomness
        const randomBytes = crypto.randomBytes(length);
        for (let i = 0; i < length; i++) {
            result += characters[randomBytes[i] % characters.length];
        }
    } catch (error) {
        logger.error("Error generating random bytes for OTP", error);
        // Fallback to less secure Math.random() in case of crypto error
        logger.warn("Falling back to Math.random() for OTP generation");
        for (let i = 0; i < length; i++) {
            result += characters.charAt(Math.floor(Math.random() * characters.length));
        }
    }

    return result;
}

/**
 * Calculates the expiration date for an OTP.
 * @param minutesToExpire The number of minutes until the OTP expires (default: 10).
 * @returns A Date object representing the expiration time.
 */
export function getOtpExpiration(minutesToExpire = 10): Date {
    return new Date(Date.now() + minutesToExpire * 60000);
}

/**
 * Compares a stored OTP against what the user typed.
 *
 * Deliberately case-insensitive: codes are mixed-case (`Fj9EYB`) and phone
 * keyboards capitalise the first letter of a field by default, so a user who
 * read the code correctly still got rejected. Measured on prod 2026-09-19 —
 * of 923 refusals in one day, 192 (21%) differed from the code we sent by
 * case alone. `strictLimiter` on the verify routes bounds brute force, so
 * folding case costs nothing that matters.
 *
 * Whitespace is trimmed too: copy-pasting from the email drags a space along.
 */
export function otpMatches(storedCode: string, providedCode: string): boolean {
    if (!storedCode || !providedCode) return false;
    return storedCode.trim().toLowerCase() === providedCode.trim().toLowerCase();
} 