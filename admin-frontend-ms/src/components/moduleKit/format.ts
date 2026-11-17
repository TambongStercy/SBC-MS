/**
 * Number and date formatting shared by the module pages (Ads Network, SBC
 * Event, SBC Love, Tombola, Impact Challenge, Boutique): fr-FR everywhere,
 * amounts with their unit ("12 500 F", "45,20 $"), dates relative when recent.
 */

const NBSP = ' ';

/** "12 500" (fr-FR grouping). */
export const formatNumber = (n: number | null | undefined, digits = 0) =>
  n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toLocaleString('fr-FR', { maximumFractionDigits: digits, minimumFractionDigits: 0 });

/** "12 500 F" for XAF/XOF/FCFA (or no currency), "45,20 $" for USD, "12 € " for EUR. */
export function formatMoney(n: number | null | undefined, currency: string = 'XAF'): string {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const c = (currency || 'XAF').toUpperCase();
  if (c === 'USD' || c === '$') return `${Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${NBSP}$`;
  if (c === 'EUR' || c === '€') return `${Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${NBSP}€`;
  return `${Math.round(Number(n)).toLocaleString('fr-FR')}${NBSP}F`;
}

/** Compact axis / tile figure: "0", "950", "15 k", "1,2 M". */
export function formatCompact(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}${NBSP}Md`;
  if (a >= 1e6) return `${(v / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}${NBSP}M`;
  if (a >= 1e4) return `${Math.round(v / 1e3).toLocaleString('fr-FR')}${NBSP}k`;
  if (a >= 1e3) return `${(v / 1e3).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}${NBSP}k`;
  return v.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
}

/** Compact money for axes: "15 k F". */
export const formatCompactMoney = (n: number | null | undefined) => (n == null ? '—' : `${formatCompact(n)}${NBSP}F`);

/** "12,5 %" */
export const formatPercent = (ratio: number | null | undefined, digits = 1) =>
  ratio == null || Number.isNaN(ratio) ? '—' : `${(ratio * 100).toLocaleString('fr-FR', { maximumFractionDigits: digits })}${NBSP}%`;

/** Signed comparison: "+12 % vs mois dernier" (null when there is nothing to compare with). */
export function formatDelta(current: number, previous: number | null | undefined, period = 'vs mois dernier'): string | null {
  if (previous == null || !Number.isFinite(previous) || previous === 0) return null;
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : '';
  return `${sign}${Math.abs(pct).toLocaleString('fr-FR', { maximumFractionDigits: 0 })}${NBSP}% ${period}`;
}

const toDate = (d: string | number | Date | null | undefined): Date | null => {
  if (d == null || d === '') return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** "16 nov. 2026" */
export const formatDate = (d: string | number | Date | null | undefined) =>
  toDate(d)?.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) ?? '—';

/** "16 nov. 2026, 14:05" */
export const formatDateTime = (d: string | number | Date | null | undefined) =>
  toDate(d)?.toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) ?? '—';

/** "lundi 16 novembre 2026 à 14:05" (tooltips). */
export const formatFullDateTime = (d: string | number | Date | null | undefined) =>
  toDate(d)?.toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' }) ?? '—';

/** "à l'instant", "il y a 5 min", "il y a 2 h", "hier", "il y a 3 j"; older (or future) → the date. */
export function formatRelative(d: string | number | Date | null | undefined, now = Date.now()): string {
  const date = toDate(d);
  if (!date) return '—';
  const diff = now - date.getTime();
  const min = Math.round(diff / 60000);
  if (diff < 0) {
    const ahead = -min;
    if (ahead < 60) return `dans ${Math.max(1, ahead)} min`;
    if (ahead < 24 * 60) return `dans ${Math.round(ahead / 60)} h`;
    if (ahead < 7 * 24 * 60) return `dans ${Math.round(ahead / 1440)} j`;
    return formatDate(date);
  }
  if (min < 1) return 'à l’instant';
  if (min < 60) return `il y a ${min} min`;
  if (min < 24 * 60) return `il y a ${Math.round(min / 60)} h`;
  if (min < 48 * 60) return 'hier';
  if (min < 7 * 24 * 60) return `il y a ${Math.round(min / 1440)} j`;
  return formatDate(date);
}

export const plural = (n: number, one: string, many = `${one}s`) => (Math.abs(n) > 1 ? many : one);

/** "3 campagnes" */
export const count = (n: number, one: string, many?: string) => `${formatNumber(n)} ${plural(n, one, many)}`;

/** Last 6 characters of an id, for a compact reference ("…a1b2c3"). */
export const shortId = (id?: string | null) => (id ? `…${String(id).slice(-6)}` : '—');

/** Extracts a readable message from an axios-like error. */
export function errorText(err: unknown, fallback = 'Une erreur est survenue.'): string {
  const e = err as { response?: { data?: { message?: string; error?: string } }; message?: string } | null;
  return e?.response?.data?.message || e?.response?.data?.error || (e?.message && !/^Request failed/.test(e.message) ? e.message : '') || fallback;
}
