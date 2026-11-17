import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Command } from 'cmdk';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowDown01Icon, Calendar03Icon, Cancel01Icon, Globe02Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { Button, Input, Popover, PopoverContent, PopoverTrigger } from '../ui';
import { cn } from '../../lib/cn';
import { COUNTRIES, countryName } from '../../lib/countries';
import { PERIODS, describeRange, type PeriodKey } from '../../lib/period';
import type { PageFilters as Filters } from '../../hooks/usePageFilters';

const trigger =
    'inline-flex h-11 md:h-9 w-full sm:w-auto items-center justify-between gap-2 rounded-control border border-line-strong bg-surface px-3 text-sm text-fg ' +
    'hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-primary';

/** "Tous les pays" or one country; searchable (55 countries, main markets first). */
export function CountryFilter({ value, onChange, className }: { value: string; onChange: (code: string) => void; className?: string }) {
    const [open, setOpen] = useState(false);
    const pick = (code: string) => { onChange(code); setOpen(false); };
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger className={cn(trigger, value && 'border-primary text-primary', className)} aria-label="Pays">
                <span className="inline-flex min-w-0 items-center gap-2">
                    <HugeiconsIcon icon={Globe02Icon} size={16} aria-hidden />
                    <span className="truncate">{value ? countryName(value) : 'Tous les pays'}</span>
                </span>
                <HugeiconsIcon icon={ArrowDown01Icon} size={16} aria-hidden className="shrink-0 text-fg-subtle" />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[min(20rem,calc(100vw-2rem))] p-0">
                <Command label="Choisir un pays" className="flex max-h-[22rem] flex-col">
                    <Command.Input
                        autoFocus
                        placeholder="Chercher un pays…"
                        className="h-11 border-b border-line bg-transparent px-3 text-sm text-fg placeholder:text-fg-subtle focus:outline-none"
                    />
                    <Command.List className="overflow-y-auto p-1">
                        <Command.Empty className="px-3 py-6 text-center text-sm text-fg-muted">Aucun pays trouvé.</Command.Empty>
                        <Option selected={!value} onSelect={() => pick('')}>Tous les pays</Option>
                        <Command.Group heading="Pays principaux" className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-fg-subtle">
                            {COUNTRIES.filter(c => c.main).map(c => (
                                <Option key={c.code} value={`${c.name} ${c.code}`} selected={value === c.code} onSelect={() => pick(c.code)}>{c.name}</Option>
                            ))}
                        </Command.Group>
                        <Command.Group heading="Autres pays" className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-fg-subtle">
                            {COUNTRIES.filter(c => !c.main).map(c => (
                                <Option key={c.code} value={`${c.name} ${c.code}`} selected={value === c.code} onSelect={() => pick(c.code)}>{c.name}</Option>
                            ))}
                        </Command.Group>
                    </Command.List>
                </Command>
            </PopoverContent>
        </Popover>
    );
}

function Option({ selected, onSelect, value, children }: { selected: boolean; onSelect: () => void; value?: string; children: ReactNode }) {
    return (
        <Command.Item
            value={value ?? String(children)}
            onSelect={onSelect}
            className="flex min-h-11 md:min-h-9 cursor-pointer items-center justify-between gap-2 rounded-md px-2.5 text-sm text-fg data-[selected=true]:bg-surface-2"
        >
            {children}
            {selected && <HugeiconsIcon icon={Tick02Icon} size={16} className="text-primary" aria-hidden />}
        </Command.Item>
    );
}

/** Presets ("Toute la période" by default) and a custom range with two dates. */
export function PeriodFilter({ filters, className }: { filters: Filters; className?: string }) {
    const [open, setOpen] = useState(false);
    const [from, setFrom] = useState(filters.custom.from);
    const [to, setTo] = useState(filters.custom.to);
    const choose = (key: PeriodKey) => {
        filters.setPeriod(key);
        if (key !== 'custom') setOpen(false);
    };
    const invalid = !!from && !!to && from > to;

    return (
        <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) { setFrom(filters.custom.from); setTo(filters.custom.to); } }}>
            <PopoverTrigger className={cn(trigger, filters.period !== 'all' && 'border-primary text-primary', className)} aria-label="Période">
                <span className="inline-flex min-w-0 items-center gap-2">
                    <HugeiconsIcon icon={Calendar03Icon} size={16} aria-hidden />
                    <span className="truncate">{describeRange(filters.period, filters.range)}</span>
                </span>
                <HugeiconsIcon icon={ArrowDown01Icon} size={16} aria-hidden className="shrink-0 text-fg-subtle" />
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[min(18rem,calc(100vw-2rem))] p-1">
                <div role="radiogroup" aria-label="Période">
                    {PERIODS.map(p => (
                        <button
                            key={p.key}
                            type="button"
                            role="radio"
                            aria-checked={filters.period === p.key}
                            onClick={() => choose(p.key)}
                            className="flex min-h-11 md:min-h-9 w-full items-center justify-between gap-2 rounded-md px-2.5 text-left text-sm text-fg hover:bg-surface-2"
                        >
                            {p.label}
                            {filters.period === p.key && <HugeiconsIcon icon={Tick02Icon} size={16} className="text-primary" aria-hidden />}
                        </button>
                    ))}
                </div>
                {filters.period === 'custom' && (
                    <form
                        className="mt-1 grid gap-2 border-t border-line p-2"
                        onSubmit={(e) => { e.preventDefault(); if (!invalid) { filters.setCustomRange(from, to); setOpen(false); } }}
                    >
                        <label className="grid gap-1 text-xs text-fg-muted">
                            Du
                            <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
                        </label>
                        <label className="grid gap-1 text-xs text-fg-muted">
                            Au (inclus)
                            <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
                        </label>
                        {invalid && <p className="text-xs text-danger">La date de début doit précéder la date de fin.</p>}
                        <Button type="submit" variant="primary" size="sm" disabled={invalid || (!from && !to)}>Appliquer</Button>
                    </form>
                )}
            </PopoverContent>
        </Popover>
    );
}

/**
 * The filter row every admin page starts with: country, period, then the
 * page's own filters (children), and "Effacer les filtres" when something is set.
 * Pass `hideCountry` only where a country makes no sense (e.g. global settings).
 */
export function PageFilters({ filters, children, hideCountry, hidePeriod, resetKeys, onReset, className }: {
    filters: Filters;
    children?: ReactNode;
    hideCountry?: boolean;
    hidePeriod?: boolean;
    /**
     * The page's own URL filter keys (e.g. ['q', 'statut']), cleared with the
     * shared ones in the same URL update. Prefer this to onReset: two URL
     * updates in one tick overwrite each other.
     */
    resetKeys?: string[];
    /** The page's own clearing (draft inputs, its own URL keys); runs first, then country + period are cleared. */
    onReset?: () => void;
    className?: string;
}) {
    const [searchParams] = useSearchParams();
    return (
        <div className={cn('mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center', className)}>
            {!hideCountry && <CountryFilter value={filters.country} onChange={filters.setCountry} />}
            {!hidePeriod && <PeriodFilter filters={filters} />}
            {children}
            {(filters.isFiltered || !!resetKeys?.some(k => searchParams.has(k))) && (
                <Button variant="ghost" size="sm" onClick={() => { onReset?.(); filters.reset(resetKeys); }} className="self-start sm:self-auto">
                    <HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden />
                    Effacer les filtres
                </Button>
            )}
        </div>
    );
}

export default PageFilters;
