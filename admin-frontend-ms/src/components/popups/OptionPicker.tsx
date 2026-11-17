import { useId, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel01Icon, Search01Icon } from '@hugeicons/core-free-icons';
import { Button, Checkbox, Input, Skeleton } from '../ui';
import { fmtInt } from '../display/format';
import type { TargetingOption } from './api';

/**
 * Several values out of a list members picked from (interests, professions):
 * chips for the chosen ones, a searchable list with how many members chose each.
 */
export function OptionPicker({ label, options, value, onChange, loading, error, emptyHint }: {
    label: string;
    options: TargetingOption[];
    value: string[];
    onChange: (values: string[]) => void;
    loading?: boolean;
    error?: boolean;
    /** Shown under the list: what "none chosen" means. */
    emptyHint: string;
}) {
    const [search, setSearch] = useState('');
    const id = useId();
    const q = search.trim().toLowerCase();
    // Accent-insensitive, so "etudiant" finds "Étudiant/Élève".
    const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    const shown = options.filter(o => !q || fold(o.value).includes(fold(q)));
    const toggle = (v: string) => onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v]);

    return (
        <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
                <label htmlFor={`${id}-search`} className="text-sm font-medium text-fg">{label}</label>
                {value.length > 0 && (
                    <Button variant="link" size="sm" onClick={() => onChange([])}>Tout retirer ({value.length})</Button>
                )}
            </div>
            {value.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {value.map(v => (
                        <button
                            key={v}
                            type="button"
                            onClick={() => toggle(v)}
                            aria-label={`Retirer ${v}`}
                            className="inline-flex min-h-8 items-center gap-1 rounded-md bg-primary-soft px-2.5 text-left text-xs font-medium text-primary hover:bg-primary-soft/70"
                        >
                            {v}
                            <HugeiconsIcon icon={Cancel01Icon} size={12} aria-hidden="true" className="shrink-0" />
                        </button>
                    ))}
                </div>
            )}
            <div className="relative">
                <HugeiconsIcon icon={Search01Icon} size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
                <Input id={`${id}-search`} className="h-11 pl-9" value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher" />
            </div>
            <div className="max-h-56 overflow-y-auto rounded-control border border-line bg-surface" role="group" aria-label={label}>
                {loading ? (
                    <div className="space-y-2 p-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-6 w-full" />)}</div>
                ) : error ? (
                    <p className="px-3 py-3 text-sm text-danger">La liste n’a pas pu être chargée.</p>
                ) : shown.length === 0 ? (
                    <p className="px-3 py-3 text-sm text-fg-muted">Rien ne correspond.</p>
                ) : shown.map(o => (
                    <label key={o.value} className="flex min-h-11 cursor-pointer items-center gap-3 px-3 text-sm text-fg hover:bg-surface-2">
                        <Checkbox checked={value.includes(o.value)} onCheckedChange={() => toggle(o.value)} />
                        <span className="min-w-0 flex-1">{o.value}</span>
                        <span className="shrink-0 text-xs tabular-nums text-fg-muted">{fmtInt(o.count)}</span>
                    </label>
                ))}
            </div>
            <p className="text-xs text-fg-muted">{emptyHint}</p>
        </div>
    );
}
