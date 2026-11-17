import { describe, expect, it } from 'vitest';
import { rangeFor, describeRange, PERIODS } from './period';

// Wednesday 2026-01-14 15:30 local time.
const NOW = new Date(2026, 0, 14, 15, 30);
const d = (y: number, m: number, day: number, h = 0, min = 0, s = 0, ms = 0) => new Date(y, m, day, h, min, s, ms);

describe('period presets', () => {
    it('offers the owner\'s presets, "Toute la période" first', () => {
        expect(PERIODS.map(p => p.label)).toEqual([
            'Toute la période', "Aujourd'hui", '3 derniers jours', 'Cette semaine', 'Ce mois',
            'Mois dernier', 'Cette année', 'Année dernière', 'Période personnalisée',
        ]);
    });
    it('all = no bounds', () => expect(rangeFor('all', {}, NOW)).toEqual({}));
    it('today', () => expect(rangeFor('today', {}, NOW)).toEqual({ from: d(2026, 0, 14), to: d(2026, 0, 14, 23, 59, 59, 999) }));
    it('3 derniers jours = today and the 2 days before', () =>
        expect(rangeFor('last3days', {}, NOW)).toEqual({ from: d(2026, 0, 12), to: d(2026, 0, 14, 23, 59, 59, 999) }));
    it('week runs Monday → Sunday', () =>
        expect(rangeFor('thisWeek', {}, NOW)).toEqual({ from: d(2026, 0, 12), to: d(2026, 0, 18, 23, 59, 59, 999) }));
    it('last month across the year boundary', () =>
        expect(rangeFor('lastMonth', {}, NOW)).toEqual({ from: d(2025, 11, 1), to: d(2025, 11, 31, 23, 59, 59, 999) }));
    it('last year', () =>
        expect(rangeFor('lastYear', {}, NOW)).toEqual({ from: d(2025, 0, 1), to: d(2025, 11, 31, 23, 59, 59, 999) }));
    it('custom range includes the whole last day', () => {
        const r = rangeFor('custom', { from: '2026-01-03', to: '2026-01-05' }, NOW);
        expect(r).toEqual({ from: d(2026, 0, 3), to: d(2026, 0, 5, 23, 59, 59, 999) });
        expect(describeRange('custom', r)).toBe('3 janv. 2026 → 5 janv. 2026');
    });
    it('custom range ignores invalid dates', () => expect(rangeFor('custom', { from: 'x' }, NOW)).toEqual({ from: undefined, to: undefined }));
});
