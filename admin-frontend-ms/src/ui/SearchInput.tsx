import { Search, X } from 'lucide-react';
import { cn } from './cn';

export function SearchInput({ value, onChange, placeholder = 'Rechercher', className, autoFocus }: {
    value: string; onChange: (v: string) => void; placeholder?: string; className?: string; autoFocus?: boolean;
}) {
    return (
        <div className={cn('relative', className)}>
            <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
                type="search" inputMode="search" value={value} autoFocus={autoFocus}
                onChange={e => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder}
                className="w-full h-11 rounded-pill border border-border bg-surface dark:bg-surface-2/60 pl-10 pr-10 text-[15px] text-ink placeholder:text-ink-3 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 [&::-webkit-search-cancel-button]:hidden"
            />
            {value && (
                <button type="button" aria-label="Effacer" onClick={() => onChange('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 size-8 grid place-items-center rounded-pill text-ink-3 hover:bg-surface-2">
                    <X size={16} />
                </button>
            )}
        </div>
    );
}
