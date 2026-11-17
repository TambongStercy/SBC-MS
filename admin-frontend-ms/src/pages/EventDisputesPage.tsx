import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { Cancel01Icon, CheckmarkCircle02Icon, JusticeScale01Icon, ViewIcon } from '@hugeicons/core-free-icons';
import { listAdminDisputes, resolveDispute, type AdminDispute, type DisputeStatus } from '../api/event';
import { Can } from '../components/Can';
import { usePageFilters } from '../hooks/usePageFilters';
import { PageFilters } from '../components/filters/PageFilters';
import { useClearAll } from '../components/event/useClearAll';
import { usePermission } from '../hooks/usePermission';
import {
  Button, Dialog, EmptyState, MenuItem, PageHeader, Pagination, Panel, ResponsiveList, SheetContent, type ListColumn,
} from '../components/ui';
import {
  ConfirmDialog, CopyId, DateText, DetailList, ErrorState, FilterBar, FilterSelect, Notice, RowMenu, SheetSection, StatusBadge,
  formatDateTime, formatNumber, useUrlFilters, type ConfirmOptions,
} from '../components/moduleKit';
import { DISPUTE_KIND, DISPUTE_STATUS, PAGE_SIZE } from '../components/event/shared';

const ALL = 'ALL';
const STATUS_OPTIONS = [
  { value: 'OPEN', label: 'Ouverts' },
  { value: 'RESOLVED', label: 'Résolus' },
  { value: 'REJECTED', label: 'Rejetés' },
];
const kindLabel = (k: string) => DISPUTE_KIND[k] ?? 'Autre';

/**
 * Disputes opened by members (mostly resales). Each decision — resolve or
 * reject — needs a note explaining it. Opens on the open ones
 * (`?status=ALL` shows every dispute).
 */
