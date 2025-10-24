import React, { useState, useEffect } from 'react';
import {
    WithdrawalTransaction,
    WithdrawalStats,
    getPendingWithdrawals,
    getWithdrawalStats,
    formatCurrency,
    formatDate,
    getStatusLabel,
    getStatusColor,
    bulkApproveWithdrawals
} from '../services/adminWithdrawalApi';
import WithdrawalDetailsModal from '../components/withdrawals/WithdrawalDetailsModal';
import Pagination from '../components/common/Pagination';
import Loader from '../components/common/loader';
import Header from '../components/common/Header';

const WithdrawalApprovalPage: React.FC = () => {
    // State
    const [withdrawals, setWithdrawals] = useState<WithdrawalTransaction[]>([]);
    const [stats, setStats] = useState<WithdrawalStats | null>(null);
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
    const [withdrawalTypeFilter, setWithdrawalTypeFilter] = useState<'all' | 'mobile_money' | 'crypto'>('all');

    // Bulk selection
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [bulkApproving, setBulkApproving] = useState(false);

    // Auto-refresh
    const [autoRefresh, setAutoRefresh] = useState(true);

    // Fetch data
    const fetchData = async () => {
        try {
            setError(null);

            // Fetch stats and withdrawals in parallel
            const [statsRes, withdrawalsRes] = await Promise.all([
                getWithdrawalStats(),
                getPendingWithdrawals(
                    currentPage,
                    limit,
                    withdrawalTypeFilter === 'all' ? undefined : withdrawalTypeFilter
                )
            ]);

            setStats(statsRes.data);
            setWithdrawals(withdrawalsRes.data.withdrawals);
            setTotalPages(withdrawalsRes.data.pagination.totalPages);
            setTotalCount(withdrawalsRes.data.pagination.total);
        } catch (err: any) {
            setError(err.message || 'Failed to fetch data');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [currentPage, withdrawalTypeFilter]);

    // Auto-refresh every 30 seconds
    useEffect(() => {
        if (!autoRefresh) return;

        const interval = setInterval(() => {
            fetchData();
        }, 30000);

        return () => clearInterval(interval);
    }, [autoRefresh, currentPage, withdrawalTypeFilter]);

    // Handlers
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
        setSelectedIds([]);
    };

    const handleSelectAll = () => {
        if (selectedIds.length === withdrawals.length) {
            setSelectedIds([]);
        } else {
            setSelectedIds(withdrawals.map(w => w.transactionId));
        }
    };

    const handleSelectOne = (transactionId: string) => {
        setSelectedIds(prev => {
            if (prev.includes(transactionId)) {
                return prev.filter(id => id !== transactionId);
            } else {
                return [...prev, transactionId];
            }
        });
    };

    const handleBulkApprove = async () => {
        if (selectedIds.length === 0) return;

        if (!confirm(`Are you sure you want to approve ${selectedIds.length} withdrawals?`)) {
            return;
        }

        setBulkApproving(true);
        try {
            const result = await bulkApproveWithdrawals({
                transactionIds: selectedIds,
                adminNotes: 'Bulk approved'
            });

            alert(`Success! Approved: ${result.data.approved}, Failed: ${result.data.failed}`);
            if (result.data.errors.length > 0) {
                console.error('Bulk approval errors:', result.data.errors);
            }

            fetchData();
            setSelectedIds([]);
        } catch (err: any) {
            alert('Failed to bulk approve: ' + err.message);
        } finally {
            setBulkApproving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex-1 overflow-auto relative z-10 bg-gray-900">
                <Header title="Withdrawal Approvals" />
                <div className="flex items-center justify-center h-96">
                    <Loader />
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-auto relative z-10 bg-gray-900 text-white">
            <Header title="Withdrawal Approvals" />

            <main className="max-w-full mx-auto py-6 px-4 lg:px-8">
                {/* Header Actions */}
                <div className="flex items-center justify-between mb-6">
                    <p className="text-gray-400">Review and approve pending withdrawal requests</p>
                    <div className="flex items-center gap-3">
                        <label className="flex items-center gap-2 text-sm text-gray-300">
                            <input
                                type="checkbox"
                                checked={autoRefresh}
                                onChange={(e) => setAutoRefresh(e.target.checked)}
                                className="rounded bg-gray-700 border-gray-600"
                            />
                            Auto-refresh (30s)
                        </label>
                        <button
                            onClick={fetchData}
                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md transition-colors"
                        >
                            🔄 Refresh
                        </button>
                    </div>
                </div>

                {/* Error Message */}
                {error && (
                    <div className="mb-6 bg-red-800 border border-red-700 rounded-lg p-4">
                        <p className="text-red-200">{error}</p>
                    </div>
                )}

                {/* Statistics Cards */}
                {stats && (
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                        <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm text-gray-400 font-medium">Pending Approval</p>
                                    <p className="text-3xl font-bold text-yellow-500">{stats.pendingApproval}</p>
                                </div>
                                <div className="text-4xl">⏳</div>
                            </div>
                        </div>

                        <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm text-gray-400 font-medium">Approved Today</p>
                                    <p className="text-3xl font-bold text-green-500">{stats.approvedToday}</p>
                                </div>
                                <div className="text-4xl">✓</div>
                            </div>
                        </div>

                        <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm text-gray-400 font-medium">Rejected Today</p>
                                    <p className="text-3xl font-bold text-red-500">{stats.rejectedToday}</p>
                                </div>
                                <div className="text-4xl">✗</div>
                            </div>
                        </div>

                        <div className="bg-gray-800 border border-gray-700 rounded-lg p-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm text-gray-400 font-medium">Processing</p>
                                    <p className="text-3xl font-bold text-blue-500">{stats.processing}</p>
                                </div>
                                <div className="text-4xl">⚙️</div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Filters and Bulk Actions */}
                <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 mb-6">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div>
                                <label className="text-sm font-medium text-gray-300 mr-2">Type:</label>
                                <select
                                    value={withdrawalTypeFilter}
                                    onChange={(e) => {
                                        setWithdrawalTypeFilter(e.target.value as any);
                                        setCurrentPage(1);
                                    }}
                                    className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-2 focus:ring-indigo-500"
                                >
                                    <option value="all">All Types</option>
                                    <option value="mobile_money">📱 Mobile Money</option>
                                    <option value="crypto">💰 Crypto</option>
                                </select>
                            </div>
                            <div className="text-sm text-gray-400">
                                Showing {withdrawals.length} of {totalCount} withdrawals
                            </div>
                        </div>

                        {selectedIds.length > 0 && (
                            <div className="flex items-center gap-3">
                                <span className="text-sm font-medium text-gray-300">
                                    {selectedIds.length} selected
                                </span>
                                <button
                                    onClick={handleBulkApprove}
                                    disabled={bulkApproving}
                                    className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md transition-colors disabled:opacity-50"
                                >
                                    {bulkApproving ? 'Approving...' : `Approve ${selectedIds.length}`}
                                </button>
                                <button
                                    onClick={() => setSelectedIds([])}
                                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-md transition-colors"
                                >
                                    Clear
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Withdrawals Table */}
                <div className="shadow overflow-hidden border-b border-gray-700 sm:rounded-lg mb-6 overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-700">
                        <thead className="bg-gray-700">
                            <tr>
                                <th className="px-6 py-3 text-left">
                                    <input
                                        type="checkbox"
                                        checked={withdrawals.length > 0 && selectedIds.length === withdrawals.length}
                                        onChange={handleSelectAll}
                                        className="rounded bg-gray-600 border-gray-500"
                                    />
                                </th>
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
                                    Date
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                                    Status
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                                    Actions
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-gray-800 divide-y divide-gray-600">
                            {withdrawals.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="px-6 py-8 text-center text-gray-400">
                                        No pending withdrawals
                                    </td>
                                </tr>
                            ) : (
                                withdrawals.map((withdrawal) => (
                                    <tr key={withdrawal._id} className="hover:bg-gray-750">
                                        <td className="px-6 py-4">
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.includes(withdrawal.transactionId)}
                                                onChange={() => handleSelectOne(withdrawal.transactionId)}
                                                className="rounded bg-gray-600 border-gray-500"
                                            />
                                        </td>
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
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-300">
                                            {formatDate(withdrawal.createdAt)}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(withdrawal.status)}`}>
                                                {getStatusLabel(withdrawal.status)}
                                            </span>
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
                onApproved={handleActionComplete}
                onRejected={handleActionComplete}
            />
        </div>
    );
};

export default WithdrawalApprovalPage;
