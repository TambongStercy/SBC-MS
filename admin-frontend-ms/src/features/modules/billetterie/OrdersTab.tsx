import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { listAdminOrders, type AdminOrder, type OrderKind, type OrderStatus } from '../../../api/event';
import { MemberPicker } from '../../members/MemberPicker';
import type { Member } from '../../members/api';
import { DataList, EmptyState, Pagination, Select, StatusBadge, type Column } from '../../../ui';
import { formatDateTime, formatMoney } from '../../../lib/format';
import { ORDER_KIND, ORDER_STATUS, useEventIndex } from './shared';
import { OrderSheet } from './OrderSheet';

const PAGE = 20;

/** Orders and their tickets in one place: filter by event (pick it) and by buyer (find them). */
export function OrdersTab({ eventId: fixedEvent }: { eventId?: string }) {
    const { events, title } = useEventIndex();
    const [status, setStatus] = useState<'' | OrderStatus>('');
    const [kind, setKind] = useState<'' | OrderKind>('');
    const [eventId, setEventId] = useState(fixedEvent ?? '');
    const [buyer, setBuyer] = useState<Member | null>(null);
    const [page, setPage] = useState(1);
    const [open, setOpen] = useState<AdminOrder | null>(null);
    const q = useQuery({
        queryKey: ['events', 'orders', status, kind, eventId, buyer?._id, page],
        queryFn: () => listAdminOrders({ status: status || undefined, kind: kind || undefined, eventId: eventId || undefined, userId: buyer?._id, limit: PAGE, skip: (page - 1) * PAGE }),
        placeholderData: keepPreviousData,
    });
    const cols: Column<AdminOrder>[] = [
        { key: 'b', header: 'Acheteur', cell: o => <span><span className="block font-semibold">{o.holder.firstName} {o.holder.lastName}</span><span className="block text-xs text-ink-2">{o.holder.phone}</span></span> },
        ...(!fixedEvent ? [{ key: 'e', header: 'Événement', cell: (o: AdminOrder) => <span className="text-ink-2">{title(o.eventId)}</span> }] : []),
        { key: 'k', header: 'Type', cell: o => <StatusBadge status={o.kind} labels={ORDER_KIND} /> },
        { key: 's', header: 'Statut', cell: o => <StatusBadge status={o.status} labels={ORDER_STATUS} /> },
        { key: 't', header: 'Total', align: 'right', cell: o => <span className="font-semibold">{formatMoney(o.total)}</span> },
        { key: 'd', header: 'Date', cell: o => <span className="text-ink-2 whitespace-nowrap">{formatDateTime(o.paidAt || o.createdAt)}</span> },
    ];
    return (
        <div className="space-y-3">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                <Select aria-label="Statut" value={status} onChange={e => { setStatus(e.target.value as OrderStatus | ''); setPage(1); }}>
                    <option value="">Tous les statuts</option>{Object.entries(ORDER_STATUS).map(([v, [l]]) => <option key={v} value={v}>{l}</option>)}
                </Select>
                <Select aria-label="Type" value={kind} onChange={e => { setKind(e.target.value as OrderKind | ''); setPage(1); }}>
                    <option value="">Tous les types</option><option value="PRIMARY">Ventes</option><option value="RESALE">Reventes</option>
                </Select>
                {!fixedEvent && (
                    <div className="col-span-2"><Select aria-label="Événement" value={eventId} onChange={e => { setEventId(e.target.value); setPage(1); }}>
                        <option value="">Tous les événements</option>{events.map(e => <option key={e._id} value={e._id}>{e.title}</option>)}
                    </Select></div>
                )}
            </div>
            <MemberPicker value={buyer} onChange={m => { setBuyer(m); setPage(1); }} />
            <DataList rows={q.data?.items} columns={cols} rowKey={o => o._id} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()}
                onRowClick={setOpen} empty={<EmptyState title="Aucune commande" />}
                card={o => (
                    <span className="flex items-center justify-between gap-3">
                        <span className="min-w-0"><span className="block font-semibold truncate">{o.holder.firstName} {o.holder.lastName}</span>
                            <span className="block text-xs text-ink-2 truncate">{fixedEvent ? formatDateTime(o.paidAt || o.createdAt) : title(o.eventId)}</span></span>
                        <span className="text-right shrink-0"><span className="block font-semibold tabular">{formatMoney(o.total)}</span><StatusBadge status={o.status} labels={ORDER_STATUS} /></span>
                    </span>
                )} />
            {q.data && <Pagination page={page} totalPages={Math.max(1, Math.ceil(q.data.total / PAGE))} total={q.data.total} onChange={setPage} />}
            {open && <OrderSheet order={open} eventTitle={title(open.eventId)} onClose={() => setOpen(null)} />}
        </div>
    );
}
