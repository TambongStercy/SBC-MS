import React, { useCallback, useEffect, useRef, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import {
    CancelCircleIcon, CheckmarkCircle02Icon, HourglassIcon, Loading03Icon, Refresh01Icon, Tick02Icon, TaskDone01Icon,
} from '@hugeicons/core-free-icons';
import {
    WithdrawalTransaction,
    WithdrawalStats,
    getPendingWithdrawals,
    getWithdrawalStats,
    bulkApproveWithdrawals
} from '../services/adminWithdrawalApi';
import WithdrawalDetailsModal from '../components/withdrawals/WithdrawalDetailsModal';
import { WithdrawalStatusBadge } from '../components/withdrawals/WithdrawalStatusBadge';
import { withdrawalTypeLabel } from '../components/withdrawals/withdrawalStatus';
import ConfirmationModal from '../components/common/ConfirmationModal';
import ToastContainer from '../components/common/ToastContainer';
import { ErrorState, RelativeTime } from '../components/common/DataStates';
import { formatNumber } from '../components/common/format';
import { FilterRow, errorMessage, exactMoney, useUrlFilters } from '../components/finance/shared';
import { usePageFilters } from '../hooks/usePageFilters';
import { Can } from '../components/Can';
import { useToast } from '../hooks/useToast';
import {
    Button, Checkbox, EmptyState, Metric, PageHeader, Pagination, Panel, PanelHeader, ResponsiveList, Segmented, Skeleton, Switch,
    type ListColumn,
} from '../components/ui';

type TypeFilter = 'all' | 'mobile_money' | 'crypto';
const TYPE_OPTIONS: { value: TypeFilter; label: string }[] = [
    { value: 'all', label: 'Tous' },
    { value: 'mobile_money', label: 'Mobile Money' },
    { value: 'crypto', label: 'Crypto' },
];
const LIMIT = 20;

const net = (w: WithdrawalTransaction) => w.amount - w.fee;

/** Where the money goes, in one line. */
function destination(w: WithdrawalTransaction): string {
    if (w.metadata?.withdrawalType === 'crypto') return `Crypto${w.metadata.cryptoCurrency ? ` · ${w.metadata.cryptoCurrency}` : ''}`;
    const a = w.metadata?.accountInfo;
    return a ? `${a.momoOperator || 'Mobile Money'} · ${a.fullMomoNumber}` : withdrawalTypeLabel(w.metadata?.withdrawalType);
}

/** Sum of selected amounts, per currency: "25 000 F" or "25 000 F + 40,00 $". */
function selectionTotal(rows: WithdrawalTransaction[]): string {
    const byCur = new Map<string, number>();
    rows.forEach(w => byCur.set(w.currency, (byCur.get(w.currency) ?? 0) + net(w)));
    return Array.from(byCur, ([cur, sum]) => exactMoney(sum, cur)).join(' + ');
}

/**
 * Retraits à valider (module `withdrawals`): the queue of withdrawal requests
 * waiting for an admin. Each one opens in a sheet to validate (confirmation)
 * or reject (reason); several can be validated at once.
 */
const WithdrawalApprovalPage: React.FC = () => {
    const { toasts, removeToast, showSuccess, showError, showInfo } = useToast();
    const { get, set, page } = useUrlFilters();
    const filters = usePageFilters();
    // The "À valider" count follows the country only; the list follows country and period.
    const listParams = JSON.stringify(filters.apiParams);
    const statsCountry = filters.apiParams.country;
    const rawType = get('type', 'all');
    const withdrawalTypeFilter: TypeFilter = rawType === 'mobile_money' || rawType === 'crypto' ? rawType : 'all';

    const [withdrawals, setWithdrawals] = useState<WithdrawalTransaction[]>([]);
    const [stats, setStats] = useState<WithdrawalStats | null>(null);
    const [selectedWithdrawal, setSelectedWithdrawal] = useState<WithdrawalTransaction | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [totalPages, setTotalPages] = useState(1);
    const [totalCount, setTotalCount] = useState(0);

    // Bulk selection (kept across pages, like before; rows kept to show the total)
    const [selected, setSelected] = useState<Map<string, WithdrawalTransaction>>(new Map());
    const [bulkApproving, setBulkApproving] = useState(false);
    const [showConfirmModal, setShowConfirmModal] = useState(false);

    const [autoRefresh, setAutoRefresh] = useState(true);
    const requestId = useRef(0);

    const fetchData = useCallback(async () => {
        const id = ++requestId.current;
        setRefreshing(true);
        try {
            setError(null);
            const [statsRes, withdrawalsRes] = await Promise.all([
                getWithdrawalStats(statsCountry ? { country: statsCountry } : {}),
                getPendingWithdrawals(
                    page,
                    LIMIT,
                    withdrawalTypeFilter === 'all' ? undefined : withdrawalTypeFilter,
                    JSON.parse(listParams) as Record<string, string>
                )
            ]);
            if (id !== requestId.current) return; // a newer request answers instead
            setStats(statsRes.data);
            setWithdrawals(withdrawalsRes.data.withdrawals);
            setTotalPages(withdrawalsRes.data.pagination.totalPages);
            setTotalCount(withdrawalsRes.data.pagination.total);
        } catch (err: unknown) {
            if (id !== requestId.current) return;
            setError(errorMessage(err, 'Impossible de charger les données'));
        } finally {
            if (id === requestId.current) {
                setLoading(false);
                setRefreshing(false);
            }
        }
    }, [page, withdrawalTypeFilter, statsCountry, listParams]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Auto-refresh every 30 seconds
    useEffect(() => {
        if (!autoRefresh) return;
        const interval = setInterval(() => { fetchData(); }, 30000);
        return () => clearInterval(interval);
    }, [autoRefresh, fetchData]);

    const handleViewDetails = (withdrawal: WithdrawalTransaction) => {
        setSelectedWithdrawal(withdrawal);
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setSelectedWithdrawal(null);
    };

    const handleActionComplete = () => {
        fetchData();
        setSelected(new Map());
    };

    const allOnPageSelected = withdrawals.length > 0 && withdrawals.every(w => selected.has(w.transactionId));
    const someOnPageSelected = withdrawals.some(w => selected.has(w.transactionId));

    const handleSelectAll = () => {
        setSelected(prev => {
            const next = new Map(prev);
            if (allOnPageSelected) withdrawals.forEach(w => next.delete(w.transactionId));
            else withdrawals.forEach(w => next.set(w.transactionId, w));
            return next;
        });
    };

    const handleSelectOne = (w: WithdrawalTransaction) => {
        setSelected(prev => {
            const next = new Map(prev);
            if (next.has(w.transactionId)) next.delete(w.transactionId);
            else next.set(w.transactionId, w);
            return next;
        });
    };

    const handleBulkApprove = async () => {
        const selectedIds = Array.from(selected.keys());
        if (selectedIds.length === 0) return;
        setBulkApproving(true);
        setShowConfirmModal(false);

        try {
            const result = await bulkApproveWithdrawals({
                transactionIds: selectedIds,
                adminNotes: 'Bulk approved'
            });

            showSuccess(`Terminé : ${result.data.approved} validé(s), ${result.data.failed} en échec`);
            if (result.data.errors.length > 0) {
                console.error('Bulk approval errors:', result.data.errors);
                showInfo(`Certains retraits ont échoué : ${result.data.errors.slice(0, 3).join(' ; ')}${result.data.errors.length > 3 ? '…' : ''}`);
            }

            fetchData();
            setSelected(new Map());
        } catch (err: unknown) {
            showError('Échec de la validation groupée : ' + errorMessage(err, 'erreur inconnue'));
        } finally {
            setBulkApproving(false);
        }
    };

    const selectedRows = Array.from(selected.values());
    const stop = (e: React.SyntheticEvent) => e.stopPropagation();

    const selectBox = (w: WithdrawalTransaction) => (
        <Can module="withdrawals" write>
            <span onClick={stop} onKeyDown={stop} className="-m-3 inline-flex p-3">
                <Checkbox
                    checked={selected.has(w.transactionId)}
                    onCheckedChange={() => handleSelectOne(w)}
                    aria-label={`Sélectionner le retrait de ${w.userName || w.userEmail || w.transactionId}`}
                />
            </span>
        </Can>
    );

    const amountCell = (w: WithdrawalTransaction) => (
        <div>
            <div className="font-semibold text-fg">{exactMoney(net(w), w.currency)}</div>
            <div className="text-xs text-fg-muted">frais {exactMoney(w.fee, w.currency)}</div>
        </div>
    );

    const reviewButton = (w: WithdrawalTransaction, phone = false) => (
        <Button
            variant="outline"
            size={phone ? 'lg' : 'sm'}
            className={phone ? 'w-full' : undefined}
            onClick={e => { e.stopPropagation(); handleViewDetails(w); }}
        >
            Examiner
        </Button>
    );

    const columns: ListColumn<WithdrawalTransaction>[] = [
        {
            key: 'select',
            header: (
                <Can module="withdrawals" write>
                    <Checkbox
                        checked={allOnPageSelected ? true : someOnPageSelected ? 'indeterminate' : false}
                        onCheckedChange={handleSelectAll}
                        aria-label="Tout sélectionner sur cette page"
                    />
                </Can>
            ),
            cell: selectBox,
            className: 'w-10 pr-0',
        },
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
        { key: 'amount', header: 'Montant envoyé', numeric: true, cell: amountCell },
        { key: 'to', header: 'Vers', cell: w => <span className="text-sm text-fg-muted">{destination(w)}</span> },
        { key: 'date', header: 'Demandé', cell: w => <RelativeTime value={w.createdAt} className="text-sm text-fg-muted" /> },
        { key: 'status', header: 'Statut', cell: w => <WithdrawalStatusBadge status={w.status} /> },
        { key: 'action', header: <span className="sr-only">Action</span>, cell: w => reviewButton(w), className: 'text-right' },
    ];

    const card = (w: WithdrawalTransaction) => (
        <div className="space-y-3">
            <div className="flex items-start gap-3">
                <div className="pt-0.5">{selectBox(w)}</div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 truncate text-sm font-medium text-fg">{w.userName || w.userEmail || '—'}</p>
                        <p className="shrink-0 text-sm font-semibold tabular-nums text-fg">{exactMoney(net(w), w.currency)}</p>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-fg-muted">{destination(w)}</p>
                    <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-fg-muted">
                        <RelativeTime value={w.createdAt} />
                        <span className="tabular-nums">frais {exactMoney(w.fee, w.currency)}</span>
                    </div>
                </div>
            </div>
            {reviewButton(w, true)}
        </div>
    );

    const statValue = (n: number | undefined) => (stats ? formatNumber(n ?? 0) : <Skeleton className="h-8 w-16" />);

    return (
        <div className="space-y-6">
            <PageHeader
                title="Retraits à valider"
                description="Les demandes de retrait des membres attendent votre décision. L’argent part dès la validation."
                actions={(
                    <>
                        <label className="flex h-11 items-center gap-2 text-sm text-fg-muted sm:h-9">
                            <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} aria-label="Actualisation automatique toutes les 30 secondes" />
                            Actualisation auto (30 s)
                        </label>
                        <Button variant="outline" className="h-11 sm:h-9" onClick={() => fetchData()} loading={refreshing && !loading}>
                            {!(refreshing && !loading) && <HugeiconsIcon icon={Refresh01Icon} size={16} aria-hidden="true" />}
                            Actualiser
                        </Button>
                    </>
                )}
            />

            <FilterRow filters={filters} ownKeys={['type']} ownActive={withdrawalTypeFilter !== 'all'}>
                <Segmented
                    label="Type de retrait"
                    value={withdrawalTypeFilter}
                    onValueChange={v => set({ type: v === 'all' ? null : v })}
                    options={TYPE_OPTIONS}
                    className="self-start sm:self-auto"
                />
            </FilterRow>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Metric label="À valider" value={statValue(stats?.pendingApproval)} hint={statsCountry ? 'dans ce pays, toutes dates' : 'attendent votre décision'} icon={HourglassIcon} tone="warning" />
                <Metric label="En cours" value={statValue(stats?.processing)} hint="envoyés, réponse du fournisseur attendue" icon={Loading03Icon} tone="primary" />
                <Metric label="Validés aujourd’hui" value={statValue(stats?.approvedToday)} icon={CheckmarkCircle02Icon} tone="success" />
                <Metric label="Rejetés aujourd’hui" value={statValue(stats?.rejectedToday)} icon={CancelCircleIcon} tone="danger" />
            </div>

            <Panel>
                <PanelHeader
                    title="Demandes à valider"
                    description={loading ? undefined : `${formatNumber(totalCount)} demande${totalCount > 1 ? 's' : ''}${withdrawalTypeFilter !== 'all' ? ` (${withdrawalTypeLabel(withdrawalTypeFilter)})` : ''}${filters.isFiltered ? ' pour ces filtres' : ''}`}
                />

                {selected.size > 0 && (
                    <Can module="withdrawals" write>
                        <div className="flex flex-col gap-2 border-y border-line bg-surface-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                            <p className="text-sm text-fg">
                                <span className="font-medium tabular-nums">{selected.size}</span> sélectionné{selected.size > 1 ? 's' : ''}
                                {' · '}<span className="tabular-nums">{selectionTotal(selectedRows)}</span>
                            </p>
                            <div className="grid grid-cols-2 gap-2 sm:flex">
                                <Button variant="ghost" className="h-11 sm:h-9" onClick={() => setSelected(new Map())} disabled={bulkApproving}>
                                    Effacer
                                </Button>
                                <Button
                                    variant="primary"
                                    className="h-11 bg-success text-white hover:bg-success/90 sm:h-9 dark:text-background"
                                    onClick={() => setShowConfirmModal(true)}
                                    loading={bulkApproving}
                                >
                                    {!bulkApproving && <HugeiconsIcon icon={Tick02Icon} size={16} aria-hidden="true" />}
                                    {bulkApproving ? 'Validation…' : `Valider ${selected.size}`}
                                </Button>
                            </div>
                        </div>
                    </Can>
                )}

                {error && withdrawals.length > 0 && (
                    <p role="alert" className="border-y border-danger/30 bg-danger-soft px-5 py-2.5 text-sm text-danger">
                        {error} — la liste affichée peut ne plus être à jour.
                    </p>
                )}

                <div className={refreshing && !loading ? 'opacity-70 transition-opacity' : undefined}>
                    <ResponsiveList
                        rows={withdrawals}
                        columns={columns}
                        rowKey={w => w._id}
                        onRowClick={handleViewDetails}
                        card={card}
                        loading={loading}
                        empty={error ? (
                            <ErrorState description={error} onRetry={() => fetchData()} retrying={refreshing} />
                        ) : (
                            <EmptyState
                                icon={TaskDone01Icon}
                                title="Rien à valider"
                                description={withdrawalTypeFilter === 'all' && !filters.isFiltered
                                    ? 'Aucune demande de retrait n’attend de décision. La liste se met à jour toute seule.'
                                    : 'Aucune demande pour ces filtres. Effacez-les pour tout voir.'}
                            />
                        )}
                    />
                </div>

                <Pagination
                    page={page}
                    totalPages={totalPages}
                    total={totalCount}
                    pageSize={LIMIT}
                    onPageChange={p => set({ page: p })}
                />
            </Panel>

            <WithdrawalDetailsModal
                withdrawal={selectedWithdrawal}
                isOpen={isModalOpen}
                onClose={handleCloseModal}
                onApproved={handleActionComplete}
                onRejected={handleActionComplete}
                showSuccess={showSuccess}
                showError={showError}
            />

            <ConfirmationModal
                isOpen={showConfirmModal}
                variant="success"
                title="Valider les retraits sélectionnés ?"
                message={(
                    <div className="space-y-1">
                        <p>
                            <span className="font-medium text-fg tabular-nums">{selected.size}</span> retrait{selected.size > 1 ? 's' : ''},{' '}
                            <span className="font-medium text-fg tabular-nums">{selectionTotal(selectedRows)}</span> au total.
                        </p>
                        <p>L’argent part dès la validation.</p>
                    </div>
                )}
                confirmText={`Valider ${selected.size}`}
                onConfirm={handleBulkApprove}
                onCancel={() => setShowConfirmModal(false)}
            />

            <ToastContainer toasts={toasts} onRemove={removeToast} />
        </div>
    );
};

export default WithdrawalApprovalPage;
