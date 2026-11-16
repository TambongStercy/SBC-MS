import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Search, RefreshCw, Wrench } from 'lucide-react';
import Header from '../components/common/Header';
import Loader from '../components/common/loader';
import {
    WithdrawalTransaction,
    formatCurrency,
    formatDate,
    getStuckMoneyFusionWithdrawals,
    manualCompleteWithdrawal,
    manualFailWithdrawal,
} from '../services/adminWithdrawalApi';
import ToastContainer from '../components/common/ToastContainer';
import { useToast } from '../hooks/useToast';
import Pagination from '../components/common/Pagination';
import ConfirmationModal from '../components/common/ConfirmationModal';
import { HugeiconsIcon } from '@hugeicons/react';
import { Tick02Icon, Cancel01Icon } from '@hugeicons/core-free-icons';

/**
 * Dedicated page for reconciling MoneyFusion withdrawals stuck in PROCESSING.
 * Rationale: MF doesn't deliver payout webhooks, so admin has to confirm
 * out-of-band (MF dashboard / recipient confirmation) and click here to either
 * mark completed (debits wallet) or mark failed (no wallet movement).
 *
 * Mirrors the shape of FixFeexpayPaymentsPage but for withdrawals instead of
 * payins. Each row exposes the recipient phone + amount the admin needs to
 * verify against the MF dashboard before deciding.
 */
const PAGE_SIZE = 20;

interface FixMoneyFusionWithdrawalsPageProps {
    embedded?: boolean;
}

