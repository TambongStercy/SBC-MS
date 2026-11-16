import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import ConfirmationModal from '../common/ConfirmationModal';
import { getUserDetails } from '../../services/adminUserApi';
import {
    EXPORT_FORMATS, EXPORT_KIND_LABELS, downloadAnimationExport, shortId,
    type ExportFormat, type ExportKind, type ExportScope,
} from '../../api/animation';
import { TONE_CLASSES, errorMessage, useAnim, type StatusTable, type Tone } from './shared';

/** Small building blocks of the animation admin page, in the look of the other SBC Event pages. */

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
    return <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${TONE_CLASSES[tone]}`}>{children}</span>;
}

export function StatusBadge({ status, labels }: { status: string; labels: StatusTable }) {
    const [label, tone] = labels[status] ?? ['Autre', 'neutral' as Tone];
    return <Badge tone={tone}>{label}</Badge>;
}

export function Section({ title, action, children }: { title: ReactNode; action?: ReactNode; children: ReactNode }) {
    return (
        <section className="space-y-2">
            <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-400">{title}</h3>
                {action}
            </div>
            {children}
        </section>
    );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
    return <div className={`bg-gray-800 border border-gray-700 rounded-xl p-4 ${className}`}>{children}</div>;
}

const STAT_TONES: Partial<Record<Tone, string>> = { warning: 'border-amber-600', danger: 'border-red-600', success: 'border-emerald-700' };

/** A figure tile; clickable when `to` or `onClick` is given. */
export function Stat({ label, value, hint, tone, to, onClick }: {
    label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; to?: string; onClick?: () => void;
}) {
    const body = (
        <>
            <div className="text-xs text-gray-400 uppercase">{label}</div>
            <div className="text-2xl font-bold mt-1">{value}</div>
            {hint && <div className="text-xs text-gray-400 mt-1">{hint}</div>}
        </>
    );
    const cls = `block text-left w-full bg-gray-800 border rounded-xl p-4 ${(tone && STAT_TONES[tone]) || 'border-gray-700'}`;
    if (to) return <Link to={to} className={`${cls} hover:bg-gray-700/60 transition-colors`}>{body}</Link>;
    if (onClick) return <button type="button" onClick={onClick} className={`${cls} hover:bg-gray-700/60 transition-colors`}>{body}</button>;
    return <div className={cls}>{body}</div>;
}

export type KVItem = [string, ReactNode] | null | false | undefined;

/** Label / value lines. Falsy items are skipped. */
export function KV({ items }: { items: KVItem[] }) {
    const rows = items.filter(Boolean) as [string, ReactNode][];
    return (
        <dl className="divide-y divide-gray-700 border border-gray-700 rounded-lg text-sm">
            {rows.map(([k, v], i) => (
                <div key={i} className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 px-3 py-2">
                    <dt className="sm:w-56 shrink-0 text-gray-400">{k}</dt>
                    <dd className="text-gray-100 break-words min-w-0">{v}</dd>
                </div>
            ))}
        </dl>
    );
}

/** A large panel over the page (detail views). */
export function Modal({ title, subtitle, onClose, footer, children }: {
    title: ReactNode; subtitle?: ReactNode; onClose: () => void; footer?: ReactNode; children: ReactNode;
}) {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);
    return (
        <div className="fixed inset-0 bg-black/70 z-40 flex justify-center items-start sm:items-center p-2 sm:p-6" onClick={onClose}>
            <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-xl w-full max-w-4xl max-h-full flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-700">
                    <div className="min-w-0">
                        <h2 className="text-lg font-semibold text-white truncate">{title}</h2>
                        {subtitle && <div className="text-sm text-gray-400 truncate">{subtitle}</div>}
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none px-2" aria-label="Fermer">×</button>
                </div>
                <div className="overflow-y-auto px-5 py-4 space-y-5">{children}</div>
                {footer && <div className="px-5 py-3 border-t border-gray-700 flex flex-wrap justify-end gap-2">{footer}</div>}
            </div>
        </div>
    );
}

const BTN: Record<string, string> = {
    primary: 'bg-blue-600 hover:bg-blue-700 text-white',
    success: 'bg-emerald-600 hover:bg-emerald-700 text-white',
    danger: 'bg-red-600 hover:bg-red-700 text-white',
    warning: 'bg-amber-600 hover:bg-amber-700 text-white',
    secondary: 'bg-gray-700 hover:bg-gray-600 text-white border border-gray-600',
};

export function Button({ variant = 'secondary', small, disabled, onClick, children, className = '' }: {
    variant?: keyof typeof BTN; small?: boolean; disabled?: boolean; onClick?: () => void; children: ReactNode; className?: string;
}) {
    return (
        <button type="button" onClick={onClick} disabled={disabled}
            className={`${small ? 'text-xs px-2 py-1' : 'text-sm px-3 py-2'} rounded-lg disabled:opacity-40 disabled:cursor-not-allowed ${BTN[variant]} ${className}`}>
            {children}
        </button>
    );
}

export const selectCls = 'border border-gray-600 rounded-lg px-3 py-2 text-sm bg-gray-700 text-white hover:bg-gray-600';
export const inputCls = 'border border-gray-600 rounded-lg px-3 py-2 text-sm bg-gray-700 text-white';

/** Table frame used by every list on the page. */
export function Table({ headers, children, empty, loading, error, onRetry }: {
    headers: ReactNode[]; children: ReactNode; empty?: ReactNode; loading?: boolean; error?: string | null; onRetry?: () => void;
}) {
    return (
        <div className="overflow-x-auto bg-gray-800 rounded-xl border border-gray-700">
            <table className="min-w-full text-sm">
                <thead className="bg-gray-900/50 text-gray-300">
                    <tr>{headers.map((h, i) => <th key={i} className="px-4 py-2 text-left font-medium whitespace-nowrap">{h}</th>)}</tr>
                </thead>
                <tbody>
                    {loading ? (
                        <tr><td colSpan={headers.length} className="px-4 py-6 text-center text-gray-400">Chargement…</td></tr>
                    ) : error ? (
                        <tr><td colSpan={headers.length} className="px-4 py-6 text-center text-red-300">
                            {error} {onRetry && <button onClick={onRetry} className="underline ml-2">Réessayer</button>}
                        </td></tr>
                    ) : empty ? (
                        <tr><td colSpan={headers.length} className="px-4 py-6 text-center text-gray-400">{empty}</td></tr>
                    ) : children}
                </tbody>
            </table>
        </div>
    );
}

export const tdCls = 'px-4 py-2 align-top';
export const trCls = 'border-t border-gray-700 hover:bg-gray-700/40 cursor-pointer';

/** Previous / next with the page count, in French. */
export function Pager({ page, totalPages, total, onChange }: { page: number; totalPages: number; total?: number; onChange: (p: number) => void }) {
    if (totalPages <= 1) return total !== undefined ? <p className="text-xs text-gray-400">{total} résultat{total > 1 ? 's' : ''}</p> : null;
    return (
        <div className="flex items-center justify-end gap-3 text-sm">
            {total !== undefined && <span className="text-gray-400 mr-auto">{total} résultats</span>}
            <Button disabled={page <= 1} onClick={() => onChange(page - 1)}>Précédent</Button>
            <span className="text-gray-400">Page {page} / {totalPages}</span>
            <Button disabled={page >= totalPages} onClick={() => onChange(page + 1)}>Suivant</Button>
        </div>
    );
}

/**
 * Confirmation before an action that takes a reason (suspend, cancel, refund,
 * reject, confirm fraud…). The reason is required (`minLength`) and sent to the
 * API; suggestions fill it in one tap. Errors are toasted, the modal stays open.
 */
export function ReasonConfirm({ open, title, message, label, minLength = 3, suggestions = [], optional, confirmText, variant = 'danger', onCancel, onConfirm, children }: {
    open: boolean; title: string; message: ReactNode; label: string; minLength?: number; suggestions?: string[];
    /** The reason may stay empty. */
    optional?: boolean;
    confirmText: string; variant?: 'danger' | 'success' | 'primary'; onCancel: () => void;
    /** Resolves when done; throw to keep the modal open (the error is shown as a toast). */
    onConfirm: (reason: string) => Promise<void>;
    children?: ReactNode;
}) {
    const { notifyError } = useAnim();
    const [reason, setReason] = useState('');
    const [touched, setTouched] = useState(false);
    useEffect(() => { if (open) { setReason(''); setTouched(false); } }, [open]);
    const trimmed = reason.trim();
    const invalid = optional ? false : trimmed.length < minLength;

    const submit = async () => {
        setTouched(true);
        if (invalid) return;
        try {
            await onConfirm(trimmed);
            onCancel();
        } catch (e) {
            notifyError(errorMessage(e, 'Action impossible.'));
        }
    };

    return (
        <ConfirmationModal isOpen={open} title={title} message={message} confirmText={confirmText} cancelText="Annuler"
            variant={variant} onCancel={onCancel} onConfirm={() => (invalid ? setTouched(true) : submit())}>
            <div className="mb-5 space-y-2">
                {children}
                <label className="block text-sm text-gray-300">{label}</label>
                <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={1000}
                    className="w-full border border-gray-600 rounded-lg px-3 py-2 text-sm bg-gray-700 text-white" />
                {suggestions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                        {suggestions.map(s => (
                            <button key={s} type="button" onClick={() => setReason(s)} className="text-xs px-2 py-1 rounded-full bg-gray-700 text-gray-200 hover:bg-gray-600">{s}</button>
                        ))}
                    </div>
                )}
                {touched && invalid && <p className="text-xs text-red-400">Au moins {minLength} caractères.</p>}
            </div>
        </ConfirmationModal>
    );
}

/** A plain yes/no confirmation; errors are toasted and the modal stays open. */
export function SimpleConfirm({ open, title, message, confirmText, variant = 'primary', onCancel, onConfirm, children }: {
    open: boolean; title: string; message: ReactNode; confirmText: string; variant?: 'danger' | 'success' | 'primary';
    onCancel: () => void; onConfirm: () => Promise<void>; children?: ReactNode;
}) {
    const { notifyError } = useAnim();
    return (
        <ConfirmationModal isOpen={open} title={title} message={message} confirmText={confirmText} cancelText="Annuler" variant={variant}
            onCancel={onCancel}
            onConfirm={async () => {
                try { await onConfirm(); onCancel(); } catch (e) { notifyError(errorMessage(e, 'Action impossible.')); }
            }}>
            {children && <div className="mb-5">{children}</div>}
        </ConfirmationModal>
    );
}

export function Toggle({ label, help, checked, onChange }: { label: string; help?: string; checked: boolean; onChange: (v: boolean) => void }) {
    return (
        <label className="flex items-start justify-between gap-3 px-3 py-2.5 cursor-pointer">
            <span className="min-w-0"><span className="block text-sm font-semibold text-gray-100">{label}</span>{help && <span className="block text-xs text-gray-400">{help}</span>}</span>
            <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="mt-1 h-4 w-4 accent-emerald-500" />
        </label>
    );
}

const FORMAT_LABELS: Record<ExportFormat, string> = { csv: 'CSV', xlsx: 'Excel', pdf: 'PDF' };

/**
 * One line per export, one button per format. Downloads through apiClient
 * (admin token); the server's own message is shown when it refuses.
 */
export function ExportButtons({ kinds, scope, formats = EXPORT_FORMATS }: { kinds: ExportKind[]; scope: ExportScope; formats?: ExportFormat[] }) {
    const { notifySuccess, notifyError } = useAnim();
    const [busy, setBusy] = useState<string | null>(null);
    const run = async (kind: ExportKind, format: ExportFormat) => {
        setBusy(`${kind}.${format}`);
        try {
            await downloadAnimationExport(kind, format, scope);
            notifySuccess(`Export ${EXPORT_KIND_LABELS[kind]} (${FORMAT_LABELS[format]}) téléchargé.`);
        } catch (e) {
            notifyError(e instanceof Error ? e.message : 'Export impossible.');
        } finally { setBusy(null); }
    };
    return (
        <ul className="divide-y divide-gray-700">
            {kinds.map(kind => (
                <li key={kind} className="flex items-center justify-between gap-3 py-2">
                    <span className="text-sm font-semibold text-gray-100">{EXPORT_KIND_LABELS[kind]}</span>
                    <span className="flex gap-1.5">
                        {formats.map(format => (
                            <Button key={format} small disabled={busy !== null} onClick={() => run(kind, format)}>
                                {busy === `${kind}.${format}` ? '…' : FORMAT_LABELS[format]}
                            </Button>
                        ))}
                    </span>
                </li>
            ))}
        </ul>
    );
}

// ---------- members ----------

type Member = { name?: string; email?: string; phoneNumber?: number | string };
const memberCache = new Map<string, Promise<Member | null>>();
const loadMember = (id: string) => {
    if (!memberCache.has(id)) memberCache.set(id, getUserDetails(id).then(u => u as Member).catch(() => null));
    return memberCache.get(id)!;
};

/** A member by id: name and contact (fetched once per id), linking to their admin page. */
export function UserRef({ id, fallback = 'Membre' }: { id?: string | null; fallback?: string }) {
    const [m, setM] = useState<Member | null | undefined>(undefined);
    useEffect(() => {
        if (!id) return;
        let alive = true;
        loadMember(id).then(r => { if (alive) setM(r); });
        return () => { alive = false; };
    }, [id]);
    if (!id) return <span className="text-gray-400">{fallback}</span>;
    const contact = m ? [m.phoneNumber ? String(m.phoneNumber) : null, m.email].filter(Boolean).join(' · ') : '';
    return (
        <Link to={`/userpage/${id}`} onClick={e => e.stopPropagation()} className="inline-block min-w-0 hover:underline">
            <span className="block font-medium text-blue-300 truncate">{m?.name || (m === undefined ? '…' : fallback)}</span>
            <span className="block text-xs text-gray-400 truncate">{contact || shortId(id)}</span>
        </Link>
    );
}
