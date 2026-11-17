import type { TimePoint } from '../charts/TimeSeriesChart';

/** "2024-5" / "2024-05" / "2024-05-…" → "2024-05", or null. */
export function normMonth(key: string | null | undefined): string | null {
  if (!key) return null;
  const [y, m] = key.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return null;
  return `${y}-${String(m).padStart(2, '0')}`;
}

export const monthOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Every month key from `first` to `last`, inclusive. */
export function monthRange(first: string, last: string): string[] {
  const out: string[] = [];
  let [y, m] = first.split('-').map(Number);
  const [ly, lm] = last.split('-').map(Number);
  let guard = 0;
  while ((y < ly || (y === ly && m <= lm)) && guard++ < 600) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

export const addMonths = (key: string, n: number) => {
  const [y, m] = key.split('-').map(Number);
  return monthOf(new Date(y, m - 1 + n, 1));
};

/** Rows like {month, count} → Map("YYYY-MM" → value). */
export function toMonthMap<T extends { month: string }>(rows: T[] | undefined, value: (row: T) => number): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows ?? []) {
    const k = normMonth(row.month);
    if (k) map.set(k, (map.get(k) ?? 0) + (Number(value(row)) || 0));
  }
  return map;
}

const axisLabel = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
};
const fullLabel = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  const s = new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
export const monthName = fullLabel;

/** One point per month in `keys`, a value (0 when missing) per series. */
export function buildPoints(keys: string[], series: Record<string, Map<string, number>>): TimePoint[] {
  return keys.map(key => {
    const point: TimePoint = { key, label: axisLabel(key), full: fullLabel(key) };
    for (const [name, map] of Object.entries(series)) point[name] = map.get(key) ?? 0;
    return point;
  });
}

/** Last complete month vs the one before, from a month map: for "Octobre : 1 234 (+12 % vs septembre)". */
export function lastTwoMonths(map: Map<string, number>, now = new Date()) {
  const last = addMonths(monthOf(now), -1);
  const before = addMonths(last, -1);
  return { last, before, lastValue: map.get(last) ?? 0, beforeValue: map.get(before) ?? 0 };
}
