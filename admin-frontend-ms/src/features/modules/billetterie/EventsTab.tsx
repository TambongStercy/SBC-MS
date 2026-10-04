import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { listAdminEvents, type AdminEvent, type EventStatus } from '../../../api/event';
import { DataList, EmptyState, Pagination, SearchInput, Select, StatusBadge, type Column } from '../../../ui';
import { formatDateTime, formatMoney, formatNumber } from '../../../lib/format';
import { useDebounced } from '../../../lib/hooks';
import { EVENT_STATUS, eventPlace } from './shared';

const PAGE = 20;

/**
 * Every event; a row opens the event with its orders, tickets and actions.
 * Opens on « À valider » when events wait for SBC's decision.
 */
export function EventsTab() {
    const navigate = useNavigate();
    const [search, setSearch] = useState('');
    const waiting = useQuery({ queryKey: ['events', 'list', 'PENDING_REVIEW', 'count'], queryFn: () => listAdminEvents({ status: 'PENDING_REVIEW', limit: 1 }) });
    const [status, setStatus] = useState<'' | EventStatus | null>(null);
    useEffect(() => { if (status === null && (waiting.data || waiting.isError)) setStatus(waiting.data?.total ? 'PENDING_REVIEW' : ''); }, [waiting.data, waiting.isError, status]);
    const [page, setPage] = useState(1);
    const q = useDebounced(search);
    const list = useQuery({
        queryKey: ['events', 'list', q, status, page],
        queryFn: () => listAdminEvents({ q: q || undefined, status: status || undefined, limit: PAGE, skip: (page - 1) * PAGE }),
        placeholderData: keepPreviousData, enabled: status !== null,
    });
    const cols: Column<AdminEvent>[] = [
        { key: 't', header: 'Événement', cell: e => <span><span className="block font-semibold">{e.title}</span><span className="block text-xs text-ink-2">{eventPlace(e)}</span></span> },
        { key: 'd', header: 'Date', cell: e => <span className="text-ink-2 whitespace-nowrap">{formatDateTime(e.startsAt)}</span> },
        { key: 's', header: 'Statut', cell: e => <StatusBadge status={e.status} labels={EVENT_STATUS} /> },
        { key: 'v', header: 'Billets', align: 'right', cell: e => formatNumber(e.totals?.ticketsSold ?? 0) },
        { key: 'r', header: 'Ventes', align: 'right', cell: e => formatMoney(e.totals?.grossRevenue ?? 0) },
    ];
    return (
        <div className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
                <SearchInput className="flex-1" value={search} onChange={v => { setSearch(v); setPage(1); }} placeholder="Titre ou ville" />
                <div className="sm:w-48"><Select aria-label="Statut" value={status ?? ''} onChange={e => { setStatus(e.target.value as EventStatus | ''); setPage(1); }}>
                    <option value="">Tous</option>{Object.entries(EVENT_STATUS).map(([v, [l]]) => <option key={v} value={v}>{l}</option>)}
                </Select></div>
            </div>
            <DataList rows={list.data?.items} columns={cols} rowKey={e => e._id} loading={list.isLoading || status === null} error={list.error} onRetry={() => list.refetch()}
                onRowClick={e => navigate(`/modules/billetterie/evenements/${e._id}`)} empty={<EmptyState title={status === 'PENDING_REVIEW' ? 'Aucun événement à valider' : 'Aucun événement'} />}
                card={e => (
                    <span className="flex items-center justify-between gap-3">
                        <span className="min-w-0"><span className="block font-semibold truncate">{e.title}</span><span className="block text-xs text-ink-2">{formatDateTime(e.startsAt)} · {e.category === 'webinaire' ? 'Webinaire' : e.city}</span>
                            <span className="block text-xs text-ink-3">{formatNumber(e.totals?.ticketsSold ?? 0)} billets · {formatMoney(e.totals?.grossRevenue ?? 0)}</span></span>
                        <StatusBadge status={e.status} labels={EVENT_STATUS} />
                    </span>
                )} />
            {list.data && <Pagination page={page} totalPages={Math.max(1, Math.ceil(list.data.total / PAGE))} total={list.data.total} onChange={setPage} />}
        </div>
    );
}
