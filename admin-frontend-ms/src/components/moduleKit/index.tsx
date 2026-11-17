import { useEffect, useState, type ReactNode } from 'react';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  Alert02Icon, ArrowRight01Icon, InformationCircleIcon, Cancel01Icon, Copy01Icon, FilterHorizontalIcon, MoreHorizontalIcon, RefreshIcon, Search01Icon, Tick02Icon,
} from '@hugeicons/core-free-icons';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { cn } from '../../lib/cn';
import {
  Badge, Button, Dialog, DialogClose, DialogContent, EmptyState, Field, Input, Menu, MenuContent, MenuTrigger, Panel, Select, SheetContent,
  Textarea, Tooltip,
} from '../ui';
import { formatFullDateTime, formatMoney, formatRelative, errorText } from './format';

export * from './format';
export { useUrlFilters } from './useUrlFilters';

/* ------------------------------------------------------------------ values */

/** An amount with its unit, tabular digits ("12 500 F", "45,20 $"). */
export function Money({ value, currency, className }: { value: number | null | undefined; currency?: string; className?: string }) {
  return <span className={cn('tabular-nums whitespace-nowrap', className)}>{formatMoney(value, currency)}</span>;
}

/** "il y a 2 h" with the full date in a tooltip (relative only when recent). */
export function DateText({ value, className }: { value: string | number | Date | null | undefined; className?: string }) {
  if (!value) return <span className={cn('text-fg-subtle', className)}>—</span>;
  return (
    <Tooltip content={formatFullDateTime(value)}>
      <time dateTime={new Date(value).toISOString()} className={cn('whitespace-nowrap', className)} tabIndex={0}>
        {formatRelative(value)}
      </time>
    </Tooltip>
  );
}

export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';
/** status → [French label, tone, icon?] */
export type StatusMap = Record<string, readonly [string, Tone, IconSvgElement?]>;

/** A status in words, coloured by what it means. Unknown codes fall back to a neutral badge. */
export function StatusBadge({ status, map, className }: { status?: string | null; map: StatusMap; className?: string }) {
  if (!status) return <span className="text-fg-subtle">—</span>;
  const [label, tone, icon] = map[status] ?? [status, 'neutral' as Tone];
  return (
    <Badge tone={tone} className={className}>
      {icon && <HugeiconsIcon icon={icon} size={12} aria-hidden="true" />}
      {label}
    </Badge>
  );
}

