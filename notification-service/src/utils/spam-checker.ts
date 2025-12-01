import logger from './logger';

const log = logger.getLogger('SpamChecker');

/**
 * Result of spam check
 */
export interface SpamCheckResult {
    isSpam: boolean;
    score: number; // 0-100, higher = more likely spam
    reasons: string[];
}

/**
 * Common spam keywords and patterns
 */
const SPAM_PATTERNS = {
    // Phishing indicators
    phishing: [
        /click\s+here\s+immediately/i,
        /verify\s+your\s+account\s+now/i,
        /your\s+account\s+(has\s+been|will\s+be)\s+(suspended|closed|terminated)/i,
        /urgent\s+action\s+required/i,
        /confirm\s+your\s+identity/i,
        /unusual\s+activity\s+detected/i,
    ],

    // Financial spam
    financial: [
        /you\s+(have\s+)?(won|inherited)\s+\$?\d+/i,
        /lottery\s+winner/i,
        /nigerian\s+prince/i,
        /million\s+dollars/i,
        /wire\s+transfer/i,
        /bank\s+account\s+details/i,
        /investment\s+opportunity/i,
        /guaranteed\s+returns/i,
        /double\s+your\s+money/i,
        /risk\s+free\s+investment/i,
    ],

    // Marketing spam
    marketing: [
        /act\s+now/i,
        /limited\s+time\s+offer/i,
        /exclusive\s+deal/i,
        /once\s+in\s+a\s+lifetime/i,
        /you\s+have\s+been\s+selected/i,
        /congratulations\s+you\s+won/i,
        /free\s+gift/i,
        /100%\s+free/i,
        /no\s+obligation/i,
        /money\s+back\s+guarantee/i,
    ],

    // Suspicious subject patterns
    suspiciousSubject: [
        /^re:\s*$/i, // Empty Re:
        /^fw:\s*$/i, // Empty Fw:
        /\$\$\$/,
        /!!+/,
        /\?\?+/,
        /FREE/,
        /WINNER/,
        /URGENT/i,
        /IMPORTANT/i,
        /ACTION\s+REQUIRED/i,
    ],
};

/**
 * List of disposable/temporary email domains
 */
const DISPOSABLE_EMAIL_DOMAINS = [
    'tempmail.com',
    'throwaway.email',
    'guerrillamail.com',
    'mailinator.com',
    '10minutemail.com',
    'temp-mail.org',
    'fakeinbox.com',
    'trashmail.com',
    'getnada.com',
    'maildrop.cc',
    'yopmail.com',
    'sharklasers.com',
    'guerrillamail.info',
    'grr.la',
    'spam4.me',
    'dispostable.com',
    'mintemail.com',
    'emailondeck.com',
];

/**
 * Common typos in email domains
 */
const DOMAIN_TYPOS: Record<string, string[]> = {
    'gmail.com': ['gmial.com', 'gmai.com', 'gmaill.com', 'gmil.com', 'gmal.com'],
    'yahoo.com': ['yaho.com', 'yahooo.com', 'yhaoo.com', 'yaoo.com'],
    'hotmail.com': ['hotmal.com', 'hotmai.com', 'hotmial.com'],
    'outlook.com': ['outlok.com', 'outlokk.com', 'outloo.com'],
};

/**
 * SpamChecker class for validating email content
 */
class SpamChecker {
    /**
     * Check if email content is likely spam
     */
    checkContent(subject: string, htmlBody: string, textBody?: string): SpamCheckResult {
        const reasons: string[] = [];
        let score = 0;

        const body = textBody || this.stripHtml(htmlBody);

        // Check subject line
        const subjectScore = this.checkSubject(subject, reasons);
        score += subjectScore;

        // Check body content
        const bodyScore = this.checkBody(body, reasons);
        score += bodyScore;

        // Check HTML patterns
        const htmlScore = this.checkHtmlPatterns(htmlBody, reasons);
        score += htmlScore;

        // Check for excessive URLs
        const urlScore = this.checkUrls(body, htmlBody, reasons);
        score += urlScore;

        // Cap score at 100
        score = Math.min(score, 100);

        const isSpam = score >= 50; // Threshold for spam detection

        if (reasons.length > 0) {
            log.debug('Spam check completed', { score, isSpam, reasonCount: reasons.length });
        }

        return { isSpam, score, reasons };
    }

    /**
     * Check subject line for spam indicators
     */
    private checkSubject(subject: string, reasons: string[]): number {
        let score = 0;

        // Check for ALL CAPS
        const capsRatio = (subject.match(/[A-Z]/g)?.length || 0) / subject.length;
        if (capsRatio > 0.7 && subject.length > 10) {
            score += 15;
            reasons.push('Subject is mostly uppercase');
        }

        // Check for excessive punctuation
        const punctCount = (subject.match(/[!?$]/g)?.length || 0);
        if (punctCount > 3) {
            score += 10;
            reasons.push('Excessive punctuation in subject');
        }

        // Check for suspicious patterns
        for (const pattern of SPAM_PATTERNS.suspiciousSubject) {
            if (pattern.test(subject)) {
                score += 15;
                reasons.push(`Suspicious subject pattern: ${pattern.source}`);
                break; // Only count once
            }
        }

        return score;
    }

