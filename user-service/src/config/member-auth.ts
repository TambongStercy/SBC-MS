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
    /**
     * Security plan Phase 3 item 1: withdrawals locked 24–48 h after a member sets up
     * the app. 0 (default) = no lock until Rufus picks the number: with the app required
     * for every withdrawal, each member's first withdrawal would wait this long.
     */
    get setupLockHours(): number { const n = Number(process.env.AUTHENTICATOR_SETUP_LOCK_HOURS || 0); return Number.isFinite(n) && n > 0 ? Math.min(n, 168) : 0; },
    /**
     * Plan item 3: a risky setup (country elsewhere, payout details changed in the last
     * 7 days, account flagged by the fraud engine) goes to support. `log` (default) files a
     * case and lets the setup stand; `off`. Holding the app until approval is Rufus's call.
     */
    get setupReview(): 'off' | 'log' { return process.env.AUTHENTICATOR_SETUP_REVIEW === 'off' ? 'off' : 'log'; },
    /** Plan: the setup routes get their own limit, 5 per minute per member (Redis; fails open). */
    setupPerMinute: 5,
};
