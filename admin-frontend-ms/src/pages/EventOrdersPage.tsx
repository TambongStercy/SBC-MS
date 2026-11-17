import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { MoneyReceive02Icon, ShoppingCart01Icon, ViewIcon } from '@hugeicons/core-free-icons';
import { listAdminOrders, refundOrder, type AdminOrder, type OrderKind, type OrderStatus } from '../api/event';
import { Can } from '../components/Can';
import { usePageFilters } from '../hooks/usePageFilters';
import { PageFilters } from '../components/filters/PageFilters';
import { useClearAll } from '../components/event/useClearAll';
import { usePermission } from '../hooks/usePermission';
import {
  Button, Dialog, EmptyState, Input, MenuItem, PageHeader, Pagination, Panel, ResponsiveList, SheetContent, type ListColumn,
} from '../components/ui';
import {
  ConfirmDialog, CopyId, DateText, DetailList, ErrorState, FilterBar, FilterSelect, Money, RowMenu, SheetSection, StatusBadge,
  formatDateTime, formatMoney, formatNumber, useUrlFilters, type ConfirmOptions,
} from '../components/moduleKit';
import { ORDER_KIND, ORDER_STATUS, PAGE_SIZE, isObjectId } from '../components/event/shared';
import { TwoLines } from '../components/event/TwoLines';

const STATUS_OPTIONS = [
  { value: 'PAID', label: 'Payées' },
  { value: 'PENDING', label: 'En attente' },
  { value: 'FAILED', label: 'Échouées' },
  { value: 'CANCELLED', label: 'Annulées' },
  { value: 'REFUNDED', label: 'Remboursées' },
];
const KIND_OPTIONS = [
  { value: 'PRIMARY', label: 'Ventes directes' },
  { value: 'RESALE', label: 'Reventes' },
];

const holderName = (o: AdminOrder) => `${o.holder.firstName} ${o.holder.lastName}`.trim() || 'Acheteur';
const refundable = (o: AdminOrder) => o.status === 'PAID' && o.kind === 'PRIMARY';

