/**
 * Security plan Phase 7: dormant accounts. Every value is an env setting
 * (user-service .env), read when used so a restart picks up a change.
 *
 *   DORMANCY_INACTIVE_DAYS        90   no activity for this long → inactive
 *   DORMANCY_DORMANT_DAYS         180  → dormant
 *   DORMANCY_LONG_DORMANT_DAYS    365  → long_dormant
 *   DORMANCY_XAF_PER_USD          660  USD balances in XAF on the page (SBC's USD price)
 *   DORMANCY_REACTIVATION_HOLD    log  off | log | on
 *       on:  first sign-in after dormant / long_dormant holds withdrawals
 *            DORMANCY_HOLD_HOURS and may open a dormant_reactivation case;
 *       log: the return is recorded (reactivatedAt) but nothing is held and no
 *            case opens, until the sign-in dates cover enough time (≥ 30 days);
 *       off: nothing.
 *   DORMANCY_HOLD_HOURS           72
 *   DORMANCY_JOB_DISABLED         false  stops the nightly pass and the hold watch
 */
const num = (k: string, d: number) => {
    const v = Number(process.env[k]);
    return Number.isFinite(v) && v > 0 ? v : d;
};

export type HoldMode = 'off' | 'log' | 'on';

export function dormancyConfig() {
    const inactiveDays = num('DORMANCY_INACTIVE_DAYS', 90);
    const dormantDays = Math.max(num('DORMANCY_DORMANT_DAYS', 180), inactiveDays);
    const longDormantDays = Math.max(num('DORMANCY_LONG_DORMANT_DAYS', 365), dormantDays);
    const mode = String(process.env.DORMANCY_REACTIVATION_HOLD || 'log').toLowerCase();
    return {
        inactiveDays,
        dormantDays,
        longDormantDays,
        xafPerUsd: num('DORMANCY_XAF_PER_USD', 660),
        holdMode: (mode === 'on' || mode === 'off' ? mode : 'log') as HoldMode,
        holdHours: num('DORMANCY_HOLD_HOURS', 72),
        /** Commissions this recent, with no sign-in for inactiveDays, raise the flag. */
        commissionWindowDays: inactiveDays,
        /** A contact change this long before the return counts as "combined with". */
        contactChangeWindowDays: 30,
        disabled: String(process.env.DORMANCY_JOB_DISABLED || '').toLowerCase() === 'true',
    };
}
