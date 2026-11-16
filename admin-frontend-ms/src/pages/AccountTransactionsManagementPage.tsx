import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom'; // Use for navigation if needed
import Header from '../components/common/Header'; // Import Header
import Pagination from '../components/common/Pagination'; // Import custom Pagination
import MetadataViewerModal from '../components/common/MetadataViewerModal'; // Import Metadata viewer
import { format, parseISO } from 'date-fns'; // Import parseISO for date handling
import { fr } from 'date-fns/locale';
import toast from 'react-hot-toast';
import { getAccountTransactions, AccountTransaction, AccountTransactionFilters } from '../services/adminAccountTransactionApi';
import { Currency, TransactionStatus, TransactionType } from '../types/enums'; // Use correct path for enums

// Helper to format date strings (copied from TransactionManagementPage)
const formatDate = (dateString?: string) => {
    if (!dateString) return '—';
    try {
        // Use parseISO to handle potential ISO string format from backend
        return format(parseISO(dateString), 'dd MMM yyyy, HH:mm', { locale: fr });
    } catch (error) {
        console.error("Error formatting date:", dateString, error);
        return 'Date invalide';
    }
};

/** Labels shown to the admin; the values sent to the API stay the enum's. */
const STATUS_LABELS: Record<string, string> = {
    pending: 'En attente',
    completed: 'Terminé',
    failed: 'Échoué',
    cancelled: 'Annulé',
    refunded: 'Remboursé',
};
const TYPE_LABELS: Record<string, string> = {
    deposit: 'Dépôt',
    withdrawal: 'Retrait',
    transfer: 'Transfert',
    payment: 'Paiement',
    refund: 'Remboursement',
    fee: 'Frais',
};

// Status badge helper
const getStatusBadge = (status: TransactionStatus) => {
    const base = 'px-2 inline-flex text-xs leading-5 font-semibold rounded-full';
    const label = STATUS_LABELS[status] ?? status;
    switch (status) {
        case TransactionStatus.COMPLETED:
            return <span className={`${base} bg-success-soft text-success`}>{label}</span>;
        case TransactionStatus.FAILED:
            return <span className={`${base} bg-danger-soft text-danger`}>{label}</span>;
        case TransactionStatus.PENDING:
            return <span className={`${base} bg-warning-soft text-warning`}>{label}</span>;
        case TransactionStatus.CANCELLED:
            return <span className={`${base} bg-surface-2 text-fg-muted`}>{label}</span>;
        case TransactionStatus.REFUNDED:
            return <span className={`${base} bg-info-soft text-info`}>{label}</span>;
        default:
            return <span className={`${base} bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300`}>{label}</span>;
    }
};

// Define currencies (copied from TransactionManagementPage)
const _CURRENCIES = [
    { code: 'XAF', name: 'Franc CFA (CEMAC)' },
    { code: 'XOF', name: 'Franc CFA (UEMOA)' },
    { code: 'USD', name: 'Dollar américain' },
    { code: 'EUR', name: 'Euro' },
    { code: 'GBP', name: 'Livre sterling' },
];

