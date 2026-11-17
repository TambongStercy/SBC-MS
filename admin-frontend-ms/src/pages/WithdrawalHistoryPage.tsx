import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
    Alert02Icon, CancelCircleIcon, CheckmarkCircle02Icon, Download01Icon, InboxIcon, MoneySend01Icon, Refresh01Icon,
} from '@hugeicons/core-free-icons';
import {
    WithdrawalTransaction,
    getValidatedWithdrawals,
} from '../services/adminWithdrawalApi';
import WithdrawalDetailsModal from '../components/withdrawals/WithdrawalDetailsModal';
import { WithdrawalStatusBadge } from '../components/withdrawals/WithdrawalStatusBadge';
import { withdrawalStatusLabel, withdrawalTypeLabel } from '../components/withdrawals/withdrawalStatus';
import ToastContainer from '../components/common/ToastContainer';
import { ErrorState, RelativeTime } from '../components/common/DataStates';
import { formatDateTime, formatNumber } from '../components/common/format';
import { FilterRow, SHARED_FILTER_KEYS, SearchBox, downloadCsv, errorMessage, exactMoney, useUrlFilters } from '../components/finance/shared';
import { usePageFilters } from '../hooks/usePageFilters';
import { useToast } from '../hooks/useToast';
import {
    Button, EmptyState, Metric, PageHeader, Pagination, Panel, PanelHeader, ResponsiveList, Select,
    type ListColumn,
} from '../components/ui';

type StatusFilter = 'all' | 'completed' | 'rejected_by_admin' | 'failed';
type TypeFilter = 'all' | 'mobile_money' | 'crypto';
const STATUS_OPTIONS = [
    { value: 'all', label: 'Tous les statuts' },
    { value: 'completed', label: 'Payés' },
    { value: 'rejected_by_admin', label: 'Rejetés' },
    { value: 'failed', label: 'Échoués' },
];
const TYPE_OPTIONS = [
    { value: 'all', label: 'Tous les types' },
    { value: 'mobile_money', label: 'Mobile Money' },
    { value: 'crypto', label: 'Crypto' },
];
const LIMIT = 20;

const net = (w: WithdrawalTransaction) => w.amount - w.fee;

function destination(w: WithdrawalTransaction): string {
    if (w.metadata?.withdrawalType === 'crypto') return `Crypto${w.metadata.cryptoCurrency ? ` · ${w.metadata.cryptoCurrency}` : ''}`;
    const a = w.metadata?.accountInfo;
    return a ? `${a.momoOperator || 'Mobile Money'} · ${a.fullMomoNumber}` : withdrawalTypeLabel(w.metadata?.withdrawalType);
}

/**
 * Historique des retraits (module `withdrawals`): requests already decided
 * (paid, rejected, failed). Status is filtered by the server; type and search
 * apply to the page shown, as before.
 */
