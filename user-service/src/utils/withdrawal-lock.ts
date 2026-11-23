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
export type WithdrawalLockReason = 'email_change' | 'phone_change' | 'momo_change' | 'crypto_change' | 'authenticator_reset' | 'authenticator_setup';

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
    reason?: WithdrawalLockReason | 'account_frozen' | 'dormant_reactivation' | 'account_banned';
}

/**
 * Security plan Phase 5: money frozen by support (fraud suspicion), until an
 * approved unfreeze. Kept apart from the timed lock, so a later email or MoMo
 * change (which rewrites the lock date) can never lift it.
 */
export const FROZEN_UNTIL = '9999-12-31T00:00:00.000Z';

export function withdrawalLockStatus(
    user: {
        withdrawalsLockedUntil?: Date | null; withdrawalLockReason?: WithdrawalLockReason | null; frozen?: { at?: Date | null } | null;
        dormancy?: { holdUntil?: Date | null } | null;
        ban?: { at?: Date | null } | null;
    },
    now: Date = new Date(),
): WithdrawalLockStatus {
    // A suspended account (services/account-ban.service.ts): nothing leaves, on any path, admin ones included.
    if (user.ban?.at) return { locked: true, until: FROZEN_UNTIL, reason: 'account_banned' };
    if (user.frozen?.at) return { locked: true, until: FROZEN_UNTIL, reason: 'account_frozen' };
    const until = user.withdrawalsLockedUntil ? new Date(user.withdrawalsLockedUntil) : null;
    // Security plan Phase 7: the hold after a dormant account comes back is kept
    // apart too, so a contact change (which rewrites the timed lock) cannot shorten it.
    const hold = user.dormancy?.holdUntil ? new Date(user.dormancy.holdUntil) : null;
    const timed = until && until > now ? until : null;
    const held = hold && hold > now ? hold : null;
    if (!timed && !held) return { locked: false };
    if (held && (!timed || held >= timed)) return { locked: true, until: held.toISOString(), reason: 'dormant_reactivation' };
    return { locked: true, until: timed!.toISOString(), reason: user.withdrawalLockReason ?? undefined };
}
