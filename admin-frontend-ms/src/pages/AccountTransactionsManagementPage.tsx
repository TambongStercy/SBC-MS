import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom'; // Use for navigation if needed
import Header from '../components/common/Header'; // Import Header
import Pagination from '../components/common/Pagination'; // Import custom Pagination
import MetadataViewerModal from '../components/common/MetadataViewerModal'; // Import Metadata viewer
import { format, parseISO } from 'date-fns'; // Import parseISO for date handling
import toast from 'react-hot-toast';
import { getAccountTransactions, AccountTransaction, AccountTransactionFilters } from '../services/adminAccountTransactionApi';
import { Currency, TransactionStatus, TransactionType } from '../types/enums'; // Use correct path for enums

// Helper to format date strings (copied from TransactionManagementPage)
const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    try {
        // Use parseISO to handle potential ISO string format from backend
        return format(parseISO(dateString), 'MMM dd, yyyy, hh:mm a');
    } catch (error) {
        console.error("Error formatting date:", dateString, error);
        return 'Invalid Date';
    }
};

// Status badge helper (copied and adapted for AccountTransaction Status)
const getStatusBadge = (status: TransactionStatus) => {
    switch (status) {
        case TransactionStatus.COMPLETED:
            return <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">Completed</span>;
        case TransactionStatus.FAILED:
            return <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">Failed</span>;
        case TransactionStatus.PENDING:
            return <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-yellow-100 text-yellow-800">Pending</span>;
        case TransactionStatus.CANCELLED:
            return <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-800">Cancelled</span>;
        case TransactionStatus.REFUNDED:
            return <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">Refunded</span>;
        default:
            return <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-purple-100 text-purple-800">{status}</span>;
    }
};

