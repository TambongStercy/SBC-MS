import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getUserFinancialAnalytics, type UserAnalyticsEntry } from '../../services/adminFinancialAnalyticsApi';
import { Avatar, DataList, EmptyState, Input, Page, Pagination, Select, Tabs, type Column } from '../../ui';
import { formatMoney, formatNumber, formatPhone } from '../../lib/format';
import { countryName } from '../../lib/labels';
import { useDebounced } from '../../lib/hooks';

const COUNTRIES = ['BJ', 'BF', 'CM', 'CI', 'CD', 'CG', 'GA', 'GN', 'ML', 'NE', 'SN', 'TG', 'TD', 'GH', 'KE', 'NG'];

/** Members ranked by what they withdrew, or by what they earned. */
export default function AnalysisPage() {
    const navigate = useNavigate();
    const [sortBy, setSortBy] = useState<'totalWithdrawn' | 'totalEarned'>('totalWithdrawn');
    const [country, setCountry] = useState('');
    const [min, setMin] = useState('50000');
    const [page, setPage] = useState(1);
    const minAmount = useDebounced(min, 500);
    const q = useQuery({
        queryKey: ['analysis', sortBy, country, minAmount, page],
        queryFn: () => getUserFinancialAnalytics({ sortBy, sortOrder: 'desc', country: country || undefined, minAmount: Number(minAmount) || 0, page, limit: 20 }),
        placeholderData: keepPreviousData,
    });
    const cols: Column<UserAnalyticsEntry>[] = [
        { key: 'm', header: 'Membre', cell: r => (
            <span className="flex items-center gap-2.5"><Avatar name={r.name} size={32} /><span><span className="block font-semibold">{r.name}</span><span className="block text-xs text-ink-2">{formatPhone(r.phoneNumber)} · {countryName(r.country)}</span></span></span>
        ) },
        { key: 'w', header: 'Retiré', align: 'right', cell: r => <span className={sortBy === 'totalWithdrawn' ? 'font-bold' : ''}>{formatMoney(r.totalWithdrawn)}<span className="block text-xs text-ink-3 font-normal">{formatNumber(r.withdrawalCount)} retraits</span></span> },
        { key: 'e', header: 'Gagné', align: 'right', cell: r => <span className={sortBy === 'totalEarned' ? 'font-bold' : ''}>{formatMoney(r.totalEarned)}<span className="block text-xs text-ink-3 font-normal">{formatNumber(r.earningCount)} gains</span></span> },
        { key: 'b', header: 'Solde', align: 'right', cell: r => formatMoney(r.balance) },
    ];
    return (
        <Page title="Plus gros gains" width="wide">
            <div className="space-y-3">
                <Tabs value={sortBy} onChange={v => { setSortBy(v); setPage(1); }} items={[{ value: 'totalWithdrawn', label: 'Plus gros retraits' }, { value: 'totalEarned', label: 'Plus gros gains' }]} />
                <div className="grid grid-cols-2 gap-2 sm:max-w-md">
                    <Select aria-label="Pays" value={country} onChange={e => { setCountry(e.target.value); setPage(1); }}>
                        <option value="">Tous les pays</option>{COUNTRIES.map(c => <option key={c} value={c}>{countryName(c)}</option>)}
                    </Select>
                    <Input aria-label="Montant minimum" inputMode="numeric" value={min} onChange={e => { setMin(e.target.value); setPage(1); }} placeholder="Minimum (FCFA)" />
                </div>
                <DataList rows={q.data?.data} columns={cols} rowKey={r => r.userId} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()}
                    onRowClick={r => navigate(`/membres/${r.userId}`)} empty={<EmptyState title="Personne au-dessus de ce montant" />}
                    card={r => (
                        <span className="flex items-center gap-3"><Avatar name={r.name} size={36} />
                            <span className="min-w-0 flex-1"><span className="block font-semibold truncate">{r.name}</span><span className="block text-xs text-ink-2">{countryName(r.country)}</span></span>
                            <span className="text-right"><span className="block font-bold tabular">{formatMoney(sortBy === 'totalWithdrawn' ? r.totalWithdrawn : r.totalEarned)}</span><span className="block text-xs text-ink-3">{sortBy === 'totalWithdrawn' ? 'retiré' : 'gagné'}</span></span>
                        </span>
                    )} />
                {q.data && <Pagination page={q.data.pagination.page} totalPages={q.data.pagination.totalPages} total={q.data.pagination.total} onChange={setPage} />}
            </div>
        </Page>
    );
}
