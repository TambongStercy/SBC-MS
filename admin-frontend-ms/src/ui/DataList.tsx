import { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from './cn';
import { EmptyState, ErrorState, ListSkeleton } from './States';

export type Column<T> = {
    key: string;
    header: ReactNode;
    cell: (row: T) => ReactNode;
    align?: 'left' | 'right';
    className?: string;
};

/**
 * One list component for the whole admin: a table on a computer, cards on a
 * phone. Loading, error and empty states are built in so no screen forgets one.
 */
export function DataList<T>({ rows, columns, rowKey, onRowClick, card, loading, error, onRetry, empty }: {
    rows: T[] | undefined;
    columns: Column<T>[];
    rowKey: (row: T) => string;
    onRowClick?: (row: T) => void;
    /** How a row reads on a phone. */
    card: (row: T) => ReactNode;
    loading?: boolean;
    error?: unknown;
    onRetry?: () => void;
    empty?: ReactNode;
}) {
    if (loading && !rows) return <ListSkeleton />;
    if (error && !rows) return <ErrorState onRetry={onRetry} />;
    if (!rows || rows.length === 0) return <>{empty ?? <EmptyState title="Rien à afficher" />}</>;

    return (
        <>
            <div className="hidden md:block overflow-x-auto panel rounded-card">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-border">
                            {columns.map(c => (
                                <th key={c.key} className={cn('px-4 py-3 text-xs font-bold uppercase tracking-wider text-ink-3 whitespace-nowrap', c.align === 'right' ? 'text-right' : 'text-left')}>
                                    {c.header}
                                </th>
                            ))}
                            {onRowClick && <th className="w-8" />}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(row => (
                            <tr key={rowKey(row)} onClick={onRowClick ? () => onRowClick(row) : undefined}
                                className={cn('border-b border-border last:border-0', onRowClick && 'cursor-pointer hover:bg-surface-2')}>
                                {columns.map(c => (
                                    <td key={c.key} className={cn('px-4 py-3 align-middle', c.align === 'right' && 'text-right tabular', c.className)}>{c.cell(row)}</td>
                                ))}
                                {onRowClick && <td className="pr-3 text-ink-3"><ChevronRight size={16} /></td>}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <ul className="md:hidden space-y-2">
                {rows.map(row => (
                    <li key={rowKey(row)}>
                        {onRowClick ? (
                            <button type="button" onClick={() => onRowClick(row)}
                                className="w-full text-left panel lift rounded-card p-3.5 flex items-center gap-3">
                                <div className="min-w-0 flex-1">{card(row)}</div>
                                <ChevronRight size={16} className="text-ink-3 shrink-0" />
                            </button>
                        ) : (
                            <div className="panel rounded-card p-3.5">{card(row)}</div>
                        )}
                    </li>
                ))}
            </ul>
        </>
    );
}
