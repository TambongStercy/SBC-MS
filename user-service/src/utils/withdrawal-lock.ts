import config from '../config';

/**
 * Withdrawals are blocked for a while after the account's email or phone
 * number changes (Rufus, 2026-10-22). Taking over an account starts with
 * changing them, so that codes and alerts reach the new holder instead of
 * the owner. The delay gives the owner time to see the alert sent to the old
 * address and call support before any money can leave.
 *
 * Every path that writes `email` or `phoneNumber` must add
 * `withdrawalLockFields(...)` to its update. payment-service reads the lock
 * through GET /users/internal/:userId/withdrawal-lock before every payout.
 */
export type WithdrawalLockReason = 'email_change' | 'phone_change';

export function withdrawalLockFields(reason: WithdrawalLockReason, now: Date = new Date()) {
    const hours = config.withdrawal.lockHoursAfterContactChange;
    return {
        withdrawalsLockedUntil: new Date(now.getTime() + hours * 60 * 60 * 1000),
        withdrawalLockReason: reason,
    };
}

export interface WithdrawalLockStatus {
    locked: boolean;
    /** ISO date, only when locked. */
    until?: string;
    reason?: WithdrawalLockReason;
}

export function withdrawalLockStatus(
    user: { withdrawalsLockedUntil?: Date | null; withdrawalLockReason?: WithdrawalLockReason | null },
    now: Date = new Date(),
): WithdrawalLockStatus {
    const until = user.withdrawalsLockedUntil ? new Date(user.withdrawalsLockedUntil) : null;
    if (!until || until <= now) return { locked: false };
    return { locked: true, until: until.toISOString(), reason: user.withdrawalLockReason ?? undefined };
}
