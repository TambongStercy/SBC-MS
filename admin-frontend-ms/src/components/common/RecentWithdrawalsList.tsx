import React from 'react';
import { RecentWithdrawal } from '../../services/adminDashboardApi';
import { Link } from 'react-router-dom';

interface RecentWithdrawalsListProps {
    withdrawals: RecentWithdrawal[];
}

const RecentWithdrawalsList: React.FC<RecentWithdrawalsListProps> = ({ withdrawals }) => {
    const getStatusColor = (status: string) => {
        switch (status) {
            case 'pending_admin_approval':
                return 'bg-yellow-500';
            case 'processing':
                return 'bg-blue-500';
            case 'completed':
                return 'bg-green-500';
            case 'rejected_by_admin':
            case 'failed':
                return 'bg-red-500';
            default:
                return 'bg-gray-500';
        }
    };

    const getStatusLabel = (status: string) => {
        switch (status) {
            case 'pending_admin_approval':
                return 'En attente';
            case 'processing':
                return 'En cours';
            case 'completed':
                return 'Terminé';
            case 'rejected_by_admin':
                return 'Rejeté';
            case 'failed':
                return 'Échoué';
            default:
                return status;
        }
    };

    const formatCurrency = (amount: number, currency: string) => {
        return `${amount.toLocaleString('fr-FR')} ${currency}`;
    };

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleString('fr-FR', {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    if (withdrawals.length === 0) {
        return (
            <div className="text-center text-gray-500 dark:text-gray-400 py-4">
                Aucun retrait récent
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {withdrawals.map((withdrawal) => (
                <div
                    key={withdrawal._id}
                    className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                >
                    <div className="flex items-center flex-1">
                        {/* Status Indicator */}
                        <div className={`w-2 h-2 rounded-full ${getStatusColor(withdrawal.status)} mr-3`} />

                        <div className="flex-1 min-w-0">
                            {/* User Name */}
                            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                                {withdrawal.userName || 'Utilisateur inconnu'}
                            </p>

                            {/* Transaction ID & Date */}
                            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                <span className="font-mono">{withdrawal.transactionId.substring(0, 12)}...</span>
                                <span>•</span>
                                <span>{formatDate(withdrawal.createdAt)}</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        {/* Amount */}
                        <div className="text-right">
                            <p className="text-sm font-semibold text-red-600 dark:text-red-400">
                                -{formatCurrency(withdrawal.amount, withdrawal.currency)}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                {getStatusLabel(withdrawal.status)}
                            </p>
                        </div>
                    </div>
                </div>
            ))}

            {/* View All Link */}
            <Link
                to="/withdrawals/approvals"
                className="block text-center text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-medium mt-4"
            >
                Voir tous les retraits →
            </Link>
        </div>
    );
};

export default RecentWithdrawalsList;
