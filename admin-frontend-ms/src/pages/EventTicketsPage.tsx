import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Ticket01Icon } from '@hugeicons/core-free-icons';
import { listAdminEvents, listAdminTickets, type AdminTicket, type TicketStatus } from '../api/event';
import { usePageFilters } from '../hooks/usePageFilters';
import { PageFilters } from '../components/filters/PageFilters';
import { useClearAll } from '../components/event/useClearAll';
import {
  Button, Dialog, EmptyState, PageHeader, Pagination, Panel, ResponsiveList, SheetContent, type ListColumn,
} from '../components/ui';
import {
  CopyId, DateText, DetailList, ErrorState, FilterBar, FilterSelect, SearchInput, SheetSection, StatusBadge,
  formatDateTime, formatNumber, useUrlFilters,
} from '../components/moduleKit';
import { PAGE_SIZE, TICKET_STATUS } from '../components/event/shared';
import { TwoLines } from '../components/event/TwoLines';

const STATUS_OPTIONS = [
  { value: 'ISSUED', label: 'Émis' },
  { value: 'CHECKED_IN', label: 'Entrés' },
  { value: 'PENDING', label: 'En attente' },
  { value: 'CANCELLED', label: 'Annulés' },
  { value: 'REFUNDED', label: 'Remboursés' },
  { value: 'EXPIRED', label: 'Expirés' },
];

/** SBC Event tickets: find a ticket by number, holder name or phone (read only). */
export default function EventTicketsPage() {
  const f = useUrlFilters(['q', 'status', 'eventId'] as const);
  const filters = usePageFilters();
  const clearAll = useClearAll(['q', 'status', 'eventId']);
  const { q, status, eventId } = f.values;
  const [detail, setDetail] = useState<AdminTicket | null>(null);

  // The API returns raw eventId/ticketTypeId, so the event title is joined
  // client-side from the first 100 events. Drop this once the backend
  // returns eventTitle/ticketTypeName on the ticket.
  const events = useQuery({ queryKey: ['event', 'events', 'index'], queryFn: () => listAdminEvents({ limit: 100 }).then(r => r.items), staleTime: 60_000 });
  const eventTitle = (id: string) => events.data?.find(e => e._id === id)?.title;

  const list = useQuery({
    queryKey: ['event', 'tickets', q, status, eventId, f.page, filters.apiParams],
    queryFn: () => listAdminTickets({
      q: q.trim() || undefined, status: (status || undefined) as TicketStatus | undefined, eventId: eventId || undefined,
      limit: PAGE_SIZE, skip: (f.page - 1) * PAGE_SIZE, ...filters.apiParams,
    }),
    placeholderData: keepPreviousData,
  });
  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;

  const eventCell = (t: AdminTicket) => eventTitle(t.eventId) ?? <CopyId value={t.eventId} />;

  const columns: ListColumn<AdminTicket>[] = [
    { key: 'holder', header: 'Participant', cell: t => <TwoLines main={t.holderName || 'Participant'} sub={t.holderPhone} /> },
    { key: 'serial', header: 'N° de billet', cell: t => <span className="font-mono text-sm">{t.serial}</span> },
    { key: 'event', header: 'Événement', cell: t => <span className="text-sm">{eventCell(t)}</span> },
    { key: 'status', header: 'Statut', cell: t => <StatusBadge status={t.status} map={TICKET_STATUS} /> },
    { key: 'created', header: 'Acheté', cell: t => <DateText value={t.createdAt} className="text-fg-muted" /> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Billets" description="Retrouvez un billet par son numéro, le nom ou le téléphone du participant." />

      <PageFilters filters={filters} onReset={clearAll}>
        <FilterBar
          search={<SearchInput value={q} onChange={v => f.set({ q: v })} placeholder="N° de billet, nom ou téléphone" />}
          filterCount={2}
          activeCount={filters.isFiltered ? 0 : f.activeCount}
          onClear={f.clear}
          filters={(
            <>
              <FilterSelect label="Statut" allLabel="Tous les statuts" value={status} onChange={v => f.set({ status: v })} options={STATUS_OPTIONS} />
              <FilterSelect label="Événement" allLabel="Tous les événements" value={eventId} onChange={v => f.set({ eventId: v })}
                options={(events.data ?? []).map(e => ({ value: e._id, label: e.title }))} />
            </>
          )}
          trailing={list.data && <span className="text-sm text-fg-muted">{formatNumber(total)} billet{total > 1 ? 's' : ''}</span>}
        />
      </PageFilters>

      <Panel>
        <div className={list.isFetching && list.data ? 'opacity-60 transition-opacity' : undefined}>
          <ResponsiveList
            rows={items}
            columns={columns}
            rowKey={t => t._id}
            onRowClick={setDetail}
            loading={list.isLoading}
            empty={list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} retrying={list.isFetching} /> : (
              <EmptyState icon={Ticket01Icon} title="Aucun billet"
                description={(f.activeCount || filters.isFiltered) ? 'Aucun billet ne correspond à cette recherche.' : 'Les billets achetés apparaîtront ici.'}
                action={(f.activeCount || filters.isFiltered) ? <Button size="lg" onClick={clearAll}>Effacer les filtres</Button> : undefined} />
            )}
          />
        </div>
        <Pagination page={f.page} totalPages={Math.ceil(total / PAGE_SIZE)} total={total} pageSize={PAGE_SIZE} onPageChange={f.setPage} />
      </Panel>

      <Dialog open={!!detail} onOpenChange={o => { if (!o) setDetail(null); }}>
        {detail && (
          <SheetContent title={`Billet ${detail.serial}`} description={<StatusBadge status={detail.status} map={TICKET_STATUS} />}>
            <div className="space-y-5">
              <SheetSection title="Participant">
                <DetailList items={[
                  ['Nom', detail.holderName || '—'],
                  ['Téléphone', detail.holderPhone || '—'],
                  !!detail.holderEmail && ['E-mail', detail.holderEmail],
                ]} />
              </SheetSection>
              <SheetSection title="Billet">
                <DetailList items={[
                  ['Événement', eventCell(detail)],
                  ['Type de billet', <CopyId key="tt" value={detail.ticketTypeId} />],
                  ['Commande', <CopyId key="o" value={detail.orderId} />],
                  ['Acheté le', formatDateTime(detail.createdAt)],
                  !!detail.issuedAt && ['Émis le', formatDateTime(detail.issuedAt)],
                  !!detail.checkedInAt && ['Entré le', formatDateTime(detail.checkedInAt)],
                  !!detail.previousTicketId && ['Remplace le billet', <CopyId key="p" value={detail.previousTicketId} />],
                ]} />
              </SheetSection>
            </div>
          </SheetContent>
        )}
      </Dialog>
    </div>
  );
}
