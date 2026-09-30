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
/*
 * How often one account may be sent a sign-in code.
 *
 * Measured on prod 2026-09-26: 62,165 OTP emails in six days to 13,553 people,
 * 56% of them sent while that person's previous code was still valid. The
 * "Renvoyer" button had no cooldown and the only limits were per IP, so one
 * person could trigger ~140 codes an hour — 100 went to a single address over
 * three days. Each extra send is also what pushed the mail server into
 * refusing us, which made codes arrive late, which made people tap again.
 *
 * The window is 20 minutes rather than an hour on purpose (Sterling,
 * 2026-09-26): the mail server is unstable, so a genuine user may need several
 * sends before one gets through, and an hourly cap would lock them out.
 */
export const OTP_SEND_COOLDOWN_MS = 60 * 1000;
export const OTP_SEND_WINDOW_MS = 20 * 60 * 1000;
export const OTP_SEND_MAX_IN_WINDOW = 5;

/** A code with less life than this left is not worth resending; mint a fresh one. */
export const OTP_REUSE_MIN_REMAINING_MS = 3 * 60 * 1000;

/**
 * Whether another code may be sent now, and if not, how long until it may.
 *
 * Mirrors the condition `userRepository.reserveOtpSend` enforces atomically in
 * Mongo. This copy exists so the wait can be reported to the user and so the
 * rule can be tested without a database — keep the two in step.
 */
export function otpSendDecision(
    sendLog: Date[] | undefined,
    now: Date = new Date(),
): { allowed: boolean; retryAfterSeconds: number } {
    const t = now.getTime();
    const sends = (sendLog ?? []).map(d => new Date(d).getTime()).sort((a, b) => a - b);

    const last = sends[sends.length - 1];
    const cooldownLeft = last === undefined ? 0 : last + OTP_SEND_COOLDOWN_MS - t;

    const inWindow = sends.filter(s => s > t - OTP_SEND_WINDOW_MS);
    const windowLeft = inWindow.length >= OTP_SEND_MAX_IN_WINDOW
        ? inWindow[inWindow.length - OTP_SEND_MAX_IN_WINDOW] + OTP_SEND_WINDOW_MS - t
        : 0;

    const waitMs = Math.max(cooldownLeft, windowLeft, 0);
    return { allowed: waitMs === 0, retryAfterSeconds: Math.ceil(waitMs / 1000) };
}
