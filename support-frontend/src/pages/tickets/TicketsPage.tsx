import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { HugeiconsIcon } from '@hugeicons/react';
import { InboxIcon, Search01Icon } from '@hugeicons/core-free-icons';
import { ticketsApi, type TicketFilters } from '../../api/tickets';
import type { Ticket, TicketPriority, TicketStatus } from '../../api/types';
import { ErrorState } from '../../components/display/ErrorState';
import { StatusBadge, TICKET_PRIORITY, TICKET_STATUS } from '../../components/display/labels';
import { Button, EmptyState, Input, PageHeader, Pagination, Panel, ResponsiveList, Select, type ListColumn } from '../../components/ui';
import { cn } from '../../lib/cn';
import { categoryLabel, SlaText } from './shared';
import { formatDateTime, formatNumber, formatRelative } from '../../lib/format';

const PAGE_SIZE = 20;
const ALL = 'all';

const STATUS_OPTIONS = [
  { value: 'active', label: 'En cours (non résolus)' },
  { value: ALL, label: 'Tous les statuts' },
  ...Object.entries(TICKET_STATUS).map(([value, v]) => ({ value, label: v.label })),
];
const PRIORITY_OPTIONS = [
  { value: ALL, label: 'Toutes priorités' },
  ...Object.entries(TICKET_PRIORITY).map(([value, v]) => ({ value, label: v.label })),
];
const ASSIGNEE_OPTIONS = [
  { value: ALL, label: 'Tous les agents' },
  { value: 'me', label: 'Mes tickets' },
  { value: 'unassigned', label: 'Sans agent' },
];

