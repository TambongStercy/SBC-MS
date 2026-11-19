/**
 * The agent app's date inputs send a plain day ("2026-11-18") for the end of a
 * period and mean that whole day. Read alone it would be midnight, so the last
 * day would be left out and a one-day period would be empty. A full timestamp
 * is kept as sent.
 */
export function periodEnd(v: unknown): Date {
    const s = String(v ?? '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T23:59:59.999Z`) : new Date(s);
}

/** periodEnd as a string, for forwarding to another service. */
export const periodEndParam = (v: unknown): string | undefined => {
    if (v === undefined || v === null || v === '') return undefined;
    const d = periodEnd(v);
    return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
};
