import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { HugeiconsIcon } from '@hugeicons/react';
import { CodeIcon, InboxIcon, MoreHorizontalIcon, UserIcon } from '@hugeicons/core-free-icons';
import MetadataViewerModal from '../components/common/MetadataViewerModal';
import { ErrorState, RelativeTime } from '../components/common/DataStates';
import { formatDateTime, formatNumber } from '../components/common/format';
import { DetailList, FilterRow, MoreFiltersButton, Reference, SHARED_FILTER_KEYS, SearchBox, SheetSection, exactMoney, useUrlFilters } from '../components/finance/shared';
import { usePageFilters } from '../hooks/usePageFilters';
import { toDateInput } from '../lib/period';
import { TransactionFilterSheet, countExtra, type ExtraFilters } from '../components/finance/TransactionFilterSheet';
import { ACCOUNT_STATUS, ACCOUNT_TYPE, StatusBadge, gatewayLabel } from '../components/finance/labels';
import { getAccountTransactions, AccountTransaction, AccountTransactionFilters } from '../services/adminAccountTransactionApi';
import { Currency, TransactionStatus, TransactionType } from '../types/enums';
import {
    Button, Dialog, EmptyState, Menu, MenuContent, MenuItem, MenuTrigger, PageHeader, Pagination, Panel, PanelHeader,
    ResponsiveList, Select, SheetContent, type ListColumn,
} from '../components/ui';

const LIMIT = 20;
const FILTER_KEYS = ['q', 'type', 'status', 'currency', 'min', 'max'];
const TYPE_OPTIONS = [{ value: 'all', label: 'Tous les types' }, ...Object.values(TransactionType).map(t => ({ value: t, label: ACCOUNT_TYPE[t] ?? t }))];
const STATUS_OPTIONS = [{ value: 'all', label: 'Tous les statuts' }, ...Object.values(TransactionStatus).map(s => ({ value: s, label: ACCOUNT_STATUS[s]?.label ?? s }))];
const CURRENCY_OPTIONS = Object.values(Currency).map(c => ({ value: c, label: c }));


function AmountCell({ tx }: { tx: AccountTransaction }) {
    return (
        <div>
            <div className="font-medium text-fg">{exactMoney(tx.amount, tx.currency)}</div>
            {tx.fee ? <div className="text-xs text-fg-muted">frais {exactMoney(tx.fee, tx.currency)}</div> : null}
        </div>
    );
}

