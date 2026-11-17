/**
 * Shared fr-FR formatting for amounts, counts and dates, so every admin page
 * writes "12 500 F", "45,20 $", "1,2 M" and "il y a 2 h" the same way.
 */

const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });

/** Unit for a currency code: F for XAF/XOF/FCFA, $ for USD, else the code. */
export function currencyUnit(currency?: string | null): string {
  const c = (currency || 'XAF').toUpperCase();
  if (c === 'XAF' || c === 'XOF' || c === 'FCFA' || c === 'F') return 'F';
  if (c === 'USD' || c === 'USDT' || c === '$') return '$';
  if (c === 'EUR') return '€';
  return c;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** "12 500" (no decimals). Non-numbers give "—". */
export function formatNumber(value: number | null | undefined): string {
  return isNum(value) ? nf0.format(value) : '—';
}

/**
 * An amount with its unit: "12 500 F" (francs, rounded) or "45,20 $"
 * (dollars, 2 decimals). Non-numbers give "—".
 */
export function formatMoney(value: number | null | undefined, currency: string | null = 'XAF'): string {
  if (!isNum(value)) return '—';
  const unit = currencyUnit(currency);
  return unit === 'F' ? `${nf0.format(Math.round(value))}\u202fF` : `${nf2.format(value)}\u202f${unit}`;
}

/**
 * Short form for axis ticks and dense tiles: "0", "950", "15 k", "1,2 M".
 * In full under 10 000, compact above (one style per axis is the caller's job).
 */
export function formatCompact(value: number | null | undefined): string {
  if (!isNum(value)) return '—';
  if (Math.abs(value) < 10_000) return nf0.format(value);
  return compact.format(value).replace(/\s?k$/i, '\u202fk').replace(/\s?M$/, '\u202fM').replace(/\s?Md$/, '\u202fMd');
}

/** Compact amount with unit: "15 k F", "1,2 M F", "45 $". */
export function formatCompactMoney(value: number | null | undefined, currency: string | null = 'XAF'): string {
  if (!isNum(value)) return '—';
  return `${formatCompact(value)}\u202f${currencyUnit(currency)}`;
}

/** Signed percentage change, "+12 %" / "−4 %", or null when there is no base. */
export function formatDelta(current: number, previous: number): string | null {
  if (!isNum(current) || !isNum(previous) || previous === 0) return null;
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const rounded = Math.abs(pct) >= 10 ? Math.round(pct) : Math.round(pct * 10) / 10;
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '';
  return `${sign}${Math.abs(rounded).toLocaleString('fr-FR')}\u202f%`;
}

const toDate = (value: string | number | Date | null | undefined): Date | null => {
  if (value === null || value === undefined || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** "16 nov. 2026" */
export function formatDate(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  return d ? d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

/** "16 nov. 2026, 14:05" */
export function formatDateTime(value: string | number | Date | null | undefined): string {
  const d = toDate(value);
  return d
    ? d.toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';
}

/**
 * "à l'instant", "il y a 5 min", "il y a 2 h", "hier", "il y a 3 j" for the
 * last week; the date beyond ("16 nov. 2026").
 */
export function formatRelative(value: string | number | Date | null | undefined, now: Date = new Date()): string {
  const d = toDate(value);
  if (!d) return '—';
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 0) return formatDateTime(d);
  if (diff < 60) return 'à l’instant';
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
  const days = Math.floor(diff / 86400);
  if (days === 1) return 'hier';
  if (days < 7) return `il y a ${days} j`;
  return formatDate(d);
}

/** "nov. 26" for a "2026-11" or "2026-11-..." month key. */
export function formatMonthKey(key: string): string {
  const [y, m] = key.split('-').map(Number);
  if (!y || !m) return key;
  return new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
}
