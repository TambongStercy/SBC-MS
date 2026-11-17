import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { HugeiconsIcon } from '@hugeicons/react';
import { CodeIcon, InboxIcon, MoreHorizontalIcon, UserIcon } from '@hugeicons/core-free-icons';
import { listAdminTransactions, PaymentIntent, PaymentStatus, TransactionFilters, Pagination as ApiPagination } from '../services/adminPaymentApi';
import MetadataViewerModal from '../components/common/MetadataViewerModal';
import { ErrorState, RelativeTime } from '../components/common/DataStates';
import { formatDateTime, formatNumber } from '../components/common/format';
import { DetailList, FilterRow, MoreFiltersButton, Reference, SHARED_FILTER_KEYS, SearchBox, SheetSection, exactMoney, useUrlFilters } from '../components/finance/shared';
import { usePageFilters } from '../hooks/usePageFilters';
import { toDateInput } from '../lib/period';
import { TransactionFilterSheet, countExtra, type ExtraFilters } from '../components/finance/TransactionFilterSheet';
import { PAYMENT_STATUS, StatusBadge, gatewayLabel } from '../components/finance/labels';
import { getCountryName } from '../utils/countryUtils';
import {
    Button, Dialog, EmptyState, Menu, MenuContent, MenuItem, MenuTrigger, PageHeader, Pagination, Panel, PanelHeader,
    ResponsiveList, Select, SheetContent, type ListColumn,
} from '../components/ui';

// Define common currencies, prioritizing African ones
const CURRENCIES = [
    { code: 'XAF', name: 'Franc CFA (CEMAC)' },
    { code: 'XOF', name: 'Franc CFA (UEMOA)' },
    { code: 'GHS', name: 'Cedi ghanéen' },
    { code: 'NGN', name: 'Naira nigérian' },
    { code: 'KES', name: 'Shilling kényan' },
    { code: 'ZAR', name: 'Rand sud-africain' },
    { code: 'EGP', name: 'Livre égyptienne' },
    { code: 'USD', name: 'Dollar américain' },
    { code: 'EUR', name: 'Euro' },
    { code: 'GBP', name: 'Livre sterling' },
];
const CURRENCY_OPTIONS = CURRENCIES.map(c => ({ value: c.code, label: `${c.name} (${c.code})` }));
const STATUS_OPTIONS = [
    { value: 'all', label: 'Tous les statuts' },
    ...Object.values(PaymentStatus).map(s => ({ value: s, label: PAYMENT_STATUS[s]?.label ?? s })),
];
const LIMIT = 20;
const FILTER_KEYS = ['q', 'status', 'currency', 'min', 'max'];

function AmountCell({ tx }: { tx: PaymentIntent }) {
    return (
        <div>
            <div className="font-medium text-fg">{exactMoney(tx.amount, tx.currency)}</div>
            {tx.gateway === 'nowpayments' && !!tx.payAmount && !!tx.payCurrency && (
                <div className="text-xs text-fg-muted">Crypto : {tx.payAmount.toLocaleString('fr-FR')} {tx.payCurrency}</div>
            )}
            {tx.gateway !== 'nowpayments' && !!tx.paidAmount && tx.paidAmount !== tx.amount && (
                <div className="text-xs text-fg-muted">Payé : {exactMoney(tx.paidAmount, tx.paidCurrency)}</div>
            )}
        </div>
    );
}

