import type { ReactNode } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel01Icon, RefreshIcon } from '@hugeicons/core-free-icons';
import { Button, EmptyState, Tooltip } from '../ui';
import { cn } from '../../lib/cn';
import { formatDateTime, formatRelative } from './format';

/** "il y a 2 h", with the full date and time in a tooltip. */
export function RelativeTime({ value, className }: { value: string | number | Date | null | undefined; className?: string }) {
  if (value === null || value === undefined || value === '') return <span className={cn('text-fg-subtle', className)}>—</span>;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return <span className={cn('text-fg-subtle', className)}>—</span>;
  const full = formatDateTime(date);
  const iso = date.toISOString();
  return (
    <Tooltip content={full}>
      <time dateTime={iso} className={cn('whitespace-nowrap', className)} tabIndex={0}>{formatRelative(value)}</time>
    </Tooltip>
  );
}

/** A list or panel that could not load: what happened and "Réessayer". */
export function ErrorState({ title = 'Les données n’ont pas pu être chargées', description, onRetry, retrying, className }: {
  title?: ReactNode;
  description?: ReactNode;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}) {
  return (
    <EmptyState
      className={className}
      icon={RefreshIcon}
      title={title}
      description={description ?? 'Vérifiez la connexion, puis réessayez.'}
      action={onRetry ? <Button size="lg" onClick={onRetry} loading={retrying}>Réessayer</Button> : undefined}
    />
  );
}

/**
 * One row of filters above a list. Wraps on phones; "Effacer les filtres"
 * appears when `active` is true.
 */
export function FilterBar({ children, active, onClear, className }: {
  children: ReactNode;
  active?: boolean;
  onClear?: () => void;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center', className)}>
      {children}
      {active && onClear && (
        <Button variant="ghost" size="md" className="h-11 sm:h-9 sm:self-auto" onClick={onClear}>
          <HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden="true" />
          Effacer les filtres
        </Button>
      )}
    </div>
  );
}
