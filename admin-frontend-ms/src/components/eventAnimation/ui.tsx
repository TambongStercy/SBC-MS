import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import { Download01Icon, RefreshIcon } from '@hugeicons/core-free-icons';
import { getUserDetails } from '../../services/adminUserApi';
import {
    EXPORT_FORMATS, EXPORT_KIND_LABELS, downloadAnimationExport, shortId,
    type ExportFormat, type ExportKind, type ExportScope,
} from '../../api/animation';
import { cn } from '../../lib/cn';
import {
    Badge as KitBadge, Button as KitButton, Dialog, DialogClose, DialogContent, Field, Pagination, Panel, SheetContent, Skeleton, Switch,
    Table as KitTable, TBody, TH, THead, Textarea,
} from '../ui';
import { errorMessage, useAnim, type StatusTable, type Tone } from './shared';

/**
 * Building blocks of the SBC Event « Animation » admin page, on top of the
 * design kit (src/components/ui): same props as before, so every tab keeps
 * working, with the kit's look, tokens and dialogs.
 */

const KIT_TONE: Record<Tone, 'neutral' | 'primary' | 'info' | 'success' | 'warning' | 'danger'> = {
    neutral: 'neutral', primary: 'primary', accent: 'info', success: 'success', warning: 'warning', danger: 'danger',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
    return <KitBadge tone={KIT_TONE[tone]}>{children}</KitBadge>;
}

export function StatusBadge({ status, labels }: { status: string; labels: StatusTable }) {
    const [label, tone] = labels[status] ?? ['Autre', 'neutral' as Tone];
    return <Badge tone={tone}>{label}</Badge>;
}

export function Section({ title, action, children }: { title: ReactNode; action?: ReactNode; children: ReactNode }) {
    return (
        <section className="space-y-2">
            <div className="flex items-center justify-between gap-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">{title}</h3>
                {action}
            </div>
            {children}
        </section>
    );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
    return <Panel className={cn('p-4', className)}>{children}</Panel>;
}

const STAT_TONES: Partial<Record<Tone, string>> = { warning: 'border-warning/50', danger: 'border-danger/50', success: 'border-success/40' };

/** A figure tile; clickable when `to` or `onClick` is given. */
export function Stat({ label, value, hint, tone, to, onClick }: {
    label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; to?: string; onClick?: () => void;
}) {
    const body = (
        <>
            <p className="text-xs font-medium text-fg-muted">{label}</p>
            <div className="mt-2 text-2xl font-semibold tracking-tight text-fg">{value}</div>
            {hint && <div className="mt-1 text-xs text-fg-muted">{hint}</div>}
        </>
    );
    const cls = cn('block w-full rounded-panel border bg-surface p-4 text-left', (tone && STAT_TONES[tone]) || 'border-line');
    if (to) return <Link to={to} className={cn(cls, 'transition-colors hover:border-line-strong')}>{body}</Link>;
    if (onClick) return <button type="button" onClick={onClick} className={cn(cls, 'transition-colors hover:border-line-strong')}>{body}</button>;
    return <div className={cls}>{body}</div>;
}

export type KVItem = [string, ReactNode] | null | false | undefined;

/** Label / value lines. Falsy items are skipped. */
export function KV({ items }: { items: KVItem[] }) {
    const rows = items.filter(Boolean) as [string, ReactNode][];
    return (
        <dl className="divide-y divide-line rounded-panel border border-line text-sm">
            {rows.map(([k, v], i) => (
                <div key={i} className="flex flex-col gap-0.5 px-4 py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                    <dt className="shrink-0 text-xs text-fg-muted sm:w-56">{k}</dt>
                    <dd className="min-w-0 break-words text-fg sm:text-right">{v}</dd>
                </div>
            ))}
        </dl>
    );
}

/** Detail view: a sheet from the right (full screen on phones). */
export function Modal({ title, subtitle, onClose, footer, children }: {
    title: ReactNode; subtitle?: ReactNode; onClose: () => void; footer?: ReactNode; children: ReactNode;
}) {
    return (
        <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
            <SheetContent title={title} description={subtitle} footer={footer} width="xl">
                <div className="space-y-5">{children}</div>
            </SheetContent>
        </Dialog>
    );
}

const BTN = {
    primary: 'primary',
    success: 'primary',
    danger: 'danger',
    warning: 'outline',
    secondary: 'outline',
} as const;