/** An id filter: the API casts it to an ObjectId and fails on a partial value, so it is sent only once complete. */
function IdFilter({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const partial = value !== '' && !isObjectId(value);
  return (
    <div className="min-w-0">
      <Input value={value} onChange={e => onChange(e.target.value.trim())} placeholder={label} aria-label={label}
        aria-invalid={partial || undefined} className="h-11 font-mono sm:h-9" />
      {partial && <p className="mt-1 text-xs text-fg-muted">Collez l’identifiant complet (24 caractères).</p>}
    </div>
  );
}

/** SBC Event orders: every purchase (direct sale or resale), with the refund of a paid direct sale. */
export default function EventOrdersPage() {
  const qc = useQueryClient();
  const f = useUrlFilters(['status', 'kind', 'eventId', 'userId'] as const);
  const filters = usePageFilters();
  const clearAll = useClearAll(['status', 'kind', 'eventId', 'userId']);
  const { status, kind, eventId, userId } = f.values;
  const [detail, setDetail] = useState<AdminOrder | null>(null);
  const [confirm, setConfirm] = useState<ConfirmOptions | null>(null);
  const canWrite = usePermission('events') === 'write';

  const list = useQuery({
    queryKey: ['event', 'orders', status, kind, eventId, userId, f.page, filters.apiParams],
    queryFn: () => listAdminOrders({
      status: (status || undefined) as OrderStatus | undefined,
      kind: (kind || undefined) as OrderKind | undefined,
      eventId: isObjectId(eventId) ? eventId : undefined,
      userId: isObjectId(userId) ? userId : undefined,
      limit: PAGE_SIZE,
      skip: (f.page - 1) * PAGE_SIZE,
      ...filters.apiParams,
    }),
    placeholderData: keepPreviousData,
  });
  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;

  const refund = (o: AdminOrder) => setConfirm({
    title: `Rembourser ${formatMoney(o.total)} ?`,
    description: `${holderName(o)} est remboursé sur son solde SBC principal et ses billets de cette commande sont invalidés.`,
    confirmLabel: 'Rembourser',
    onConfirm: async () => {
      await refundOrder(o._id, 'Remboursement administrateur');
      toast.success('Commande remboursée.');
      setDetail(null);
      void qc.invalidateQueries({ queryKey: ['event', 'orders'] });
    },
  });

  const menu = (o: AdminOrder) => (
    <RowMenu>
      <MenuItem onSelect={() => setDetail(o)}><HugeiconsIcon icon={ViewIcon} size={16} aria-hidden="true" />Voir la commande</MenuItem>
      {canWrite && refundable(o) && (
        <MenuItem destructive onSelect={() => refund(o)}><HugeiconsIcon icon={MoneyReceive02Icon} size={16} aria-hidden="true" />Rembourser…</MenuItem>
      )}
    </RowMenu>
  );

  const columns: ListColumn<AdminOrder>[] = [
    { key: 'buyer', header: 'Acheteur', cell: o => <TwoLines main={holderName(o)} sub={o.holder.phone} /> },
    { key: 'kind', header: 'Type', cell: o => <StatusBadge status={o.kind} map={ORDER_KIND} /> },
    { key: 'status', header: 'Statut', cell: o => <StatusBadge status={o.status} map={ORDER_STATUS} /> },
    { key: 'total', header: 'Total', numeric: true, cell: o => <Money value={o.total} className="font-medium" /> },
    { key: 'paid', header: 'Payée', cell: o => <DateText value={o.paidAt} className="text-fg-muted" /> },
    { key: 'actions', header: <span className="sr-only">Actions</span>, className: 'text-right', hideOnCard: true, cell: menu },
  ];

  const card = (o: AdminOrder) => (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <TwoLines main={holderName(o)} sub={o.holder.phone} />
        <Money value={o.total} className="text-sm font-semibold text-fg" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={o.status} map={ORDER_STATUS} />
        <StatusBadge status={o.kind} map={ORDER_KIND} />
        <span className="text-xs text-fg-muted"><DateText value={o.paidAt ?? o.createdAt} /></span>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Commandes" description="Toutes les commandes de billets, ventes directes et reventes. Une vente directe payée peut être remboursée." />

      <PageFilters filters={filters} onReset={clearAll}>
        <FilterBar
          filterCount={4}
          activeCount={filters.isFiltered ? 0 : f.activeCount}
          onClear={f.clear}
          filters={(
            <>
              <FilterSelect label="Statut" allLabel="Tous les statuts" value={status} onChange={v => f.set({ status: v })} options={STATUS_OPTIONS} />
              <FilterSelect label="Type" allLabel="Tous les types" value={kind} onChange={v => f.set({ kind: v })} options={KIND_OPTIONS} />
              <IdFilter label="ID événement" value={eventId} onChange={v => f.set({ eventId: v })} />
              <IdFilter label="ID acheteur" value={userId} onChange={v => f.set({ userId: v })} />
            </>
          )}
          trailing={list.data && <span className="text-sm text-fg-muted">{formatNumber(total)} commande{total > 1 ? 's' : ''}</span>}
        />
      </PageFilters>

      <Panel>
        <div className={list.isFetching && list.data ? 'opacity-60 transition-opacity' : undefined}>
          <ResponsiveList
            rows={items}
            columns={columns}
            rowKey={o => o._id}
            onRowClick={setDetail}
            card={card}
            loading={list.isLoading}
            empty={list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} retrying={list.isFetching} /> : (
              <EmptyState icon={ShoppingCart01Icon} title="Aucune commande"
                description={(f.activeCount || filters.isFiltered) ? 'Aucune commande ne correspond à ces filtres.' : 'Les commandes de billets apparaîtront ici.'}
                action={(f.activeCount || filters.isFiltered) ? <Button size="lg" onClick={clearAll}>Effacer les filtres</Button> : undefined} />
            )}
          />
        </div>
        <Pagination page={f.page} totalPages={Math.ceil(total / PAGE_SIZE)} total={total} pageSize={PAGE_SIZE} onPageChange={f.setPage} />
      </Panel>

      <Dialog open={!!detail} onOpenChange={o => { if (!o) setDetail(null); }}>
        {detail && (
          <SheetContent
            title={`Commande de ${holderName(detail)}`}
            description={<span className="inline-flex gap-1.5"><StatusBadge status={detail.status} map={ORDER_STATUS} /><StatusBadge status={detail.kind} map={ORDER_KIND} /></span>}
            footer={refundable(detail) ? (
              <Can module="events" write>
                <Button variant="danger" size="lg" onClick={() => refund(detail)}>
                  <HugeiconsIcon icon={MoneyReceive02Icon} size={16} aria-hidden="true" />Rembourser {formatMoney(detail.total)}…
                </Button>
              </Can>
            ) : undefined}
          >
            <div className="space-y-5">
              <SheetSection title="Montants">
                <DetailList items={[
                  ['Sous-total', <Money key="s" value={detail.subtotal} />],
                  ['Commission SBC', <Money key="c" value={detail.commission} />],
                  ['Total payé', <Money key="t" value={detail.total} className="font-semibold" />],
                ]} />
              </SheetSection>
              <SheetSection title="Acheteur">
                <DetailList items={[
                  ['Nom', holderName(detail)],
                  ['Téléphone', detail.holder.phone || '—'],
                  !!detail.holder.email && ['E-mail', detail.holder.email],
                  ['Compte SBC', <Link key="u" to={`/userpage/${detail.userId}`} className="text-primary hover:underline">Ouvrir la fiche membre</Link>],
                ]} />
              </SheetSection>
              <SheetSection title="Références">
                <DetailList items={[
                  ['Créée le', formatDateTime(detail.createdAt)],
                  ['Payée le', formatDateTime(detail.paidAt)],
                  ['Commande', <CopyId key="o" value={detail._id} />],
                  ['Événement', <CopyId key="e" value={detail.eventId} />],
                  !!detail.paymentSessionId && ['Paiement', <span key="p" className="break-all font-mono text-xs">{detail.paymentSessionId}</span>],
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