/** A long id shown short, copied in full on click. */
export function CopyId({ value, label = 'Copier l’identifiant' }: { value?: string | null; label?: string }) {
  if (!value) return <span className="text-fg-subtle">—</span>;
  return (
    <Tooltip content={label}>
      <button
        type="button"
        onClick={e => { e.stopPropagation(); void navigator.clipboard?.writeText(value).then(() => toast.success('Identifiant copié.')); }}
        className="inline-flex items-center gap-1 rounded-md font-mono text-xs text-fg-muted hover:text-fg"
      >
        …{value.slice(-8)}
        <HugeiconsIcon icon={Copy01Icon} size={12} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}

/** Label/value lines for a details sheet. Falsy rows are skipped. */
export function DetailList({ items, className }: { items: Array<[ReactNode, ReactNode] | null | false | undefined>; className?: string }) {
  return (
    <dl className={cn('divide-y divide-line rounded-panel border border-line', className)}>
      {items.filter(Boolean).map((row, i) => {
        const [k, v] = row as [ReactNode, ReactNode];
        return (
          <div key={i} className="flex flex-col gap-0.5 px-4 py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
            <dt className="shrink-0 text-xs text-fg-muted">{k}</dt>
            <dd className="min-w-0 break-words text-sm text-fg sm:text-right">{v ?? '—'}</dd>
          </div>
        );
      })}
    </dl>
  );
}

/** A titled block inside a details sheet. */
export function SheetSection({ title, children, actions }: { title: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  );
}

/* ----------------------------------------------------------------- queues */

export interface TodoItem {
  key: string;
  label: ReactNode;
  count: number;
  hint?: ReactNode;
  action?: ReactNode;
  tone?: 'warning' | 'danger' | 'info';
}

/**
 * "À traiter": what needs the person opening the page, first. Items at 0 are
 * folded into a single "Rien à traiter" line.
 */
export function TodoPanel({ items, loading, title = 'À traiter', className }: { items: TodoItem[]; loading?: boolean; title?: ReactNode; className?: string }) {
  const open = items.filter(i => i.count > 0);
  return (
    <Panel className={cn('overflow-hidden', open.length > 0 && 'border-warning/40', className)} aria-busy={loading || undefined}>
      <div className={cn('flex items-center gap-2 px-4 py-3 sm:px-5', (loading || open.length > 0) && 'border-b border-line')}>
        <HugeiconsIcon icon={open.length ? Alert02Icon : Tick02Icon} size={18} aria-hidden="true" className={open.length ? 'text-warning' : 'text-success'} />
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        {!loading && <span className="text-sm text-fg-muted">{open.length ? `${open.reduce((s, i) => s + i.count, 0).toLocaleString('fr-FR')} en attente` : 'Rien à traiter'}</span>}
      </div>
      {loading ? (
        <div className="px-4 py-3 text-sm text-fg-muted sm:px-5">Chargement…</div>
      ) : open.length === 0 ? null : (
        <ul className="divide-y divide-line">
          {open.map(i => (
            <li key={i.key} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div className="flex min-w-0 items-start gap-3">
                <span className={cn('mt-0.5 inline-flex min-w-8 justify-center rounded-md px-1.5 py-0.5 text-sm font-semibold tabular-nums',
                  i.tone === 'danger' ? 'bg-danger-soft text-danger' : i.tone === 'info' ? 'bg-info-soft text-info' : 'bg-warning-soft text-fg')}>
                  {i.count.toLocaleString('fr-FR')}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-fg">{i.label}</p>
                  {i.hint && <p className="text-xs text-fg-muted">{i.hint}</p>}
                </div>
              </div>
              {i.action && <div className="shrink-0">{i.action}</div>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** Small "Ouvrir →" link-style button for TodoPanel items. */
export function TodoAction({ children, onClick, href }: { children: ReactNode; onClick?: () => void; href?: string }) {
  const inner = (<>{children}<HugeiconsIcon icon={ArrowRight01Icon} size={16} aria-hidden="true" /></>);
  if (href) return <Button asChild variant="soft" size="md" className="h-11 w-full sm:h-9 sm:w-auto"><Link to={href}>{inner}</Link></Button>;
  return <Button variant="soft" size="md" className="h-11 w-full sm:h-9 sm:w-auto" onClick={onClick}>{inner}</Button>;
}

/* --------------------------------------------------------------- filters */

/** Search box, debounced (the URL/API is updated 300 ms after typing stops). */
export function SearchInput({ value, onChange, placeholder = 'Rechercher…', className, delay = 300 }: {
  value: string; onChange: (v: string) => void; placeholder?: string; className?: string; delay?: number;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => {
    if (draft === value) return;
    const t = setTimeout(() => onChange(draft), delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);
  return (
    <div className={cn('relative min-w-0', className)}>
      <HugeiconsIcon icon={Search01Icon} size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
      <Input type="search" value={draft} onChange={e => setDraft(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="h-11 pl-9 sm:h-9" />
    </div>
  );
}

const ALL = '__all__';
/** A select whose empty choice ("Tous les statuts") maps to ''. */
export function FilterSelect({ value, onChange, options, allLabel, label, className }: {
  value: string; onChange: (v: string) => void; options: { value: string; label: ReactNode }[]; allLabel: string; label: string; className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <span className="sr-only">{label}</span>
      <Select
        value={value || ALL}
        onValueChange={v => onChange(v === ALL ? '' : v)}
        options={[{ value: ALL, label: allLabel }, ...options]}
        className="h-11 sm:h-9"
      />
    </div>
  );
}

/**
 * One filter row: search + a few selects, "Effacer les filtres" when any is
 * set. On phones, when there are more than 2 filters besides the search, they
 * collapse into a "Filtres" sheet.
 */
export function FilterBar({ search, filters, filterCount = 0, activeCount, onClear, trailing, className }: {
  search?: ReactNode;
  filters?: ReactNode;
  /** How many filter controls `filters` holds (decides the phone layout). */
  filterCount?: number;
  activeCount: number;
  onClear: () => void;
  trailing?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const collapse = filterCount > 2;
  const clear = activeCount > 0 && (
    <Button variant="ghost" size="md" className="h-11 sm:h-9" onClick={onClear}>
      <HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden="true" />
      Effacer les filtres
    </Button>
  );
  return (
    <div className={cn('flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center', className)}>
      {search && <div className="min-w-0 sm:w-72">{search}</div>}
      {filters && (
        <div className={cn('grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center [&>*]:sm:w-48', collapse && 'hidden sm:flex')}>{filters}</div>
      )}
      {collapse && (
        <div className="sm:hidden">
          <Dialog open={open} onOpenChange={setOpen}>
            <Button variant="outline" size="lg" className="w-full" onClick={() => setOpen(true)}>
              <HugeiconsIcon icon={FilterHorizontalIcon} size={16} aria-hidden="true" />
              Filtres{activeCount > 0 ? ` (${activeCount})` : ''}
            </Button>
            <SheetContent
              title="Filtres"
              footer={(
                <>
                  {activeCount > 0 && <Button variant="outline" size="lg" onClick={() => { onClear(); setOpen(false); }}>Effacer les filtres</Button>}
                  <DialogClose asChild><Button variant="primary" size="lg">Voir les résultats</Button></DialogClose>
                </>
              )}
            >
              <div className="grid gap-3">{filters}</div>
            </SheetContent>
          </Dialog>
        </div>
      )}
      <div className={cn('flex items-center gap-2', collapse && 'hidden sm:flex')}>{clear}</div>
      {trailing && <div className="flex items-center gap-2 sm:ml-auto">{trailing}</div>}
    </div>
  );
}

/* ----------------------------------------------------------------- states */

/** What a failed load means, with "Réessayer". */
export function ErrorState({ error, onRetry, retrying, title = 'Le chargement a échoué' }: { error?: unknown; onRetry: () => void; retrying?: boolean; title?: string }) {
  return (
    <EmptyState
      icon={RefreshIcon}
      title={title}
      description={errorText(error, 'Vérifiez la connexion, puis réessayez.')}
      action={<Button size="lg" onClick={onRetry} loading={retrying}>Réessayer</Button>}
    />
  );
}

/* ---------------------------------------------------------------- actions */

/** The ⋯ button that opens a row's secondary actions (children = MenuItems). */
export function RowMenu({ children, label = 'Plus d’actions' }: { children: ReactNode; label?: string }) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-11 w-11 sm:h-9 sm:w-9" aria-label={label} onClick={e => e.stopPropagation()}>
          <HugeiconsIcon icon={MoreHorizontalIcon} size={18} aria-hidden="true" />
        </Button>
      </MenuTrigger>
      <MenuContent onClick={e => e.stopPropagation()}>{children}</MenuContent>
    </Menu>
  );
}

export interface ConfirmOptions {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  /** Ask for a reason (sent to the API). */
  reason?: { label: string; required?: boolean; minLength?: number; placeholder?: string; suggestions?: string[]; initial?: string };
  /** Extra content (summary of what is being acted on). */
  body?: ReactNode;
  onConfirm: (reason: string) => Promise<unknown> | unknown;
}

/**
 * Confirmation dialog for destructive or important actions, with an optional
 * reason field. Stays open (button loading) while the action runs; closes on
 * success, stays open on failure so the person can retry.
 */
export function ConfirmDialog({ options, onClose }: { options: ConfirmOptions | null; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setReason(options?.reason?.initial ?? ''); setBusy(false); }, [options]);
  const min = options?.reason ? (options.reason.minLength ?? (options.reason.required ? 3 : 0)) : 0;
  const invalid = !!options?.reason && reason.trim().length < min;
  const run = async () => {
    if (!options || invalid) return;
    setBusy(true);
    try {
      await options.onConfirm(reason.trim());
      onClose();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!options} onOpenChange={o => { if (!o && !busy) onClose(); }}>
      {options && (
        <DialogContent
          size="sm"
          title={options.title}
          description={options.description}
          footer={(
            <>
              <DialogClose asChild><Button variant="outline" size="lg" disabled={busy}>Annuler</Button></DialogClose>
              <Button variant={options.tone === 'primary' ? 'primary' : 'danger'} size="lg" loading={busy} disabled={invalid} onClick={() => void run()}>
                {options.confirmLabel}
              </Button>
            </>
          )}
        >
          {(options.body || options.reason) && (
            <div className="space-y-3">
              {options.body}
              {options.reason && (
                <Field label={options.reason.label} required={options.reason.required} help={min > 0 ? `${min} caractères au moins.` : undefined}>
                  <Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder={options.reason.placeholder} rows={3} />
                </Field>
              )}
              {options.reason?.suggestions && options.reason.suggestions.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {options.reason.suggestions.map(s => (
                    <button key={s} type="button" onClick={() => setReason(s)} className="rounded-md border border-line px-2 py-1 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg">
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}

/** Notice line inside a page (info / warning), never a modal. */
export function Notice({ tone = 'info', icon, children, className }: { tone?: 'info' | 'warning' | 'danger' | 'success'; icon?: IconSvgElement; children: ReactNode; className?: string }) {
  const cls = { info: 'border-info/30 bg-info-soft/50', warning: 'border-warning/40 bg-warning-soft/60', danger: 'border-danger/30 bg-danger-soft/50', success: 'border-success/30 bg-success-soft/50' }[tone];
  const ic = { info: 'text-info', warning: 'text-warning', danger: 'text-danger', success: 'text-success' }[tone];
  return (
    <div className={cn('flex items-start gap-3 rounded-panel border px-4 py-3 text-sm text-fg', cls, className)} role={tone === 'danger' ? 'alert' : 'status'}>
      <HugeiconsIcon icon={icon ?? (tone === 'info' ? InformationCircleIcon : tone === 'success' ? Tick02Icon : Alert02Icon)} size={18} aria-hidden="true" className={cn('mt-0.5 shrink-0', ic)} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export { TrendChart, type TrendPoint } from './TrendChart';
export { RankedBars, type RankedBar } from './RankedBars';