export default function EventDisputesPage() {
  const qc = useQueryClient();
  const f = useUrlFilters(['status'] as const, { status: 'OPEN' });
  const filters = usePageFilters();
  const clearAll = useClearAll(['status']);
  /** Queues show everything pending whatever the period: country only. */
  const queueParams = filters.country ? { country: filters.country } : {};
  const status = f.values.status === ALL ? '' : f.values.status as DisputeStatus;
  const [detail, setDetail] = useState<AdminDispute | null>(null);
  const [confirm, setConfirm] = useState<ConfirmOptions | null>(null);
  const canWrite = usePermission('events') === 'write';

  const list = useQuery({
    queryKey: ['event', 'disputes', status, f.page, status === 'OPEN' ? queueParams : filters.apiParams],
    // open disputes are a queue: country only, whatever the period
    queryFn: () => listAdminDisputes({ status: status || undefined, limit: PAGE_SIZE, skip: (f.page - 1) * PAGE_SIZE, ...(status === 'OPEN' ? queueParams : filters.apiParams) }),
    placeholderData: keepPreviousData,
  });
  const open = useQuery({ queryKey: ['event', 'disputes', 'OPEN', 'count', queueParams], queryFn: () => listAdminDisputes({ status: 'OPEN', limit: 1, ...queueParams }).then(r => r.total) });
  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;

  const decide = (d: AdminDispute, outcome: 'resolve' | 'reject') => setConfirm({
    title: outcome === 'resolve' ? 'Résoudre le litige ?' : 'Rejeter le litige ?',
    description: outcome === 'resolve'
      ? 'Le litige est marqué résolu. Expliquez la décision (note obligatoire).'
      : 'Le litige est marqué rejeté. Expliquez la décision (note obligatoire).',
    confirmLabel: outcome === 'resolve' ? 'Résoudre' : 'Rejeter',
    tone: outcome === 'resolve' ? 'primary' : 'danger',
    reason: { label: 'Note de résolution', required: true, minLength: 2, placeholder: 'Ce qui a été décidé, et pourquoi' },
    onConfirm: async note => {
      await resolveDispute(d._id, note, outcome);
      toast.success(outcome === 'resolve' ? 'Litige résolu.' : 'Litige rejeté.');
      setDetail(null);
      void qc.invalidateQueries({ queryKey: ['event', 'disputes'] });
    },
  });

  const refs = (d: AdminDispute) => [d.ticketId && `billet …${d.ticketId.slice(-8)}`, d.resaleOrderId && `revente …${d.resaleOrderId.slice(-8)}`].filter(Boolean).join(' · ');

  const columns: ListColumn<AdminDispute>[] = [
    {
      key: 'dispute', header: 'Litige', cell: d => (
        <div className="min-w-0 max-w-xl">
          <p className="text-sm font-medium text-fg">{kindLabel(d.kind)}</p>
          <p className="line-clamp-2 text-xs text-fg-muted">{d.description}</p>
        </div>
      ),
    },
    { key: 'status', header: 'Statut', cell: d => <StatusBadge status={d.status} map={DISPUTE_STATUS} /> },
    { key: 'created', header: 'Ouvert', cell: d => <DateText value={d.createdAt} className="text-fg-muted" /> },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>, className: 'text-right', hideOnCard: true,
      cell: d => (
        <div className="flex items-center justify-end gap-1">
          {d.status === 'OPEN' && (
            <Can module="events" write>
              <Button variant="soft" size="sm" onClick={e => { e.stopPropagation(); decide(d, 'resolve'); }}>Résoudre</Button>
            </Can>
          )}
          <RowMenu>
            <MenuItem onSelect={() => setDetail(d)}><HugeiconsIcon icon={ViewIcon} size={16} aria-hidden="true" />Voir le litige</MenuItem>
            {canWrite && d.status === 'OPEN' && (
              <MenuItem destructive onSelect={() => decide(d, 'reject')}><HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden="true" />Rejeter…</MenuItem>
            )}
          </RowMenu>
        </div>
      ),
    },
  ];

  const card = (d: AdminDispute) => (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-fg">{kindLabel(d.kind)}</p>
        <StatusBadge status={d.status} map={DISPUTE_STATUS} />
      </div>
      <p className="line-clamp-3 text-sm text-fg-muted">{d.description}</p>
      <p className="text-xs text-fg-muted"><DateText value={d.createdAt} />{refs(d) ? ` · ${refs(d)}` : ''}</p>
      {d.status === 'OPEN' && (
        <Can module="events" write>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" size="lg" onClick={e => { e.stopPropagation(); decide(d, 'reject'); }}>Rejeter</Button>
            <Button variant="soft" size="lg" onClick={e => { e.stopPropagation(); decide(d, 'resolve'); }}>Résoudre</Button>
          </div>
        </Can>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Litiges" description="Les réclamations des membres sur un billet ou une revente. Chaque décision s’accompagne d’une note." />

      <PageFilters filters={filters} onReset={clearAll}>
        <FilterBar
          filterCount={1}
          activeCount={filters.isFiltered ? 0 : f.activeCount}
          onClear={f.clear}
          filters={<FilterSelect label="Statut" allLabel="Tous les litiges" value={status} onChange={v => f.set({ status: v || ALL })} options={STATUS_OPTIONS} />}
          trailing={list.data && <span className="text-sm text-fg-muted">{formatNumber(total)} litige{total > 1 ? 's' : ''}</span>}
        />
      </PageFilters>

      {!!open.data && status !== 'OPEN' && (
        <Notice tone="warning">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span><strong className="font-semibold">{formatNumber(open.data)} litige{open.data > 1 ? 's' : ''} ouvert{open.data > 1 ? 's' : ''}</strong> en attente d’une décision.</span>
            <Button variant="soft" size="md" className="h-11 sm:h-9" onClick={() => f.set({ status: 'OPEN' })}>Voir les litiges ouverts</Button>
          </div>
        </Notice>
      )}

      <Panel>
        <div className={list.isFetching && list.data ? 'opacity-60 transition-opacity' : undefined}>
          <ResponsiveList
            rows={items}
            columns={columns}
            rowKey={d => d._id}
            onRowClick={setDetail}
            card={card}
            loading={list.isLoading}
            empty={list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} retrying={list.isFetching} /> : (
              <EmptyState icon={JusticeScale01Icon} title={status === 'OPEN' ? 'Aucun litige ouvert' : 'Aucun litige'}
                description={status === 'OPEN' ? 'Tout est traité.' : 'Les réclamations des membres apparaîtront ici.'} />
            )}
          />
        </div>
        <Pagination page={f.page} totalPages={Math.ceil(total / PAGE_SIZE)} total={total} pageSize={PAGE_SIZE} onPageChange={f.setPage} />
      </Panel>

      <Dialog open={!!detail} onOpenChange={o => { if (!o) setDetail(null); }}>
        {detail && (
          <SheetContent
            title={kindLabel(detail.kind)}
            description={<StatusBadge status={detail.status} map={DISPUTE_STATUS} />}
            footer={detail.status === 'OPEN' && canWrite ? (
              <>
                <Button variant="danger-ghost" size="lg" onClick={() => decide(detail, 'reject')}>Rejeter…</Button>
                <Button variant="primary" size="lg" onClick={() => decide(detail, 'resolve')}>
                  <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} aria-hidden="true" />Résoudre…
                </Button>
              </>
            ) : undefined}
          >
            <div className="space-y-5">
              <SheetSection title="Réclamation">
                <p className="whitespace-pre-wrap rounded-panel border border-line p-3 text-sm text-fg">{detail.description}</p>
              </SheetSection>
              {detail.resolutionNote && (
                <SheetSection title="Décision">
                  <p className="whitespace-pre-wrap rounded-panel border border-line p-3 text-sm text-fg">{detail.resolutionNote}</p>
                </SheetSection>
              )}
              <SheetSection title="Références">
                <DetailList items={[
                  ['Ouvert le', formatDateTime(detail.createdAt)],
                  !!detail.resolvedAt && ['Clos le', formatDateTime(detail.resolvedAt)],
                  ['Plaignant', <Link key="u" to={`/userpage/${detail.complainantUserId}`} className="text-primary hover:underline">Ouvrir la fiche membre</Link>],
                  !!detail.ticketId && ['Billet', <CopyId key="t" value={detail.ticketId} />],
                  !!detail.resaleOrderId && ['Commande de revente', <CopyId key="r" value={detail.resaleOrderId} />],
                  !!detail.eventId && ['Événement', <CopyId key="e" value={detail.eventId} />],
                ]} />
              </SheetSection>
            </div>
          </SheetContent>
        )}
      </Dialog>

      <ConfirmDialog options={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
