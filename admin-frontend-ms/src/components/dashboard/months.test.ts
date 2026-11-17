import { describe, expect, it } from 'vitest';
import { buildPoints, monthRange, normMonth, toMonthMap } from './months';
import { outlierCap } from '../charts/TimeSeriesChart';

describe('months', () => {
  it('normalises the two month formats the API sends', () => {
    expect(normMonth('2024-5')).toBe('2024-05');
    expect(normMonth('2024-05')).toBe('2024-05');
    expect(normMonth('')).toBeNull();
  });
  it('fills every month of the range, missing ones at 0', () => {
    expect(monthRange('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    const map = toMonthMap([{ month: '2025-12', count: 4 }], r => r.count);
    const points = buildPoints(monthRange('2025-11', '2026-01'), { users: map });
    expect(points.map(p => p.users)).toEqual([0, 4, 0]);
  });
  it('caps a month far above the others (the import spike) but not normal variation', () => {
    const series = [{ key: 'v', label: 'v' }];
    const spike = [9000, 11000, 60000, 32000, 8000, 12000, 10000, 9500].map((v, i) => ({ key: String(i), label: '', full: '', v }));
    const capped = outlierCap(spike, series);
    expect(capped?.max).toBe(60000);
    expect(capped!.cap).toBeGreaterThanOrEqual(12000);
    expect(capped!.cap).toBeLessThan(60000);
    const normal = [9000, 11000, 14000, 12000, 8000, 12000].map((v, i) => ({ key: String(i), label: '', full: '', v }));
    expect(outlierCap(normal, series)).toBeNull();
  });
});
