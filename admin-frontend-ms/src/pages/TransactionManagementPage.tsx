import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { listAdminTransactions, PaymentIntent, PaymentStatus, TransactionFilters, Pagination as ApiPagination } from '../services/adminPaymentApi';
import Header from '../components/common/Header';
import Pagination from '../components/common/Pagination';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import toast from 'react-hot-toast';
import MetadataViewerModal from '../components/common/MetadataViewerModal';

// Helper to format date strings
const formatDate = (dateString?: string) => {
    if (!dateString) return '—';
    try {
        return format(parseISO(dateString), 'dd MMM yyyy, HH:mm', { locale: fr });
    } catch (error) {
        console.error("Error formatting date:", dateString, error);
        return 'Date invalide';
    }
};

/** Payment intent statuses as shown to the admin (values stay the API's). */
const STATUS_LABELS: Record<string, string> = {
    PENDING_USER_INPUT: 'En attente du membre',
    PENDING_PROVIDER: 'En attente du fournisseur',
    PROCESSING: 'En cours',
    SUCCEEDED: 'Réussi',
    FAILED: 'Échoué',
    CANCELED: 'Annulé',
    EXPIRED: 'Expiré',
    ERROR: 'Erreur',
    REQUIRES_ACTION: 'Action requise',
    REFUNDED: 'Remboursé',
};
const statusLabel = (status: string) => STATUS_LABELS[status] ?? status;

// Status badges
const getStatusBadge = (status: PaymentStatus) => {
    const base = 'px-2 inline-flex text-xs leading-5 font-semibold rounded-full';
    switch (status) {
        case PaymentStatus.SUCCEEDED:
            return <span className={`${base} bg-success-soft text-success`}>{statusLabel(status)}</span>;
        case PaymentStatus.FAILED:
        case PaymentStatus.ERROR:
            return <span className={`${base} bg-danger-soft text-danger`}>{statusLabel(status)}</span>;
        case PaymentStatus.PENDING_USER_INPUT:
        case PaymentStatus.PENDING_PROVIDER:
            return <span className={`${base} bg-warning-soft text-warning`}>{statusLabel(status)}</span>;
        case PaymentStatus.PROCESSING:
            return <span className={`${base} bg-info-soft text-info`}>{statusLabel(status)}</span>;
        case PaymentStatus.CANCELED:
        case PaymentStatus.EXPIRED:
            return <span className={`${base} bg-surface-2 text-fg-muted`}>{statusLabel(status)}</span>;
        default:
            return <span className={`${base} bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300`}>{statusLabel(status)}</span>;
    }
};

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
    // Add more as needed
];

