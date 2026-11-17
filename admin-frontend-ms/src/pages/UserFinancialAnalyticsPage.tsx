import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowDown01Icon, ArrowUp01Icon, Download01Icon, MoneyReceive01Icon, MoneySend01Icon, UserGroupIcon, InboxIcon } from '@hugeicons/core-free-icons';
import { getUserFinancialAnalytics, UserAnalyticsEntry, UserAnalyticsFilters } from '../services/adminFinancialAnalyticsApi';
import { getCountryName } from '../utils/countryUtils';
import { ErrorState } from '../components/common/DataStates';
import { formatMoney, formatNumber } from '../components/common/format';
import { FilterRow, SHARED_FILTER_KEYS, downloadCsv, errorMessage, useUrlFilters } from '../components/finance/shared';
import { usePageFilters } from '../hooks/usePageFilters';
import { EarnedWithdrawnChart } from '../components/finance/EarnedWithdrawnChart';
import {
    Button, EmptyState, Input, Metric, PageHeader, Pagination, Panel, PanelHeader, ResponsiveList, Select,
    type ListColumn,
} from '../components/ui';


type SortField = 'totalWithdrawn' | 'totalEarned' | 'total';
const SORT_LABEL: Record<SortField, string> = { total: 'Total', totalEarned: 'Gagné', totalWithdrawn: 'Retiré' };
const SORT_OPTIONS = (['total', 'totalEarned', 'totalWithdrawn'] as SortField[]).flatMap(f => [
    { value: `${f}:desc`, label: `${SORT_LABEL[f]}, du plus grand` },
    { value: `${f}:asc`, label: `${SORT_LABEL[f]}, du plus petit` },
]);
const LIMIT_OPTIONS = ['25', '50', '100', '200'].map(v => ({ value: v, label: `${v} par page` }));
const DEFAULT_MIN = 50000;
const DEFAULT_LIMIT = 50;
const FILTER_KEYS = ['min', 'limit', 'sort', 'order'];

const fcfa = (n: number) => formatMoney(n, 'XAF');

/** The API answers "Unknown" when the member account no longer exists. */
const known = (item: UserAnalyticsEntry) => !!item.name && item.name !== 'Unknown';
const displayName = (item: UserAnalyticsEntry) => (known(item) ? item.name : `Membre introuvable …${item.userId.slice(-6)}`);

/**
 * Analyse financière des membres (module `finance`): members ranked by what
 * they earned and withdrew, to spot the big accounts. Read only.
 */
