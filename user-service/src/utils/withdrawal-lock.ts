import config from '../config';

/**
 * Withdrawals are blocked for a while after the account's email or phone
 * number changes (Rufus, 2026-10-22), and after the Mobile Money number or
 * operator or the crypto wallet changes (Security plan Phase 0, Rufus 2026-11-19). Taking over an account starts with
 * changing them, so that codes and alerts reach the new holder instead of
 * the owner. The delay gives the owner time to see the alert sent to the old
 * address and call support before any money can leave.
 *
 * Every path that writes `email`, `phoneNumber`, the MoMo details or the crypto wallet must add
 * `withdrawalLockFields(...)` to its update. payment-service reads the lock
 * through GET /users/internal/:userId/withdrawal-lock before every payout.
 */
export type WithdrawalLockReason = 'email_change' | 'phone_change' | 'momo_change' | 'crypto_change' | 'authenticator_reset';

export function withdrawalLockFields(reason: WithdrawalLockReason, now: Date = new Date(), hoursOverride?: number) {
    const hours = hoursOverride ?? config.withdrawal.lockHoursAfterContactChange;
    return {
        withdrawalsLockedUntil: new Date(now.getTime() + hours * 60 * 60 * 1000),
        withdrawalLockReason: reason,
    };
}

export interface WithdrawalLockStatus {
    locked: boolean;
    /** ISO date, only when locked. */
    until?: string;
    reason?: WithdrawalLockReason | 'account_frozen';
}

/**
 * Security plan Phase 5: money frozen by support (fraud suspicion), until an
 * approved unfreeze. Kept apart from the timed lock, so a later email or MoMo
 * change (which rewrites the lock date) can never lift it.
 */
export const FROZEN_UNTIL = '9999-12-31T00:00:00.000Z';

export function withdrawalLockStatus(
    user: { withdrawalsLockedUntil?: Date | null; withdrawalLockReason?: WithdrawalLockReason | null; frozen?: { at?: Date | null } | null },
    now: Date = new Date(),
): WithdrawalLockStatus {
    if (user.frozen?.at) return { locked: true, until: FROZEN_UNTIL, reason: 'account_frozen' };
    const until = user.withdrawalsLockedUntil ? new Date(user.withdrawalsLockedUntil) : null;
    if (!until || until <= now) return { locked: false };
    return { locked: true, until: until.toISOString(), reason: user.withdrawalLockReason ?? undefined };
}
