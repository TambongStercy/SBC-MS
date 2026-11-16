import React, { useState } from 'react';
import ConfirmationModal from '../common/ConfirmationModal';
import {
    WithdrawalTransaction,
    formatCurrency,
    formatDate,
    approveWithdrawal,
    rejectWithdrawal
} from '../../services/adminWithdrawalApi';
import { withdrawalStatusLabel, withdrawalStatusColor } from './withdrawalStatus';
import { HugeiconsIcon } from '@hugeicons/react';
import { Wallet01Icon, Tick02Icon, Cancel01Icon } from '@hugeicons/core-free-icons';

interface WithdrawalDetailsModalProps {
    withdrawal: WithdrawalTransaction | null;
    isOpen: boolean;
    onClose: () => void;
    onApproved?: () => void;
    onRejected?: () => void;
    showSuccess?: (message: string) => void;
    showError?: (message: string) => void;
}

const WithdrawalDetailsModal: React.FC<WithdrawalDetailsModalProps> = ({
    withdrawal,
    isOpen,
    onClose,
    onApproved,
    onRejected,
    showSuccess,
    showError
}) => {
    const [isApproving, setIsApproving] = useState(false);
    const [confirmApprove, setConfirmApprove] = useState(false);
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

            if (showSuccess) {
                showSuccess('Retrait validé');
            }
            if (onApproved) onApproved();
            onClose();
        } catch (err: any) {
            const errorMsg = err.message || 'Impossible de valider le retrait';
            setError(errorMsg);
            if (showError) {
                showError(errorMsg);
            }
        } finally {
            setIsApproving(false);
        }
    };

    const handleReject = async () => {
        if (!withdrawal || !rejectionReason.trim()) {
            const errorMsg = 'Le motif du rejet est obligatoire';
            setError(errorMsg);
            if (showError) {
                showError(errorMsg);
            }
            return;
        }

        setError(null);
        setIsRejecting(true);

        try {
            await rejectWithdrawal(withdrawal.transactionId, {
                rejectionReason,
                adminNotes: adminNotes || undefined
            });

            if (showSuccess) {
                showSuccess('Retrait rejeté');
            }
            if (onRejected) onRejected();
            onClose();
        } catch (err: any) {
            const errorMsg = err.message || 'Impossible de rejeter le retrait';
            setError(errorMsg);
            if (showError) {
                showError(errorMsg);
            }
        } finally {
            setIsRejecting(false);
        }
    };

    const isPendingApproval = withdrawal.status === 'pending_admin_approval';
    const isRejected = withdrawal.status === 'rejected_by_admin';
    const isMobileMoneyWithdrawal = withdrawal.metadata?.withdrawalType === 'mobile_money';

    return (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
            <div className="bg-surface rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto border border-line">
                {/* Header */}
                <div className="sticky top-0 bg-surface border-b border-line px-6 py-4 flex justify-between items-center">
                    <h2 className="text-2xl font-bold text-fg">
                        Détail du retrait
                    </h2>
                    <button
                        onClick={onClose}
                        className="text-fg-muted hover:text-fg transition-colors"
                        aria-label="Fermer"
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
                        <div className="bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-700 rounded-lg p-4">
                            <p className="text-red-800 dark:text-red-200 text-sm">{error}</p>
                        </div>
                    )}

                    {/* Status Badge */}
                    <div className="flex items-center justify-between">
                        <div>
                            <span className={`px-3 py-1 rounded-full text-sm font-medium ${withdrawalStatusColor(withdrawal.status)}`}>
                                {withdrawalStatusLabel(withdrawal.status)}
                            </span>
                        </div>
                        <div className="text-sm text-fg-muted">
                            {formatDate(withdrawal.createdAt)}
                        </div>
                    </div>

                    {/* Transaction Info */}
                    <div className="grid grid-cols-2 gap-4 bg-surface-2 p-4 rounded-lg border border-line-strong">
                        <div>
                            <p className="text-sm text-fg-muted">ID transaction</p>
                            <p className="font-mono text-sm font-medium text-fg">{withdrawal.transactionId}</p>
                        </div>
                        <div>
                            <p className="text-sm text-fg-muted">Type</p>
                            <p className="font-medium capitalize text-fg">
                                {withdrawal.metadata?.withdrawalType === 'crypto' ? 'Crypto' : 'Mobile Money'}
                            </p>
                        </div>
                    </div>

                    {/* Amount Info */}
                    <div className="bg-blue-100 dark:bg-blue-900/30 border border-blue-300 dark:border-blue-700 rounded-lg p-4">
                        <div className="grid grid-cols-3 gap-4">
                            <div>
                                <p className="text-sm text-fg-muted">Montant</p>
                                <p className="text-lg font-bold text-blue-600 dark:text-blue-400">
                                    {formatCurrency(withdrawal.amount - withdrawal.fee, withdrawal.currency)}
                                </p>
                            </div>
                            <div>
                                <p className="text-sm text-fg-muted">Frais</p>
                                <p className="text-lg font-semibold text-fg-muted">
                                    {formatCurrency(withdrawal.fee, withdrawal.currency)}
                                </p>
                            </div>
                            <div>
                                <p className="text-sm text-fg-muted">Total débité</p>
                                <p className="text-lg font-bold text-red-600 dark:text-red-400">
                                    {formatCurrency(withdrawal.amount, withdrawal.currency)}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* User Info */}
                    <div>
                        <h3 className="text-lg font-semibold mb-3 text-fg">Membre</h3>
                        <div className="grid grid-cols-2 gap-4 bg-surface-2 p-4 rounded-lg border border-line-strong">
                            <div>
                                <p className="text-sm text-fg-muted">Nom</p>
                                <p className="font-medium text-fg">{withdrawal.userName || '—'}</p>
                            </div>
                            <div>
                                <p className="text-sm text-fg-muted">E-mail</p>
                                <p className="font-medium text-fg">{withdrawal.userEmail || '—'}</p>
                            </div>
                            <div>
                                <p className="text-sm text-fg-muted">Téléphone</p>
                                <p className="font-medium text-fg">{withdrawal.userPhoneNumber || '—'}</p>
                            </div>
                            <div>
                                <p className="text-sm text-fg-muted">ID membre</p>
                                <p className="font-mono text-xs text-fg-muted">{withdrawal.userId}</p>
                            </div>
                        </div>
                    </div>

                    {/* User Balance */}
                    <div>
                        <h3 className="text-lg font-semibold mb-3 text-fg inline-flex items-center gap-2"><HugeiconsIcon icon={Wallet01Icon} size={20} className="text-green-600 dark:text-green-400" />Solde actuel du membre</h3>
                        <div className="bg-green-100 dark:bg-green-900/30 border border-green-300 dark:border-green-700 rounded-lg p-4">
                            {withdrawal.userBalance !== undefined && withdrawal.userBalance !== null ? (
                                typeof withdrawal.userBalance === 'number' ? (
                                    // Handle number format (single balance in withdrawal currency)
                                    <div>
                                        <p className="text-sm text-fg-muted">{withdrawal.currency}</p>
                                        <p className="text-lg font-bold text-green-600 dark:text-green-400">
                                            {formatCurrency(withdrawal.userBalance, withdrawal.currency)}
                                        </p>
                                    </div>
                                ) : Object.keys(withdrawal.userBalance).length > 0 ? (
                                    // Handle object format (multiple currencies)
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                        {Object.entries(withdrawal.userBalance).map(([currency, amount]) => (
                                            <div key={currency}>
                                                <p className="text-sm text-fg-muted">{currency}</p>
                                                <p className="text-lg font-bold text-green-600 dark:text-green-400">
                                                    {formatCurrency(amount as number, currency as any)}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-fg-muted text-sm">Solde non disponible</p>
                                )
                            ) : (
                                <p className="text-fg-muted text-sm">Solde non disponible</p>
                            )}
                        </div>
                    </div>

                    {/* Referral Statistics */}
                    {withdrawal.referralStats && (
                        <div>
                            <h3 className="text-lg font-semibold mb-3 text-fg">Filleuls</h3>
                            <div className="bg-purple-100 dark:bg-purple-900/30 border border-purple-300 dark:border-purple-700 rounded-lg p-4">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div>
                                        <p className="text-sm text-fg-muted">Filleuls directs</p>
                                        <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                                            {withdrawal.referralStats.directReferrals}
                                        </p>
                                        <p className="text-xs text-fg-muted mt-1">
                                            {withdrawal.referralStats.directSubscribedReferrals} avec abonnement actif
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-fg-muted">Filleuls indirects</p>
                                        <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                                            {withdrawal.referralStats.indirectReferrals}
                                        </p>
                                        <p className="text-xs text-fg-muted mt-1">
                                            {withdrawal.referralStats.indirectSubscribedReferrals} avec abonnement actif
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-sm text-fg-muted">Filleuls abonnés (total)</p>
                                        <p className="text-2xl font-bold text-purple-600 dark:text-purple-300">
                                            {withdrawal.referralStats.totalSubscribedReferrals}
                                        </p>
                                        <p className="text-xs text-fg-muted mt-1">
                                            sur {withdrawal.referralStats.totalReferrals} au total
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Withdrawal History */}
                    {withdrawal.withdrawalHistory && withdrawal.withdrawalHistory.length > 0 && (
                        <div>
                            <h3 className="text-lg font-semibold mb-3 text-fg">Retraits récents</h3>
                            <div className="bg-surface-2 border border-line-strong rounded-lg overflow-hidden">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead className="bg-surface-3">
                                            <tr>
                                                <th className="px-4 py-2 text-left text-fg-muted font-medium">ID transaction</th>
                                                <th className="px-4 py-2 text-left text-fg-muted font-medium">Montant</th>
                                                <th className="px-4 py-2 text-left text-fg-muted font-medium">Statut</th>
                                                <th className="px-4 py-2 text-left text-fg-muted font-medium">Date</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-line-strong">
                                            {withdrawal.withdrawalHistory.map((item, index) => (
                                                <tr key={index} className="hover:bg-surface-3">
                                                    <td className="px-4 py-2 font-mono text-xs text-fg-muted">{item.transactionId}</td>
                                                    <td className="px-4 py-2 font-semibold text-fg">
                                                        {formatCurrency(item.amount, (item.currency || withdrawal.currency) as any)}
                                                    </td>
                                                    <td className="px-4 py-2">
                                                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                                            item.status === 'completed' ? 'bg-success-soft text-success' :
                                                            item.status === 'rejected_by_admin' ? 'bg-danger-soft text-danger' :
                                                            'bg-surface-3 text-fg-muted'
                                                        }`}>
                                                            {withdrawalStatusLabel(item.status)}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-2 text-fg-muted">{formatDate(item.createdAt)}</td>
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
                            <h3 className="text-lg font-semibold mb-3 text-fg">Compte Mobile Money</h3>
                            <div className="grid grid-cols-2 gap-4 bg-surface-2 p-4 rounded-lg border border-line-strong">
                                <div>
                                    <p className="text-sm text-fg-muted">Numéro</p>
                                    <p className="font-mono font-medium text-fg">{withdrawal.metadata.accountInfo.fullMomoNumber}</p>
                                </div>
                                <div>
                                    <p className="text-sm text-fg-muted">Opérateur</p>
                                    <p className="font-medium text-fg">{withdrawal.metadata.accountInfo.momoOperator}</p>
                                </div>
                                <div>
                                    <p className="text-sm text-fg-muted">Pays</p>
                                    <p className="font-medium text-fg">{withdrawal.metadata.accountInfo.countryCode}</p>
                                </div>
                                {withdrawal.metadata.accountInfo.recipientName && (
                                    <div>
                                        <p className="text-sm text-fg-muted">Nom du bénéficiaire</p>
                                        <p className="font-medium text-fg">{withdrawal.metadata.accountInfo.recipientName}</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Crypto Info */}
                    {!isMobileMoneyWithdrawal && withdrawal.metadata?.cryptoAddress && (
                        <div>
                            <h3 className="text-lg font-semibold mb-3 text-fg">Compte crypto</h3>
                            <div className="bg-surface-2 p-4 rounded-lg border border-line-strong space-y-3">
                                <div>
                                    <p className="text-sm text-fg-muted">Adresse du portefeuille</p>
                                    <p className="font-mono text-xs break-all text-fg">{withdrawal.metadata.cryptoAddress}</p>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-sm text-fg-muted">Devise</p>
                                        <p className="font-medium text-fg">{withdrawal.metadata.cryptoCurrency}</p>
                                    </div>
                                    {withdrawal.metadata.usdAmount && (
                                        <div>
                                            <p className="text-sm text-fg-muted">Montant en USD</p>
                                            <p className="font-medium text-fg">${withdrawal.metadata.usdAmount}</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Rejection Info (if rejected) */}
                    {isRejected && withdrawal.rejectionReason && (
                        <div className="bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded-lg p-4">
                            <h3 className="text-lg font-semibold text-red-600 dark:text-red-400 mb-2">Rejet</h3>
                            <div className="space-y-2">
                                <div>
                                    <p className="text-sm text-red-600 dark:text-red-300">Motif</p>
                                    <p className="font-medium text-fg">{withdrawal.rejectionReason}</p>
                                </div>
                                {withdrawal.adminNotes && (
                                    <div>
                                        <p className="text-sm text-red-600 dark:text-red-300">Notes de l'admin</p>
                                        <p className="text-sm text-fg">{withdrawal.adminNotes}</p>
                                    </div>
                                )}
                                {withdrawal.rejectedAt && (
                                    <div>
                                        <p className="text-sm text-red-600 dark:text-red-300">Rejeté le</p>
                                        <p className="text-sm text-fg">{formatDate(withdrawal.rejectedAt)}</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Approval/Rejection Form */}
                    {isPendingApproval && (
                        <div className="border-t border-line pt-6">
                            <h3 className="text-lg font-semibold mb-4 text-fg">Décision</h3>

                            {!showRejectForm ? (
                                <div>
                                    <div className="mb-4">
                                        <label className="block text-sm font-medium text-fg-muted mb-2">
                                            Notes (facultatif)
                                        </label>
                                        <textarea
                                            value={adminNotes}
                                            onChange={(e) => setAdminNotes(e.target.value)}
                                            rows={3}
                                            className="w-full px-3 py-2 bg-surface border border-line-strong rounded-lg text-fg focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-fg-subtle"
                                            placeholder="Ajoutez une note sur ce retrait…"
                                        />
                                    </div>

                                    <div className="flex gap-3">
                                        <button
                                            onClick={() => setConfirmApprove(true)}
                                            disabled={isApproving}
                                            className="flex-1 inline-flex items-center justify-center gap-2 bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed font-medium transition-colors"
                                        >
                                            {isApproving ? 'Validation…' : <><HugeiconsIcon icon={Tick02Icon} size={18} />Valider le retrait</>}
                                        </button>
                                        <button
                                            onClick={() => setShowRejectForm(true)}
                                            className="flex-1 inline-flex items-center justify-center gap-2 bg-red-600 text-white px-6 py-3 rounded-lg hover:bg-red-700 font-medium transition-colors"
                                        >
                                            <HugeiconsIcon icon={Cancel01Icon} size={18} />
                                            Rejeter le retrait
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div>
                                    <div className="mb-4">
                                        <label className="block text-sm font-medium text-fg-muted mb-2">
                                            Motif du rejet <span className="text-red-600 dark:text-red-400">*</span>
                                        </label>
                                        <textarea
                                            value={rejectionReason}
                                            onChange={(e) => setRejectionReason(e.target.value)}
                                            rows={3}
                                            className="w-full px-3 py-2 bg-surface border border-line-strong rounded-lg text-fg focus:ring-2 focus:ring-red-500 focus:border-transparent placeholder-fg-subtle"
                                            placeholder="Pourquoi rejetez-vous ce retrait ?"
                                            required
                                        />
                                    </div>

                                    <div className="mb-4">
                                        <label className="block text-sm font-medium text-fg-muted mb-2">
                                            Notes complémentaires (facultatif)
                                        </label>
                                        <textarea
                                            value={adminNotes}
                                            onChange={(e) => setAdminNotes(e.target.value)}
                                            rows={2}
                                            className="w-full px-3 py-2 bg-surface border border-line-strong rounded-lg text-fg focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-fg-subtle"
                                            placeholder="Autres remarques…"
                                        />
                                    </div>

                                    <div className="flex gap-3">
                                        <button
                                            onClick={() => {
                                                setShowRejectForm(false);
                                                setRejectionReason('');
                                            }}
                                            className="flex-1 bg-surface-2 text-fg-muted px-6 py-3 rounded-lg hover:bg-surface-3 font-medium transition-colors"
                                        >
                                            Annuler
                                        </button>
                                        <button
                                            onClick={handleReject}
                                            disabled={isRejecting || !rejectionReason.trim()}
                                            className="flex-1 bg-red-600 text-white px-6 py-3 rounded-lg hover:bg-red-700 disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed font-medium transition-colors"
                                        >
                                            {isRejecting ? 'Rejet…' : 'Confirmer le rejet'}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                </div>
            </div>
            {/* Approving sends real money: say how much, to whom, before it goes. */}
            <ConfirmationModal
                isOpen={confirmApprove}
                variant="success"
                title="Valider ce retrait ?"
                message={
                    <div className="space-y-1 text-sm">
                        <p><span className="text-fg-muted">Membre :</span> {withdrawal.userName || withdrawal.userEmail || withdrawal.userId}</p>
                        <p><span className="text-fg-muted">Montant envoyé :</span> {formatCurrency(withdrawal.amount - withdrawal.fee, withdrawal.currency)}</p>
                        {withdrawal.metadata?.accountInfo?.fullMomoNumber && (
                            <p><span className="text-fg-muted">Vers :</span> {withdrawal.metadata.accountInfo.fullMomoNumber} ({withdrawal.metadata.accountInfo.momoOperator})</p>
                        )}
                        <p className="pt-2 text-fg-muted">L'argent part dès la validation.</p>
                    </div>
                }
                confirmText="Valider le retrait"
                onConfirm={async () => { await handleApprove(); setConfirmApprove(false); }}
                onCancel={() => setConfirmApprove(false)}
            />
        </div>
    );
};

export default WithdrawalDetailsModal;
