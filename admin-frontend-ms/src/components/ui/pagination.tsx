import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowLeft01Icon, ArrowRight01Icon } from '@hugeicons/core-free-icons';
import { cn } from '../../lib/cn';
import { Button } from './button';

/**
 * Page navigation under a list: "1-20 sur 134" on the left, previous/next and
 * page numbers on the right (numbers hidden on phones).
 */
export function Pagination({ page, totalPages, total, pageSize, onPageChange, className }: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  if (totalPages <= 1) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
    .reduce<(number | 'gap')[]>((acc, p, i, arr) => {
      if (i > 0 && p - (arr[i - 1] as number) > 1) acc.push('gap');
      acc.push(p);
      return acc;
    }, []);

  return (
    <nav aria-label="Pagination" className={cn('flex items-center justify-between gap-3 border-t border-line px-4 py-3', className)}>
      <p className="text-xs text-fg-muted tabular-nums">
        {from}-{to} sur {total}
      </p>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon-sm" onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1} aria-label="Page précédente">
          <HugeiconsIcon icon={ArrowLeft01Icon} size={16} aria-hidden="true" />
        </Button>
        <div className="hidden items-center gap-1 sm:flex">
          {pages.map((p, i) =>
            p === 'gap' ? (
              <span key={`gap-${i}`} className="px-1 text-sm text-fg-subtle" aria-hidden="true">…</span>
            ) : (
              <Button
                key={p}
                variant={p === page ? 'soft' : 'ghost'}
                size="icon-sm"
                className="tabular-nums"
                onClick={() => onPageChange(p)}
                aria-current={p === page ? 'page' : undefined}
                aria-label={`Page ${p}`}
              >
                {p}
              </Button>
            ),
          )}
        </div>
        <span className="px-2 text-xs text-fg-muted tabular-nums sm:hidden">{page} / {totalPages}</span>
        <Button variant="ghost" size="icon-sm" onClick={() => onPageChange(Math.min(totalPages, page + 1))} disabled={page >= totalPages} aria-label="Page suivante">
          <HugeiconsIcon icon={ArrowRight01Icon} size={16} aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