function TransactionManagementPage() {
    const [transactions, setTransactions] = useState<PaymentIntent[]>([]);
    const [pagination, setPagination] = useState<ApiPagination>({ currentPage: 1, totalPages: 1, totalCount: 0, limit: 20 });
    const [filters, setFilters] = useState<TransactionFilters>({
        page: 1,
        limit: 20,
        status: '',
        userSearchTerm: '',
        minAmount: '',
        maxAmount: '',
        currency: '',
        startDate: '',
        endDate: ''
    });
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // State for Metadata Modal
    const [isMetadataModalOpen, setIsMetadataModalOpen] = useState<boolean>(false);
    const [selectedMetadata, setSelectedMetadata] = useState<Record<string, any> | null>(null);

    const navigate = useNavigate();

    // Remove debounced filter application
    /*
    const applyFiltersDebounced = useCallback(
        debounce((newFilters: TransactionFilters) => {
            setFilters(prev => ({ ...prev, ...newFilters, page: 1 })); // Reset page on filter change
        }, 500), // 500ms delay
        []
    );
    */

    const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        // Only update the local filters state
        setFilters(prev => ({ ...prev, [name]: value }));
        // Do not trigger API call here anymore
        // applyFiltersDebounced({ [name]: value }); 
    };

    const fetchTransactions = useCallback(async (fetchFilters: TransactionFilters) => {
        setIsLoading(true);
        setError(null);
        try {
            console.log("Fetching transactions with filters:", fetchFilters);
            const response = await listAdminTransactions(fetchFilters);
            setTransactions(response.data || []);
            setPagination(response.pagination || { currentPage: 1, totalPages: 1, totalCount: 0, limit: fetchFilters.limit || 20 });
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Erreur inconnue';
            setError(message);
            toast.error(`Impossible de charger les transactions : ${message}`);
            setTransactions([]);
            setPagination({ currentPage: 1, totalPages: 1, totalCount: 0, limit: fetchFilters.limit || 20 });
        } finally {
            setIsLoading(false);
        }
    }, []); // Remove filters from dependency array, fetch triggered manually

    // Initial fetch on component mount
    useEffect(() => {
        fetchTransactions({ page: 1, limit: 20 }); // Fetch initial page
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Empty dependency array means run only once on mount

    const handlePageChange = (newPage: number) => {
        if (newPage > 0 && newPage <= pagination.totalPages) {
            const newFilters = { ...filters, page: newPage };
            setFilters(newFilters);
            fetchTransactions(newFilters); // Fetch new page immediately
        }
    };

    // Function to handle the Search button click
    const handleSearch = () => {
        const searchFilters = { ...filters, page: 1 }; // Reset to page 1 for new search
        setFilters(searchFilters); // Update state to reflect page reset
        fetchTransactions(searchFilters); // Fetch data with current filters
    };

    const handleViewUser = (userId: string) => {
        // Adjust route to match App.tsx definition
        navigate(`/userpage/${userId}`);
    };

    // Handler to open metadata modal
    const handleViewMetadata = (metadata: Record<string, any> | undefined) => {
        setSelectedMetadata(metadata || null);
        setIsMetadataModalOpen(true);
    };

    // Handler to close metadata modal
    const handleCloseMetadataModal = () => {
        setIsMetadataModalOpen(false);
        setSelectedMetadata(null);
    };

    return (
        <div className="text-fg">
            <Header title="Transactions de paiement" />
            <main>
                {/* --- Filter Section --- */}
                <div className="mb-6 p-4 bg-surface rounded-lg border border-line">
                    <h3 className="text-lg font-semibold mb-3">Filtres</h3>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        {/* Status Filter */}
                        <div>
                            <label htmlFor="status" className="block text-sm font-medium text-fg-muted mb-1">Statut</label>
                            <select
                                id="status"
                                name="status"
                                value={filters.status || ''} // Controlled component
                                onChange={handleFilterChange}
                                className="w-full px-3 py-2 bg-surface border border-line-strong rounded-md focus:outline-hidden focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-fg"
                            >
                                <option value="">Tous les statuts</option>
                                {Object.values(PaymentStatus).map(status => (
                                    <option key={status} value={status}>{statusLabel(status)}</option>
                                ))}
                            </select>
                        </div>
                        {/* User Search Filter */}
                        <div>
                            <label htmlFor="userSearchTerm" className="block text-sm font-medium text-fg-muted mb-1">Membre (ID, nom, téléphone)</label>
                            <input
                                type="text"
                                id="userSearchTerm"
                                name="userSearchTerm"
                                value={filters.userSearchTerm || ''}
                                onChange={handleFilterChange}
                                placeholder="ID, nom ou téléphone"
                                className="w-full px-3 py-2 bg-surface border border-line-strong rounded-md focus:outline-hidden focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-fg"
                            />
                        </div>
                        {/* Min Amount Filter */}
                        <div>
                            <label htmlFor="minAmount" className="block text-sm font-medium text-fg-muted mb-1">Montant min.</label>
                            <input
                                type="number"
                                id="minAmount"
                                name="minAmount"
                                value={filters.minAmount || ''} // Controlled component
                                onChange={handleFilterChange}
                                placeholder="ex. 100"
                                className="w-full px-3 py-2 bg-surface border border-line-strong rounded-md focus:outline-hidden focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-fg"
                            />
                        </div>
                        {/* Max Amount Filter */}
                        <div>
                            <label htmlFor="maxAmount" className="block text-sm font-medium text-fg-muted mb-1">Montant max.</label>
                            <input
                                type="number"
                                id="maxAmount"
                                name="maxAmount"
                                value={filters.maxAmount || ''} // Controlled component
                                onChange={handleFilterChange}
                                placeholder="ex. 5000"
                                className="w-full px-3 py-2 bg-surface border border-line-strong rounded-md focus:outline-hidden focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-fg"
                            />
                        </div>
                        {/* Currency Filter */}
                        <div>
                            <label htmlFor="currency" className="block text-sm font-medium text-fg-muted mb-1">Devise</label>
                            <select
                                id="currency"
                                name="currency"
                                value={filters.currency || ''} // Controlled component
                                onChange={handleFilterChange}
                                className="w-full px-3 py-2 bg-surface border border-line-strong rounded-md focus:outline-hidden focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-fg"
                            >
                                <option value="">Toutes les devises</option>
                                {CURRENCIES.map(curr => (
                                    <option key={curr.code} value={curr.code}>
                                        {curr.name} ({curr.code})
                                    </option>
                                ))}
                                {/* Option to add a custom one? Unlikely needed */}
                            </select>
                        </div>
                        {/* Start Date Filter */}
                        <div>
                            <label htmlFor="startDate" className="block text-sm font-medium text-fg-muted mb-1">Date de début</label>
                            <input
                                type="date"
                                id="startDate"
                                name="startDate"
                                value={filters.startDate || ''} // Controlled component
                                onChange={handleFilterChange}
                                className="w-full px-3 py-2 bg-surface border border-line-strong rounded-md focus:outline-hidden focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-fg"
                            />
                        </div>
                        {/* End Date Filter */}
                        <div>
                            <label htmlFor="endDate" className="block text-sm font-medium text-fg-muted mb-1">Date de fin</label>
                            <input
                                type="date"
                                id="endDate"
                                name="endDate"
                                value={filters.endDate || ''} // Controlled component
                                onChange={handleFilterChange}
                                className="w-full px-3 py-2 bg-surface border border-line-strong rounded-md focus:outline-hidden focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-fg"
                            />
                        </div>

                        {/* Search Button - Adjusted grid positioning */}
                        <div className="md:col-start-4 flex items-end justify-end pt-4">
                            <button
                                onClick={handleSearch}
                                className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-surface transition ease-in-out duration-150 disabled:opacity-50"
                                disabled={isLoading}
                            >
                                {isLoading ? 'Recherche…' : 'Rechercher'}
                            </button>
                        </div>
                    </div>
                </div>

                {/* --- Transaction Table --- */}
                {isLoading ? (
                    <p className="text-fg-muted">Chargement des transactions…</p>
                ) : error ? (
                    <div className="bg-danger-soft text-danger p-3 rounded-sm">Erreur : {error}</div>
                ) : (
                    <>
                        <div className="overflow-hidden border-b border-line sm:rounded-lg mb-6 overflow-x-auto">
                            <table className="min-w-full divide-y divide-line">
                                <thead className="bg-surface-2">
                                    <tr>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">ID de session</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">Membre</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">Statut</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">Montant</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">Passerelle</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">Date</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-surface divide-y divide-line-strong">
                                    {transactions.length === 0 ? (
                                        <tr>
                                            <td colSpan={7} className="px-6 py-4 text-center text-sm text-fg-muted">Aucune transaction ne correspond aux critères.</td>
                                        </tr>
                                    ) : (
                                        transactions.map((tx) => (
                                            <tr key={tx._id}>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-fg-muted" title={tx.sessionId}>{tx.sessionId.substring(0, 12)}...</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-fg">
                                                    <div>{tx.userName || '—'}</div>
                                                    <div className="text-xs text-fg-muted">ID: {tx.userId}</div>
                                                    {tx.userPhoneNumber && (
                                                        <div className="text-xs text-fg-muted">Tél. : {tx.userPhoneNumber}</div>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">{getStatusBadge(tx.status)}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-fg-muted">
                                                    {tx.amount?.toLocaleString('fr-FR') || '—'} {tx.currency}
                                                    {/* Show crypto payment details for NOWPAYMENTS */}
                                                    {tx.gateway === 'nowpayments' && tx.payAmount && tx.payCurrency && (
                                                        <span className="block text-xs text-fg-muted">
                                                            Crypto : {tx.payAmount.toLocaleString('fr-FR')} {tx.payCurrency}
                                                        </span>
                                                    )}
                                                    {/* Show regular payment details for other gateways */}
                                                    {tx.gateway !== 'nowpayments' && tx.paidAmount && tx.paidAmount !== tx.amount && (
                                                        <span className="block text-xs text-fg-muted">
                                                            Payé : {tx.paidAmount.toLocaleString('fr-FR')} {tx.paidCurrency}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-fg-muted">{tx.gateway}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-fg-muted">{formatDate(tx.createdAt)}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                                                    <button
                                                        onClick={() => handleViewUser(tx.userId)}
                                                        title="Voir la fiche du membre"
                                                        className="px-3 py-1 text-xs font-semibold rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-offset-surface focus:ring-blue-500 transition ease-in-out duration-150"
                                                    >
                                                        Voir le membre
                                                    </button>
                                                    {/* View Metadata Button */}
                                                    <button
                                                        onClick={() => handleViewMetadata(tx.metadata)}
                                                        title="Voir les métadonnées"
                                                        className="px-3 py-1 text-xs font-semibold rounded-md text-white bg-purple-600 hover:bg-purple-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-offset-surface focus:ring-purple-500 transition ease-in-out duration-150 disabled:opacity-50"
                                                        disabled={!tx.metadata} // Disable if no metadata
                                                    >
                                                        Métadonnées
                                                    </button>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                        {pagination.totalCount > 0 && pagination.totalPages > 1 && (
                            <Pagination
                                currentPage={pagination.currentPage}
                                totalPages={pagination.totalPages}
                                onPageChange={handlePageChange}
                            />
                        )}
                    </>
                )}
            </main>
            {/* Metadata Modal */}
            <MetadataViewerModal
                isOpen={isMetadataModalOpen}
                onClose={handleCloseMetadataModal}
                metadata={selectedMetadata}
            />
        </div>
    );
}

export default TransactionManagementPage; 