export function Button({ variant = 'secondary', small, disabled, loading, onClick, children, className = '' }: {
    variant?: keyof typeof BTN; small?: boolean; disabled?: boolean; loading?: boolean; onClick?: () => void; children: ReactNode; className?: string;
}) {
    return (
        <KitButton type="button" variant={BTN[variant]} size={small ? 'sm' : 'md'} disabled={disabled} loading={loading}
            onClick={e => { e.stopPropagation(); onClick?.(); }}
            className={cn(!small && 'h-11 sm:h-9', className)}>
            {children}
        </KitButton>
    );
}

/** Kept for native controls still used here (date inputs). */
export const inputCls = 'h-11 sm:h-9 rounded-control border border-line-strong bg-surface px-3 text-sm text-fg focus:outline-none focus:border-primary focus:ring-3 focus:ring-primary/20';
export const selectCls = inputCls;

/** Table frame for the lists inside a detail view (result, live board, stuck refunds). */
export function Table({ headers, children, empty, loading, error, onRetry }: {
    headers: ReactNode[]; children: ReactNode; empty?: ReactNode; loading?: boolean; error?: string | null; onRetry?: () => void;
}) {
    const n = headers.length;
    return (
        <div className="overflow-hidden rounded-panel border border-line bg-surface">
            <KitTable>
                <THead><tr>{headers.map((h, i) => <TH key={i}>{h}</TH>)}</tr></THead>
                <TBody>
                    {loading ? (
                        <tr><td colSpan={n} className="p-4"><div className="space-y-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-8 w-full" />)}</div></td></tr>
                    ) : error ? (
                        <tr><td colSpan={n} className="px-4 py-6 text-center text-sm text-danger">
                            {error} {onRetry && <KitButton variant="outline" size="sm" className="ml-2" onClick={onRetry}><HugeiconsIcon icon={RefreshIcon} size={14} aria-hidden="true" />Réessayer</KitButton>}
                        </td></tr>
                    ) : empty ? (
                        <tr><td colSpan={n} className="px-4 py-8 text-center text-sm text-fg-muted">{empty}</td></tr>
                    ) : children}
                </TBody>
            </KitTable>
        </div>
    );
}

export const tdCls = 'px-4 py-3 align-top text-fg';
export const trCls = 'cursor-pointer transition-colors hover:bg-surface-2/60';

/** Pages under a list ("1-25 sur 134", previous / next). */
export function Pager({ page, totalPages, total, pageSize, onChange }: { page: number; totalPages: number; total?: number; pageSize?: number; onChange: (p: number) => void }) {
    if (totalPages <= 1) return total ? <p className="px-4 py-3 text-xs text-fg-muted">{total.toLocaleString('fr-FR')} résultat{total > 1 ? 's' : ''}</p> : null;
    const size = pageSize ?? Math.ceil((total ?? totalPages) / totalPages);
    return <Pagination page={page} totalPages={totalPages} total={total ?? totalPages * size} pageSize={size} onPageChange={onChange} />;
}

/** Reason field + suggestions inside a confirmation. */
function ReasonField({ label, value, onChange, suggestions, error }: { label: string; value: string; onChange: (v: string) => void; suggestions: string[]; error?: string }) {
    return (
        <div className="space-y-2">
            <Field label={label} error={error}>
                <Textarea value={value} onChange={e => onChange(e.target.value)} rows={3} maxLength={1000} />
            </Field>
            {suggestions.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {suggestions.map(s => (
                        <button key={s} type="button" onClick={() => onChange(s)} className="rounded-md border border-line px-2 py-1 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg">{s}</button>
                    ))}
                </div>
            )}
        </div>
    );
}

const CONFIRM_VARIANT = { danger: 'danger', success: 'primary', primary: 'primary' } as const;

/**
 * Confirmation before an action that takes a reason (suspend, cancel, refund,
 * reject, confirm fraud…). The reason is required (`minLength`) and sent to the
 * API; suggestions fill it in one tap. Errors are toasted, the dialog stays open.
 */
