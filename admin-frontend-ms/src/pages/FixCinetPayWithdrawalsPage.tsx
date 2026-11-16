import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Search, RefreshCw, Wrench } from 'lucide-react';
import Header from '../components/common/Header';
import Loader from '../components/common/loader';
import {
    WithdrawalTransaction,
    formatCurrency,
    formatDate,
    getStuckCinetPayWithdrawals,
    reconcileCinetPayWithdrawal,
} from '../services/adminWithdrawalApi';
import ToastContainer from '../components/common/ToastContainer';
import { useToast } from '../hooks/useToast';
import Pagination from '../components/common/Pagination';
import { HugeiconsIcon } from '@hugeicons/react';
import { Search01Icon } from '@hugeicons/core-free-icons';

/**
 * Dedicated page for reconciling CinetPay withdrawals stuck in PROCESSING.
 * Different from the MoneyFusion equivalent: instead of asking admin to verify
 * on the provider dashboard, we call CinetPay's own status API when the button
 * is clicked. Their docs explicitly recommend polling as the fallback when
 * their notification webhook doesn't arrive.
 *
 * Per-row action: "Verify & Apply" — deterministic outcome:
 *   - CinetPay says completed → wallet debited, status → COMPLETED
 *   - CinetPay says failed    → status → FAILED, no wallet movement
 *   - CinetPay says pending   → nothing changed, admin reminded to wait
 */
const PAGE_SIZE = 20;

interface FixCinetPayWithdrawalsPageProps {
    embedded?: boolean;
}

const FixCinetPayWithdrawalsPage: React.FC<FixCinetPayWithdrawalsPageProps> = ({ embedded = false }) => {
    const { toasts, removeToast, showSuccess, showError, showInfo } = useToast();

    const [withdrawals, setWithdrawals] = useState<WithdrawalTransaction[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalCount, setTotalCount] = useState(0);
    // What's typed, and what's searched: the second follows the first after a pause.
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [actingOn, setActingOn] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        try {
            setError(null);
            setLoading(true);
            const res = await getStuckCinetPayWithdrawals(page, PAGE_SIZE, search.trim() || undefined);
            setWithdrawals(res.data.withdrawals);
            setTotalPages(res.data.pagination.totalPages);
            setTotalCount(res.data.pagination.total);
        } catch (err: any) {
            setError(err.message || 'Impossible de charger les retraits CinetPay bloqués');
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

    const handleVerifyAndApply = async (tx: WithdrawalTransaction) => {
        setActingOn(tx.transactionId);
        try {
            const res = await reconcileCinetPayWithdrawal(tx.transactionId);
            if (res.action === 'completed') {
                showSuccess(`CinetPay confirme le paiement : ${formatCurrency(tx.amount, tx.currency)} débité du portefeuille du membre.`);
            } else if (res.action === 'failed') {
                showSuccess(`CinetPay confirme l'échec : retrait marqué en échec, portefeuille inchangé.`);
            } else if (res.action === 'still-pending') {
                showInfo(`Toujours « ${res.cinetpayStatus} » chez CinetPay. Rien n'a changé, réessayez plus tard.`);
            } else {
                showInfo(res.message || `Action : ${res.action}`);
            }
            await fetchData();
        } catch (e: any) {
            showError(e.message || 'La vérification a échoué');
        } finally {
            setActingOn(null);
        }
    };

    return (
        <div>
            {!embedded && <Header title="Retraits CinetPay bloqués" />}
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
                            <p>Aucun retrait CinetPay bloqué pour le moment.</p>
                            <p className="text-xs mt-2">Les retraits validés et envoyés à CinetPay apparaissent ici si CinetPay n'a jamais répondu.</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-surface-2 text-fg-muted">
                                <tr>
                                    <th className="px-4 py-3 text-left">Membre</th>
                                    <th className="px-4 py-3 text-left">Montant</th>
                                    <th className="px-4 py-3 text-left">Pays</th>
                                    <th className="px-4 py-3 text-left">MoMo du bénéficiaire</th>
                                    <th className="px-4 py-3 text-left">Demandé le</th>
                                    <th className="px-4 py-3 text-left">CinetPay tokenPay</th>
                                    <th className="px-4 py-3 text-left">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {withdrawals.map((tx) => {
                                    const meta = (tx as any).metadata;
                                    const recipientMomo = meta?.accountInfo?.fullMomoNumber || '—';
                                    const country = meta?.accountInfo?.countryCode || '—';
                                    const tokenPay = (tx as any).externalTransactionId || '—';
                                    const isActing = actingOn === tx.transactionId;
                                    return (
                                        <tr key={tx.transactionId} className="border-t border-line align-top">
                                            <td className="px-4 py-3">
                                                <div className="text-fg">{tx.userName || 'Inconnu'}</div>
                                                <div className="text-xs text-fg-muted">{tx.userEmail}</div>
                                            </td>
                                            <td className="px-4 py-3 text-fg font-mono">{formatCurrency(tx.amount, tx.currency)}</td>
                                            <td className="px-4 py-3 text-fg-muted">{country}</td>
                                            <td className="px-4 py-3 font-mono text-fg">{recipientMomo}</td>
                                            <td className="px-4 py-3 text-fg-muted">{formatDate(tx.createdAt)}</td>
                                            <td className="px-4 py-3 font-mono text-xs text-fg-muted break-all">{tokenPay}</td>
                                            <td className="px-4 py-3">
                                                <button
                                                    onClick={() => handleVerifyAndApply(tx)}
                                                    disabled={isActing}
                                                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-600 text-white rounded-sm hover:bg-blue-700 disabled:bg-gray-400 dark:disabled:bg-gray-600 disabled:cursor-not-allowed whitespace-nowrap"
                                                >
                                                    {isActing ? 'Vérification…' : <><HugeiconsIcon icon={Search01Icon} size={14} />Vérifier et appliquer</>}
                                                </button>
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
            <ToastContainer toasts={toasts} onRemove={removeToast} />
        </div>
    );
};

export default FixCinetPayWithdrawalsPage;
