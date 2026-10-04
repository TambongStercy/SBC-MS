import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { listReferrals, type Referral } from './api';
import { Avatar, Badge, DataList, EmptyState, Pagination, SearchInput, Tabs, type Column } from '../../ui';
import { formatDate, formatPhone } from '../../lib/format';
import { SUBSCRIPTION_LABEL } from '../../lib/labels';
import { useDebounced } from '../../lib/hooks';

const subsOf = (r: Referral) => r.activeSubscriptionTypes ?? r.activeSubscriptions ?? [];

/** The member's filleuls by level; each opens their own member page. */
export function MemberReferrals({ memberId }: { memberId: string }) {
    const navigate = useNavigate();
    const [level, setLevel] = useState<'1' | '2' | '3'>('1');
    const [page, setPage] = useState(1);
    const [q, setQ] = useState('');
    const search = useDebounced(q);
    const list = useQuery({
        queryKey: ['member', memberId, 'referrals', level, page, search],
        queryFn: () => listReferrals(memberId, Number(level), page, search),
        placeholderData: keepPreviousData,
    });
    const Subs = ({ r }: { r: Referral }) => subsOf(r).length
        ? <span className="flex gap-1">{subsOf(r).map(t => <Badge key={t} tone={SUBSCRIPTION_LABEL[t]?.[1] ?? 'neutral'}>{SUBSCRIPTION_LABEL[t]?.[0] ?? t}</Badge>)}</span>
        : <Badge>Pas abonné</Badge>;
    const cols: Column<Referral>[] = [
        { key: 'n', header: 'Filleul', cell: r => (
            <span className="flex items-center gap-2.5"><Avatar name={r.name} size={32} /><span><span className="block font-semibold">{r.name}</span><span className="block text-xs text-ink-2">{formatPhone(r.phoneNumber)}</span></span></span>
        ) },
        { key: 's', header: 'Abonnement', cell: r => <Subs r={r} /> },
        { key: 'd', header: 'Inscrit', cell: r => <span className="text-ink-2">{formatDate(r.createdAt)}</span> },
    ];
    return (
        <div className="space-y-3">
            <Tabs value={level} onChange={v => { setLevel(v); setPage(1); }} items={[{ value: '1', label: 'Directs' }, { value: '2', label: 'Niveau 2' }, { value: '3', label: 'Niveau 3' }]} />
            <SearchInput value={q} onChange={v => { setQ(v); setPage(1); }} placeholder="Chercher un filleul" />
            <DataList rows={list.data?.items} columns={cols} rowKey={r => String(r._id)} loading={list.isLoading} error={list.error} onRetry={() => list.refetch()}
                onRowClick={r => navigate(`/membres/${r._id}`)} empty={<EmptyState title="Aucun filleul à ce niveau" />}
                card={r => (
                    <span className="flex items-center gap-3"><Avatar name={r.name} size={36} />
                        <span className="min-w-0 flex-1"><span className="block font-semibold truncate">{r.name}</span><span className="block text-xs text-ink-2">{formatPhone(r.phoneNumber)} · {formatDate(r.createdAt)}</span></span>
                        <Subs r={r} />
                    </span>
                )} />
            {list.data && <Pagination page={list.data.page} totalPages={list.data.totalPages} total={list.data.total} onChange={setPage} />}
        </div>
    );
}
