import React, { useState, useEffect } from 'react';
import {
    WithdrawalTransaction,
    getValidatedWithdrawals,
    formatCurrency,
    formatDate,
    getStatusLabel,
    getStatusColor,
} from '../services/adminWithdrawalApi';
import WithdrawalDetailsModal from '../components/withdrawals/WithdrawalDetailsModal';
import Pagination from '../components/common/Pagination';
import Loader from '../components/common/loader';
import Header from '../components/common/Header';

const WithdrawalHistoryPage: React.FC = () => {
    // State
    const [withdrawals, setWithdrawals] = useState<WithdrawalTransaction[]>([]);
    const [selectedWithdrawal, setSelectedWithdrawal] = useState<WithdrawalTransaction | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalCount, setTotalCount] = useState(0);
    const limit = 20;

    // Filters
    const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'rejected_by_admin' | 'failed'>('all');
    const [withdrawalTypeFilter, setWithdrawalTypeFilter] = useState<'all' | 'mobile_money' | 'crypto'>('all');

    // Search
    const [searchTerm, setSearchTerm] = useState('');
    const [filteredWithdrawals, setFilteredWithdrawals] = useState<WithdrawalTransaction[]>([]);

    // Fetch data
    const fetchData = async () => {
        try {
            setLoading(true);
            setError(null);

            const response = await getValidatedWithdrawals(
                currentPage,
                limit,
                statusFilter === 'all' ? undefined : statusFilter
            );

            setWithdrawals(response.data.withdrawals);
            setTotalPages(response.data.pagination.totalPages);
            setTotalCount(response.data.pagination.total);
        } catch (err: any) {
            setError(err.message || 'Failed to fetch withdrawal history');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [currentPage, statusFilter]);

    // Apply client-side filters (search and withdrawal type)
    useEffect(() => {
        let filtered = [...withdrawals];

        // Filter by withdrawal type
        if (withdrawalTypeFilter !== 'all') {
            filtered = filtered.filter(w => w.metadata?.withdrawalType === withdrawalTypeFilter);
        }

        // Filter by search term
        if (searchTerm.trim()) {
            const term = searchTerm.toLowerCase();
            filtered = filtered.filter(w =>
                w.transactionId.toLowerCase().includes(term) ||
                w.userName?.toLowerCase().includes(term) ||
                w.userEmail?.toLowerCase().includes(term) ||
                w.userPhoneNumber?.toLowerCase().includes(term)
            );
        }

        setFilteredWithdrawals(filtered);
    }, [withdrawals, withdrawalTypeFilter, searchTerm]);

    // Handlers
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
            alert('No data to export');
            return;
        }

        // Prepare CSV data
        const headers = ['Transaction ID', 'User', 'Email', 'Phone', 'Type', 'Amount', 'Fee', 'Status', 'Date'];
        const rows = filteredWithdrawals.map(w => [
            w.transactionId,
            w.userName || 'N/A',
            w.userEmail || 'N/A',
            w.userPhoneNumber || 'N/A',
            w.metadata?.withdrawalType === 'crypto' ? 'Crypto' : 'Mobile Money',
            `${w.amount - w.fee} ${w.currency}`,
            `${w.fee} ${w.currency}`,
            getStatusLabel(w.status),
            formatDate(w.createdAt)
        ]);

        // Create CSV content
        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
        ].join('\n');

        // Download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `withdrawal-history-${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // Calculate summary stats
    const summaryStats = {
        total: filteredWithdrawals.length,
        completed: filteredWithdrawals.filter(w => w.status === 'completed').length,
        rejected: filteredWithdrawals.filter(w => w.status === 'rejected_by_admin').length,
        failed: filteredWithdrawals.filter(w => w.status === 'failed').length,
        totalAmount: filteredWithdrawals.reduce((sum, w) => {
            if (w.status === 'completed' && w.currency === 'XAF') {
                return sum + (w.amount - w.fee);
            }
            return sum;
        }, 0)
    };

    if (loading && withdrawals.length === 0) {
        return (
            <div className="flex-1 overflow-auto relative z-10 bg-gray-900">
                <Header title="Withdrawal History" />
                <div className="flex items-center justify-center h-96">
                    <Loader name="Withdrawal History" />
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-auto relative z-10 bg-gray-900 text-white">
            <Header title="Withdrawal History" />

            <main className="max-w-full mx-auto py-6 px-4 lg:px-8">
                {/* Header Actions */}
                <div className="flex items-center justify-between mb-6">
                    <p className="text-gray-400">View history of all validated withdrawal requests</p>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={fetchData}
                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md transition-colors"
                        >
                            🔄 Refresh
                        </button>
                        <button
                            onClick={handleExportCSV}
                            disabled={filteredWithdrawals.length === 0}
                            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            📥 Export CSV
                        </button>
                    </div>
                </div>

                {/* Error Message */}
                {error && (
                    <div className="mb-6 bg-red-800 border border-red-700 rounded-lg p-4">
                        <p className="text-red-200">{error}</p>
                    </div>
                )}

                {/* Summary Statistics */}
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
                    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-gray-400 font-medium">Total</p>
                                <p className="text-2xl font-bold text-white">{summaryStats.total}</p>
                            </div>
                            <div className="text-3xl">📊</div>
                        </div>
                    </div>

                    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-gray-400 font-medium">Completed</p>
                                <p className="text-2xl font-bold text-green-500">{summaryStats.completed}</p>
                            </div>
                            <div className="text-3xl">✓</div>
                        </div>
                    </div>

                    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-gray-400 font-medium">Rejected</p>
                                <p className="text-2xl font-bold text-red-500">{summaryStats.rejected}</p>
                            </div>
                            <div className="text-3xl">✗</div>
                        </div>
                    </div>

                    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-gray-400 font-medium">Failed</p>
                                <p className="text-2xl font-bold text-orange-500">{summaryStats.failed}</p>
                            </div>
                            <div className="text-3xl">⚠️</div>
                        </div>
                    </div>

                    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-gray-400 font-medium">Total Paid (XAF)</p>
                                <p className="text-xl font-bold text-blue-400">
                                    {formatCurrency(summaryStats.totalAmount, 'XAF' as any)}
                                </p>
                            </div>
                            <div className="text-3xl">💰</div>
                        </div>
                    </div>
                </div>

                {/* Filters and Search */}
                <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label className="text-sm font-medium text-gray-300 mb-2 block">Status</label>
                            <select
                                value={statusFilter}
                                onChange={(e) => {
                                    setStatusFilter(e.target.value as any);
                                    setCurrentPage(1);
                                }}
                                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-2 focus:ring-indigo-500"
                            >
                                <option value="all">All Statuses</option>
                                <option value="completed">✓ Completed</option>
                                <option value="rejected_by_admin">✗ Rejected</option>
                                <option value="failed">⚠️ Failed</option>
                            </select>
                        </div>

                        <div>
                            <label className="text-sm font-medium text-gray-300 mb-2 block">Type</label>
                            <select
                                value={withdrawalTypeFilter}
                                onChange={(e) => setWithdrawalTypeFilter(e.target.value as any)}
                                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-2 focus:ring-indigo-500"
                            >
                                <option value="all">All Types</option>
                                <option value="mobile_money">📱 Mobile Money</option>
                                <option value="crypto">💰 Crypto</option>
                            </select>
                        </div>

                        <div>
                            <label className="text-sm font-medium text-gray-300 mb-2 block">Search</label>
                            <input
                                type="text"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                placeholder="Transaction ID, user, email, phone..."
                                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-2 focus:ring-indigo-500 placeholder-gray-400"
                            />
                        </div>
                    </div>

                    <div className="mt-3 text-sm text-gray-400">
                        Showing {filteredWithdrawals.length} of {totalCount} withdrawals
                    </div>
                </div>

                {/* Withdrawals Table */}
                <div className="shadow overflow-hidden border-b border-gray-700 sm:rounded-lg mb-6 overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-700">
                        <thead className="bg-gray-700">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                                    Transaction
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                                    User
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                                    Type
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                                    Amount
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                                    Status
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                                    Date
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                                    Actions
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-gray-800 divide-y divide-gray-600">
                            {filteredWithdrawals.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="px-6 py-8 text-center text-gray-400">
                                        {searchTerm ? 'No withdrawals found matching your search' : 'No withdrawal history available'}
                                    </td>
                                </tr>
                            ) : (
                                filteredWithdrawals.map((withdrawal) => (
                                    <tr key={withdrawal._id} className="hover:bg-gray-750">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="font-mono text-sm text-gray-300">{withdrawal.transactionId}</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm font-medium text-white">{withdrawal.userName || 'N/A'}</div>
                                            <div className="text-xs text-gray-400">{withdrawal.userEmail || 'N/A'}</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className="text-sm text-gray-300">
                                                {withdrawal.metadata?.withdrawalType === 'crypto' ? '💰 Crypto' : '📱 Momo'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm font-semibold text-white">
                                                {formatCurrency(withdrawal.amount - withdrawal.fee, withdrawal.currency)}
                                            </div>
                                            <div className="text-xs text-gray-400">
                                                Fee: {formatCurrency(withdrawal.fee, withdrawal.currency)}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(withdrawal.status)}`}>
                                                {getStatusLabel(withdrawal.status)}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                                            {formatDate(withdrawal.createdAt)}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                            <button
                                                onClick={() => handleViewDetails(withdrawal)}
                                                className="px-3 py-1 text-xs font-semibold rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-blue-500 transition"
                                            >
                                                View Details
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                    <Pagination
                        currentPage={currentPage}
                        totalPages={totalPages}
                        onPageChange={setCurrentPage}
                    />
                )}
            </main>

            {/* Details Modal */}
            <WithdrawalDetailsModal
                withdrawal={selectedWithdrawal}
                isOpen={isModalOpen}
                onClose={handleCloseModal}
                onApproved={fetchData}
                onRejected={fetchData}
            />
        </div>
    );
};

export default WithdrawalHistoryPage;