export default function UserFinancialAnalyticsPage() {
    const { get, set, clear, page } = useUrlFilters();
    const filters = usePageFilters();
    const country = filters.country;
    const sharedParams = JSON.stringify(filters.apiParams);
    const minParam = get('min');
    const minAmount = minParam === '' ? DEFAULT_MIN : Math.max(0, Number(minParam) || 0);
    const limit = [25, 50, 100, 200].includes(Number(get('limit'))) ? Number(get('limit')) : DEFAULT_LIMIT;
    const rawSort = get('sort', 'total');
    const sortBy: SortField = rawSort === 'totalEarned' || rawSort === 'totalWithdrawn' ? rawSort : 'total';
    const sortOrder: 'asc' | 'desc' = get('order') === 'asc' ? 'asc' : 'desc';

    const [data, setData] = useState<UserAnalyticsEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [hasLoaded, setHasLoaded] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pagination, setPagination] = useState({ page: 1, limit: DEFAULT_LIMIT, total: 0, totalPages: 0 });
    const [minDraft, setMinDraft] = useState(String(minAmount));
    const [minSynced, setMinSynced] = useState(minAmount);
    if (minSynced !== minAmount) { setMinSynced(minAmount); setMinDraft(String(minAmount)); }
    const requestId = useRef(0);

    const filtersKey = JSON.stringify({ minAmount, page, limit, sortBy, sortOrder, shared: JSON.parse(sharedParams) });
    const fetchData = useCallback(async () => {
        const f = JSON.parse(filtersKey) as { minAmount: number; page: number; limit: number; sortBy: SortField; sortOrder: 'asc' | 'desc'; shared: { country?: string; from?: string; to?: string } };
        // country/from/to only when set (shared filters)
        const cleanFilters: UserAnalyticsFilters = { minAmount: f.minAmount, page: f.page, limit: f.limit, sortBy: f.sortBy, sortOrder: f.sortOrder, ...f.shared };
        const id = ++requestId.current;
        setLoading(true);
        setError(null);
        try {
            const response = await getUserFinancialAnalytics(cleanFilters);
            if (id !== requestId.current) return;
            if (response.success) {
                setData(response.data);
                setPagination(response.pagination);
            }
        } catch (err: unknown) {
            if (id !== requestId.current) return;
            const message = errorMessage(err, 'Erreur lors du chargement des données');
            setError(message);
            toast.error(message);
        } finally {
            if (id === requestId.current) {
                setLoading(false);
                setHasLoaded(true);
            }
        }
    }, [filtersKey]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const handleSort = (field: SortField) => {
        set({ sort: field === 'total' ? null : field, order: sortBy === field && sortOrder === 'desc' ? 'asc' : null });
    };

    const applyMin = () => {
        const n = Math.max(0, parseInt(minDraft, 10) || 0);
        if (n !== minAmount) set({ min: n === DEFAULT_MIN ? null : n });
        else setMinDraft(String(n));
    };

    const handleExportCSV = () => {
        if (data.length === 0) {
            toast.error('Aucune donnée à exporter');
            return;
        }
        const headers = ['#', 'Nom', 'Email', 'Téléphone', 'Pays', 'Solde (FCFA)', 'Total Retiré (FCFA)', 'Total Gagné (FCFA)', 'Nb Retraits', 'Nb Gains'];
        const rows = data.map((item, index) => [
            (page - 1) * limit + index + 1,
            item.name,
            item.email,
            item.phoneNumber,
            item.country,
            Math.round(item.balance),
            Math.round(item.totalWithdrawn),
            Math.round(item.totalEarned),
            item.withdrawalCount,
            item.earningCount,
        ]);
        const countryLabel = country ? `_${country}` : '_all';
        downloadCsv(`user-analytics${countryLabel}_${new Date().toISOString().split('T')[0]}.csv`, headers, rows);
        toast.success('CSV exporté avec succès');
    };

    const totalWithdrawn = data.reduce((sum, d) => sum + d.totalWithdrawn, 0);
    const totalEarned = data.reduce((sum, d) => sum + d.totalEarned, 0);
    const ownActive = minAmount !== DEFAULT_MIN || limit !== DEFAULT_LIMIT || sortBy !== 'total' || sortOrder !== 'desc';
    const filtersActive = ownActive || filters.isFiltered;
    const clearAll = () => clear([...FILTER_KEYS, ...SHARED_FILTER_KEYS]);
    const rank = (item: UserAnalyticsEntry) => (page - 1) * limit + data.indexOf(item) + 1;

    const sortHeader = (field: SortField) => {
        const on = sortBy === field;
        return (
            <button
                type="button"
                onClick={() => handleSort(field)}
                className={`ml-auto inline-flex items-center gap-1 hover:text-fg ${on ? 'text-fg' : ''}`}
                aria-label={`Trier par ${SORT_LABEL[field].toLowerCase()}`}
            >
                {SORT_LABEL[field]}
                {on && <HugeiconsIcon icon={sortOrder === 'desc' ? ArrowDown01Icon : ArrowUp01Icon} size={12} aria-hidden="true" />}
            </button>
        );
    };

    const columns: ListColumn<UserAnalyticsEntry>[] = [
        { key: 'rank', header: '#', cell: item => <span className="tabular-nums text-fg-muted">{rank(item)}</span>, className: 'w-12' },
        {
            key: 'member',
            header: 'Membre',
            cell: item => (
                <div className="min-w-0">
                    <p className={`truncate font-medium ${known(item) ? 'text-fg' : 'text-fg-muted'}`} title={known(item) ? undefined : item.userId}>{displayName(item)}</p>
                    {item.email && <p className="truncate text-xs text-fg-muted">{item.email}</p>}
                    {item.phoneNumber && <p className="truncate text-xs text-fg-subtle">{item.phoneNumber}</p>}
                </div>
            ),
        },
        { key: 'country', header: 'Pays', cell: item => <span className="text-sm text-fg-muted">{item.country ? getCountryName(item.country) : '—'}</span> },
        { key: 'balance', header: 'Solde', numeric: true, cell: item => fcfa(item.balance) },
        {
            key: 'earned', header: sortHeader('totalEarned'), numeric: true,
            cell: item => <span>{fcfa(item.totalEarned)}<span className="block text-xs text-fg-muted">{formatNumber(item.earningCount)} gain{item.earningCount > 1 ? 's' : ''}</span></span>,
        },
        {
            key: 'withdrawn', header: sortHeader('totalWithdrawn'), numeric: true,
            cell: item => <span>{fcfa(item.totalWithdrawn)}<span className="block text-xs text-fg-muted">{formatNumber(item.withdrawalCount)} retrait{item.withdrawalCount > 1 ? 's' : ''}</span></span>,
        },
        { key: 'total', header: sortHeader('total'), numeric: true, cell: item => <span className="font-semibold">{fcfa(item.total)}</span> },
    ];

    const card = (item: UserAnalyticsEntry) => (
        <div>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-fg"><span className="mr-1.5 tabular-nums text-fg-subtle">{rank(item)}.</span>{displayName(item)}</p>
                    <p className="truncate text-xs text-fg-muted">{[item.country && getCountryName(item.country), item.phoneNumber].filter(Boolean).join(' · ') || '—'}</p>
                </div>
                <p className="shrink-0 text-sm font-semibold tabular-nums text-fg">{fcfa(item.total)}</p>
            </div>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <div><dt className="text-fg-muted">Gagné</dt><dd className="tabular-nums text-fg">{fcfa(item.totalEarned)}</dd></div>
                <div><dt className="text-fg-muted">Retiré</dt><dd className="tabular-nums text-fg">{fcfa(item.totalWithdrawn)}</dd></div>
                <div><dt className="text-fg-muted">Solde</dt><dd className="tabular-nums text-fg">{fcfa(item.balance)}</dd></div>
            </dl>
        </div>
    );

    const top = data.slice(0, 10).map(d => ({ id: d.userId, name: known(d) ? d.name : `Inconnu ${d.userId.slice(-4)}`, earned: d.totalEarned, withdrawn: d.totalWithdrawn }));
    const metric = (v: string) => (hasLoaded ? v : '—');

    return (
        <div className="space-y-6">
            <PageHeader
                title="Analyse financière des membres"
                description="Les membres classés par ce qu’ils ont gagné et retiré, pour repérer les gros comptes."
                actions={(
                    <Button variant="outline" className="h-11 sm:h-9" onClick={handleExportCSV} disabled={data.length === 0}>
                        <HugeiconsIcon icon={Download01Icon} size={16} aria-hidden="true" />
                        Exporter en CSV
                    </Button>
                )}
            />

            <FilterRow filters={filters} ownKeys={FILTER_KEYS} ownActive={ownActive}>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
                    <label className="relative block sm:w-44">
                        <span className="sr-only">Montant minimum (F)</span>
                        <Input
                            className="h-11 pr-16 sm:h-9"
                            type="number"
                            inputMode="numeric"
                            min={0}
                            value={minDraft}
                            onChange={e => setMinDraft(e.target.value)}
                            onBlur={applyMin}
                            onKeyDown={e => { if (e.key === 'Enter') applyMin(); }}
                            aria-label="Montant minimum en francs"
                        />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-fg-subtle">F min.</span>
                    </label>
                    <Select
                        className="h-11 sm:h-9 sm:w-56"
                        value={`${sortBy}:${sortOrder}`}
                        onValueChange={v => {
                            const [f, o] = v.split(':');
                            set({ sort: f === 'total' ? null : f, order: o === 'asc' ? 'asc' : null });
                        }}
                        options={SORT_OPTIONS}
                    />
                    <Select className="col-span-2 h-11 sm:h-9 sm:w-36" value={String(limit)} onValueChange={v => set({ limit: Number(v) === DEFAULT_LIMIT ? null : v })} options={LIMIT_OPTIONS} />
                </div>
            </FilterRow>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Metric className="col-span-2 sm:col-span-1" label="Membres trouvés" value={metric(formatNumber(pagination.total))} hint={`ayant au moins ${fcfa(minAmount)}${filters.isFiltered ? ', pour ces filtres' : ''}`} icon={UserGroupIcon} />
                <Metric label="Gagné" value={metric(fcfa(totalEarned))} hint="par les membres de cette page" icon={MoneyReceive01Icon} tone="success" />
                <Metric label="Retiré" value={metric(fcfa(totalWithdrawn))} hint="par les membres de cette page" icon={MoneySend01Icon} />
            </div>

            {top.length > 1 && (
                <div className={loading ? 'opacity-70 transition-opacity' : undefined}>
                    <EarnedWithdrawnChart
                        rows={top}
                        title={`Gagné et retiré : les ${top.length} premiers`}
                        description={`Dans l’ordre de la liste (${SORT_OPTIONS.find(o => o.value === `${sortBy}:${sortOrder}`)?.label.toLowerCase()}).`}
                    />
                </div>
            )}

            <Panel>
                <PanelHeader
                    title="Classement"
                    description={hasLoaded ? `${formatNumber(pagination.total)} membre${pagination.total > 1 ? 's' : ''}` : undefined}
                />
                <div className={loading && hasLoaded ? 'opacity-70 transition-opacity' : undefined}>
                    <ResponsiveList
                        rows={data}
                        columns={columns}
                        rowKey={item => item.userId}
                        card={card}
                        loading={loading && !hasLoaded}
                        empty={error ? (
                            <ErrorState description={error} onRetry={() => fetchData()} retrying={loading} />
                        ) : (
                            <EmptyState
                                icon={InboxIcon}
                                title="Aucun résultat trouvé"
                                description="Aucun membre n’atteint ce montant minimum pour ces filtres. Baissez-le, ou changez de pays ou de période."
                                action={filtersActive ? <Button size="lg" onClick={clearAll}>Effacer les filtres</Button> : undefined}
                            />
                        )}
                    />
                </div>
                <Pagination
                    page={page}
                    totalPages={pagination.totalPages}
                    total={pagination.total}
                    pageSize={limit}
                    onPageChange={p => set({ page: p })}
                />
            </Panel>
        </div>
    );
}
