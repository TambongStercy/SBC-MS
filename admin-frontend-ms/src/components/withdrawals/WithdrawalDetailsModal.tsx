import React, { useState } from 'react';
import {
    WithdrawalTransaction,
    formatCurrency,
    formatDate,
    getStatusLabel,
    getStatusColor,
    approveWithdrawal,
    rejectWithdrawal
} from '../../services/adminWithdrawalApi';

interface WithdrawalDetailsModalProps {
    withdrawal: WithdrawalTransaction | null;
    isOpen: boolean;
    onClose: () => void;
    onApproved?: () => void;
    onRejected?: () => void;
}

const WithdrawalDetailsModal: React.FC<WithdrawalDetailsModalProps> = ({
    withdrawal,
    isOpen,
    onClose,
    onApproved,
    onRejected
}) => {
    const [isApproving, setIsApproving] = useState(false);
    const [isRejecting, setIsRejecting] = useState(false);
    const [showRejectForm, setShowRejectForm] = useState(false);
    const [rejectionReason, setRejectionReason] = useState('');
    const [adminNotes, setAdminNotes] = useState('');
    const [error, setError] = useState<string | null>(null);

    if (!isOpen || !withdrawal) return null;

    const handleApprove = async () => {
        if (!withdrawal) return;

        setError(null);
        setIsApproving(true);

        try {
            await approveWithdrawal(withdrawal.transactionId, {
                adminNotes: adminNotes || undefined
            });

            alert('Withdrawal approved successfully!');
            if (onApproved) onApproved();
            onClose();
        } catch (err: any) {
            setError(err.message || 'Failed to approve withdrawal');
        } finally {
            setIsApproving(false);
        }
    };

    const handleReject = async () => {
        if (!withdrawal || !rejectionReason.trim()) {
            setError('Rejection reason is required');
            return;
        }

        setError(null);
        setIsRejecting(true);

        try {
            await rejectWithdrawal(withdrawal.transactionId, {
                rejectionReason,
                adminNotes: adminNotes || undefined
            });

            alert('Withdrawal rejected successfully!');
            if (onRejected) onRejected();
            onClose();
        } catch (err: any) {
            setError(err.message || 'Failed to reject withdrawal');
        } finally {
            setIsRejecting(false);
        }
    };

    const isPendingApproval = withdrawal.status === 'pending_admin_approval';
    const isRejected = withdrawal.status === 'rejected_by_admin';
    const isMobileMoneyWithdrawal = withdrawal.metadata?.withdrawalType === 'mobile_money';

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto border border-gray-700">
                {/* Header */}
                <div className="sticky top-0 bg-gray-800 border-b border-gray-700 px-6 py-4 flex justify-between items-center">
                    <h2 className="text-2xl font-bold text-white">
                        Withdrawal Details
                    </h2>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white transition-colors"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-6">
                    {/* Error Message */}
                    {error && (
                        <div className="bg-red-900 border border-red-700 rounded-lg p-4">
                            <p className="text-red-200 text-sm">{error}</p>
                        </div>
                    )}

                    {/* Status Badge */}
                    <div className="flex items-center justify-between">
                        <div>
                            <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(withdrawal.status)}`}>
                                {getStatusLabel(withdrawal.status)}
                            </span>
                        </div>
                        <div className="text-sm text-gray-400">
                            {formatDate(withdrawal.createdAt)}
                        </div>
                    </div>

                    {/* Transaction Info */}
                    <div className="grid grid-cols-2 gap-4 bg-gray-700 p-4 rounded-lg border border-gray-600">
                        <div>
                            <p className="text-sm text-gray-400">Transaction ID</p>
                            <p className="font-mono text-sm font-medium text-white">{withdrawal.transactionId}</p>
                        </div>
                        <div>
                            <p className="text-sm text-gray-400">Type</p>
                            <p className="font-medium capitalize text-white">
                                {withdrawal.metadata?.withdrawalType === 'crypto' ? '💰 Crypto' : '📱 Mobile Money'}
                            </p>
                        </div>
                    </div>

                    {/* Amount Info */}
                    <div className="bg-blue-900 bg-opacity-30 border border-blue-700 rounded-lg p-4">
                        <div className="grid grid-cols-3 gap-4">
                            <div>
                                <p className="text-sm text-gray-400">Amount</p>
                                <p className="text-lg font-bold text-blue-400">
                                    {formatCurrency(withdrawal.amount - withdrawal.fee, withdrawal.currency)}
                                </p>
                            </div>
                            <div>
                                <p className="text-sm text-gray-400">Fee</p>
                                <p className="text-lg font-semibold text-gray-300">
                                    {formatCurrency(withdrawal.fee, withdrawal.currency)}
                                </p>
                            </div>
                            <div>
                                <p className="text-sm text-gray-400">Total Debited</p>
                                <p className="text-lg font-bold text-red-400">
                                    {formatCurrency(withdrawal.amount, withdrawal.currency)}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* User Info */}
                    <div>
                        <h3 className="text-lg font-semibold mb-3 text-white">User Information</h3>
                        <div className="grid grid-cols-2 gap-4 bg-gray-700 p-4 rounded-lg border border-gray-600">
                            <div>
                                <p className="text-sm text-gray-400">Name</p>
                                <p className="font-medium text-white">{withdrawal.userName || 'N/A'}</p>
                            </div>
                            <div>
                                <p className="text-sm text-gray-400">Email</p>
                                <p className="font-medium text-white">{withdrawal.userEmail || 'N/A'}</p>
                            </div>
                            <div>
                                <p className="text-sm text-gray-400">Phone</p>
                                <p className="font-medium text-white">{withdrawal.userPhoneNumber || 'N/A'}</p>
                            </div>
                            <div>
                                <p className="text-sm text-gray-400">User ID</p>
                                <p className="font-mono text-xs text-gray-300">{withdrawal.userId}</p>
                            </div>
                        </div>
                    </div>

                    {/* User Balance */}
                    <div>
                        <h3 className="text-lg font-semibold mb-3 text-white">💰 Current User Balance</h3>
                        <div className="bg-green-900 bg-opacity-30 border border-green-700 rounded-lg p-4">
                            {withdrawal.userBalance !== undefined && withdrawal.userBalance !== null ? (
                                typeof withdrawal.userBalance === 'number' ? (
                                    // Handle number format (single balance in withdrawal currency)
                                    <div>
                                        <p className="text-sm text-gray-400">{withdrawal.currency}</p>
                                        <p className="text-lg font-bold text-green-400">
                                            {formatCurrency(withdrawal.userBalance, withdrawal.currency)}
                                        </p>
                                    </div>
                                ) : Object.keys(withdrawal.userBalance).length > 0 ? (
                                    // Handle object format (multiple currencies)
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                        {Object.entries(withdrawal.userBalance).map(([currency, amount]) => (
                                            <div key={currency}>
                                                <p className="text-sm text-gray-400">{currency}</p>
                                                <p className="text-lg font-bold text-green-400">
                                                    {formatCurrency(amount as number, currency as any)}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-gray-400 text-sm">Balance information not available</p>
                                )
                            ) : (
                                <p className="text-gray-400 text-sm">Balance information not available</p>
                            )}
                        </div>
                    </div>

                    {/* Referral Statistics */}
                    {withdrawal.referralStats && (
                        <div>
                            <h3 className="text-lg font-semibold mb-3 text-white">Referral Statistics</h3>
                            <div className="bg-purple-900 bg-opacity-30 border border-purple-700 rounded-lg p-4">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div>
                                        <p className="text-sm text-gray-400">Direct Referrals</p>
                                        <p className="text-2xl font-bold text-purple-400">
                                            {withdrawal.referralStats.directReferrals}
                                        </p>
                                        <p className="text-xs text-gray-400 mt-1">
                                            {withdrawal.referralStats.directSubscribedReferrals} with active subscriptions
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-gray-400">Indirect Referrals</p>
                                        <p className="text-2xl font-bold text-purple-400">
                                            {withdrawal.referralStats.indirectReferrals}
                                        </p>
                                        <p className="text-xs text-gray-400 mt-1">
                                            {withdrawal.referralStats.indirectSubscribedReferrals} with active subscriptions
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-gray-400">Total Subscribed Referrals</p>
                                        <p className="text-2xl font-bold text-purple-300">
                                            {withdrawal.referralStats.totalSubscribedReferrals}
                                        </p>
                                        <p className="text-xs text-gray-400 mt-1">
                                            out of {withdrawal.referralStats.totalReferrals} total
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Withdrawal History */}
                    {withdrawal.withdrawalHistory && withdrawal.withdrawalHistory.length > 0 && (
                        <div>
                            <h3 className="text-lg font-semibold mb-3 text-white">Recent Withdrawal History</h3>
                            <div className="bg-gray-700 border border-gray-600 rounded-lg overflow-hidden">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead className="bg-gray-600">
                                            <tr>
                                                <th className="px-4 py-2 text-left text-gray-300 font-medium">Transaction ID</th>
                                                <th className="px-4 py-2 text-left text-gray-300 font-medium">Amount</th>
                                                <th className="px-4 py-2 text-left text-gray-300 font-medium">Status</th>
                                                <th className="px-4 py-2 text-left text-gray-300 font-medium">Date</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-600">
                                            {withdrawal.withdrawalHistory.map((item, index) => (
                                                <tr key={index} className="hover:bg-gray-650">
                                                    <td className="px-4 py-2 font-mono text-xs text-gray-300">{item.transactionId}</td>
                                                    <td className="px-4 py-2 font-semibold text-white">
                                                        {formatCurrency(item.amount, (item.currency || withdrawal.currency) as any)}
                                                    </td>
                                                    <td className="px-4 py-2">
                                                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                                            item.status === 'completed' ? 'bg-green-900 text-green-300' :
                                                            item.status === 'rejected_by_admin' ? 'bg-red-900 text-red-300' :
                                                            'bg-gray-600 text-gray-300'
                                                        }`}>
                                                            {item.status === 'completed' ? 'Completed' :
                                                             item.status === 'rejected_by_admin' ? 'Rejected' :
                                                             item.status === 'failed' ? 'Failed' : item.status}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-2 text-gray-300">{formatDate(item.createdAt)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Account Info */}
                    {isMobileMoneyWithdrawal && withdrawal.metadata?.accountInfo && (
                        <div>
                            <h3 className="text-lg font-semibold mb-3 text-white">Mobile Money Details</h3>
                            <div className="grid grid-cols-2 gap-4 bg-gray-700 p-4 rounded-lg border border-gray-600">
                                <div>
                                    <p className="text-sm text-gray-400">Phone Number</p>
                                    <p className="font-mono font-medium text-white">{withdrawal.metadata.accountInfo.fullMomoNumber}</p>
                                </div>
                                <div>
                                    <p className="text-sm text-gray-400">Operator</p>
                                    <p className="font-medium text-white">{withdrawal.metadata.accountInfo.momoOperator}</p>
                                </div>
                                <div>
                                    <p className="text-sm text-gray-400">Country</p>
                                    <p className="font-medium text-white">{withdrawal.metadata.accountInfo.countryCode}</p>
                                </div>
                                {withdrawal.metadata.accountInfo.recipientName && (
                                    <div>
                                        <p className="text-sm text-gray-400">Recipient Name</p>
                                        <p className="font-medium text-white">{withdrawal.metadata.accountInfo.recipientName}</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Crypto Info */}
                    {!isMobileMoneyWithdrawal && withdrawal.metadata?.cryptoAddress && (
                        <div>
                            <h3 className="text-lg font-semibold mb-3 text-white">Crypto Details</h3>
                            <div className="bg-gray-700 p-4 rounded-lg border border-gray-600 space-y-3">
                                <div>
                                    <p className="text-sm text-gray-400">Wallet Address</p>
                                    <p className="font-mono text-xs break-all text-white">{withdrawal.metadata.cryptoAddress}</p>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-sm text-gray-400">Currency</p>
                                        <p className="font-medium text-white">{withdrawal.metadata.cryptoCurrency}</p>
                                    </div>
                                    {withdrawal.metadata.usdAmount && (
                                        <div>
                                            <p className="text-sm text-gray-400">USD Amount</p>
                                            <p className="font-medium text-white">${withdrawal.metadata.usdAmount}</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Rejection Info (if rejected) */}
                    {isRejected && withdrawal.rejectionReason && (
                        <div className="bg-red-900 bg-opacity-30 border border-red-700 rounded-lg p-4">
                            <h3 className="text-lg font-semibold text-red-400 mb-2">Rejection Details</h3>
                            <div className="space-y-2">
                                <div>
                                    <p className="text-sm text-red-300">Reason</p>
                                    <p className="font-medium text-white">{withdrawal.rejectionReason}</p>
                                </div>
                                {withdrawal.adminNotes && (
                                    <div>
                                        <p className="text-sm text-red-300">Admin Notes</p>
                                        <p className="text-sm text-white">{withdrawal.adminNotes}</p>
                                    </div>
                                )}
                                {withdrawal.rejectedAt && (
                                    <div>
                                        <p className="text-sm text-red-300">Rejected At</p>
                                        <p className="text-sm text-white">{formatDate(withdrawal.rejectedAt)}</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Approval/Rejection Form */}
                    {isPendingApproval && (
                        <div className="border-t border-gray-700 pt-6">
                            <h3 className="text-lg font-semibold mb-4 text-white">Admin Action</h3>

                            {!showRejectForm ? (
                                <div>
                                    <div className="mb-4">
                                        <label className="block text-sm font-medium text-gray-300 mb-2">
                                            Admin Notes (Optional)
                                        </label>
                                        <textarea
                                            value={adminNotes}
                                            onChange={(e) => setAdminNotes(e.target.value)}
                                            rows={3}
                                            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-gray-400"
                                            placeholder="Add any notes about this withdrawal..."
                                        />
                                    </div>

                                    <div className="flex gap-3">
                                        <button
                                            onClick={handleApprove}
                                            disabled={isApproving}
                                            className="flex-1 bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed font-medium transition-colors"
                                        >
                                            {isApproving ? 'Approving...' : '✓ Approve Withdrawal'}
                                        </button>
                                        <button
                                            onClick={() => setShowRejectForm(true)}
                                            className="flex-1 bg-red-600 text-white px-6 py-3 rounded-lg hover:bg-red-700 font-medium transition-colors"
                                        >
                                            ✗ Reject Withdrawal
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div>
                                    <div className="mb-4">
                                        <label className="block text-sm font-medium text-gray-300 mb-2">
                                            Rejection Reason <span className="text-red-400">*</span>
                                        </label>
                                        <textarea
                                            value={rejectionReason}
                                            onChange={(e) => setRejectionReason(e.target.value)}
                                            rows={3}
                                            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-red-500 focus:border-transparent placeholder-gray-400"
                                            placeholder="Why are you rejecting this withdrawal?"
                                            required
                                        />
                                    </div>

                                    <div className="mb-4">
                                        <label className="block text-sm font-medium text-gray-300 mb-2">
                                            Additional Notes (Optional)
                                        </label>
                                        <textarea
                                            value={adminNotes}
                                            onChange={(e) => setAdminNotes(e.target.value)}
                                            rows={2}
                                            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-gray-400"
                                            placeholder="Any additional notes..."
                                        />
                                    </div>

                                    <div className="flex gap-3">
                                        <button
                                            onClick={() => {
                                                setShowRejectForm(false);
                                                setRejectionReason('');
                                            }}
                                            className="flex-1 bg-gray-700 text-gray-300 px-6 py-3 rounded-lg hover:bg-gray-600 font-medium transition-colors"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={handleReject}
                                            disabled={isRejecting || !rejectionReason.trim()}
                                            className="flex-1 bg-red-600 text-white px-6 py-3 rounded-lg hover:bg-red-700 disabled:bg-gray-600 disabled:cursor-not-allowed font-medium transition-colors"
                                        >
                                            {isRejecting ? 'Rejecting...' : 'Confirm Rejection'}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default WithdrawalDetailsModal;
