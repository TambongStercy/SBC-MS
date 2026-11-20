import './index'; // loads .env

/**
 * Member authenticator (Security plan Phase 3). Kept apart from config/index.ts
 * so the admin authenticator branch (#424) does not conflict with it.
 *
 *   MEMBER_TOTP_ENC_KEY  32 random bytes, base64 (`openssl rand -base64 32`), one per
 *                        environment. Encrypts the members' authenticator secrets.
 *                        Without it, setup and code checks answer 503 and nobody can
 *                        change a payout destination or withdraw.
 */
const parseKey = (raw: string | undefined): Buffer | null => {
    if (!raw) return null;
    const buf = Buffer.from(raw.trim(), 'base64');
    return buf.length === 32 ? buf : null;
};

export const memberAuthConfig = {
    get totpEncKey(): Buffer | null { return parseKey(process.env.MEMBER_TOTP_ENC_KEY); },
    /** Name shown in the authenticator app. */
    issuer: process.env.MEMBER_TOTP_ISSUER || 'SBC',
    /** How long a member has to scan the QR code and type the first code. */
    setupTtlMs: 15 * 60 * 1000,
    /** Withdrawal lock after support resets a lost authenticator (plan: 72 h). */
    resetLockHours: 72,
};
