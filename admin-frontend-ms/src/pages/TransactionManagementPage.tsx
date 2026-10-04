import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { listAdminTransactions, PaymentIntent, PaymentStatus, TransactionFilters, Pagination as ApiPagination } from '../services/adminPaymentApi';
import Header from '../components/common/Header';
import Pagination from '../components/common/Pagination';
import { format, parseISO } from 'date-fns';
import toast from 'react-hot-toast';
import MetadataViewerModal from '../components/common/MetadataViewerModal';

// Helper to format date strings
const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    try {
        return format(parseISO(dateString), 'MMM dd, yyyy, hh:mm a');
    } catch (error) {
        console.error("Error formatting date:", dateString, error);
        return 'Invalid Date';
    }
};

// Helper for status badges (similar to Tombola page)
const getStatusBadge = (status: PaymentStatus) => {
    switch (status) {
        case PaymentStatus.SUCCEEDED:
            return <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">Succeeded</span>;
        case PaymentStatus.FAILED:
        case PaymentStatus.ERROR:
            return <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-red-100 text-red-800">Failed</span>;
        case PaymentStatus.PENDING_USER_INPUT:
        case PaymentStatus.PENDING_PROVIDER:
            return <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-yellow-100 text-yellow-800">Pending</span>;
        case PaymentStatus.PROCESSING:
            return <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">Processing</span>;
        case PaymentStatus.CANCELED:
        case PaymentStatus.EXPIRED:
            return <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-800">{status}</span>;
        // Add other statuses if needed (e.g., REFUNDED)
        default:
            return <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-purple-100 text-purple-800">{status}</span>;
    }
};

