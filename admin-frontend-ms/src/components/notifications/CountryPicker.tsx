import { useId, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel01Icon, Search01Icon } from '@hugeicons/core-free-icons';
import { Button, Checkbox, Input } from '../ui';
import { COUNTRIES, countryName } from './pushShared';

/** Several countries out of the full list: chips for the picked ones, a searchable list below. */
export function CountryPicker({ value, onChange }: { value: string[]; onChange: (codes: string[]) => void }) {
    const [search, setSearch] = useState('');
    const id = useId();
    const q = search.trim().toLowerCase();
    const shown = COUNTRIES.filter(([code, name]) => !q || `${code} ${name}`.toLowerCase().includes(q));
    const toggle = (code: string) => onChange(value.includes(code) ? value.filter(c => c !== code) : [...value, code]);

    return (
        <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
                <label htmlFor={`${id}-search`} className="text-sm font-medium text-fg">Pays</label>
                {value.length > 0 && (
                    <Button variant="link" size="sm" onClick={() => onChange([])}>Tout retirer ({value.length})</Button>
                )}
            </div>
            {value.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {value.map(c => (
                        <button
                            key={c}
                            type="button"
                            onClick={() => toggle(c)}
                            aria-label={`Retirer ${countryName(c)}`}
                            className="inline-flex h-8 items-center gap-1 rounded-md bg-primary-soft px-2.5 text-xs font-medium text-primary hover:bg-primary-soft/70"
                        >
                            {countryName(c)}
                            <HugeiconsIcon icon={Cancel01Icon} size={12} aria-hidden="true" />
                        </button>
                    ))}
                </div>
            )}
            <div className="relative">
                <HugeiconsIcon icon={Search01Icon} size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
                <Input id={`${id}-search`} className="h-11 pl-9" value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher un pays" />
            </div>
            <div className="max-h-56 overflow-y-auto rounded-control border border-line bg-surface" role="group" aria-label="Pays">
                {shown.length === 0 ? (
                    <p className="px-3 py-3 text-sm text-fg-muted">Aucun pays ne correspond.</p>
                ) : shown.map(([code, name]) => (
                    <label key={code} className="flex min-h-11 cursor-pointer items-center gap-3 px-3 text-sm text-fg hover:bg-surface-2">
                        <Checkbox checked={value.includes(code)} onCheckedChange={() => toggle(code)} />
                        {name}
                    </label>
                ))}
            </div>
            <p className="text-xs text-fg-muted">Aucun pays choisi = tous les pays.</p>
        </div>
    );
}