/** Everything known about one payment, with the member link and the raw metadata. */
function PaymentSheet({ tx, onOpenChange, onViewUser }: { tx: PaymentIntent | null; onOpenChange: (open: boolean) => void; onViewUser: (id: string) => void }) {
    const [showMeta, setShowMeta] = useState(false);
    return (
        <Dialog open={!!tx} onOpenChange={onOpenChange}>
            {tx && (
                <SheetContent
                    width="lg"
                    title="Détail du paiement"
                    description={`${tx.userName || 'Membre'} · ${gatewayLabel(tx.gateway)}`}
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
                            <StatusBadge status={tx.status} map={PAYMENT_STATUS} />
                            <span className="text-sm text-fg-muted">Créé <RelativeTime value={tx.createdAt} /></span>
                        </div>
                        <SheetSection title="Paiement">
                            <DetailList items={[
                                { label: 'Montant', value: <span className="font-medium tabular-nums">{exactMoney(tx.amount, tx.currency)}</span> },
                                { label: 'Montant payé', value: exactMoney(tx.paidAmount, tx.paidCurrency), hidden: !tx.paidAmount },
                                { label: 'Montant crypto', value: `${tx.payAmount?.toLocaleString('fr-FR')} ${tx.payCurrency ?? ''}`, hidden: !tx.payAmount },
                                { label: 'Pour', value: [tx.paymentType, tx.subscriptionType, tx.subscriptionPlan].filter(Boolean).join(' · ') || '—' },
                                { label: 'Passerelle', value: gatewayLabel(tx.gateway) },
                                { label: 'Téléphone payeur', value: tx.phoneNumber, hidden: !tx.phoneNumber },
                                { label: 'Pays', value: tx.countryCode ? `${getCountryName(tx.countryCode)} (${tx.countryCode})` : '—', hidden: !tx.countryCode },
                                { label: 'Opérateur', value: tx.operator, hidden: !tx.operator },
                            ]} />
                        </SheetSection>
                        <SheetSection title="Membre">
                            <DetailList items={[
                                { label: 'Nom', value: tx.userName || '—' },
                                { label: 'E-mail', value: tx.userEmail, hidden: !tx.userEmail },
                                { label: 'Téléphone', value: tx.userPhoneNumber, hidden: !tx.userPhoneNumber },
                                { label: 'Abonnements actifs', value: tx.userActiveSubscriptions?.join(', '), hidden: !tx.userActiveSubscriptions?.length },
                                { label: 'ID membre', value: <Reference value={tx.userId} /> },
                            ]} />
                        </SheetSection>
                        <SheetSection title="Références">
                            <DetailList items={[
                                { label: 'ID de session', value: <Reference value={tx.sessionId} /> },
                                { label: 'ID fournisseur', value: <Reference value={tx.gatewayPaymentId} />, hidden: !tx.gatewayPaymentId },
                                { label: 'Créé le', value: formatDateTime(tx.createdAt) },
                                { label: 'Mis à jour le', value: formatDateTime(tx.updatedAt) },
                            ]} />
                        </SheetSection>
                        {tx.webhookHistory && tx.webhookHistory.length > 0 && (
                            <SheetSection title="Réponses du fournisseur">
                                <ul className="divide-y divide-line rounded-control border border-line">
                                    {tx.webhookHistory.map((h, i) => (
                                        <li key={i} className="flex items-center justify-between gap-3 px-3 py-2.5">
                                            <StatusBadge status={h.status} map={PAYMENT_STATUS} />
                                            <span className="text-xs text-fg-muted">{formatDateTime(h.timestamp)}</span>
                                        </li>
                                    ))}
                                </ul>
                            </SheetSection>
                        )}
                    </div>
                    <MetadataViewerModal isOpen={showMeta} onClose={() => setShowMeta(false)} metadata={tx.metadata ?? null} />
                </SheetContent>
            )}
        </Dialog>
    );
}

/**
 * Transactions de paiement (module `finance`): payments started by members
 * (packs, subscriptions…) and where they stand with the provider. Read only.
 */