// Define currencies (copied from TransactionManagementPage)
const CURRENCIES = [
    { code: 'XAF', name: 'Central African CFA franc' },
    { code: 'XOF', name: 'West African CFA franc' },
    { code: 'USD', name: 'US Dollar' },
    { code: 'EUR', name: 'Euro' },
    { code: 'GBP', name: 'British Pound' },
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
            const message = err instanceof Error ? err.message : 'An unknown error occurred';
            setError(message);
            toast.error(`Failed to load account transactions: ${message}`);
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
        <div className="flex-1 overflow-auto relative z-10 bg-gray-900 text-white">
            <Header title="Account Transaction Management" />
            <main className="max-w-full mx-auto py-6 px-4 lg:px-8">
                <div className="mb-6 p-4 bg-gray-800 rounded-lg shadow">
                    <h3 className="text-lg font-semibold mb-3">Filters</h3>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div>
                            <label htmlFor="userSearchTerm" className="block text-sm font-medium text-gray-300 mb-1">User (Name/Email/Phone)</label>
                            <input
                                type="text"
                                id="userSearchTerm"
                                name="userSearchTerm"
                                value={filters.userSearchTerm}
                                onChange={handleFilterChange}
                                placeholder="Enter Name, Email or Phone"
                                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-white"
                            />
                        </div>
                        <div>
                            <label htmlFor="type" className="block text-sm font-medium text-gray-300 mb-1">Type</label>
                            <select
                                id="type"
                                name="type"
                                value={filters.type}
                                onChange={handleFilterChange}
                                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-white"
                            >
                                <option value="">All Types</option>
                                {Object.values(TransactionType).map((type) => (
                                    <option key={type} value={type}>{type}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="status" className="block text-sm font-medium text-gray-300 mb-1">Status</label>
                            <select
                                id="status"
                                name="status"
                                value={filters.status}
                                onChange={handleFilterChange}
                                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-white"
                            >
                                <option value="">All Statuses</option>
                                {Object.values(TransactionStatus).map((status) => (
                                    <option key={status} value={status}>{status}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="currency" className="block text-sm font-medium text-gray-300 mb-1">Currency</label>
                            <select
                                id="currency"
                                name="currency"
                                value={filters.currency}
                                onChange={handleFilterChange}
                                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-white"
                            >
                                <option value="">All Currencies</option>
                                {Object.values(Currency).map((curr) => (
                                    <option key={curr} value={curr}>{curr}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="startDate" className="block text-sm font-medium text-gray-300 mb-1">Start Date</label>
                            <input
                                type="date"
                                id="startDate"
                                name="startDate"
                                value={filters.startDate}
                                onChange={handleFilterChange}
                                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-white"
                            />
                        </div>
                        <div>
                            <label htmlFor="endDate" className="block text-sm font-medium text-gray-300 mb-1">End Date</label>
                            <input
                                type="date"
                                id="endDate"
                                name="endDate"
                                value={filters.endDate}
                                onChange={handleFilterChange}
                                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-white"
                                min={filters.startDate || undefined}
                            />
                        </div>
                        <div>
                            <label htmlFor="minAmount" className="block text-sm font-medium text-gray-300 mb-1">Min Amount</label>
                            <input
                                type="number"
                                id="minAmount"
                                name="minAmount"
                                value={filters.minAmount}
                                onChange={handleFilterChange}
                                placeholder="e.g., 100"
                                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-white"
                            />
                        </div>
                        <div>
                            <label htmlFor="maxAmount" className="block text-sm font-medium text-gray-300 mb-1">Max Amount</label>
                            <input
                                type="number"
                                id="maxAmount"
                                name="maxAmount"
                                value={filters.maxAmount}
                                onChange={handleFilterChange}
                                placeholder="e.g., 5000"
                                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-white"
                            />
                        </div>
                        <div className="md:col-span-4 flex items-end justify-end pt-4">
                            <button
                                onClick={handleSearch}
                                className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-800 transition ease-in-out duration-150 disabled:opacity-50"
                                disabled={loading}
                            >
                                {loading ? 'Searching...' : 'Search'}
                            </button>
                        </div>
                    </div>
                </div>

                {loading ? (
                    <div className="text-center py-4">Loading transactions...</div>
                ) : error ? (
                    <div className="bg-red-800 text-white p-3 rounded mb-4">Error: {error}</div>
                ) : (
                    <>
                        <div className="shadow overflow-hidden border-b border-gray-700 sm:rounded-lg mb-6 overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-700">
                                <thead className="bg-gray-700">
                                    <tr>
                                        <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Date</th>
                                        <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">User</th>
                                        <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Type</th>
                                        <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-300 uppercase tracking-wider">Amount</th>
                                        <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-300 uppercase tracking-wider">Fee</th>
                                        <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Currency</th>
                                        <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Status</th>
                                        <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Description</th>
                                        <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-gray-800 divide-y divide-gray-600">
                                    {transactions.length === 0 ? (
                                        <tr>
                                            <td colSpan={9} className="px-4 py-4 text-center text-sm text-gray-400">No account transactions found.</td>
                                        </tr>
                                    ) : (
                                        transactions.map((tx) => (
                                            <tr key={tx._id} className="hover:bg-gray-700">
                                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-300">{formatDate(tx.createdAt)}</td>
                                                <td className="px-4 py-4 whitespace-nowrap text-sm text-white">
                                                    <div>{tx.userName || 'N/A'}</div>
                                                    <div className="text-xs text-gray-400" title={tx.userId}>ID: {tx.userId.substring(0, 8)}...</div>
                                                    {tx.userPhoneNumber && (
                                                        <div className="text-xs text-gray-400">Phone: {tx.userPhoneNumber}</div>
                                                    )}
                                                </td>
                                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-300">{tx.type}</td>
                                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-300 text-right">{tx.amount?.toLocaleString()}</td>
                                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-300 text-right">{tx.fee?.toLocaleString()}</td>
                                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-300">{tx.currency}</td>
                                                <td className="px-4 py-4 whitespace-nowrap">{getStatusBadge(tx.status)}</td>
                                                <td className="px-4 py-4 text-sm text-gray-300 max-w-xs truncate" title={tx.description}>{tx.description}</td>
                                                <td className="px-4 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                                                    <button
                                                        onClick={() => handleViewUser(tx.userId)}
                                                        title="View User Details"
                                                        className="px-3 py-1 text-xs font-semibold rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-blue-500 transition ease-in-out duration-150"
                                                    >
                                                        User
                                                    </button>
                                                    <button
                                                        onClick={() => handleViewMetadata(tx.metadata)}
                                                        title="View Metadata"
                                                        className="px-3 py-1 text-xs font-semibold rounded-md text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-purple-500 transition ease-in-out duration-150 disabled:opacity-50"
                                                        disabled={!tx.metadata}
                                                    >
                                                        Metadata
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