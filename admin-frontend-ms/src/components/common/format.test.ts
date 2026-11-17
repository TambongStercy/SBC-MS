import { describe, expect, it } from 'vitest';
import { formatCompact, formatCompactMoney, formatDelta, formatMoney, formatRelative } from './format';

const nb = (s: string) => s.replace(/[\u202F\u00A0]/g, ' ');

describe('format', () => {
  it('writes francs rounded with F and dollars with 2 decimals', () => {
    expect(nb(formatMoney(12500))).toBe('12 500 F');
    expect(nb(formatMoney(2306.25, 'XAF'))).toBe('2 306 F');
    expect(nb(formatMoney(45.2, 'USD'))).toBe('45,20 $');
    expect(formatMoney(undefined)).toBe('—');
  });
  it('keeps axis ticks in full under 10 000 and compact above', () => {
    expect(nb(formatCompact(9000))).toBe('9 000');
    expect(nb(formatCompact(15000))).toBe('15 k');
    expect(nb(formatCompact(1_200_000))).toBe('1,2 M');
    expect(nb(formatCompactMoney(30000))).toBe('30 k F');
  });
  it('signs the change against the previous value', () => {
    expect(nb(formatDelta(112, 100) ?? '')).toBe('+12 %');
    expect(nb(formatDelta(96, 100) ?? '')).toBe('−4 %');
    expect(formatDelta(5, 0)).toBeNull();
  });
  it('says how long ago, then the date', () => {
    const now = new Date('2026-11-16T12:00:00');
    expect(formatRelative(new Date('2026-11-16T10:00:00'), now)).toBe('il y a 2 h');
    expect(formatRelative(new Date('2026-11-15T09:00:00'), now)).toBe('hier');
    expect(formatRelative(new Date('2026-10-01T09:00:00'), now)).toMatch(/oct/);
  });
});
