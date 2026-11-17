import { useCallback, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel01Icon, Copy01Icon, FilterHorizontalIcon, Search01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { PageFilters } from '../filters/PageFilters';
import type { PageFilters as SharedFilters } from '../../hooks/usePageFilters';
import { Badge, Button, DialogClose, Input, SheetContent } from '../ui';
import { cn } from '../../lib/cn';
import { currencyUnit } from '../common/format';

/**
 * Exact amount with its unit, for money pages: "7 995 F", "2 306,25 F",
 * "45,20 $". Unlike formatMoney it never rounds francs away (withdrawal fees
 * are stored to the centime and the provider dashboards are searched by them).
 */
export function exactMoney(value: number | null | undefined, currency?: string | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const unit = currencyUnit(currency ?? 'XAF');
  const digits = unit === 'F' ? { minimumFractionDigits: 0, maximumFractionDigits: 2 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  // Known units ("F", "$", "€") after the number; an unknown code (GHS…) too.
  return `${new Intl.NumberFormat('fr-FR', digits).format(value)}\u202f${unit}`;
}

/**
 * Filters kept in the URL. `set` changes some keys (empty → removed) and
 * goes back to page 1 unless the page itself is being set.
 */
export function useUrlFilters() {
  const [params, setParams] = useSearchParams();
  const get = useCallback((key: string, fallback = '') => params.get(key) ?? fallback, [params]);
  const set = useCallback((patch: Record<string, string | number | null | undefined>) => {
    setParams(prev => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined || v === '') next.delete(k);
        else next.set(k, String(v));
      }
      if (!('page' in patch)) next.delete('page');
      return next;
    }, { replace: true });
  }, [setParams]);
  const clear = useCallback((keys: string[]) => {
    setParams(prev => {
      const next = new URLSearchParams(prev);
      keys.forEach(k => next.delete(k));
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setParams]);
  const page = Math.max(1, Number(params.get('page')) || 1);
  return { params, get, set, clear, page };
}

/** Search box that applies on Enter or on the button (not on each key). */
export function SearchBox({ value, onSearch, placeholder, label, className }: {
  value: string;
  onSearch: (v: string) => void;
  placeholder: string;
  label: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  // URL changed elsewhere (Effacer les filtres, back button): follow it.
  if (synced !== value) { setSynced(value); setDraft(value); }
  return (
    <form
      role="search"
      className={cn('flex min-w-0 gap-2', className)}
      onSubmit={e => { e.preventDefault(); onSearch(draft.trim()); }}
    >
      <div className="relative min-w-0 flex-1">
        <HugeiconsIcon icon={Search01Icon} size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
        <Input
          type="search"
          aria-label={label}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => { if (draft.trim() !== value) onSearch(draft.trim()); }}
          placeholder={placeholder}
          className="h-11 pl-9 sm:h-9"
        />
      </div>
      <Button type="submit" variant="outline" className="h-11 sm:h-9">Rechercher</Button>
    </form>
  );
}

/** A "Filtres" button showing how many extra filters are set, opening a sheet. */
export function MoreFiltersButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <Button variant="outline" className="h-11 sm:h-9" onClick={onClick}>
      <HugeiconsIcon icon={FilterHorizontalIcon} size={16} aria-hidden="true" />
      Filtres
      {count > 0 && <Badge tone="primary" className="tabular-nums">{count}</Badge>}
    </Button>
  );
}

/** Sheet holding the less-used filters, applied together. */
export function FiltersSheet({ title = 'Filtres', onApply, onReset, children }: {
  title?: string;
  onApply: () => void;
  onReset: () => void;
  children: ReactNode;
}) {
  return (
    <SheetContent
      title={title}
      description="Les filtres s’appliquent à toute la liste."
      footer={(
        <>
          <Button variant="ghost" size="lg" onClick={onReset}>Réinitialiser</Button>
          <DialogClose asChild>
            <Button variant="primary" size="lg" onClick={onApply}>Appliquer</Button>
          </DialogClose>
        </>
      )}
    >
      <div className="space-y-4">{children}</div>
    </SheetContent>
  );
}

/** Label / value lines in a details sheet. */
export function DetailList({ items, className }: { items: { label: ReactNode; value: ReactNode; mono?: boolean; hidden?: boolean }[]; className?: string }) {
  return (
    <dl className={cn('divide-y divide-line rounded-control border border-line', className)}>
      {items.filter(i => !i.hidden).map((i, idx) => (
        <div key={idx} className="flex flex-col gap-0.5 px-3 py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
          <dt className="shrink-0 text-xs text-fg-muted">{i.label}</dt>
          <dd className={cn('min-w-0 break-words text-sm text-fg sm:text-right', i.mono && 'font-mono text-xs')}>{i.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A section title inside a sheet. */
export function SheetSection({ title, children, className }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-2', className)}>
      <h3 className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{title}</h3>
      {children}
    </section>
  );
}

/** Copies a reference (transaction id, provider id) to the clipboard. */
export function CopyButton({ value, label = 'Copier' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success('Copié.');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Copie impossible : sélectionnez le texte et copiez-le à la main.');
    }
  };
  return (
    <Button variant="ghost" size="icon-sm" onClick={copy} aria-label={label} className="-my-1 shrink-0">
      <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} size={14} aria-hidden="true" />
    </Button>
  );
}

/** A reference shown in monospace with a copy button. */
export function Reference({ value }: { value?: string | null }) {
  if (!value) return <span className="text-fg-subtle">—</span>;
  return (
    <span className="inline-flex max-w-full items-center gap-1">
      <span className="min-w-0 break-all font-mono text-xs">{value}</span>
      <CopyButton value={value} />
    </span>
  );
}

/** Downloads rows as a CSV file (quoted cells, UTF-8 with BOM so Excel reads accents). */
export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (c: string | number) => `"${String(c).replace(/"/g, '""')}"`;
  const csv = [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** The message of a thrown error (server message for an API error), or the fallback. */
export function errorMessage(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: { message?: string } } })?.response?.data;
  if (data?.message) return data.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/** URL keys of the shared country + period filters (usePageFilters). */
export const SHARED_FILTER_KEYS = ['pays', 'periode', 'du', 'au'];

/**
 * The page's single filter row: shared country + period (PageFilters), then
 * the page's own filters. One "Effacer les filtres": PageFilters' own when
 * country/period are set, ours otherwise. Both clear everything in one URL
 * update (two setSearchParams in a row would overwrite each other).
 */
export function FilterRow({ filters, ownKeys, ownActive, hideCountry, hidePeriod, children }: {
  filters: SharedFilters;
  /** URL keys of the page's own filters. */
  ownKeys: string[];
  ownActive: boolean;
  hideCountry?: boolean;
  hidePeriod?: boolean;
  children?: ReactNode;
}) {
  const { clear } = useUrlFilters();
  const clearAll = () => clear([...ownKeys, ...SHARED_FILTER_KEYS]);
  return (
    <PageFilters filters={filters} onReset={clearAll} hideCountry={hideCountry} hidePeriod={hidePeriod}>
      {children}
      {ownActive && !filters.isFiltered && (
        <Button variant="ghost" size="sm" onClick={clearAll} className="self-start sm:self-auto">
          <HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden="true" />
          Effacer les filtres
        </Button>
      )}
    </PageFilters>
  );
}
