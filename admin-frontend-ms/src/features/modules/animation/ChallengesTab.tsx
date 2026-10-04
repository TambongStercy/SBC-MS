import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CHALLENGE_STATUSES, CHALLENGE_STATUS_LABELS, listAnimationChallenges, type AnimChallenge, type ChallengeStatus } from '../../../api/animation';
import { Badge, DataList, EmptyState, Pagination, SearchInput, Select, StatusBadge, type Column } from '../../../ui';
import { formatDateTime, formatMoney, formatNumber } from '../../../lib/format';
import { useDebounced, useParamState } from '../../../lib/hooks';
import { CHALLENGE_STATUS } from './shared';
import { ChallengeSheet } from './ChallengeSheet';

const PAGE = 25;

function Status({ c }: { c: AnimChallenge }) {
    return (
        <span className="inline-flex flex-wrap gap-1">
            <StatusBadge status={c.status} labels={CHALLENGE_STATUS} />
            {c.suspendedAt && <Badge tone="danger">Suspendu</Badge>}
        </span>
    );
}

/** Every challenge of every event; a row opens it with its board, result, flags and actions. */
export function ChallengesTab() {
    const [search, setSearch] = useState('');
    const [status, setStatus] = useParamState('statut', '');
    const [page, setPage] = useState(1);
    const [openId, setOpenId] = useState<string | null>(null);
    const q = useDebounced(search.trim(), 400);
    const list = useQuery({
        queryKey: ['animation', 'challenges', q, status, page],
        queryFn: () => listAnimationChallenges({ q: q || undefined, status: (status || undefined) as ChallengeStatus | undefined, page, limit: PAGE }),
        placeholderData: keepPreviousData,
    });
    const cols: Column<AnimChallenge>[] = [
        { key: 'n', header: 'Défi', cell: c => <span><span className="block font-semibold">{c.name}</span><span className="block text-xs text-ink-2">{c.event?.title ?? 'Événement'}</span></span> },
        { key: 's', header: 'Statut', cell: c => <Status c={c} /> },
        { key: 'c', header: 'Candidats', align: 'right', cell: c => formatNumber(c.counters?.candidates) },
        { key: 'f', header: 'Votes gratuits', align: 'right', cell: c => formatNumber(c.counters?.freeVotes) },
        { key: 'p', header: 'Votes payants', align: 'right', cell: c => formatNumber(c.counters?.paidVotes) },
        { key: 'r', header: 'Revenus', align: 'right', cell: c => <span className="whitespace-nowrap">{formatMoney(c.counters?.paidRevenue)}</span> },
        { key: 'u', header: 'Mis à jour', cell: c => <span className="text-ink-2 whitespace-nowrap">{formatDateTime(c.updatedAt)}</span> },
    ];
    return (
        <div className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
                <SearchInput className="flex-1" value={search} onChange={v => { setSearch(v); setPage(1); }} placeholder="Rechercher un défi par nom" />
                <div className="sm:w-56"><Select aria-label="Statut" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>
                    <option value="">Tous les statuts</option>
                    {CHALLENGE_STATUSES.map(s => <option key={s} value={s}>{CHALLENGE_STATUS_LABELS[s]}</option>)}
                </Select></div>
            </div>
            <DataList rows={list.data?.items} columns={cols} rowKey={c => c._id} loading={list.isLoading} error={list.error} onRetry={() => list.refetch()}
                onRowClick={c => setOpenId(c._id)}
                empty={<EmptyState title={q ? `Aucun défi ne correspond à « ${q} »` : 'Aucun défi'} />}
                card={c => (
                    <span className="block space-y-1">
                        <span className="flex items-start justify-between gap-3">
                            <span className="min-w-0"><span className="block font-semibold truncate">{c.name}</span><span className="block text-xs text-ink-2 truncate">{c.event?.title ?? 'Événement'}</span></span>
                            <Status c={c} />
                        </span>
                        <span className="block text-xs text-ink-3">
                            {formatNumber(c.counters?.candidates)} candidats · {formatNumber((c.counters?.freeVotes ?? 0) + (c.counters?.paidVotes ?? 0))} votes · {formatMoney(c.counters?.paidRevenue)}
                        </span>
                    </span>
                )} />
            {list.data && <Pagination page={page} totalPages={Math.max(1, list.data.totalPages)} total={list.data.total} onChange={setPage} />}
            {openId && <ChallengeSheet id={openId} onClose={() => setOpenId(null)} />}
        </div>
    );
}