export function ReasonConfirm({ open, title, message, label, minLength = 3, suggestions = [], optional, confirmText, variant = 'danger', onCancel, onConfirm, children }: {
    open: boolean; title: string; message: ReactNode; label: string; minLength?: number; suggestions?: string[];
    /** The reason may stay empty. */
    optional?: boolean;
    confirmText: string; variant?: 'danger' | 'success' | 'primary'; onCancel: () => void;
    /** Resolves when done; throw to keep the dialog open (the error is shown as a toast). */
    onConfirm: (reason: string) => Promise<void>;
    children?: ReactNode;
}) {
    const { notifyError } = useAnim();
    const [reason, setReason] = useState('');
    const [touched, setTouched] = useState(false);
    const [busy, setBusy] = useState(false);
    useEffect(() => { if (open) { setReason(''); setTouched(false); setBusy(false); } }, [open]);
    const trimmed = reason.trim();
    const invalid = optional ? false : trimmed.length < minLength;

    const submit = async () => {
        setTouched(true);
        if (invalid) return;
        setBusy(true);
        try {
            await onConfirm(trimmed);
            onCancel();
        } catch (e) {
            notifyError(errorMessage(e, 'Action impossible.'));
        } finally { setBusy(false); }
    };

    return (
        <Dialog open={open} onOpenChange={o => { if (!o && !busy) onCancel(); }}>
            <DialogContent size="md" title={title}
                footer={(
                    <>
                        <DialogClose asChild><KitButton variant="outline" size="lg" disabled={busy}>Annuler</KitButton></DialogClose>
                        <KitButton variant={CONFIRM_VARIANT[variant]} size="lg" loading={busy} onClick={() => void submit()}>{confirmText}</KitButton>
                    </>
                )}>
                <div className="space-y-4 text-sm text-fg-muted">
                    <div>{message}</div>
                    {children}
                    <ReasonField label={label} value={reason} onChange={setReason} suggestions={suggestions}
                        error={touched && invalid ? `Au moins ${minLength} caractères.` : undefined} />
                </div>
            </DialogContent>
        </Dialog>
    );
}

/** A plain yes/no confirmation; errors are toasted and the dialog stays open. */
export function SimpleConfirm({ open, title, message, confirmText, variant = 'primary', onCancel, onConfirm, children }: {
    open: boolean; title: string; message: ReactNode; confirmText: string; variant?: 'danger' | 'success' | 'primary';
    onCancel: () => void; onConfirm: () => Promise<void>; children?: ReactNode;
}) {
    const { notifyError } = useAnim();
    const [busy, setBusy] = useState(false);
    const run = async () => {
        setBusy(true);
        try { await onConfirm(); onCancel(); } catch (e) { notifyError(errorMessage(e, 'Action impossible.')); } finally { setBusy(false); }
    };
    return (
        <Dialog open={open} onOpenChange={o => { if (!o && !busy) onCancel(); }}>
            <DialogContent size="sm" title={title}
                footer={(
                    <>
                        <DialogClose asChild><KitButton variant="outline" size="lg" disabled={busy}>Annuler</KitButton></DialogClose>
                        <KitButton variant={CONFIRM_VARIANT[variant]} size="lg" loading={busy} onClick={() => void run()}>{confirmText}</KitButton>
                    </>
                )}>
                <div className="space-y-3 text-sm text-fg-muted">
                    <div>{message}</div>
                    {children}
                </div>
            </DialogContent>
        </Dialog>
    );
}

export function Toggle({ label, help, checked, onChange }: { label: string; help?: string; checked: boolean; onChange: (v: boolean) => void }) {
    const id = useId();
    return (
        <div className="flex min-h-11 items-start justify-between gap-3 px-3 py-2.5">
            <label htmlFor={id} className="min-w-0 cursor-pointer">
                <span className="block text-sm font-medium text-fg">{label}</span>
                {help && <span className="block text-xs text-fg-muted">{help}</span>}
            </label>
            <Switch id={id} checked={checked} onCheckedChange={v => onChange(v === true)} className="mt-0.5" />
        </div>
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
        <ul className="divide-y divide-line">
            {kinds.map(kind => (
                <li key={kind} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                    <span className="flex items-center gap-2 text-sm font-medium text-fg">
                        <HugeiconsIcon icon={Download01Icon} size={16} aria-hidden="true" className="text-fg-subtle" />
                        {EXPORT_KIND_LABELS[kind]}
                    </span>
                    <span className="flex gap-1.5">
                        {formats.map(format => (
                            <KitButton key={format} variant="outline" size="sm" className="h-11 min-w-16 sm:h-8" disabled={busy !== null && busy !== `${kind}.${format}`}
                                loading={busy === `${kind}.${format}`} onClick={() => void run(kind, format)}>
                                {FORMAT_LABELS[format]}
                            </KitButton>
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
    if (!id) return <span className="text-fg-muted">{fallback}</span>;
    const contact = m ? [m.phoneNumber ? String(m.phoneNumber) : null, m.email].filter(Boolean).join(' · ') : '';
    return (
        <Link to={`/userpage/${id}`} onClick={e => e.stopPropagation()} className="inline-block min-w-0 hover:underline">
            <span className="block truncate font-medium text-primary">{m?.name || (m === undefined ? '…' : fallback)}</span>
            <span className="block truncate text-xs text-fg-muted">{contact || shortId(id)}</span>
        </Link>
    );
}
