/**
 * Content restriction validation for SBCLOVE profile text (spec §7).
 *
 * Forbidden in display name and description:
 *   - phone numbers
 *   - WhatsApp references
 *   - social media handles / platform names
 *   - external links (URLs)
 *   - raw email addresses
 *
 * These checks are intentionally conservative (better to reject borderline
 * content than to leak contact details that bypass the moderated flow).
 */

const PATTERNS: { label: string; regex: RegExp }[] = [
    // URLs / external links
    { label: 'external link', regex: /\b((https?:\/\/)|(www\.)|([a-z0-9-]+\.(com|net|org|io|me|cm|fr|info|biz|link|gg|ly)))\b/i },
    // Email addresses
    { label: 'email address', regex: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i },
    // Phone numbers: 8+ digits, tolerant of spaces/dots/dashes and an optional +
    { label: 'phone number', regex: /(\+?\d[\d\s.\-()]{6,}\d)/ },
    // WhatsApp / social platforms / handles
    { label: 'WhatsApp or social media reference', regex: /\b(whats\s?app|wa\.me|telegram|t\.me|insta(gram)?|facebook|fb\.com|messenger|snap(chat)?|tiktok|twitter|x\.com|signal|viber|@[a-z0-9._]{2,})\b/i },
];

export interface ContentValidationResult {
    ok: boolean;
    violation?: string;
}

/**
 * Validates a single text field. Returns the first violation found, if any.
 */
export const validateProfileText = (text: string | undefined | null): ContentValidationResult => {
    if (!text) {
        return { ok: true };
    }
    for (const { label, regex } of PATTERNS) {
        if (regex.test(text)) {
            return { ok: false, violation: label };
        }
    }
    return { ok: true };
};
