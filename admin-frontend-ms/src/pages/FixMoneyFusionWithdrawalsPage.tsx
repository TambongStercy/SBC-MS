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
    const [search, setSearch] = useState('');
    const [debounceTimeout, setDebounceTimeout] = useState<NodeJS.Timeout | null>(null);

    // Per-row state — which transaction is currently being acted on + the
    // expanded reason input for failure.
    const [actingOn, setActingOn] = useState<string | null>(null);
    const [failReasonByTx, setFailReasonByTx] = useState<Record<string, string>>({});
    const [showFailFormFor, setShowFailFormFor] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        try {
            setError(null);
            setLoading(true);
            const res = await getStuckMoneyFusionWithdrawals(page, PAGE_SIZE, search.trim() || undefined);
            setWithdrawals(res.data.withdrawals);
            setTotalPages(res.data.pagination.totalPages);
            setTotalCount(res.data.pagination.total);
        } catch (err: any) {
            setError(err.message || 'Failed to fetch stuck withdrawals');
        } finally {
            setLoading(false);
        }
    }, [page, search]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const v = e.target.value;
        setSearch(v);
        setPage(1);
        if (debounceTimeout) clearTimeout(debounceTimeout);
        const t = setTimeout(() => { /* fetchData fires via dep change */ }, 400);
        setDebounceTimeout(t);
    };

    const handleMarkCompleted = async (tx: WithdrawalTransaction) => {
        setActingOn(tx.transactionId);
        try {
            await manualCompleteWithdrawal(tx.transactionId, {});
            showSuccess(`Withdrawal ${tx.transactionId} marked completed; ${formatCurrency(tx.amount, tx.currency)} debited from user wallet.`);
            await fetchData();
        } catch (e: any) {
            showError(e.message || 'Failed to mark completed');
        } finally {
            setActingOn(null);
        }
    };

    const handleMarkFailed = async (tx: WithdrawalTransaction) => {
        const reason = (failReasonByTx[tx.transactionId] || '').trim();
        if (!reason) {
            showError('Failure reason is required');
            return;
        }
        setActingOn(tx.transactionId);
        try {
            await manualFailWithdrawal(tx.transactionId, { reason });
            showSuccess(`Withdrawal ${tx.transactionId} marked failed.`);
            setShowFailFormFor(null);
            setFailReasonByTx((m) => ({ ...m, [tx.transactionId]: '' }));
            await fetchData();
        } catch (e: any) {
            showError(e.message || 'Failed to mark failed');
        } finally {
            setActingOn(null);
        }
    };

    return (
        <div className="flex-1 overflow-auto relative z-10">
            {!embedded && <Header title="Fix MoneyFusion Withdrawals" />}
            <main className="max-w-7xl mx-auto py-6 px-4 lg:px-8">
                <motion.div
                    className="bg-gray-800 bg-opacity-50 backdrop-blur-md shadow-lg rounded-xl p-6 border border-gray-700 mb-6"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                >
                    <div className="flex items-center gap-3 mb-4">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                            <input
                                type="text"
                                value={search}
                                onChange={handleSearchChange}
                                placeholder="Search by name / email / phone / transactionId / recipient momo"
                                className="w-full pl-10 pr-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                        </div>
                        <button
                            onClick={fetchData}
                            className="flex items-center gap-2 px-4 py-2 bg-gray-700 text-gray-200 rounded-lg hover:bg-gray-600"
                        >
                            <RefreshCw className="w-4 h-4" />
                            Refresh
                        </button>
                    </div>

                    <div className="text-sm text-gray-400 mb-2">
                        {loading ? 'Loading…' : `${totalCount} stuck withdrawal${totalCount === 1 ? '' : 's'}${search.trim() ? ` matching "${search.trim()}"` : ''}`}
                    </div>

                    {error && (
                        <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 text-red-200 mb-4">{error}</div>
                    )}
                </motion.div>

                <motion.div
                    className="bg-gray-800 bg-opacity-50 backdrop-blur-md shadow-lg rounded-xl border border-gray-700 overflow-hidden"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                >
                    {loading ? (
                        <div className="p-12 flex justify-center"><Loader name="Loading stuck withdrawals…" /></div>
                    ) : withdrawals.length === 0 ? (
                        <div className="p-12 text-center text-gray-400">
                            <Wrench className="w-12 h-12 mx-auto mb-3 text-gray-600" />
                            <p>No stuck MoneyFusion withdrawals right now.</p>
                            <p className="text-xs mt-2">Approved-and-routed MF withdrawals will appear here until you mark them completed or failed.</p>
                        </div>
                    ) : (
                        <table className="w-full text-sm">
                            <thead className="bg-gray-900/50 text-gray-300">
                                <tr>
                                    <th className="px-4 py-3 text-left">User</th>
                                    <th className="px-4 py-3 text-left">Amount (gross)</th>
                                    <th className="px-4 py-3 text-left">Recipient MoMo</th>
                                    <th className="px-4 py-3 text-left">Requested</th>
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
                                        <tr key={tx.transactionId} className="border-t border-gray-700 align-top">
                                            <td className="px-4 py-3">
                                                <div className="text-white">{tx.userName || 'Unknown'}</div>
                                                <div className="text-xs text-gray-400">{tx.userEmail}</div>
                                            </td>
                                            <td className="px-4 py-3 text-white font-mono">{formatCurrency(tx.amount, tx.currency)}</td>
                                            <td className="px-4 py-3 font-mono text-gray-200">{recipientMomo}</td>
                                            <td className="px-4 py-3 text-gray-300">{formatDate(tx.createdAt)}</td>
                                            <td className="px-4 py-3 font-mono text-xs text-gray-400 break-all">{mfToken}</td>
                                            <td className="px-4 py-3">
                                                {!showingFail ? (
                                                    <div className="flex gap-2">
                                                        <button
                                                            onClick={() => handleMarkCompleted(tx)}
                                                            disabled={isActing}
                                                            className="px-3 py-1.5 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed whitespace-nowrap"
                                                        >
                                                            {isActing ? 'Working…' : '✓ Mark Completed'}
                                                        </button>
                                                        <button
                                                            onClick={() => setShowFailFormFor(tx.transactionId)}
                                                            disabled={isActing}
                                                            className="px-3 py-1.5 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:bg-gray-600 disabled:cursor-not-allowed whitespace-nowrap"
                                                        >
                                                            ✗ Mark Failed
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div className="flex flex-col gap-2">
                                                        <input
                                                            type="text"
                                                            value={failReasonByTx[tx.transactionId] || ''}
                                                            onChange={(e) => setFailReasonByTx((m) => ({ ...m, [tx.transactionId]: e.target.value }))}
                                                            placeholder="Reason (required)"
                                                            className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-xs text-white placeholder-gray-400"
                                                        />
                                                        <div className="flex gap-2">
                                                            <button
                                                                onClick={() => {
                                                                    setShowFailFormFor(null);
                                                                    setFailReasonByTx((m) => ({ ...m, [tx.transactionId]: '' }));
                                                                }}
                                                                className="px-3 py-1 text-xs bg-gray-700 text-gray-300 rounded hover:bg-gray-600"
                                                            >
                                                                Cancel
                                                            </button>
                                                            <button
                                                                onClick={() => handleMarkFailed(tx)}
                                                                disabled={isActing || !(failReasonByTx[tx.transactionId] || '').trim()}
                                                                className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:bg-gray-600 disabled:cursor-not-allowed"
                                                            >
                                                                {isActing ? 'Working…' : 'Confirm Fail'}
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
                    )}

                    {totalPages > 1 && (
                        <div className="p-4 border-t border-gray-700">
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

export default FixMoneyFusionWithdrawalsPage;