const WithdrawalHistoryPage: React.FC = () => {
    const { toasts, removeToast, showWarning, showSuccess, showError } = useToast();
    const { get, set, clear, page } = useUrlFilters();
    const filters = usePageFilters();
    const sharedParams = JSON.stringify(filters.apiParams);

    const rawStatus = get('status', 'all');
    const statusFilter: StatusFilter = (['completed', 'rejected_by_admin', 'failed'] as const).includes(rawStatus as never) ? rawStatus as StatusFilter : 'all';
    const rawType = get('type', 'all');
    const withdrawalTypeFilter: TypeFilter = rawType === 'mobile_money' || rawType === 'crypto' ? rawType : 'all';
    const searchTerm = get('q');

    const [withdrawals, setWithdrawals] = useState<WithdrawalTransaction[]>([]);
    const [selectedWithdrawal, setSelectedWithdrawal] = useState<WithdrawalTransaction | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    const [fetching, setFetching] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [totalPages, setTotalPages] = useState(1);
    const [totalCount, setTotalCount] = useState(0);
    const requestId = useRef(0);

    const fetchData = useCallback(async () => {
        const id = ++requestId.current;
        try {
            setFetching(true);
            setError(null);
            const response = await getValidatedWithdrawals(
                page,
                LIMIT,
                statusFilter === 'all' ? undefined : statusFilter,
                JSON.parse(sharedParams) as Record<string, string>
            );
            if (id !== requestId.current) return;
            setWithdrawals(response.data.withdrawals);
            setTotalPages(response.data.pagination.totalPages);
            setTotalCount(response.data.pagination.total);
        } catch (err: unknown) {
            if (id !== requestId.current) return;
            setError(errorMessage(err, "Impossible de charger l'historique des retraits"));
        } finally {
            if (id === requestId.current) {
                setLoading(false);
                setFetching(false);
            }
        }
    }, [page, statusFilter, sharedParams]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Type and search filter the page shown (client side, as before)
    const filteredWithdrawals = useMemo(() => {
        let filtered = withdrawals;
        if (withdrawalTypeFilter !== 'all') {
            filtered = filtered.filter(w => w.metadata?.withdrawalType === withdrawalTypeFilter);
        }
        if (searchTerm.trim()) {
            const term = searchTerm.toLowerCase();
            filtered = filtered.filter(w =>
                w.transactionId.toLowerCase().includes(term) ||
                w.userName?.toLowerCase().includes(term) ||
                w.userEmail?.toLowerCase().includes(term) ||
                w.userPhoneNumber?.toLowerCase().includes(term)
            );
        }
        return filtered;
    }, [withdrawals, withdrawalTypeFilter, searchTerm]);

    const handleViewDetails = (withdrawal: WithdrawalTransaction) => {
        setSelectedWithdrawal(withdrawal);
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setSelectedWithdrawal(null);
    };

    const handleExportCSV = () => {
        if (filteredWithdrawals.length === 0) {
            showWarning('Aucune donnée à exporter');
            return;
        }
        const headers = ['ID transaction', 'Membre', 'E-mail', 'Téléphone', 'Type', 'Montant', 'Frais', 'Statut', 'Date'];
        const rows = filteredWithdrawals.map(w => [
            w.transactionId,
            w.userName || 'N/A',
            w.userEmail || 'N/A',
            w.userPhoneNumber || 'N/A',
            withdrawalTypeLabel(w.metadata?.withdrawalType),
            `${w.amount - w.fee} ${w.currency}`,
            `${w.fee} ${w.currency}`,
            withdrawalStatusLabel(w.status),
            formatDateTime(w.createdAt)
        ]);
        downloadCsv(`historique-retraits-${new Date().toISOString().split('T')[0]}.csv`, headers, rows);
        showSuccess('Export CSV terminé');
    };

    const summaryStats = {
        completed: filteredWithdrawals.filter(w => w.status === 'completed').length,
        rejected: filteredWithdrawals.filter(w => w.status === 'rejected_by_admin').length,
        failed: filteredWithdrawals.filter(w => w.status === 'failed').length,
        totalAmount: filteredWithdrawals.reduce((sum, w) => (w.status === 'completed' && w.currency === 'XAF' ? sum + net(w) : sum), 0),
    };

    const ownActive = statusFilter !== 'all' || withdrawalTypeFilter !== 'all' || !!searchTerm;
    const filtersActive = ownActive || filters.isFiltered;
    const clearAll = () => clear(['status', 'type', 'q', ...SHARED_FILTER_KEYS]);
    const pageLabel = 'sur cette page';
    const metricValue = (v: React.ReactNode) => (loading ? '—' : v);

    const columns: ListColumn<WithdrawalTransaction>[] = [
        {
            key: 'member',
            header: 'Membre',
            cell: w => (
                <div className="min-w-0">
                    <p className="truncate font-medium text-fg">{w.userName || '—'}</p>
                    <p className="truncate text-xs text-fg-muted">{w.userEmail || w.userPhoneNumber || '—'}</p>
                </div>
            ),
        },
        {
            key: 'amount',
            header: 'Montant envoyé',
            numeric: true,
            cell: w => (
                <div>
                    <div className="font-semibold text-fg">{exactMoney(net(w), w.currency)}</div>
                    <div className="text-xs text-fg-muted">frais {exactMoney(w.fee, w.currency)}</div>
                </div>
            ),
        },
        { key: 'to', header: 'Vers', cell: w => <span className="text-sm text-fg-muted">{destination(w)}</span> },
        { key: 'status', header: 'Statut', cell: w => <WithdrawalStatusBadge status={w.status} /> },
        { key: 'date', header: 'Demandé', cell: w => <RelativeTime value={w.createdAt} className="text-sm text-fg-muted" /> },
    ];

    const card = (w: WithdrawalTransaction) => (
        <div>
            <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 truncate text-sm font-medium text-fg">{w.userName || w.userEmail || '—'}</p>
                <p className="shrink-0 text-sm font-semibold tabular-nums text-fg">{exactMoney(net(w), w.currency)}</p>
            </div>
            <p className="mt-0.5 truncate text-xs text-fg-muted">{destination(w)}</p>
            <div className="mt-2 flex items-center justify-between gap-2">
                <WithdrawalStatusBadge status={w.status} />
                <RelativeTime value={w.createdAt} className="text-xs text-fg-muted" />
            </div>
        </div>
    );

    return (
        <div className="space-y-6">
            <PageHeader
                title="Historique des retraits"
                description="Toutes les demandes de retrait déjà traitées : payées, rejetées ou échouées. Touchez une ligne pour le détail."
                actions={(
                    <>
                        <Button variant="outline" className="h-11 sm:h-9" onClick={() => fetchData()} loading={fetching && !loading}>
                            {!(fetching && !loading) && <HugeiconsIcon icon={Refresh01Icon} size={16} aria-hidden="true" />}
                            Actualiser
                        </Button>
                        <Button variant="outline" className="h-11 sm:h-9" onClick={handleExportCSV} disabled={filteredWithdrawals.length === 0}>
                            <HugeiconsIcon icon={Download01Icon} size={16} aria-hidden="true" />
                            Exporter en CSV
                        </Button>
                    </>
                )}
            />

            <FilterRow filters={filters} ownKeys={['status', 'type', 'q']} ownActive={ownActive}>
                <Select
                    className="h-11 sm:h-9 sm:w-44"
                    value={statusFilter}
                    onValueChange={v => set({ status: v === 'all' ? null : v })}
                    options={STATUS_OPTIONS}
                />
                <Select
                    className="h-11 sm:h-9 sm:w-44"
                    value={withdrawalTypeFilter}
                    onValueChange={v => set({ type: v === 'all' ? null : v, page })}
                    options={TYPE_OPTIONS}
                />
            </FilterRow>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Metric label="Payés" value={metricValue(formatNumber(summaryStats.completed))} hint={pageLabel} icon={CheckmarkCircle02Icon} tone="success" />
                <Metric label="Rejetés" value={metricValue(formatNumber(summaryStats.rejected))} hint={pageLabel} icon={CancelCircleIcon} tone="danger" />
                <Metric label="Échoués" value={metricValue(formatNumber(summaryStats.failed))} hint={pageLabel} icon={Alert02Icon} tone="warning" />
                <Metric label="Montant payé" value={metricValue(exactMoney(summaryStats.totalAmount, 'XAF'))} hint={`${pageLabel}, en francs`} icon={MoneySend01Icon} tone="primary" />
            </div>

            <Panel>
                <PanelHeader
                    title="Retraits traités"
                    description={loading ? undefined : `${formatNumber(filteredWithdrawals.length)} affiché${filteredWithdrawals.length > 1 ? 's' : ''} sur ${formatNumber(totalCount)}`}
                    className="flex-col sm:flex-row"
                    actions={(
                        <SearchBox
                            className="w-full sm:w-[26rem]"
                            label="Chercher sur cette page"
                            placeholder="ID, nom, e-mail, téléphone"
                            value={searchTerm}
                            onSearch={v => set({ q: v, page })}
                        />
                    )}
                />
                {(searchTerm || withdrawalTypeFilter !== 'all') && (
                    <p className="px-4 pb-3 text-xs text-fg-muted sm:px-5">La recherche et le type filtrent la page affichée ({LIMIT} retraits par page).</p>
                )}
                {error && withdrawals.length > 0 && (
                    <p role="alert" className="border-y border-danger/30 bg-danger-soft px-5 py-2.5 text-sm text-danger">{error}</p>
                )}

                <div className={fetching && !loading ? 'opacity-70 transition-opacity' : undefined}>
                    <ResponsiveList
                        rows={filteredWithdrawals}
                        columns={columns}
                        rowKey={w => w._id}
                        onRowClick={handleViewDetails}
                        card={card}
                        loading={loading}
                        empty={error && withdrawals.length === 0 ? (
                            <ErrorState description={error} onRetry={() => fetchData()} retrying={fetching} />
                        ) : (
                            <EmptyState
                                icon={InboxIcon}
                                title={filtersActive ? 'Aucun retrait ne correspond' : 'Aucun retrait dans l’historique'}
                                description={filtersActive ? 'Changez la recherche ou les filtres.' : 'Les retraits validés, rejetés ou échoués apparaîtront ici.'}
                                action={filtersActive ? <Button size="lg" onClick={clearAll}>Effacer les filtres</Button> : undefined}
                            />
                        )}
                    />
                </div>

                <Pagination page={page} totalPages={totalPages} total={totalCount} pageSize={LIMIT} onPageChange={p => set({ page: p })} />
            </Panel>

            <WithdrawalDetailsModal
                withdrawal={selectedWithdrawal}
                isOpen={isModalOpen}
                onClose={handleCloseModal}
                onApproved={fetchData}
                onRejected={fetchData}
                showSuccess={showSuccess}
                showError={showError}
            />

            <ToastContainer toasts={toasts} onRemove={removeToast} />
        </div>
    );
};

export default WithdrawalHistoryPage;
