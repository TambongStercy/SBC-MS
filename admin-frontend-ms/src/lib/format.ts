/** French formatting used across the admin: money, dates, phones, "il y a". */

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

/** 12 500 FCFA · 3,50 $ — XAF is shown as FCFA, as members see it. */
export function formatMoney(amount: number | null | undefined, currency: string = 'XAF'): string {
    if (amount === null || amount === undefined || Number.isNaN(amount)) return '—';
    const c = (currency || 'XAF').toUpperCase();
    if (c === 'XAF' || c === 'XOF' || c === 'FCFA') return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.round(amount))} FCFA`;
    if (c === 'USD') return `${nf.format(amount)} $`;
    return `${nf.format(amount)} ${c}`;
}

export const formatNumber = (n: number | null | undefined) =>
    n === null || n === undefined ? '—' : new Intl.NumberFormat('fr-FR').format(n);

/** 1,2 M · 45 k — for tight tiles. */
export function formatCompact(n: number | null | undefined): string {
    if (n === null || n === undefined) return '—';
    return new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export const formatDate = (iso?: string | Date | null) => (iso ? dateFmt.format(new Date(iso)) : '—');
export const formatDateTime = (iso?: string | Date | null) => (iso ? dateTimeFmt.format(new Date(iso)) : '—');

/** "à l'instant", "il y a 5 min", "il y a 3 h", "il y a 2 j", then the date. */
export function timeAgo(iso?: string | Date | null, now: Date = new Date()): string {
    if (!iso) return '—';
    const min = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
    if (min < 1) return "à l'instant";
    if (min < 60) return `il y a ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `il y a ${h} h`;
    const d = Math.floor(h / 24);
    if (d < 7) return `il y a ${d} j`;
    return formatDate(iso);
}

/** +237 6 77 12 34 56 — readable grouping of a stored number (digits, country code first). */
export function formatPhone(raw?: string | number | null): string {
    if (raw === null || raw === undefined || raw === '') return '—';
    const d = String(raw).replace(/\D/g, '');
    const cc = ['237', '242', '241', '243', '225', '229', '228', '226', '223', '224', '221', '227', '235', '236', '233', '234', '254', '250'].find(c => d.startsWith(c) && d.length > c.length + 6);
    const rest = cc ? d.slice(cc.length) : d;
    const grouped = rest.length === 9 ? `${rest[0]} ${rest.slice(1, 3)} ${rest.slice(3, 5)} ${rest.slice(5, 7)} ${rest.slice(7)}` : rest.replace(/(\d{2})(?=\d)/g, '$1 ');
    return cc ? `+${cc} ${grouped}` : grouped;
}

/** Midnight today in Douala (UTC+1, no DST), as an ISO string. */
export function startOfTodayDouala(now: Date = new Date()): string {
    const douala = new Date(now.getTime() + 60 * 60 * 1000);
    douala.setUTCHours(0, 0, 0, 0);
    return new Date(douala.getTime() - 60 * 60 * 1000).toISOString();
}

/** Today's date in Douala as YYYY-MM-DD (for APIs that take a day). */
export const todayDouala = (now: Date = new Date()) => new Date(now.getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);

export const initials = (name?: string | null) =>
    (name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || '?';

/**
 * A small resized copy of a stored image, served from our own origin (behind
 * Cloudflare). The direct bucket URL has no cache in front and costs egress on
 * the full file every time — see CLAUDE.md "Cloud Storage bills egress".
 */
export function thumbnailUrl(fileIdOrUrl?: string | null, width = 96): string {
    if (!fileIdOrUrl) return '';
    const base = (import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:3000/api';
    const bucket = 'https://storage.googleapis.com/sbc-file-storage/';
    const id = fileIdOrUrl.startsWith(bucket) ? fileIdOrUrl.slice(bucket.length) : fileIdOrUrl;
    if (/^https?:\/\//.test(id)) return fileIdOrUrl;
    return `${base}/settings/files/${encodeURIComponent(id)}?w=${width}`;
}
