import type { KeyboardEvent, ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Skeleton } from './skeleton';
import { Table, TBody, TD, TH, THead, TR } from './table';

export interface ListColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Right-aligned, tabular digits. */
  numeric?: boolean;
  className?: string;
  /** Left out of the phone card (actions shown elsewhere, redundant details…). */
  hideOnCard?: boolean;
}

/**
 * One list, two layouts: a table from `md` up, a stack of cards on phones
 * (no horizontal scroll at 390px). The first column is the card's title and
 * the others become label/value lines, unless `card` draws the card itself.
 */
export function ResponsiveList<T>({ rows, columns, rowKey, onRowClick, card, empty, loading, loadingRows = 5, className }: {
  rows: T[];
  columns: ListColumn<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Custom phone card. */
  card?: (row: T) => ReactNode;
  /** Shown when there are no rows (an EmptyState). */
  empty?: ReactNode;
  loading?: boolean;
  loadingRows?: number;
  className?: string;
}) {
  if (loading) {
    return (
      <div className={cn('space-y-2 p-4', className)} aria-busy="true">
        {Array.from({ length: loadingRows }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    );
  }
  if (rows.length === 0) return <>{empty ?? null}</>;

  const clickable = !!onRowClick;
  const onKey = (e: KeyboardEvent, row: T) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick?.(row); }
  };
  const [title, ...rest] = columns;

  return (
    <div className={className}>
      <div className="hidden md:block">
        <Table>
          <THead>
            <tr>{columns.map(c => <TH key={c.key} numeric={c.numeric} className={c.className}>{c.header}</TH>)}</tr>
          </THead>
          <TBody>
            {rows.map(row => (
              <TR
                key={rowKey(row)}
                className={cn(clickable && 'cursor-pointer')}
                onClick={clickable ? () => onRowClick(row) : undefined}
                onKeyDown={clickable ? e => onKey(e, row) : undefined}
                tabIndex={clickable ? 0 : undefined}
              >
                {columns.map(c => <TD key={c.key} numeric={c.numeric} className={c.className}>{c.cell(row)}</TD>)}
              </TR>
            ))}
          </TBody>
        </Table>
      </div>

      <ul className="divide-y divide-line md:hidden">
        {rows.map(row => (
          <li
            key={rowKey(row)}
            className={cn('px-4 py-3', clickable && 'cursor-pointer active:bg-surface-2')}
            onClick={clickable ? () => onRowClick(row) : undefined}
            onKeyDown={clickable ? e => onKey(e, row) : undefined}
            tabIndex={clickable ? 0 : undefined}
            role={clickable ? 'button' : undefined}
          >
            {card ? card(row) : (
              <>
                {title && <div className="min-w-0 text-sm font-medium text-fg">{title.cell(row)}</div>}
                <dl className="mt-1.5 space-y-1">
                  {rest.filter(c => !c.hideOnCard).map(c => (
                    <div key={c.key} className="flex items-baseline justify-between gap-3 text-sm">
                      <dt className="shrink-0 text-xs text-fg-muted">{c.header}</dt>
                      <dd className={cn('min-w-0 text-right text-fg', c.numeric && 'tabular-nums')}>{c.cell(row)}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