const AccountTransactionsManagementPage: React.FC = () => {
    const [transactions, setTransactions] = useState<AccountTransaction[]>([]);
    const [loading, setLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [filters, setFilters] = useState<Omit<AccountTransactionFilters, 'page' | 'limit'>>({
        sortBy: 'createdAt',
        sortOrder: 'desc',
        userSearchTerm: '',
        status: '',
        type: '',
        startDate: '',
        endDate: '',
        minAmount: '',
        maxAmount: '',
        currency: '',
    });
    const [pagination, setPaginationApi] = useState({
        currentPage: 1,
        totalPages: 1,
        totalCount: 0,
        limit: 20,
    });
    const [isMetadataModalOpen, setIsMetadataModalOpen] = useState<boolean>(false);
    const [selectedMetadata, setSelectedMetadata] = useState<Record<string, any> | null>(null);
    const navigate = useNavigate();

    const fetchTransactions = useCallback(async (currentPage: number, currentLimit: number, currentFilters: Omit<AccountTransactionFilters, 'page' | 'limit'>) => {
        setLoading(true);
        setError(null);
        try {
            console.log("Fetching account transactions with:", { page: currentPage, limit: currentLimit, filters: currentFilters });
            const apiFilters: AccountTransactionFilters = {
                ...currentFilters,
                page: currentPage,
                limit: currentLimit,
                minAmount: currentFilters.minAmount ? Number(currentFilters.minAmount) : undefined,
                maxAmount: currentFilters.maxAmount ? Number(currentFilters.maxAmount) : undefined,
            };
            const response = await getAccountTransactions(apiFilters);
            setTransactions(response.data || []);
            setPaginationApi(response.pagination || { currentPage: 1, totalPages: 1, totalCount: 0, limit: currentLimit });
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Erreur inconnue';
            setError(message);
            toast.error(`Impossible de charger les transactions de compte : ${message}`);
            setTransactions([]);
            setPaginationApi({ currentPage: 1, totalPages: 1, totalCount: 0, limit: currentLimit });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchTransactions(pagination.currentPage, pagination.limit, filters);
    }, []);

    const handleFilterChange = (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = event.target;
        setFilters(prev => ({ ...prev, [name]: value }));
    };

    const handlePageChange = (newPage: number) => {
        if (newPage > 0 && newPage <= pagination.totalPages) {
            setPaginationApi(prev => ({ ...prev, currentPage: newPage }));
            fetchTransactions(newPage, pagination.limit, filters);
        }
    };

    const handleSearch = () => {
        setPaginationApi(prev => ({ ...prev, currentPage: 1 }));
        fetchTransactions(1, pagination.limit, filters);
    };

    const handleViewUser = (userId: string) => {
        navigate(`/userpage/${userId}`);
    };

    const handleViewMetadata = (metadata: Record<string, any> | undefined) => {
        setSelectedMetadata(metadata || null);
        setIsMetadataModalOpen(true);
    };
    const handleCloseMetadataModal = () => {
        setIsMetadataModalOpen(false);
        setSelectedMetadata(null);
    };

    return (
        <div className="text-fg">
            <Header title="Transactions de compte" />
            <main>
                <div className="mb-6 p-4 bg-surface rounded-lg border border-line">
                    <h3 className="text-lg font-semibold mb-3">Filtres</h3>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div>
                            <label htmlFor="userSearchTerm" className="block text-sm font-medium text-fg-muted mb-1">Membre (nom, e-mail, téléphone)</label>
                            <input
                                type="text"
                                id="userSearchTerm"
                                name="userSearchTerm"
                                value={filters.userSearchTerm}
                                onChange={handleFilterChange}
                                placeholder="Nom, e-mail ou téléphone"
                                className="w-full px-3 py-2 bg-surface border border-line-strong rounded-md focus:outline-hidden focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-fg"
                            />
                        </div>
                        <div>
                            <label htmlFor="type" className="block text-sm font-medium text-fg-muted mb-1">Type</label>
                            <select
                                id="type"
                                name="type"
                                value={filters.type}
                                onChange={handleFilterChange}
                                className="w-full px-3 py-2 bg-surface border border-line-strong rounded-md focus:outline-hidden focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-fg"
                            >
                                <option value="">Tous les types</option>
                                {Object.values(TransactionType).map((type) => (
                                    <option key={type} value={type}>{TYPE_LABELS[type] ?? type}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="status" className="block text-sm font-medium text-fg-muted mb-1">Statut</label>
                            <select
                                id="status"
                                name="status"
                                value={filters.status}
                                onChange={handleFilterChange}
                                className="w-full px-3 py-2 bg-surface border border-line-strong rounded-md focus:outline-hidden focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-fg"
                            >
                                <option value="">Tous les statuts</option>
                                {Object.values(TransactionStatus).map((status) => (
                                    <option key={status} value={status}>{STATUS_LABELS[status] ?? status}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="currency" className="block text-sm font-medium text-fg-muted mb-1">Devise</label>
                            <select
                                id="currency"
                                name="currency"
                                value={filters.currency}
                                onChange={handleFilterChange}
                                className="w-full px-3 py-2 bg-surface border border-line-strong rounded-md focus:outline-hidden focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-fg"
                            >
                                <option value="">Toutes les devises</option>
                                {Object.values(Currency).map((curr) => (
                                    <option key={curr} value={curr}>{curr}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="startDate" className="block text-sm font-medium text-fg-muted mb-1">Date de début</label>
                            <input
                                type="date"
                                id="startDate"
                                name="startDate"
                                value={filters.startDate}
                                onChange={handleFilterChange}
                                className="w-full px-3 py-2 bg-surface border border-line-strong rounded-md focus:outline-hidden focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-fg"
                            />
                        </div>
                        <div>
                            <label htmlFor="endDate" className="block text-sm font-medium text-fg-muted mb-1">Date de fin</label>
                            <input
                                type="date"
                                id="endDate"
                                name="endDate"
                                value={filters.endDate}
                                onChange={handleFilterChange}
                                className="w-full px-3 py-2 bg-surface border border-line-strong rounded-md focus:outline-hidden focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-fg"
                                min={filters.startDate || undefined}
                            />
                        </div>
                        <div>
                            <label htmlFor="minAmount" className="block text-sm font-medium text-fg-muted mb-1">Montant min.</label>
                            <input
                                type="number"
                                id="minAmount"
                                name="minAmount"
                                value={filters.minAmount}
                                onChange={handleFilterChange}
                                placeholder="ex. 100"
                                className="w-full px-3 py-2 bg-surface border border-line-strong rounded-md focus:outline-hidden focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-fg"
                            />
                        </div>
                        <div>
                            <label htmlFor="maxAmount" className="block text-sm font-medium text-fg-muted mb-1">Montant max.</label>
                            <input
                                type="number"
                                id="maxAmount"
                                name="maxAmount"
                                value={filters.maxAmount}
                                onChange={handleFilterChange}
                                placeholder="ex. 5000"
                                className="w-full px-3 py-2 bg-surface border border-line-strong rounded-md focus:outline-hidden focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-fg"
                            />
                        </div>
                        <div className="md:col-span-4 flex items-end justify-end pt-4">
                            <button
                                onClick={handleSearch}
                                className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-surface transition ease-in-out duration-150 disabled:opacity-50"
                                disabled={loading}
                            >
                                {loading ? 'Recherche…' : 'Rechercher'}
                            </button>
                        </div>
                    </div>
                </div>

                {loading ? (
                    <div className="text-center py-4 text-fg-muted">Chargement des transactions…</div>
                ) : error ? (
                    <div className="bg-danger-soft text-danger p-3 rounded-sm mb-4">Erreur : {error}</div>
                ) : (
                    <>
                        <div className="overflow-hidden border-b border-line sm:rounded-lg mb-6 overflow-x-auto">
                            <table className="min-w-full divide-y divide-line">
                                <thead className="bg-surface-2">
                                    <tr>
                                        <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">Date</th>
                                        <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">Membre</th>
                                        <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">Type</th>
                                        <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-fg-muted uppercase tracking-wider">Montant</th>
                                        <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-fg-muted uppercase tracking-wider">Frais</th>
                                        <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">Devise</th>
                                        <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">Statut</th>
                                        <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">Description</th>
                                        <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-surface divide-y divide-line-strong">
                                    {transactions.length === 0 ? (
                                        <tr>
                                            <td colSpan={9} className="px-4 py-4 text-center text-sm text-fg-muted">Aucune transaction de compte.</td>
                                        </tr>
                                    ) : (
                                        transactions.map((tx) => (
                                            <tr key={tx._id} className="hover:bg-surface-2">
                                                <td className="px-4 py-4 whitespace-nowrap text-sm text-fg-muted">{formatDate(tx.createdAt)}</td>
                                                <td className="px-4 py-4 whitespace-nowrap text-sm text-fg">
                                                    <div>{tx.userName || '—'}</div>
                                                    <div className="text-xs text-fg-muted" title={tx.userId}>ID: {tx.userId.substring(0, 8)}...</div>
                                                    {tx.userPhoneNumber && (
                                                        <div className="text-xs text-fg-muted">Tél. : {tx.userPhoneNumber}</div>
                                                    )}
                                                </td>
                                                <td className="px-4 py-4 whitespace-nowrap text-sm text-fg-muted">{TYPE_LABELS[tx.type] ?? tx.type}</td>
                                                <td className="px-4 py-4 whitespace-nowrap text-sm text-fg-muted text-right">{tx.amount?.toLocaleString('fr-FR')}</td>
                                                <td className="px-4 py-4 whitespace-nowrap text-sm text-fg-muted text-right">{tx.fee?.toLocaleString('fr-FR')}</td>
                                                <td className="px-4 py-4 whitespace-nowrap text-sm text-fg-muted">{tx.currency}</td>
                                                <td className="px-4 py-4 whitespace-nowrap">{getStatusBadge(tx.status)}</td>
                                                <td className="px-4 py-4 text-sm text-fg-muted max-w-xs truncate" title={tx.description}>{tx.description}</td>
                                                <td className="px-4 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                                                    <button
                                                        onClick={() => handleViewUser(tx.userId)}
                                                        title="Voir la fiche du membre"
                                                        className="px-3 py-1 text-xs font-semibold rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-offset-surface focus:ring-blue-500 transition ease-in-out duration-150"
                                                    >
                                                        Membre
                                                    </button>
                                                    <button
                                                        onClick={() => handleViewMetadata(tx.metadata)}
                                                        title="Voir les métadonnées"
                                                        className="px-3 py-1 text-xs font-semibold rounded-md text-white bg-purple-600 hover:bg-purple-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-offset-surface focus:ring-purple-500 transition ease-in-out duration-150 disabled:opacity-50"
                                                        disabled={!tx.metadata}
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
            <MetadataViewerModal
                isOpen={isMetadataModalOpen}
                onClose={handleCloseMetadataModal}
                metadata={selectedMetadata}
            />
        </div>
    );
};

export default AccountTransactionsManagementPage;