import {
    endOfDay, endOfMonth, endOfWeek, endOfYear, format, isValid, parseISO,
    startOfDay, startOfMonth, startOfWeek, startOfYear, subDays, subMonths, subYears,
} from 'date-fns';
import { fr } from 'date-fns/locale';

/**
 * The period filter every admin page offers (owner, 2026-11-16). "Toute la
 * période" is the default so a queue never hides old items. Weeks start on
 * Monday. Bounds are the admin's local days, sent to the API as ISO instants
 * (`from` inclusive, `to` inclusive end of day).
 */
export const PERIODS = [
    { key: 'all', label: 'Toute la période' },
    { key: 'today', label: "Aujourd'hui" },
    { key: 'last3days', label: '3 derniers jours' },
    { key: 'thisWeek', label: 'Cette semaine' },
    { key: 'thisMonth', label: 'Ce mois' },
    { key: 'lastMonth', label: 'Mois dernier' },
    { key: 'thisYear', label: 'Cette année' },
    { key: 'lastYear', label: 'Année dernière' },
    { key: 'custom', label: 'Période personnalisée' },
] as const;

export type PeriodKey = typeof PERIODS[number]['key'];
export const DEFAULT_PERIOD: PeriodKey = 'all';

export const isPeriodKey = (v: unknown): v is PeriodKey =>
    typeof v === 'string' && PERIODS.some(p => p.key === v);

export interface DateRange { from?: Date; to?: Date }

const WEEK = { weekStartsOn: 1 as const };

/** The dates a period covers ({} for "Toute la période"). `custom` needs from/to (yyyy-MM-dd). */
export function rangeFor(key: PeriodKey, custom: { from?: string; to?: string } = {}, now = new Date()): DateRange {
    switch (key) {
        case 'today': return { from: startOfDay(now), to: endOfDay(now) };
        case 'last3days': return { from: startOfDay(subDays(now, 2)), to: endOfDay(now) };
        case 'thisWeek': return { from: startOfWeek(now, WEEK), to: endOfWeek(now, WEEK) };
        case 'thisMonth': return { from: startOfMonth(now), to: endOfMonth(now) };
        case 'lastMonth': { const m = subMonths(now, 1); return { from: startOfMonth(m), to: endOfMonth(m) }; }
        case 'thisYear': return { from: startOfYear(now), to: endOfYear(now) };
        case 'lastYear': { const y = subYears(now, 1); return { from: startOfYear(y), to: endOfYear(y) }; }
        case 'custom': {
            const f = custom.from ? parseISO(custom.from) : undefined;
            const t = custom.to ? parseISO(custom.to) : undefined;
            return {
                from: f && isValid(f) ? startOfDay(f) : undefined,
                to: t && isValid(t) ? endOfDay(t) : undefined,
            };
        }
        default: return {};
    }
}

export const periodLabel = (key: PeriodKey) => PERIODS.find(p => p.key === key)?.label ?? 'Toute la période';

/** "1 nov. → 16 nov. 2026" for the chosen dates, or the preset's name. */
export function describeRange(key: PeriodKey, range: DateRange): string {
    if (key !== 'custom') return periodLabel(key);
    const f = range.from ? format(range.from, 'd MMM yyyy', { locale: fr }) : '…';
    const t = range.to ? format(range.to, 'd MMM yyyy', { locale: fr }) : '…';
    return `${f} → ${t}`;
}

/** yyyy-MM-dd for <input type="date"> and the URL. */
export const toDateInput = (d?: Date) => (d ? format(d, 'yyyy-MM-dd') : '');
