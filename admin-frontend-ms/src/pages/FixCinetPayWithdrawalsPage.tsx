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

const FixCinetPayWithdrawalsPage: React.FC = () => {
    const { toasts, removeToast, showSuccess, showError, showInfo } = useToast();

    const [withdrawals, setWithdrawals] = useState<WithdrawalTransaction[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalCount, setTotalCount] = useState(0);
    const [search, setSearch] = useState('');
    const [debounceTimeout, setDebounceTimeout] = useState<NodeJS.Timeout | null>(null);
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
            setError(err.message || 'Failed to fetch stuck CinetPay withdrawals');
        } finally {
            setLoading(false);
        }
    }, [page, search]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearch(e.target.value);
        setPage(1);
        if (debounceTimeout) clearTimeout(debounceTimeout);
        const t = setTimeout(() => { /* fetchData fires via dep change */ }, 400);
        setDebounceTimeout(t);
    };

    const handleVerifyAndApply = async (tx: WithdrawalTransaction) => {
        setActingOn(tx.transactionId);
        try {
            const res = await reconcileCinetPayWithdrawal(tx.transactionId);
            if (res.action === 'completed') {
                showSuccess(`CinetPay confirmed completed — ${formatCurrency(tx.amount, tx.currency)} debited from user wallet.`);
            } else if (res.action === 'failed') {
                showSuccess(`CinetPay confirmed failed — withdrawal marked FAILED, no wallet movement.`);
            } else if (res.action === 'still-pending') {
                showInfo(`Still ${res.cinetpayStatus} at CinetPay. Nothing changed. Try again later.`);
            } else {
                showInfo(res.message || `Action: ${res.action}`);
            }
            await fetchData();
        } catch (e: any) {
            showError(e.message || 'Failed to reconcile');
        } finally {
            setActingOn(null);
        }
    };

    return (
        <div className="flex-1 overflow-auto relative z-10">
            <Header title="Fix CinetPay Withdrawals" />
            <main className="max-w-7xl mx-auto py-6 px-4 lg:px-8">
                <motion.div
                    className="bg-gray-800 bg-opacity-50 backdrop-blur-md shadow-lg rounded-xl p-6 border border-gray-700 mb-6"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                >
                    <div className="bg-blue-900/20 border border-blue-700 rounded-lg p-4 mb-6">
                        <p className="text-sm text-blue-200">
                            <strong>What this page is for.</strong> CinetPay doesn't reliably deliver
                            payout notification webhooks — their own docs explicitly recommend polling
                            the status API as fallback. Click <em>Verify &amp; Apply</em> on any row:
                            we call CinetPay's status API and act on the answer:
                            <br />
                            &nbsp;&nbsp;• If CinetPay says <em>completed</em> → we mark the withdrawal COMPLETED and debit the user wallet
                            <br />
                            &nbsp;&nbsp;• If CinetPay says <em>failed</em> → we mark the withdrawal FAILED (no wallet movement — the user can retry)
                            <br />
                            &nbsp;&nbsp;• If CinetPay says <em>pending</em> → nothing changes; try again later
                            <br />
                            No manual dashboard verification needed — the CinetPay status API is authoritative.
                        </p>
                    </div>

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
                            <p>No stuck CinetPay withdrawals right now.</p>
                            <p className="text-xs mt-2">Approved-and-routed CinetPay withdrawals will appear here if CinetPay never called back.</p>
                        </div>
                    ) : (
                        <table className="w-full text-sm">
                            <thead className="bg-gray-900/50 text-gray-300">
                                <tr>
                                    <th className="px-4 py-3 text-left">User</th>
                                    <th className="px-4 py-3 text-left">Amount</th>
                                    <th className="px-4 py-3 text-left">Country</th>
                                    <th className="px-4 py-3 text-left">Recipient MoMo</th>
                                    <th className="px-4 py-3 text-left">Requested</th>
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
                                        <tr key={tx.transactionId} className="border-t border-gray-700 align-top">
                                            <td className="px-4 py-3">
                                                <div className="text-white">{tx.userName || 'Unknown'}</div>
                                                <div className="text-xs text-gray-400">{tx.userEmail}</div>
                                            </td>
                                            <td className="px-4 py-3 text-white font-mono">{formatCurrency(tx.amount, tx.currency)}</td>
                                            <td className="px-4 py-3 text-gray-300">{country}</td>
                                            <td className="px-4 py-3 font-mono text-gray-200">{recipientMomo}</td>
                                            <td className="px-4 py-3 text-gray-300">{formatDate(tx.createdAt)}</td>
                                            <td className="px-4 py-3 font-mono text-xs text-gray-400 break-all">{tokenPay}</td>
                                            <td className="px-4 py-3">
                                                <button
                                                    onClick={() => handleVerifyAndApply(tx)}
                                                    disabled={isActing}
                                                    className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed whitespace-nowrap"
                                                >
                                                    {isActing ? 'Verifying…' : '🔍 Verify & Apply'}
                                                </button>
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

export default FixCinetPayWithdrawalsPage;