/** Ticket queues: queue chips, filters in the address bar, paginated list. */
export default function TicketsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const queue = params.get('queue') ?? '';
  const status = params.get('status') ?? 'active';
  const priority = params.get('priority') ?? ALL;
  const assignee = params.get('assignee') ?? ALL;
  const page = Math.max(1, Number(params.get('page')) || 1);
  // The search text stays in memory only (never in the address bar or the history):
  // agents search by a member's email or phone. The other filters stay in the address.
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      // "Tous les statuts" must be stored: the default status is "active".
      if (v === null || v === '' || (v === ALL && k !== 'status')) next.delete(k);
      else next.set(k, v);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next, { replace: true });
  };

  const filters: TicketFilters = {
    queue: queue || undefined,
    status: status === ALL ? undefined : (status as TicketStatus | 'active'),
    priority: priority === ALL ? undefined : (priority as TicketPriority),
    assignee: assignee === ALL ? undefined : assignee,
    q: q || undefined,
    page,
    limit: PAGE_SIZE,
  };

  const queues = useQuery({ queryKey: ['tickets', 'queues'], queryFn: ticketsApi.queues, refetchInterval: 15_000 });
  const list = useQuery({ queryKey: ['tickets', 'list', filters], queryFn: () => ticketsApi.list(filters), placeholderData: keepPreviousData, refetchInterval: 15_000 });

  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    setQ(search.trim());
    update({ page: null });
  };

  const columns: ListColumn<Ticket>[] = [
    {
      key: 'subject',
      header: 'Ticket',
      cell: t => (
        <div className="min-w-0">
          <p className="truncate font-medium text-fg">{t.subject}</p>
          <p className="font-mono text-xs text-fg-muted">{t.number}</p>
        </div>
      ),
      className: 'max-w-[320px]',
    },
    { key: 'member', header: 'Membre', cell: t => <span className="text-fg">{t.member?.name ?? '—'}</span> },
    { key: 'queue', header: 'File', cell: t => <span className="text-fg-muted">{categoryLabel(t.queue || t.category)}</span> },
    { key: 'priority', header: 'Priorité', cell: t => <StatusBadge map={TICKET_PRIORITY} value={t.priority} /> },
    { key: 'status', header: 'Statut', cell: t => <StatusBadge map={TICKET_STATUS} value={t.status} /> },
    { key: 'assignee', header: 'Agent', cell: t => (t.assignee ? <span>{t.assignee.name}</span> : <span className="text-fg-subtle">Sans agent</span>) },
    { key: 'sla', header: 'Échéance', cell: t => <SlaText due={t.slaDueAt} status={t.status} /> },
    { key: 'updated', header: 'Mis à jour', cell: t => <span className="whitespace-nowrap text-fg-muted" title={formatDateTime(t.updatedAt)}>{formatRelative(t.updatedAt)}</span> },
  ];

  const data = list.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / (data.limit || PAGE_SIZE))) : 1;

  return (
    <>
      <PageHeader title="Tickets" description="Les demandes des membres, par file. Les notes internes ne sont jamais visibles du membre." />

      {/* Queues */}
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Files">
        <QueueChip label="Toutes les files" active={!queue} onClick={() => update({ queue: null })} />
        {queues.data?.map(qc => (
          <QueueChip key={qc.key} label={qc.label || categoryLabel(qc.key)} count={qc.open} active={queue === qc.key} onClick={() => update({ queue: qc.key })} />
        ))}
      </div>

      <Panel>
        <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center">
          <form onSubmit={submitSearch} className="flex min-w-0 flex-1 gap-2" role="search">
            <label htmlFor="ticket-search" className="sr-only">Rechercher un ticket</label>
            <Input id="ticket-search" type="search" placeholder="Numéro, sujet ou membre…" value={search} onChange={e => setSearch(e.target.value)} className="min-w-0 flex-1" />
            <Button type="submit" variant="outline" aria-label="Rechercher">
              <HugeiconsIcon icon={Search01Icon} size={16} aria-hidden="true" />
              <span className="hidden sm:inline">Rechercher</span>
            </Button>
          </form>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:w-[560px]">
            <label htmlFor="ticket-status" className="sr-only">Statut</label>
            <Select id="ticket-status" value={status} onValueChange={v => update({ status: v === 'active' ? null : v })} options={STATUS_OPTIONS} />
            <label htmlFor="ticket-priority" className="sr-only">Priorité</label>
            <Select id="ticket-priority" value={priority} onValueChange={v => update({ priority: v })} options={PRIORITY_OPTIONS} />
            <label htmlFor="ticket-assignee" className="sr-only">Agent</label>
            <Select id="ticket-assignee" value={assignee} onValueChange={v => update({ assignee: v })} options={ASSIGNEE_OPTIONS} />
          </div>
        </div>

        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} retrying={list.isFetching} />
        ) : (
          <ResponsiveList
            rows={data?.items ?? []}
            columns={columns}
            rowKey={t => t.id}
            loading={list.isLoading}
            onRowClick={t => navigate(`/tickets/${encodeURIComponent(t.id)}`)}
            empty={<EmptyState icon={InboxIcon} title="Aucun ticket" description="Aucun ticket ne correspond à ces filtres." />}
          />
        )}
        {data && (
          <Pagination page={page} totalPages={totalPages} total={data.total} pageSize={data.limit || PAGE_SIZE} onPageChange={p => update({ page: String(p) })} />
        )}
      </Panel>
      {data && <p className="mt-2 text-xs text-fg-muted">{formatNumber(data.total)} ticket(s)</p>}
    </>
  );
}

function QueueChip({ label, count, active, onClick }: { label: string; count?: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex h-9 items-center gap-2 rounded-control border px-3 text-sm transition-colors',
        active ? 'border-primary bg-primary-soft font-medium text-primary' : 'border-line bg-surface text-fg-muted hover:border-line-strong hover:text-fg',
      )}
    >
      {label}
      {count != null && <span className={cn('rounded-md px-1.5 text-xs tabular-nums', active ? 'bg-surface text-primary' : 'bg-surface-3 text-fg-muted')}>{formatNumber(count)}</span>}
    </button>
  );
}