function AccountTransactionSheet({ tx, onOpenChange, onViewUser }: { tx: AccountTransaction | null; onOpenChange: (open: boolean) => void; onViewUser: (id: string) => void }) {
    const [showMeta, setShowMeta] = useState(false);
    return (
        <Dialog open={!!tx} onOpenChange={onOpenChange}>
            {tx && (
                <SheetContent
                    width="lg"
                    title={`${ACCOUNT_TYPE[tx.type] ?? tx.type} · ${exactMoney(tx.amount, tx.currency)}`}
                    description={tx.userName || tx.userId}
                    footer={(
                        <>
                            <Button variant="outline" size="lg" onClick={() => setShowMeta(true)} disabled={!tx.metadata}>
                                <HugeiconsIcon icon={CodeIcon} size={16} aria-hidden="true" />
                                Métadonnées
                            </Button>
                            <Button variant="primary" size="lg" onClick={() => onViewUser(tx.userId)}>
                                <HugeiconsIcon icon={UserIcon} size={16} aria-hidden="true" />
                                Voir la fiche du membre
                            </Button>
                        </>
                    )}
                >
                    <div className="space-y-6">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <StatusBadge status={tx.status} map={ACCOUNT_STATUS} />
                            <RelativeTime value={tx.createdAt} className="text-sm text-fg-muted" />
                        </div>
                        {tx.description && <p className="text-sm text-fg">{tx.description}</p>}
                        <SheetSection title="Mouvement">
                            <DetailList items={[
                                { label: 'Type', value: ACCOUNT_TYPE[tx.type] ?? tx.type },
                                { label: 'Montant', value: <span className="font-medium tabular-nums">{exactMoney(tx.amount, tx.currency)}</span> },
                                { label: 'Frais', value: exactMoney(tx.fee, tx.currency) },
                                { label: 'Fournisseur', value: gatewayLabel(tx.serviceProvider), hidden: !tx.serviceProvider },
                                { label: 'Moyen', value: tx.paymentMethod, hidden: !tx.paymentMethod },
                            ]} />
                        </SheetSection>
                        <SheetSection title="Membre">
                            <DetailList items={[
                                { label: 'Nom', value: tx.userName || '—' },
                                { label: 'Téléphone', value: tx.userPhoneNumber, hidden: !tx.userPhoneNumber },
                                { label: 'ID membre', value: <Reference value={tx.userId} /> },
                            ]} />
                        </SheetSection>
                        <SheetSection title="Références">
                            <DetailList items={[
                                { label: 'ID transaction', value: <Reference value={tx.transactionId} /> },
                                { label: 'Référence', value: <Reference value={tx.reference} />, hidden: !tx.reference },
                                { label: 'ID fournisseur', value: <Reference value={tx.externalTransactionId} />, hidden: !tx.externalTransactionId },
                                { label: 'Créée le', value: formatDateTime(tx.createdAt) },
                                { label: 'Mise à jour le', value: formatDateTime(tx.updatedAt) },
                            ]} />
                        </SheetSection>
                    </div>
                    <MetadataViewerModal isOpen={showMeta} onClose={() => setShowMeta(false)} metadata={tx.metadata ?? null} />
                </SheetContent>
            )}
        </Dialog>
    );
}

/**
 * Transactions de compte (module `finance`): every movement on members'
 * wallets (deposits, withdrawals, payments, fees…). Read only.
 */
