import type { TicketStatus } from '../../api/types';
import { TICKET_CATEGORY } from '../../components/display/labels';
import { cn } from '../../lib/cn';
import { formatDateTime, formatRelative } from '../../lib/format';

export const categoryLabel = (c: string) => TICKET_CATEGORY[c] ?? c;

/** SLA due date, in red once passed. */
export function SlaText({ due, status }: { due?: string | null; status: TicketStatus }) {
  if (!due || status === 'resolved' || status === 'closed') return <span className="text-fg-subtle">—</span>;
  const late = new Date(due).getTime() < Date.now();
  return (
    <span className={cn('whitespace-nowrap', late ? 'font-medium text-danger' : 'text-fg-muted')} title={formatDateTime(due)}>
      {late ? `Dépassé ${formatRelative(due)}` : formatRelative(due)}
    </span>
  );
}