const FixMoneyFusionWithdrawalsPage: React.FC<FixMoneyFusionWithdrawalsPageProps> = ({ embedded = false }) => {
    const { toasts, removeToast, showSuccess, showError } = useToast();

    const [withdrawals, setWithdrawals] = useState<WithdrawalTransaction[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalCount, setTotalCount] = useState(0);
    // What's typed, and what's searched: the second follows the first after a pause.
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');

    // Per-row state — which transaction is currently being acted on + the
    // expanded reason input for failure.
    const [actingOn, setActingOn] = useState<string | null>(null);
    const [failReasonByTx, setFailReasonByTx] = useState<Record<string, string>>({});
    const [showFailFormFor, setShowFailFormFor] = useState<string | null>(null);
    const [confirmComplete, setConfirmComplete] = useState<WithdrawalTransaction | null>(null);

    const fetchData = useCallback(async () => {
        try {
            setError(null);
            setLoading(true);
            const res = await getStuckMoneyFusionWithdrawals(page, PAGE_SIZE, search.trim() || undefined);
            setWithdrawals(res.data.withdrawals);
            setTotalPages(res.data.pagination.totalPages);
            setTotalCount(res.data.pagination.total);
        } catch (err: any) {
            setError(err.message || 'Impossible de charger les retraits bloqués');
        } finally {
            setLoading(false);
        }
    }, [page, search]);

    useEffect(() => { fetchData(); }, [fetchData]);

    useEffect(() => {
        const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 400);
        return () => clearTimeout(t);
    }, [searchInput]);

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => setSearchInput(e.target.value);

    const handleMarkCompleted = async (tx: WithdrawalTransaction) => {
        setActingOn(tx.transactionId);
        try {
            await manualCompleteWithdrawal(tx.transactionId, {});
            showSuccess(`Retrait ${tx.transactionId} marqué payé ; ${formatCurrency(tx.amount, tx.currency)} débité du portefeuille du membre.`);
            await fetchData();
        } catch (e: any) {
            showError(e.message || 'Impossible de marquer le retrait comme payé');
        } finally {
            setActingOn(null);
        }
    };

    const handleMarkFailed = async (tx: WithdrawalTransaction) => {
        const reason = (failReasonByTx[tx.transactionId] || '').trim();
        if (!reason) {
            showError("Le motif de l'échec est obligatoire");
            return;
        }
        setActingOn(tx.transactionId);
        try {
            await manualFailWithdrawal(tx.transactionId, { reason });
            showSuccess(`Retrait ${tx.transactionId} marqué en échec.`);
            setShowFailFormFor(null);
            setFailReasonByTx((m) => ({ ...m, [tx.transactionId]: '' }));
            await fetchData();
        } catch (e: any) {
            showError(e.message || "Impossible de marquer le retrait en échec");
        } finally {
            setActingOn(null);
        }
    };

    return (
        <div>
            {!embedded && <Header title="Retraits MoneyFusion bloqués" />}
            <main>
                <motion.div
                    className="bg-surface rounded-xl p-6 border border-line mb-6"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                >
                    <div className="flex flex-wrap items-center gap-3 mb-4">
                        <div className="relative flex-1 min-w-[12rem]">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted w-4 h-4" />
                            <input
                                type="text"
                                value={searchInput}
                                onChange={handleSearchChange}
                                placeholder="Rechercher par nom, e-mail, téléphone, ID transaction ou numéro MoMo"
                                className="w-full pl-10 pr-4 py-2 bg-surface border border-line-strong rounded-lg text-fg placeholder-fg-subtle focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                        </div>
                        <button
                            onClick={fetchData}
                            className="flex items-center gap-2 px-4 py-2 bg-surface-2 text-fg rounded-lg hover:bg-surface-3"
                        >
                            <RefreshCw className="w-4 h-4" />
                            Actualiser
                        </button>
                    </div>

                    <div className="text-sm text-fg-muted mb-2">
                        {loading ? 'Chargement…' : `${totalCount} retrait${totalCount > 1 ? 's' : ''} bloqué${totalCount > 1 ? 's' : ''}${search.trim() ? ` pour « ${search.trim()} »` : ''}`}
                    </div>

                    {error && (
                        <div className="bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded-lg p-3 text-red-800 dark:text-red-200 mb-4">{error}</div>
                    )}
                </motion.div>

                <motion.div
                    className="bg-surface rounded-xl border border-line overflow-hidden"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                >
                    {loading ? (
                        <div className="p-12 flex justify-center"><Loader name="Chargement des retraits bloqués…" /></div>
                    ) : withdrawals.length === 0 ? (
                        <div className="p-12 text-center text-fg-muted">
                            <Wrench className="w-12 h-12 mx-auto mb-3 text-fg-subtle" />
                            <p>Aucun retrait MoneyFusion bloqué pour le moment.</p>
                            <p className="text-xs mt-2">Les retraits validés et envoyés à MoneyFusion apparaissent ici jusqu'à ce que vous les marquiez payés ou en échec.</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-surface-2 text-fg-muted">
                                <tr>
                                    <th className="px-4 py-3 text-left">Membre</th>
                                    <th className="px-4 py-3 text-left">Montant (brut)</th>
                                    <th className="px-4 py-3 text-left">MoMo du bénéficiaire</th>
                                    <th className="px-4 py-3 text-left">Demandé le</th>
                                    <th className="px-4 py-3 text-left">MF tokenPay</th>
                                    <th className="px-4 py-3 text-left">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {withdrawals.map((tx) => {
                                    const recipientMomo = (tx as any).metadata?.accountInfo?.fullMomoNumber || '—';
                                    const tokenPay = tx as any;
                                    const mfToken = tokenPay.externalTransactionId || tokenPay.metadata?.moneyFusionTokenPay || '—';
                                    const isActing = actingOn === tx.transactionId;
                                    const showingFail = showFailFormFor === tx.transactionId;
                                    return (
                                        <tr key={tx.transactionId} className="border-t border-line align-top">
                                            <td className="px-4 py-3">
                                                <div className="text-fg">{tx.userName || 'Inconnu'}</div>
                                                <div className="text-xs text-fg-muted">{tx.userEmail}</div>
                                            </td>
                                            <td className="px-4 py-3 text-fg font-mono">{formatCurrency(tx.amount, tx.currency)}</td>
                                            <td className="px-4 py-3 font-mono text-fg">{recipientMomo}</td>
                                            <td className="px-4 py-3 text-fg-muted">{formatDate(tx.createdAt)}</td>
                                            <td className="px-4 py-3 font-mono text-xs text-fg-muted break-all">{mfToken}</td>
                                            <td className="px-4 py-3">
                                                {!showingFail ? (
                                                    <div className="flex gap-2">
                                                        <button
                                                            onClick={() => setConfirmComplete(tx)}
                                                            disabled={isActing}
                                                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-green-600 text-white rounded-sm hover:bg-green-700 disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed whitespace-nowrap"
                                                        >
                                                            {isActing ? 'En cours…' : <><HugeiconsIcon icon={Tick02Icon} size={14} />Marquer payé</>}
                                                        </button>
                                                        <button
                                                            onClick={() => setShowFailFormFor(tx.transactionId)}
                                                            disabled={isActing}
                                                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-red-600 text-white rounded-sm hover:bg-red-700 disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed whitespace-nowrap"
                                                        >
                                                            <HugeiconsIcon icon={Cancel01Icon} size={14} />
                                                            Marquer en échec
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div className="flex flex-col gap-2">
                                                        <input
                                                            type="text"
                                                            value={failReasonByTx[tx.transactionId] || ''}
                                                            onChange={(e) => setFailReasonByTx((m) => ({ ...m, [tx.transactionId]: e.target.value }))}
                                                            placeholder="Motif (obligatoire)"
                                                            className="px-2 py-1 bg-surface border border-line-strong rounded-sm text-xs text-fg placeholder-fg-subtle"
                                                        />
                                                        <div className="flex gap-2">
                                                            <button
                                                                onClick={() => {
                                                                    setShowFailFormFor(null);
                                                                    setFailReasonByTx((m) => ({ ...m, [tx.transactionId]: '' }));
                                                                }}
                                                                className="px-3 py-1 text-xs bg-surface-2 text-fg-muted rounded-sm hover:bg-surface-3"
                                                            >
                                                                Annuler
                                                            </button>
                                                            <button
                                                                onClick={() => handleMarkFailed(tx)}
                                                                disabled={isActing || !(failReasonByTx[tx.transactionId] || '').trim()}
                                                                className="px-3 py-1 text-xs bg-red-600 text-white rounded-sm hover:bg-red-700 disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed"
                                                            >
                                                                {isActing ? 'En cours…' : "Confirmer l'échec"}
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        </div>
                    )}

                    {totalPages > 1 && (
                        <div className="p-4 border-t border-line">
                            <Pagination
                                currentPage={page}
                                totalPages={totalPages}
                                onPageChange={setPage}
                            />
                        </div>
                    )}
                </motion.div>
            </main>
            {/* Marking completed debits the member's wallet: only once MoneyFusion shows the payout. */}
            <ConfirmationModal
                isOpen={!!confirmComplete}
                variant="success"
                title="Marquer ce retrait comme payé ?"
                message={confirmComplete && (
                    <div className="space-y-1 text-sm">
                        <p><span className="text-fg-muted">Vers :</span> {confirmComplete.metadata?.accountInfo?.fullMomoNumber || '—'}</p>
                        <p><span className="text-fg-muted">Montant :</span> {formatCurrency(confirmComplete.amount, confirmComplete.currency)}</p>
                        <p className="pt-2 text-fg-muted">Vérifie d'abord qu'il apparaît « Validé » sur le tableau de bord MoneyFusion. Le portefeuille du membre sera débité.</p>
                    </div>
                )}
                confirmText="Oui, il est payé"
                onConfirm={async () => { if (confirmComplete) await handleMarkCompleted(confirmComplete); setConfirmComplete(null); }}
                onCancel={() => setConfirmComplete(null)}
            />
            <ToastContainer toasts={toasts} onRemove={removeToast} />
        </div>
    );
};

export default FixMoneyFusionWithdrawalsPage;
