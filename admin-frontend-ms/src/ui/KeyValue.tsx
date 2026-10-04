import { ReactNode } from 'react';
import { cn } from './cn';

/** Label/value lines, e.g. the facts behind a decision. */
export function KeyValue({ items, className }: { items: Array<[ReactNode, ReactNode] | false | null | undefined>; className?: string }) {
    return (
        <dl className={cn('divide-y divide-border', className)}>
            {items.filter(Boolean).map((it, i) => {
                const [k, v] = it as [ReactNode, ReactNode];
                return (
                    <div key={i} className="flex items-baseline justify-between gap-4 py-2">
                        <dt className="text-sm text-ink-2 shrink-0">{k}</dt>
                        <dd className="text-sm font-semibold text-ink text-right min-w-0 break-words tabular">{v}</dd>
                    </div>
                );
            })}
        </dl>
    );
}