function TransactionManagementPage() {
    const navigate = useNavigate();
    const { get, set, clear, page } = useUrlFilters();
    const filters = usePageFilters();
    // The shared period replaces the old Du/Au fields: sent as startDate/endDate (what the API reads) and from/to.
    const shared = {
        ...filters.apiParams,
        startDate: toDateInput(filters.range.from),
        endDate: toDateInput(filters.range.to),
    };
    const status = get('status');
    const userSearchTerm = get('q');
    const extra: ExtraFilters = {
        currency: get('currency'), minAmount: get('min'), maxAmount: get('max')
    };

    const [transactions, setTransactions] = useState<PaymentIntent[]>([]);
    const [pagination, setPagination] = useState<ApiPagination>({ currentPage: 1, totalPages: 1, totalCount: 0, limit: LIMIT });
    const [isLoading, setIsLoading] = useState(true);
    const [hasLoaded, setHasLoaded] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [selected, setSelected] = useState<PaymentIntent | null>(null);
    const [isMetadataModalOpen, setIsMetadataModalOpen] = useState<boolean>(false);
    const [selectedMetadata, setSelectedMetadata] = useState<Record<string, unknown> | null>(null);
    const requestId = useRef(0);

    // The applied filters, as the API takes them
    const filterKey = JSON.stringify({ page, status, userSearchTerm, ...extra, ...shared });
    const fetchTransactions = useCallback(async () => {
        const f = JSON.parse(filterKey) as { page: number; status: string; userSearchTerm: string; startDate: string; endDate: string; country?: string; from?: string; to?: string } & ExtraFilters;
        const fetchFilters: TransactionFilters = {
            page: f.page, limit: LIMIT, status: f.status, userSearchTerm: f.userSearchTerm,
            minAmount: f.minAmount, maxAmount: f.maxAmount, currency: f.currency, startDate: f.startDate, endDate: f.endDate,
            country: f.country, from: f.from, to: f.to,
        };
        const id = ++requestId.current;
        setIsLoading(true);
        setError(null);
        try {
            const response = await listAdminTransactions(fetchFilters);
            if (id !== requestId.current) return;
            setTransactions(response.data || []);
            setPagination(response.pagination || { currentPage: 1, totalPages: 1, totalCount: 0, limit: LIMIT });
        } catch (err) {
            if (id !== requestId.current) return;
            const message = err instanceof Error ? err.message : 'Erreur inconnue';
            setError(message);
            toast.error(`Impossible de charger les transactions : ${message}`);
            setTransactions([]);
            setPagination({ currentPage: 1, totalPages: 1, totalCount: 0, limit: LIMIT });
        } finally {
            if (id === requestId.current) {
                setIsLoading(false);
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
    const ownActive = !!status || !!userSearchTerm || extraCount > 0;
    const filtersActive = ownActive || filters.isFiltered;
    const clearAll = () => clear([...FILTER_KEYS, ...SHARED_FILTER_KEYS]);

    const rowMenu = (tx: PaymentIntent) => (
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

    const columns: ListColumn<PaymentIntent>[] = [
        {
            key: 'member',
            header: 'Membre',
            cell: tx => (
                <div className="min-w-0">
                    <p className="truncate font-medium text-fg">{tx.userName || '—'}</p>
                    <p className="truncate text-xs text-fg-muted">{tx.userPhoneNumber || tx.userEmail || tx.userId}</p>
                </div>
            ),
        },
        { key: 'amount', header: 'Montant', numeric: true, cell: tx => <AmountCell tx={tx} /> },
        { key: 'status', header: 'Statut', cell: tx => <StatusBadge status={tx.status} map={PAYMENT_STATUS} /> },
        { key: 'gateway', header: 'Passerelle', cell: tx => <span className="text-sm text-fg-muted">{gatewayLabel(tx.gateway)}</span> },
        { key: 'date', header: 'Date', cell: tx => <RelativeTime value={tx.createdAt} className="text-sm text-fg-muted" /> },
        { key: 'menu', header: <span className="sr-only">Actions</span>, cell: rowMenu, className: 'w-12 text-right', hideOnCard: true },
    ];

    const card = (tx: PaymentIntent) => (
        <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 truncate text-sm font-medium text-fg">{tx.userName || '—'}</p>
                    <div className="shrink-0 text-right text-sm tabular-nums"><AmountCell tx={tx} /></div>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <StatusBadge status={tx.status} map={PAYMENT_STATUS} />
                    <span className="text-xs text-fg-muted">{gatewayLabel(tx.gateway)} · <RelativeTime value={tx.createdAt} /></span>
                </div>
            </div>
            <div className="-mr-2 -mt-2">{rowMenu(tx)}</div>
        </div>
    );

    return (
        <div className="space-y-6">
            <PageHeader
                title="Transactions de paiement"
                description="Les paiements lancés par les membres (abonnements, packs, services) et leur état chez le fournisseur. Touchez une ligne pour le détail."
            />

            <FilterRow filters={filters} ownKeys={FILTER_KEYS} ownActive={ownActive}>
                <SearchBox
                    className="sm:w-72"
                    label="Chercher un membre"
                    placeholder="Membre : ID, nom ou téléphone"
                    value={userSearchTerm}
                    onSearch={v => set({ q: v })}
                />
                <div className="grid grid-cols-2 gap-2 sm:flex">
                    <Select
                        className="h-11 sm:h-9 sm:w-56"
                        value={status || 'all'}
                        onValueChange={v => set({ status: v === 'all' ? null : v })}
                        options={STATUS_OPTIONS}
                    />
                    <MoreFiltersButton count={extraCount} onClick={() => setFiltersOpen(true)} />
                </div>
            </FilterRow>

            <Panel>
                <PanelHeader
                    title="Paiements"
                    description={hasLoaded ? `${formatNumber(pagination.totalCount)} paiement${pagination.totalCount > 1 ? 's' : ''}${filtersActive ? ' pour ces filtres' : ''}` : undefined}
                />

                <div className={isLoading && hasLoaded ? 'opacity-70 transition-opacity' : undefined}>
                    <ResponsiveList
                        rows={transactions}
                        columns={columns}
                        rowKey={tx => tx._id}
                        onRowClick={setSelected}
                        card={card}
                        loading={isLoading && !hasLoaded}
                        empty={error ? (
                            <ErrorState description={error} onRetry={() => fetchTransactions()} retrying={isLoading} />
                        ) : (
                            <EmptyState
                                icon={InboxIcon}
                                title="Aucune transaction ne correspond aux critères"
                                description={filtersActive ? 'Changez la recherche ou les filtres.' : 'Les paiements des membres apparaîtront ici.'}
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

            <PaymentSheet tx={selected} onOpenChange={open => { if (!open) setSelected(null); }} onViewUser={handleViewUser} />

            <MetadataViewerModal
                isOpen={isMetadataModalOpen}
                onClose={() => { setIsMetadataModalOpen(false); setSelectedMetadata(null); }}
                metadata={selectedMetadata}
            />
        </div>
    );
}

export default TransactionManagementPage;
