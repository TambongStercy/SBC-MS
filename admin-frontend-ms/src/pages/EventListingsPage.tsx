import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { Delete02Icon, PauseIcon, Store01Icon, ViewIcon } from '@hugeicons/core-free-icons';
import {
  listAdminEvents, listAdminResaleListings, removeResaleListing, suspendResaleListing, type AdminResaleListing, type ResaleListingStatus,
} from '../api/event';
import { Can } from '../components/Can';
import { usePageFilters } from '../hooks/usePageFilters';
import { PageFilters } from '../components/filters/PageFilters';
import { useClearAll } from '../components/event/useClearAll';
import { usePermission } from '../hooks/usePermission';
import {
  Button, Dialog, EmptyState, MenuItem, PageHeader, Pagination, Panel, ResponsiveList, SheetContent, type ListColumn,
} from '../components/ui';
import {
  ConfirmDialog, CopyId, DateText, DetailList, ErrorState, FilterBar, FilterSelect, Money, RowMenu, SheetSection, StatusBadge,
  formatDateTime, formatNumber, formatPercent, useUrlFilters, type ConfirmOptions,
} from '../components/moduleKit';
import { LISTING_STATUS, PAGE_SIZE } from '../components/event/shared';
import { TwoLines } from '../components/event/TwoLines';

const ALL = 'ALL';
const STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'En vente' },
  { value: 'SOLD', label: 'Vendues' },
  { value: 'CANCELLED', label: 'Annulées' },
  { value: 'SUSPENDED', label: 'Suspendues' },
];

/** Asking price against the original: "+20 %". */
const markup = (l: AdminResaleListing) => (l.originalPrice ? (l.askingPrice - l.originalPrice) / l.originalPrice : null);

/**
 * The resale marketplace: tickets members put back on sale. SBC can suspend
 * a listing or remove it for good; the seller keeps the ticket either way.
 * Opens on the listings on sale (`?status=ALL` shows every listing).
 */
