import { useEffect, useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Ticket01Icon } from '@hugeicons/core-free-icons';
import { listTicketsForMonth, type TombolaMonth, type TombolaTicket } from '../../services/adminTombolaApi';
import { Dialog, EmptyState, Pagination, ResponsiveList, SheetContent, type ListColumn } from '../ui';
import {
  CopyId, DateText, DetailList, ErrorState, SearchInput, SheetSection, StatusBadge, count, formatDateTime, formatNumber,
} from '../moduleKit';
import { Prize, TOMBOLA_STATUS, monthTitle } from './labels';

const PAGE_SIZE = 15;

/**
 * A tombola's details sheet: status and dates, its winners, and every ticket
 * sold (search by name, e-mail or phone, paginated by the server).
 */
export default function TombolaSheet({ tombola, onClose, footer, winnerNames, api = {} }: {
  tombola: TombolaMonth | null;
  /** Country + period of the page filter row: tickets bought in that period / country. */
  api?: { country?: string; from?: string; to?: string };
  onClose: () => void;
  footer?: ReactNode;
  /** userId → name, when known */
  winnerNames?: Map<string, string>;
}) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  useEffect(() => { setPage(1); setSearch(''); }, [tombola?._id]);

  const query = useQuery({
    queryKey: ['tombola', 'tickets', tombola?._id, page, search, api],
    queryFn: async () => {
      const res = await listTicketsForMonth(tombola!._id, { page, limit: PAGE_SIZE, ...api }, search);
      if (!res?.data?.tickets || !res.pagination) throw new Error(res?.message || 'Réponse inattendue du serveur pour les tickets.');
      return res;
    },
    enabled: !!tombola,
    placeholderData: keepPreviousData,
  });
  const tickets = query.data?.data.tickets ?? [];
  const pg = query.data?.pagination;

  const columns: ListColumn<TombolaTicket>[] = [
    { key: 'num', header: 'N°', cell: t => <span className="font-semibold tabular-nums">{t.ticketNumber}</span> },
    {
      key: 'member', header: 'Membre', cell: t => (
        <div className="min-w-0">
          <p className="truncate text-sm text-fg">{t.userName || 'Nom inconnu'}</p>
          <p className="truncate text-xs text-fg-muted">{[t.userPhoneNumber, t.userEmail].filter(Boolean).join(' · ') || '—'}</p>
        </div>
      ),
    },
    { key: 'ids', header: 'Références', cell: t => <span className="flex flex-col items-start gap-0.5"><CopyId value={t.ticketId} label="Copier la référence du ticket" /><CopyId value={t.userId} label="Copier l’identifiant du membre" /></span> },
    { key: 'date', header: 'Acheté', cell: t => <DateText value={t.purchaseTimestamp} className="text-fg-muted" /> },
  ];

  const card = (t: TombolaTicket) => (
    <div className="flex items-start gap-3">
      <span className="inline-flex min-w-10 justify-center rounded-md bg-surface-3 px-1.5 py-0.5 text-sm font-semibold tabular-nums text-fg">{t.ticketNumber}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-fg">{t.userName || 'Nom inconnu'}</p>
        <p className="truncate text-xs text-fg-muted">{t.userPhoneNumber || t.userEmail || '—'}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-fg-muted"><DateText value={t.purchaseTimestamp} /><CopyId value={t.ticketId} /></div>
      </div>
    </div>
  );

  const winners = [...(tombola?.winners ?? [])].sort((a, b) => a.rank - b.rank);

  return (
    <Dialog open={!!tombola} onOpenChange={o => { if (!o) onClose(); }}>
      {tombola && (
        <SheetContent width="xl" title={`Tombola de ${monthTitle(tombola.month, tombola.year).toLowerCase()}`} description="Détails, gagnants et tickets vendus." footer={footer}>
          <div className="space-y-6">
            <SheetSection title="Tombola">
              <DetailList items={[
                ['Statut', <StatusBadge status={tombola.status} map={TOMBOLA_STATUS} />],
                ['Tickets vendus', <span className="tabular-nums">{formatNumber(tombola.lastTicketNumber ?? 0)}</span>],
                ['Début', formatDateTime(tombola.startDate)],
                !!tombola.endDate && ['Fin', formatDateTime(tombola.endDate)],
                ['Tirage', tombola.drawDate ? formatDateTime(tombola.drawDate) : 'Pas encore tiré'],
              ]} />
            </SheetSection>

            {winners.length > 0 && (
              <SheetSection title="Gagnants">
                <DetailList items={winners.map(w => [
                  `Rang ${w.rank}`,
                  <span className="flex flex-col items-start gap-0.5 sm:items-end">
                    <span><Prize value={w.prize} /> · ticket n° <span className="tabular-nums">{w.winningTicketNumber}</span></span>
                    <span className="text-xs text-fg-muted">{winnerNames?.get(w.userId) ?? <CopyId value={w.userId} />}</span>
                  </span>,
                ] as [ReactNode, ReactNode])} />
              </SheetSection>
            )}

            <SheetSection title={pg ? `Tickets (${count(pg.totalCount, 'ticket')})` : 'Tickets'}>
              {(api.country || api.from || api.to) && <p className="text-xs text-fg-muted">Seuls les tickets du pays et de la période choisis sur la page sont listés.</p>}
              <SearchInput value={search} onChange={v => { setSearch(v); setPage(1); }} placeholder="Nom, e-mail ou téléphone" delay={500} />
              <div className={`overflow-hidden rounded-panel border border-line ${query.isFetching && !query.isLoading ? 'opacity-60' : ''}`}>
                <ResponsiveList
                  rows={tickets}
                  columns={columns}
                  rowKey={t => t._id}
                  card={card}
                  loading={query.isLoading}
                  empty={query.isError
                    ? <ErrorState error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />
                    : <EmptyState icon={Ticket01Icon} title={search ? 'Aucun ticket ne correspond' : 'Aucun ticket vendu'} description={search ? 'Vérifiez l’orthographe.' : 'Les tickets achetés par les membres apparaissent ici.'} />}
                />
                {pg && <Pagination page={page} totalPages={pg.totalPages || 1} total={pg.totalCount || 0} pageSize={PAGE_SIZE} onPageChange={setPage} />}
              </div>
            </SheetSection>
          </div>
        </SheetContent>
      )}
    </Dialog>
  );
}