    /**
     * Check body content for spam indicators
     */
    private checkBody(body: string, reasons: string[]): number {
        let score = 0;

        // Check phishing patterns
        for (const pattern of SPAM_PATTERNS.phishing) {
            if (pattern.test(body)) {
                score += 25;
                reasons.push(`Phishing pattern detected: ${pattern.source}`);
                break;
            }
        }

        // Check financial spam patterns
        for (const pattern of SPAM_PATTERNS.financial) {
            if (pattern.test(body)) {
                score += 20;
                reasons.push(`Financial spam pattern: ${pattern.source}`);
                break;
            }
        }

        // Check marketing spam patterns
        let marketingMatches = 0;
        for (const pattern of SPAM_PATTERNS.marketing) {
            if (pattern.test(body)) {
                marketingMatches++;
            }
        }
        if (marketingMatches >= 3) {
            score += 15;
            reasons.push(`Multiple marketing spam phrases detected (${marketingMatches})`);
        }

        return score;
    }

    /**
     * Check HTML patterns that indicate spam
     */
    private checkHtmlPatterns(html: string, reasons: string[]): number {
        let score = 0;

        // Check for hidden text (display:none with content)
        const hiddenTextMatch = html.match(/display\s*:\s*none[^>]*>[^<]+</gi);
        if (hiddenTextMatch && hiddenTextMatch.length > 5) {
            score += 10;
            reasons.push('Excessive hidden text in HTML');
        }

        // Check for suspicious iframe/script tags (shouldn't be in emails)
        if (/<iframe/i.test(html)) {
            score += 20;
            reasons.push('Contains iframe tag');
        }

        if (/<script/i.test(html) && !/<script type="application\/ld\+json"/i.test(html)) {
            score += 25;
            reasons.push('Contains script tag');
        }

        // Check for form elements (suspicious in emails)
        if (/<form/i.test(html)) {
            score += 15;
            reasons.push('Contains form element');
        }

        return score;
    }

    /**
     * Check for excessive or suspicious URLs
     */
    private checkUrls(body: string, html: string, reasons: string[]): number {
        let score = 0;

        // Count URLs in body
        const urlPattern = /https?:\/\/[^\s<>"]+/gi;
        const urls = html.match(urlPattern) || [];

        // Too many URLs can indicate spam
        if (urls.length > 20) {
            score += 15;
            reasons.push(`Excessive URLs in email (${urls.length})`);
        }

        // Check for URL shorteners (can be used to hide malicious links)
        const shorteners = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly'];
        const hasShortener = urls.some(url => shorteners.some(s => url.includes(s)));
        if (hasShortener) {
            score += 10;
            reasons.push('Contains URL shortener links');
        }

        return score;
    }

    /**
     * Validate email address format and domain
     */
    validateEmailAddress(email: string): { isValid: boolean; warnings: string[] } {
        const warnings: string[] = [];

        // Basic email format validation (RFC 5322 simplified)
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return { isValid: false, warnings: ['Invalid email format'] };
        }

        const domain = email.split('@')[1]?.toLowerCase();
        if (!domain) {
            return { isValid: false, warnings: ['Missing email domain'] };
        }

        // Check for disposable email domains
        if (DISPOSABLE_EMAIL_DOMAINS.includes(domain)) {
            warnings.push('Disposable email address detected');
        }

        // Check for common domain typos
        for (const [correctDomain, typos] of Object.entries(DOMAIN_TYPOS)) {
            if (typos.includes(domain)) {
                warnings.push(`Possible typo in domain: did you mean ${correctDomain}?`);
            }
        }

        return { isValid: true, warnings };
    }

    /**
     * Strip HTML tags from content
     */
    private stripHtml(html: string): string {
        return html
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Check if sender is attempting to spoof a known brand
     */
    checkBrandSpoofing(fromAddress: string, subject: string, body: string): boolean {
        const spoofedBrands = [
            { name: 'paypal', patterns: [/paypal/i] },
            { name: 'amazon', patterns: [/amazon/i] },
            { name: 'apple', patterns: [/apple\s+id/i, /icloud/i] },
            { name: 'microsoft', patterns: [/microsoft/i, /office\s*365/i] },
            { name: 'google', patterns: [/google\s+account/i] },
            { name: 'bank', patterns: [/your\s+bank/i, /banking/i] },
        ];

        const content = `${subject} ${body}`.toLowerCase();
        const fromLower = fromAddress.toLowerCase();

        for (const brand of spoofedBrands) {
            const mentionsBrand = brand.patterns.some(p => p.test(content));
            const isFromBrand = fromLower.includes(brand.name);

            // If email mentions brand but isn't from that brand's domain
            if (mentionsBrand && !isFromBrand) {
                // This is the legitimate SBC service, allow it
                if (fromLower.includes('sniperbuisnesscenter') || fromLower.includes('sbc')) {
                    continue;
                }
                log.warn('Potential brand spoofing detected', { brand: brand.name, from: fromAddress });
                return true;
            }
        }

        return false;
    }
}

// Export singleton instance
export const spamChecker = new SpamChecker();
