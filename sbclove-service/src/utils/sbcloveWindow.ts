import config from '../config';

/**
 * Helpers for the SBCLOVE weekly session window.
 *
 * The module is active only on a configured weekday (default: Wednesday)
 * between `openHour` and `closeHour`, evaluated in the configured timezone
 * (default: Africa/Douala). All time math is timezone-aware via Intl so the
 * server's local timezone is irrelevant.
 */

interface ZonedParts {
    weekday: number; // 0=Sunday ... 6=Saturday
    hour: number;
    year: number;
    month: number; // 1-12
    day: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/**
 * Breaks a Date down into its parts in the SBCLOVE timezone.
 */
const getZonedParts = (date: Date, timezone: string): ZonedParts => {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        weekday: 'short',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hour12: false,
    });

    const parts = formatter.formatToParts(date);
    const lookup = (type: string) => parts.find(p => p.type === type)?.value ?? '';

    // hour12:false can emit '24' at midnight in some environments; normalize to 0.
    const rawHour = parseInt(lookup('hour'), 10);
    const hour = rawHour === 24 ? 0 : rawHour;

    return {
        weekday: WEEKDAY_INDEX[lookup('weekday')] ?? 0,
        hour,
        year: parseInt(lookup('year'), 10),
        month: parseInt(lookup('month'), 10),
        day: parseInt(lookup('day'), 10),
    };
};

/**
 * Returns true if the module window is currently open.
 */
export const isWindowOpen = (now: Date = new Date()): boolean => {
    const { timezone, activeWeekday, openHour, closeHour } = config.sbclove;
    const { weekday, hour } = getZonedParts(now, timezone);
    return weekday === activeWeekday && hour >= openHour && hour < closeHour;
};

/**
 * Returns the date key (YYYY-MM-DD, in the SBCLOVE timezone) of the active
 * weekday for the week containing `now`. Used as the weekly bucket for the
 * "max N interests per week" quota so the quota resets each session.
 */
export const getSessionDateKey = (now: Date = new Date()): string => {
    const { timezone, activeWeekday } = config.sbclove;
    const { weekday, year, month, day } = getZonedParts(now, timezone);

    // Days to shift back to reach the active weekday of the current week.
    const diff = (weekday - activeWeekday + 7) % 7;

    // Build a UTC date from the zoned Y/M/D then subtract the diff in days.
    // Using UTC avoids DST drift for a pure date-key computation.
    const base = Date.UTC(year, month - 1, day);
    const sessionDate = new Date(base - diff * 24 * 60 * 60 * 1000);

    const y = sessionDate.getUTCFullYear();
    const m = String(sessionDate.getUTCMonth() + 1).padStart(2, '0');
    const d = String(sessionDate.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};