export default function EventListingsPage() {
  const qc = useQueryClient();
  const f = useUrlFilters(['status'] as const, { status: 'ACTIVE' });
  const filters = usePageFilters();
  const clearAll = useClearAll(['status']);
  const status = f.values.status === ALL ? '' : f.values.status as ResaleListingStatus;
  const [detail, setDetail] = useState<AdminResaleListing | null>(null);
  const [confirm, setConfirm] = useState<ConfirmOptions | null>(null);
  const canWrite = usePermission('events') === 'write';

  const events = useQuery({ queryKey: ['event', 'events', 'index'], queryFn: () => listAdminEvents({ limit: 100 }).then(r => r.items), staleTime: 60_000 });
  const eventTitle = (id: string) => events.data?.find(e => e._id === id)?.title;

  const list = useQuery({
    queryKey: ['event', 'listings', status, f.page, filters.apiParams],
    queryFn: () => listAdminResaleListings({ status: status || undefined, limit: PAGE_SIZE, skip: (f.page - 1) * PAGE_SIZE, ...filters.apiParams }),
    placeholderData: keepPreviousData,
  });
  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;

  const done = (msg: string) => { toast.success(msg); setDetail(null); void qc.invalidateQueries({ queryKey: ['event', 'listings'] }); };
  const suspend = (l: AdminResaleListing) => setConfirm({
    title: 'Suspendre l’annonce ?',
    description: 'L’annonce est retirée du marketplace. Le vendeur conserve son billet.',
    confirmLabel: 'Suspendre',
    onConfirm: async () => { await suspendResaleListing(l._id); done('Annonce suspendue.'); },
  });
  const remove = (l: AdminResaleListing) => setConfirm({
    title: 'Retirer l’annonce définitivement ?',
    description: 'L’annonce est annulée définitivement. Le vendeur conserve son billet.',
    confirmLabel: 'Retirer',
    onConfirm: async () => { await removeResaleListing(l._id); done('Annonce retirée.'); },
  });

  const eventCell = (l: AdminResaleListing) => eventTitle(l.eventId) ?? 'Événement';
  const priceCell = (l: AdminResaleListing) => {
    const m = markup(l);
    return <TwoLines main={<Money value={l.askingPrice} />} sub={<>prix d’origine <Money value={l.originalPrice} />{m ? ` (${m > 0 ? '+' : ''}${formatPercent(m, 0)})` : ''}</>} />;
  };

  const columns: ListColumn<AdminResaleListing>[] = [
    { key: 'event', header: 'Événement', cell: l => <TwoLines main={eventCell(l)} sub={`Annonce …${l._id.slice(-8)}`} /> },
    { key: 'status', header: 'Statut', cell: l => <StatusBadge status={l.status} map={LISTING_STATUS} /> },
    { key: 'price', header: 'Prix demandé', numeric: true, cell: priceCell },
    { key: 'listed', header: 'Publiée', cell: l => <DateText value={l.listedAt} className="text-fg-muted" /> },
    {
      key: 'actions', header: <span className="sr-only">Actions</span>, className: 'text-right', hideOnCard: true,
      cell: l => (
        <div className="flex items-center justify-end gap-1">
          {l.status === 'ACTIVE' && (
            <Can module="events" write>
              <Button variant="ghost" size="sm" onClick={e => { e.stopPropagation(); suspend(l); }}>
                <HugeiconsIcon icon={PauseIcon} size={16} aria-hidden="true" />Suspendre
              </Button>
            </Can>
          )}
          <RowMenu>
            <MenuItem onSelect={() => setDetail(l)}><HugeiconsIcon icon={ViewIcon} size={16} aria-hidden="true" />Voir l’annonce</MenuItem>
            {canWrite && l.status === 'ACTIVE' && (
              <MenuItem destructive onSelect={() => remove(l)}><HugeiconsIcon icon={Delete02Icon} size={16} aria-hidden="true" />Retirer définitivement…</MenuItem>
            )}
          </RowMenu>
        </div>
      ),
    },
  ];

  const card = (l: AdminResaleListing) => (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <TwoLines main={eventCell(l)} sub={<DateText value={l.listedAt} />} />
        <StatusBadge status={l.status} map={LISTING_STATUS} />
      </div>
      {priceCell(l)}
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Reventes" description="Les billets remis en vente par les membres. Suspendez ou retirez une annonce douteuse ; le vendeur garde son billet." />

      <PageFilters filters={filters} onReset={clearAll}>
        <FilterBar
          filterCount={1}
          activeCount={filters.isFiltered ? 0 : f.activeCount}
          onClear={f.clear}
          filters={<FilterSelect label="Statut" allLabel="Tous les statuts" value={status} onChange={v => f.set({ status: v || ALL })} options={STATUS_OPTIONS} />}
          trailing={list.data && <span className="text-sm text-fg-muted">{formatNumber(total)} annonce{total > 1 ? 's' : ''}</span>}
        />
      </PageFilters>

      <Panel>
        <div className={list.isFetching && list.data ? 'opacity-60 transition-opacity' : undefined}>
          <ResponsiveList
            rows={items}
            columns={columns}
            rowKey={l => l._id}
            onRowClick={setDetail}
            card={card}
            loading={list.isLoading}
            empty={list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} retrying={list.isFetching} /> : (
              <EmptyState icon={Store01Icon} title={status === 'ACTIVE' ? 'Aucune annonce en vente' : 'Aucune annonce'}
                description="Les billets remis en vente par les membres apparaîtront ici." />
            )}
          />
        </div>
        <Pagination page={f.page} totalPages={Math.ceil(total / PAGE_SIZE)} total={total} pageSize={PAGE_SIZE} onPageChange={f.setPage} />
      </Panel>

      <Dialog open={!!detail} onOpenChange={o => { if (!o) setDetail(null); }}>
        {detail && (
          <SheetContent
            title="Annonce de revente"
            description={<StatusBadge status={detail.status} map={LISTING_STATUS} />}
            footer={detail.status === 'ACTIVE' && canWrite ? (
              <>
                <Button variant="danger-ghost" size="lg" onClick={() => remove(detail)}>Retirer définitivement…</Button>
                <Button variant="outline" size="lg" onClick={() => suspend(detail)}>Suspendre</Button>
              </>
            ) : undefined}
          >
            <div className="space-y-5">
              <SheetSection title="Prix">
                <DetailList items={[
                  ['Prix demandé', <Money key="a" value={detail.askingPrice} className="font-semibold" />],
                  ['Prix d’origine', <Money key="o" value={detail.originalPrice} />],
                  markup(detail) != null && ['Écart', `${(markup(detail) ?? 0) > 0 ? '+' : ''}${formatPercent(markup(detail), 0)}`],
                ]} />
              </SheetSection>
              <SheetSection title="Références">
                <DetailList items={[
                  ['Événement', eventCell(detail)],
                  ['Vendeur', <Link key="s" to={`/userpage/${detail.sellerUserId}`} className="text-primary hover:underline">Ouvrir la fiche membre</Link>],
                  ['Billet', <CopyId key="t" value={detail.ticketId} />],
                  ['Annonce', <CopyId key="l" value={detail._id} />],
                  ['Publiée le', formatDateTime(detail.listedAt)],
                  !!detail.soldAt && ['Vendue le', formatDateTime(detail.soldAt)],
                  !!detail.cancelledAt && ['Annulée le', formatDateTime(detail.cancelledAt)],
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
