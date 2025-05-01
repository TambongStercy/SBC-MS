import crypto from 'crypto';

// Define the desired length for the referral code
const REFERRAL_CODE_LENGTH = 8;

/**
 * Generates a random string for use as a referral code.
 * Simple implementation using Node.js crypto module.
 */
export const generateReferralCode = (): string => {
    const characters = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    let result = '';

    // Generate random bytes
    const randomBytes = crypto.randomBytes(REFERRAL_CODE_LENGTH);

    // Convert random bytes to characters
    for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
        // Use modulo to ensure the index is within bounds of our character set
        result += characters[randomBytes[i] % characters.length];
    }

    return result;
}; 