const AccountTransactionsManagementPage: React.FC = () => {
    const navigate = useNavigate();
    const { get, set, clear, page } = useUrlFilters();
    const filters = usePageFilters();
    // The shared period replaces the old Du/Au fields: sent as startDate/endDate (what the API reads) and from/to.
    const shared = {
        ...filters.apiParams,
        startDate: toDateInput(filters.range.from),
        endDate: toDateInput(filters.range.to),
    };
    const userSearchTerm = get('q');
    const type = get('type');
    const status = get('status');
    const extra: ExtraFilters = {
        currency: get('currency'), minAmount: get('min'), maxAmount: get('max')
    };

    const [transactions, setTransactions] = useState<AccountTransaction[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [hasLoaded, setHasLoaded] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pagination, setPaginationApi] = useState({ currentPage: 1, totalPages: 1, totalCount: 0, limit: LIMIT });
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [selected, setSelected] = useState<AccountTransaction | null>(null);
    const [isMetadataModalOpen, setIsMetadataModalOpen] = useState<boolean>(false);
    const [selectedMetadata, setSelectedMetadata] = useState<Record<string, unknown> | null>(null);
    const requestId = useRef(0);

    const filterKey = JSON.stringify({ page, userSearchTerm, type, status, ...extra, ...shared });
    const fetchTransactions = useCallback(async () => {
        const f = JSON.parse(filterKey) as { page: number; userSearchTerm: string; type: string; status: string; startDate: string; endDate: string; country?: string; from?: string; to?: string } & ExtraFilters;
        const apiFilters: AccountTransactionFilters = {
            sortBy: 'createdAt',
            sortOrder: 'desc',
            userSearchTerm: f.userSearchTerm,
            status: f.status as TransactionStatus | '',
            type: f.type as TransactionType | '',
            startDate: f.startDate,
            endDate: f.endDate,
            currency: f.currency as Currency | '',
            country: f.country,
            from: f.from,
            to: f.to,
            page: f.page,
            limit: LIMIT,
            minAmount: f.minAmount ? Number(f.minAmount) : undefined,
            maxAmount: f.maxAmount ? Number(f.maxAmount) : undefined,
        };
        const id = ++requestId.current;
        setLoading(true);
        setError(null);
        try {
            const response = await getAccountTransactions(apiFilters);
            if (id !== requestId.current) return;
            setTransactions(response.data || []);
            setPaginationApi(response.pagination || { currentPage: 1, totalPages: 1, totalCount: 0, limit: LIMIT });
        } catch (err) {
            if (id !== requestId.current) return;
            const message = err instanceof Error ? err.message : 'Erreur inconnue';
            setError(message);
            toast.error(`Impossible de charger les transactions de compte : ${message}`);
            setTransactions([]);
            setPaginationApi({ currentPage: 1, totalPages: 1, totalCount: 0, limit: LIMIT });
        } finally {
            if (id === requestId.current) {
                setLoading(false);
                setHasLoaded(true);
            }
        }
    }, [filterKey]);

    useEffect(() => { fetchTransactions(); }, [fetchTransactions]);

    const handleViewUser = (userId: string) => navigate(`/userpage/${userId}`);
    const handleViewMetadata = (metadata: Record<string, unknown> | undefined) => {
        setSelectedMetadata(metadata || null);
        setIsMetadataModalOpen(true);
    };

    const extraCount = countExtra(extra);
    const ownActive = !!userSearchTerm || !!type || !!status || extraCount > 0;
    const filtersActive = ownActive || filters.isFiltered;
    const clearAll = () => clear([...FILTER_KEYS, ...SHARED_FILTER_KEYS]);

    const rowMenu = (tx: AccountTransaction) => (
        <Menu>
            <MenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-11 w-11 sm:h-9 sm:w-9" aria-label="Plus d’actions" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
                    <HugeiconsIcon icon={MoreHorizontalIcon} size={18} aria-hidden="true" />
                </Button>
            </MenuTrigger>
            <MenuContent onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
                <MenuItem onSelect={() => handleViewUser(tx.userId)}>
                    <HugeiconsIcon icon={UserIcon} size={16} aria-hidden="true" />
                    Voir la fiche du membre
                </MenuItem>
                <MenuItem disabled={!tx.metadata} onSelect={() => handleViewMetadata(tx.metadata)}>
                    <HugeiconsIcon icon={CodeIcon} size={16} aria-hidden="true" />
                    Voir les métadonnées
                </MenuItem>
            </MenuContent>
        </Menu>
    );

    const columns: ListColumn<AccountTransaction>[] = [
        {
            key: 'member',
            header: 'Membre',
            cell: tx => (
                <div className="min-w-0">
                    <p className="truncate font-medium text-fg">{tx.userName || '—'}</p>
                    <p className="truncate text-xs text-fg-muted">{tx.userPhoneNumber || tx.userId}</p>
                </div>
            ),
        },
        {
            key: 'type',
            header: 'Type',
            cell: tx => (
                <div className="min-w-0 max-w-xs">
                    <p className="text-sm text-fg">{ACCOUNT_TYPE[tx.type] ?? tx.type}</p>
                    {tx.description && <p className="truncate text-xs text-fg-muted" title={tx.description}>{tx.description}</p>}
                </div>
            ),
        },
        { key: 'amount', header: 'Montant', numeric: true, cell: tx => <AmountCell tx={tx} /> },
        { key: 'status', header: 'Statut', cell: tx => <StatusBadge status={tx.status} map={ACCOUNT_STATUS} /> },
        { key: 'date', header: 'Date', cell: tx => <RelativeTime value={tx.createdAt} className="text-sm text-fg-muted" /> },
        { key: 'menu', header: <span className="sr-only">Actions</span>, cell: rowMenu, className: 'w-12 text-right', hideOnCard: true },
    ];

    const card = (tx: AccountTransaction) => (
        <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 truncate text-sm font-medium text-fg">{tx.userName || '—'}</p>
                    <div className="shrink-0 text-right text-sm tabular-nums"><AmountCell tx={tx} /></div>
                </div>
                <p className="mt-0.5 truncate text-xs text-fg-muted">{ACCOUNT_TYPE[tx.type] ?? tx.type}{tx.description ? ` · ${tx.description}` : ''}</p>
                <div className="mt-2 flex items-center justify-between gap-2">
                    <StatusBadge status={tx.status} map={ACCOUNT_STATUS} />
                    <RelativeTime value={tx.createdAt} className="text-xs text-fg-muted" />
                </div>
            </div>
            <div className="-mr-2 -mt-2">{rowMenu(tx)}</div>
        </div>
    );

    return (
        <div className="space-y-6">
            <PageHeader
                title="Transactions de compte"
                description="Chaque mouvement sur les soldes des membres : dépôts, retraits, paiements, frais. Touchez une ligne pour le détail."
            />

            <FilterRow filters={filters} ownKeys={FILTER_KEYS} ownActive={ownActive}>
                <SearchBox
                    className="sm:w-72"
                    label="Chercher un membre"
                    placeholder="Membre : nom, e-mail ou téléphone"
                    value={userSearchTerm}
                    onSearch={v => set({ q: v })}
                />
                <div className="grid grid-cols-2 gap-2 sm:flex">
                    <Select className="h-11 sm:h-9 sm:w-36" value={type || 'all'} onValueChange={v => set({ type: v === 'all' ? null : v })} options={TYPE_OPTIONS} />
                    <Select className="h-11 sm:h-9 sm:w-36" value={status || 'all'} onValueChange={v => set({ status: v === 'all' ? null : v })} options={STATUS_OPTIONS} />
                    <MoreFiltersButton count={extraCount} onClick={() => setFiltersOpen(true)} />
                </div>
            </FilterRow>

            <Panel>
                <PanelHeader
                    title="Mouvements"
                    description={hasLoaded ? `${formatNumber(pagination.totalCount)} transaction${pagination.totalCount > 1 ? 's' : ''}${filtersActive ? ' pour ces filtres' : ''}` : undefined}
                />

                <div className={loading && hasLoaded ? 'opacity-70 transition-opacity' : undefined}>
                    <ResponsiveList
                        rows={transactions}
                        columns={columns}
                        rowKey={tx => tx._id}
                        onRowClick={setSelected}
                        card={card}
                        loading={loading && !hasLoaded}
                        empty={error ? (
                            <ErrorState description={error} onRetry={() => fetchTransactions()} retrying={loading} />
                        ) : (
                            <EmptyState
                                icon={InboxIcon}
                                title="Aucune transaction de compte"
                                description={filtersActive ? 'Rien ne correspond : changez la recherche ou les filtres.' : 'Les mouvements des soldes apparaîtront ici.'}
                                action={filtersActive ? <Button size="lg" onClick={clearAll}>Effacer les filtres</Button> : undefined}
                            />
                        )}
                    />
                </div>

                <Pagination
                    page={page}
                    totalPages={pagination.totalPages}
                    total={pagination.totalCount}
                    pageSize={pagination.limit || LIMIT}
                    onPageChange={p => set({ page: p })}
                />
            </Panel>

            <TransactionFilterSheet
                open={filtersOpen}
                onOpenChange={setFiltersOpen}
                value={extra}
                currencies={CURRENCY_OPTIONS}
                onApply={f => set({ currency: f.currency, min: f.minAmount, max: f.maxAmount })}
            />

            <AccountTransactionSheet tx={selected} onOpenChange={open => { if (!open) setSelected(null); }} onViewUser={handleViewUser} />

            <MetadataViewerModal
                isOpen={isMetadataModalOpen}
                onClose={() => { setIsMetadataModalOpen(false); setSelectedMetadata(null); }}
                metadata={selectedMetadata}
            />
        </div>
    );
};

export default AccountTransactionsManagementPage;