// Define common currencies, prioritizing African ones
const CURRENCIES = [
    { code: 'XAF', name: 'Central African CFA franc' },
    { code: 'XOF', name: 'West African CFA franc' },
    { code: 'GHS', name: 'Ghanaian Cedi' },
    { code: 'NGN', name: 'Nigerian Naira' },
    { code: 'KES', name: 'Kenyan Shilling' },
    { code: 'ZAR', name: 'South African Rand' },
    { code: 'EGP', name: 'Egyptian Pound' },
    { code: 'USD', name: 'US Dollar' },
    { code: 'EUR', name: 'Euro' },
    { code: 'GBP', name: 'British Pound' },
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
            const message = err instanceof Error ? err.message : 'An unknown error occurred';
            setError(message);
            toast.error(`Failed to load transactions: ${message}`);
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
        <div className="flex-1 overflow-auto relative z-10 bg-gray-900 text-white">
            <Header title="Payment Transaction Management" />
            <main className="max-w-full mx-auto py-6 px-4 lg:px-8">
                {/* --- Filter Section --- */}
                <div className="mb-6 p-4 bg-gray-800 rounded-lg shadow">
                    <h3 className="text-lg font-semibold mb-3">Filters</h3>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        {/* Status Filter */}
                        <div>
                            <label htmlFor="status" className="block text-sm font-medium text-gray-300 mb-1">Status</label>
                            <select
                                id="status"
                                name="status"
                                value={filters.status || ''} // Controlled component
                                onChange={handleFilterChange}
                                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-white"
                            >
                                <option value="">All Statuses</option>
                                {Object.values(PaymentStatus).map(status => (
                                    <option key={status} value={status}>{status}</option>
                                ))}
                            </select>
                        </div>
                        {/* User Search Filter */}
                        <div>
                            <label htmlFor="userSearchTerm" className="block text-sm font-medium text-gray-300 mb-1">User (ID, Name, Phone)</label>
                            <input
                                type="text"
                                id="userSearchTerm"
                                name="userSearchTerm"
                                value={filters.userSearchTerm || ''}
                                onChange={handleFilterChange}
                                placeholder="Enter ID, Name or Phone"
                                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-white"
                            />
                        </div>
                        {/* Min Amount Filter */}
                        <div>
                            <label htmlFor="minAmount" className="block text-sm font-medium text-gray-300 mb-1">Min Amount</label>
                            <input
                                type="number"
                                id="minAmount"
                                name="minAmount"
                                value={filters.minAmount || ''} // Controlled component
                                onChange={handleFilterChange}
                                placeholder="e.g., 100"
                                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-white"
                            />
                        </div>
                        {/* Max Amount Filter */}
                        <div>
                            <label htmlFor="maxAmount" className="block text-sm font-medium text-gray-300 mb-1">Max Amount</label>
                            <input
                                type="number"
                                id="maxAmount"
                                name="maxAmount"
                                value={filters.maxAmount || ''} // Controlled component
                                onChange={handleFilterChange}
                                placeholder="e.g., 5000"
                                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-white"
                            />
                        </div>
                        {/* Currency Filter */}
                        <div>
                            <label htmlFor="currency" className="block text-sm font-medium text-gray-300 mb-1">Currency</label>
                            <select
                                id="currency"
                                name="currency"
                                value={filters.currency || ''} // Controlled component
                                onChange={handleFilterChange}
                                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-white"
                            >
                                <option value="">All Currencies</option>
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
                            <label htmlFor="startDate" className="block text-sm font-medium text-gray-300 mb-1">Start Date</label>
                            <input
                                type="date"
                                id="startDate"
                                name="startDate"
                                value={filters.startDate || ''} // Controlled component
                                onChange={handleFilterChange}
                                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-white"
                            />
                        </div>
                        {/* End Date Filter */}
                        <div>
                            <label htmlFor="endDate" className="block text-sm font-medium text-gray-300 mb-1">End Date</label>
                            <input
                                type="date"
                                id="endDate"
                                name="endDate"
                                value={filters.endDate || ''} // Controlled component
                                onChange={handleFilterChange}
                                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm text-white"
                            />
                        </div>

                        {/* Search Button - Adjusted grid positioning */}
                        <div className="md:col-start-4 flex items-end justify-end pt-4">
                            <button
                                onClick={handleSearch}
                                className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-800 transition ease-in-out duration-150 disabled:opacity-50"
                                disabled={isLoading}
                            >
                                {isLoading ? 'Searching...' : 'Search'}
                            </button>
                        </div>
                    </div>
                </div>

                {/* --- Transaction Table --- */}
                {isLoading ? (
                    <p>Loading transactions...</p>
                ) : error ? (
                    <div className="bg-red-800 text-white p-3 rounded">Error: {error}</div>
                ) : (
                    <>
                        <div className="shadow overflow-hidden border-b border-gray-700 sm:rounded-lg mb-6 overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-700">
                                <thead className="bg-gray-700">
                                    <tr>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Session ID</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">User</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Status</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Amount</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Gateway</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Date</th>
                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="bg-gray-800 divide-y divide-gray-600">
                                    {transactions.length === 0 ? (
                                        <tr>
                                            <td colSpan={7} className="px-6 py-4 text-center text-sm text-gray-400">No transactions found matching criteria.</td>
                                        </tr>
                                    ) : (
                                        transactions.map((tx) => (
                                            <tr key={tx._id}>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-300" title={tx.sessionId}>{tx.sessionId.substring(0, 12)}...</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-white">
                                                    <div>{tx.userName || 'N/A'}</div>
                                                    <div className="text-xs text-gray-400">ID: {tx.userId}</div>
                                                    {tx.userPhoneNumber && (
                                                        <div className="text-xs text-gray-400">Phone: {tx.userPhoneNumber}</div>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap">{getStatusBadge(tx.status)}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                                                    {tx.amount?.toLocaleString() || 'N/A'} {tx.currency}
                                                    {/* Show crypto payment details for NOWPAYMENTS */}
                                                    {tx.gateway === 'nowpayments' && tx.payAmount && tx.payCurrency && (
                                                        <span className="block text-xs text-gray-400">
                                                            Crypto: {tx.payAmount.toLocaleString()} {tx.payCurrency}
                                                        </span>
                                                    )}
                                                    {/* Show regular payment details for other gateways */}
                                                    {tx.gateway !== 'nowpayments' && tx.paidAmount && tx.paidAmount !== tx.amount && (
                                                        <span className="block text-xs text-gray-400">
                                                            Paid: {tx.paidAmount.toLocaleString()} {tx.paidCurrency}
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">{tx.gateway}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">{formatDate(tx.createdAt)}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                                                    <button
                                                        onClick={() => handleViewUser(tx.userId)}
                                                        title="View User Details"
                                                        className="px-3 py-1 text-xs font-semibold rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-blue-500 transition ease-in-out duration-150"
                                                    >
                                                        View User
                                                    </button>
                                                    {/* View Metadata Button */}
                                                    <button
                                                        onClick={() => handleViewMetadata(tx.metadata)}
                                                        title="View Metadata"
                                                        className="px-3 py-1 text-xs font-semibold rounded-md text-white bg-purple-600 hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-purple-500 transition ease-in-out duration-150 disabled:opacity-50"
                                                        disabled={!tx.metadata} // Disable if no metadata
                                                    >
                                                        View Metadata
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