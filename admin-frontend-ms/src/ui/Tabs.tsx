import { ReactNode } from 'react';
import { cn } from './cn';

/** A segmented control. Scrolls sideways on a phone when there are many tabs. */
export function Tabs<T extends string>({ value, onChange, items, className }: {
    value: T;
    onChange: (v: T) => void;
    items: Array<{ value: T; label: ReactNode; count?: number }>;
    className?: string;
}) {
    return (
        <div role="tablist" className={cn('flex gap-1 overflow-x-auto rounded-pill bg-surface-2 p-1 [scrollbar-width:none]', className)}>
            {items.map(it => (
                <button key={it.value} role="tab" type="button" aria-selected={it.value === value}
                    onClick={() => onChange(it.value)}
                    className={cn('flex-1 shrink-0 whitespace-nowrap rounded-pill px-3 h-9 text-sm font-semibold transition-colors inline-flex items-center justify-center gap-1.5',
                        it.value === value ? 'bg-surface text-ink border border-border' : 'text-ink-2 hover:text-ink')}>
                    {it.label}
                    {it.count !== undefined && it.count > 0 && (
                        <span className={cn('rounded-pill px-1.5 text-[11px] tabular', it.value === value ? 'bg-primary text-white' : 'bg-ink-3/20 text-ink-2')}>
                            {it.count > 999 ? '999+' : it.count}
                        </span>
                    )}
                </button>
            ))}
        </div>
    );
}
