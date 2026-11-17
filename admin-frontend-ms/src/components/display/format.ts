import axios from 'axios';

/**
 * Display helpers shared by the Communication, Relance and Système screens:
 * numbers, sizes and dates in fr-FR, and the API's own error message.
 */

const int = new Intl.NumberFormat('fr-FR');
const compact = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });
const pct = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

/** 12 500 */
export const fmtInt = (n: number | null | undefined) => int.format(Math.round(n ?? 0));
/** 1,2 k / 3,4 M (axis ticks, tight spots) */
export const fmtCompact = (n: number) => (Math.abs(n) < 10_000 ? int.format(n) : compact.format(n));
/** 12,5 % */
export const fmtPct = (n: number | null | undefined) => `${pct.format(n ?? 0)} %`;
/** 12 500 F */
export const fmtXaf = (n: number | null | undefined) => `${fmtInt(n)} F`;

/** 1,5 Go */
export function fmtBytes(bytes: number | null | undefined): string {
    const b = bytes ?? 0;
    if (b <= 0) return '0 o';
    const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
    const v = b / 1024 ** i;
    return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: i === 0 ? 0 : v < 10 ? 2 : 1 }).format(v)} ${units[i]}`;
}

const toDate = (d: string | number | Date | null | undefined) => {
    if (d === null || d === undefined || d === '') return null;
    const date = d instanceof Date ? d : new Date(d);
    return Number.isNaN(date.getTime()) ? null : date;
};

/** 16 nov. 2026 à 14:05 */
export function fmtDateTime(d: string | number | Date | null | undefined): string {
    const date = toDate(d);
    if (!date) return '—';
    return date.toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** 16 nov. 2026 */
export function fmtDate(d: string | number | Date | null | undefined): string {
    const date = toDate(d);
    if (!date) return '—';
    return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

const rtf = new Intl.RelativeTimeFormat('fr-FR', { numeric: 'auto' });

/**
 * "il y a 2 h", "dans 3 j" for dates within a week, the short date beyond.
 * Works for past and future dates (next message due…).
 */
export function fmtRelative(d: string | number | Date | null | undefined, now = Date.now()): string {
    const date = toDate(d);
    if (!date) return '—';
    const diff = date.getTime() - now;
    const abs = Math.abs(diff);
    const min = 60_000, hour = 60 * min, day = 24 * hour;
    if (abs < min) return diff < 0 ? 'à l’instant' : 'dans un instant';
    if (abs < hour) return rtf.format(Math.round(diff / min), 'minute');
    if (abs < day) return rtf.format(Math.round(diff / hour), 'hour');
    if (abs < 7 * day) return rtf.format(Math.round(diff / day), 'day');
    return fmtDate(date);
}

/** The API's own message when it gives one, otherwise the fallback. */
export function apiError(error: unknown, fallback: string): string {
    if (axios.isAxiosError(error)) {
        const message = (error.response?.data as { message?: unknown } | undefined)?.message;
        if (typeof message === 'string' && message.trim()) return message;
    }
    return fallback;
}
