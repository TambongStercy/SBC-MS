import React, { useState, useEffect } from 'react';
import {
    WithdrawalTransaction,
    WithdrawalStats,
    getPendingWithdrawals,
    getWithdrawalStats,
    formatCurrency,
    formatDate,
    bulkApproveWithdrawals
} from '../services/adminWithdrawalApi';
import { withdrawalStatusLabel, withdrawalStatusColor } from '../components/withdrawals/withdrawalStatus';
import { HugeiconsIcon } from '@hugeicons/react';
import { Refresh01Icon, HourglassIcon, CheckmarkCircle02Icon, CancelCircleIcon, Settings02Icon } from '@hugeicons/core-free-icons';
import WithdrawalDetailsModal from '../components/withdrawals/WithdrawalDetailsModal';
import Pagination from '../components/common/Pagination';
import Loader from '../components/common/loader';
import Header from '../components/common/Header';
import ConfirmationModal from '../components/common/ConfirmationModal';
import ToastContainer from '../components/common/ToastContainer';
import { useToast } from '../hooks/useToast';

const WithdrawalApprovalPage: React.FC = () => {
    const { toasts, removeToast, showSuccess, showError, showInfo } = useToast();

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

    // Confirmation modal
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [confirmAction, setConfirmAction] = useState<{
        title: string;
        message: string;
        onConfirm: () => void;
    } | null>(null);

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
            setError(err.message || 'Impossible de charger les données');
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

    const handleBulkApprove = () => {
        if (selectedIds.length === 0) return;

        setConfirmAction({
            title: 'Valider les retraits sélectionnés',
            message: `Voulez-vous vraiment valider ${selectedIds.length} retrait(s) ?`,
            onConfirm: async () => {
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
                        showInfo(`Certains retraits ont échoué. Détails dans la console.`);
                    }

                    fetchData();
                    setSelectedIds([]);
                } catch (err: any) {
                    showError('Échec de la validation groupée : ' + err.message);
                } finally {
                    setBulkApproving(false);
                }
            }
        });
        setShowConfirmModal(true);
    };

    if (loading) {
        return (
            <div>
                <Header title="Retraits à valider" />
                <div className="flex items-center justify-center h-96">
                    <Loader name="Retraits" />
                </div>
            </div>
        );
    }

    return (
        <div className="text-fg">
            <Header title="Retraits à valider" />

            <main>
                {/* Header Actions */}
                <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                    <p className="text-fg-muted">Vérifiez et validez les demandes de retrait en attente</p>
                    <div className="flex items-center gap-3">
                        <label className="flex items-center gap-2 text-sm text-fg-muted">
                            <input
                                type="checkbox"
                                checked={autoRefresh}
                                onChange={(e) => setAutoRefresh(e.target.checked)}
                                className="rounded-sm bg-surface border-line-strong"
                            />
                            Actualisation auto (30 s)
                        </label>
                        <button
                            onClick={fetchData}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md transition-colors"
                        >
                            <HugeiconsIcon icon={Refresh01Icon} size={16} />
                            Actualiser
                        </button>
                    </div>
                </div>

                {/* Error Message */}
                {error && (
                    <div className="mb-6 bg-red-100 dark:bg-red-800 border border-red-300 dark:border-red-700 rounded-lg p-4">
                        <p className="text-red-800 dark:text-red-200">{error}</p>
                    </div>
                )}

                {/* Statistics Cards */}
                {stats && (
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                        <div className="bg-surface border border-line rounded-lg p-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm text-fg-muted font-medium">À valider</p>
                                    <p className="text-3xl font-bold text-yellow-600 dark:text-yellow-500">{stats.pendingApproval}</p>
                                </div>
                                <HugeiconsIcon icon={HourglassIcon} size={32} className="text-yellow-600 dark:text-yellow-500" />
                            </div>
                        </div>

                        <div className="bg-surface border border-line rounded-lg p-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm text-fg-muted font-medium">Validés aujourd'hui</p>
                                    <p className="text-3xl font-bold text-green-600 dark:text-green-500">{stats.approvedToday}</p>
                                </div>
                                <HugeiconsIcon icon={CheckmarkCircle02Icon} size={32} className="text-green-600 dark:text-green-500" />
                            </div>
                        </div>

                        <div className="bg-surface border border-line rounded-lg p-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm text-fg-muted font-medium">Rejetés aujourd'hui</p>
                                    <p className="text-3xl font-bold text-red-500">{stats.rejectedToday}</p>
                                </div>
                                <HugeiconsIcon icon={CancelCircleIcon} size={32} className="text-red-500" />
                            </div>
                        </div>

                        <div className="bg-surface border border-line rounded-lg p-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm text-fg-muted font-medium">En cours</p>
                                    <p className="text-3xl font-bold text-blue-500">{stats.processing}</p>
                                </div>
                                <HugeiconsIcon icon={Settings02Icon} size={32} className="text-blue-500" />
                            </div>
                        </div>
                    </div>
                )}

                {/* Filters and Bulk Actions */}
                <div className="bg-surface border border-line rounded-lg p-4 mb-6">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-4">
                            <div>
                                <label className="text-sm font-medium text-fg-muted mr-2">Type :</label>
                                <select
                                    value={withdrawalTypeFilter}
                                    onChange={(e) => {
                                        setWithdrawalTypeFilter(e.target.value as any);
                                        setCurrentPage(1);
                                    }}
                                    className="px-3 py-2 bg-surface border border-line-strong rounded-md text-fg focus:ring-2 focus:ring-indigo-500"
                                >
                                    <option value="all">Tous les types</option>
                                    <option value="mobile_money">Mobile Money</option>
                                    <option value="crypto">Crypto</option>
                                </select>
                            </div>
                            <div className="text-sm text-fg-muted">
                                {withdrawals.length} sur {totalCount} retraits
                            </div>
                        </div>

                        {selectedIds.length > 0 && (
                            <div className="flex items-center gap-3">
                                <span className="text-sm font-medium text-fg-muted">
                                    {selectedIds.length} sélectionné(s)
                                </span>
                                <button
                                    onClick={handleBulkApprove}
                                    disabled={bulkApproving}
                                    className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-md transition-colors disabled:opacity-50"
                                >
                                    {bulkApproving ? 'Validation…' : `Valider ${selectedIds.length}`}
                                </button>
                                <button
                                    onClick={() => setSelectedIds([])}
                                    className="px-4 py-2 bg-surface-2 hover:bg-surface-3 text-fg-muted rounded-md transition-colors"
                                >
                                    Effacer
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Withdrawals Table */}
                <div className="overflow-hidden border-b border-line sm:rounded-lg mb-6 overflow-x-auto">
                    <table className="min-w-full divide-y divide-line">
                        <thead className="bg-surface-2">
                            <tr>
                                <th className="px-6 py-3 text-left">
                                    <input
                                        type="checkbox"
                                        checked={withdrawals.length > 0 && selectedIds.length === withdrawals.length}
                                        onChange={handleSelectAll}
                                        className="rounded-sm bg-surface border-line-strong"
                                    />
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">
                                    Transaction
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">
                                    Membre
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">
                                    Type
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">
                                    Montant
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">
                                    Date
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">
                                    Statut
                                </th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-fg-muted uppercase tracking-wider">
                                    Actions
                                </th>
                            </tr>
                        </thead>
                        <tbody className="bg-surface divide-y divide-line-strong">
                            {withdrawals.length === 0 ? (
                                <tr>
                                    <td colSpan={8} className="px-6 py-8 text-center text-fg-muted">
                                        Aucun retrait en attente
                                    </td>
                                </tr>
                            ) : (
                                withdrawals.map((withdrawal) => (
                                    <tr key={withdrawal._id} className="hover:bg-surface-2">
                                        <td className="px-6 py-4">
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.includes(withdrawal.transactionId)}
                                                onChange={() => handleSelectOne(withdrawal.transactionId)}
                                                className="rounded-sm bg-surface border-line-strong"
                                            />
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="font-mono text-sm text-fg-muted">{withdrawal.transactionId}</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm font-medium text-fg">{withdrawal.userName || '—'}</div>
                                            <div className="text-xs text-fg-muted">{withdrawal.userEmail || '—'}</div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className="text-sm text-fg-muted">
                                                {withdrawal.metadata?.withdrawalType === 'crypto' ? 'Crypto' : 'Mobile Money'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <div className="text-sm font-semibold text-fg">
                                                {formatCurrency(withdrawal.amount - withdrawal.fee, withdrawal.currency)}
                                            </div>
                                            <div className="text-xs text-fg-muted">
                                                Frais : {formatCurrency(withdrawal.fee, withdrawal.currency)}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-fg-muted">
                                            {formatDate(withdrawal.createdAt)}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${withdrawalStatusColor(withdrawal.status)}`}>
                                                {withdrawalStatusLabel(withdrawal.status)}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                            <button
                                                onClick={() => handleViewDetails(withdrawal)}
                                                className="px-3 py-1 text-xs font-semibold rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-offset-surface focus:ring-blue-500 transition"
                                            >
                                                Voir le détail
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
                showSuccess={showSuccess}
                showError={showError}
            />

            {/* Confirmation Modal */}
            {confirmAction && (
                <ConfirmationModal
                    isOpen={showConfirmModal}
                    title={confirmAction.title}
                    message={confirmAction.message}
                    confirmText="Confirmer"
                    cancelText="Annuler"
                    onConfirm={confirmAction.onConfirm}
                    onCancel={() => setShowConfirmModal(false)}
                />
            )}

            {/* Toast Container */}
            <ToastContainer toasts={toasts} onRemove={removeToast} />
        </div>
    );
};

export default WithdrawalApprovalPage;
