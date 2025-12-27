import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { CreditCard, DollarSign, Wallet, Edit2, Save, X, RefreshCw, TrendingUp, AlertCircle, Zap, Clock } from 'lucide-react';
import { getGatewayBalances, updateGatewayBalances, getLiveGatewayBalances, IGatewayBalances, IGatewayBalanceInput, ILiveGatewayBalances } from '../../services/adminSettingsApi';

interface GatewayBalancesCardProps {
    totalUserBalanceXAF?: number;
    totalUserBalanceUSD?: number;
    onUpdate?: () => void;
}

const GatewayBalancesCard: React.FC<GatewayBalancesCardProps> = ({
    totalUserBalanceXAF = 0,
    totalUserBalanceUSD = 0,
    onUpdate
}) => {
    const [balances, setBalances] = useState<IGatewayBalances | null>(null);
    const [liveBalances, setLiveBalances] = useState<ILiveGatewayBalances | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingLive, setIsLoadingLive] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showLiveBalances, setShowLiveBalances] = useState(true);

    // Edit form state
    const [editForm, setEditForm] = useState<IGatewayBalanceInput>({
        nowpaymentsBalanceUSD: 0,
        feexpayBalanceXAF: 0,
        cinetpayBalanceXAF: 0,
        notes: ''
    });

    const USD_TO_XAF_RATE = 600;

    const fetchBalances = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const data = await getGatewayBalances();
            setBalances(data);
            setEditForm({
                nowpaymentsBalanceUSD: data.nowpaymentsBalanceUSD,
                feexpayBalanceXAF: data.feexpayBalanceXAF,
                cinetpayBalanceXAF: data.cinetpayBalanceXAF,
                notes: data.notes || ''
            });
        } catch (err) {
            console.error('Error fetching gateway balances:', err);
            setError('Erreur lors du chargement des soldes');
        } finally {
            setIsLoading(false);
        }
    };

    const fetchLiveBalances = async () => {
        setIsLoadingLive(true);
        try {
            const data = await getLiveGatewayBalances();
            setLiveBalances(data);
        } catch (err) {
            console.error('Error fetching live gateway balances:', err);
            // Don't set error for live balances - just show manual ones
        } finally {
            setIsLoadingLive(false);
        }
    };

    useEffect(() => {
        fetchBalances();
        fetchLiveBalances();
    }, []);

    const handleSave = async () => {
        setIsSaving(true);
        setError(null);
        try {
            const updated = await updateGatewayBalances(editForm);
            setBalances(updated);
            setIsEditing(false);
            onUpdate?.();
        } catch (err) {
            console.error('Error updating gateway balances:', err);
            setError('Erreur lors de la mise à jour');
        } finally {
            setIsSaving(false);
        }
    };

    const handleCancel = () => {
        setIsEditing(false);
        if (balances) {
            setEditForm({
                nowpaymentsBalanceUSD: balances.nowpaymentsBalanceUSD,
                feexpayBalanceXAF: balances.feexpayBalanceXAF,
                cinetpayBalanceXAF: balances.cinetpayBalanceXAF,
                notes: balances.notes || ''
            });
        }
    };

    // Calculate separate USD and XAF revenues
    const calculateRevenue = () => {
        // USD calculation (NOWPayments only)
        let totalExternalUSD = 0;
        if (showLiveBalances && liveBalances?.nowpayments.available) {
            totalExternalUSD = liveBalances.nowpayments.totalUsd;
        } else {
            totalExternalUSD = balances?.nowpaymentsBalanceUSD || 0;
        }
        const revenueUSD = totalExternalUSD - totalUserBalanceUSD;

        // XAF calculation (CinetPay + FeexPay)
        let totalExternalXAF = 0;
        if (showLiveBalances && liveBalances) {
            const cinetpayXAF = liveBalances.cinetpay.available
                ? liveBalances.cinetpay.available_balance
                : (balances?.cinetpayBalanceXAF || 0);
            const feexpayXAF = balances?.feexpayBalanceXAF || 0; // Always manual for FeexPay
            totalExternalXAF = cinetpayXAF + feexpayXAF;
        } else if (balances) {
            totalExternalXAF = (balances.cinetpayBalanceXAF || 0) + (balances.feexpayBalanceXAF || 0);
        }
        const revenueXAF = totalExternalXAF - totalUserBalanceXAF;

        // Combined total (for reference)
        const totalExternalCombinedXAF = totalExternalXAF + (totalExternalUSD * USD_TO_XAF_RATE);

        return {
            revenueUSD,
            revenueXAF,
            totalExternalUSD,
            totalExternalXAF,
            totalExternalCombinedXAF
        };
    };

    const revenue = calculateRevenue();

    if (isLoading) {
        return (
            <motion.div
                className="bg-gray-800 bg-opacity-50 backdrop-blur-md overflow-hidden shadow-lg rounded-xl border border-gray-700 p-6"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
            >
                <div className="flex items-center justify-center py-8">
                    <RefreshCw className="animate-spin text-gray-400" size={24} />
                    <span className="ml-2 text-gray-400">Chargement...</span>
                </div>
            </motion.div>
        );
    }

    return (
        <motion.div
            className="bg-gray-800 bg-opacity-50 backdrop-blur-md overflow-hidden shadow-lg rounded-xl border border-gray-700"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
        >
            <div className="p-6">
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center">
                        <CreditCard className="text-purple-400 mr-2" size={24} />
                        <h3 className="text-lg font-semibold text-gray-100">Soldes des Passerelles</h3>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* Toggle Live/Manual */}
                        <button
                            onClick={() => setShowLiveBalances(!showLiveBalances)}
                            className={`flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg transition-colors ${
                                showLiveBalances
                                    ? 'bg-green-600 hover:bg-green-700 text-white'
                                    : 'bg-gray-600 hover:bg-gray-700 text-white'
                            }`}
                            title={showLiveBalances ? 'Affichage en direct' : 'Affichage manuel'}
                        >
                            {showLiveBalances ? <Zap size={14} /> : <Clock size={14} />}
                            {showLiveBalances ? 'Live' : 'Manuel'}
                        </button>
                        <button
                            onClick={() => {
                                fetchBalances();
                                fetchLiveBalances();
                            }}
                            className="p-2 text-gray-400 hover:text-gray-200 transition-colors"
                            title="Rafraichir"
                            disabled={isLoadingLive}
                        >
                            <RefreshCw size={18} className={isLoadingLive ? 'animate-spin' : ''} />
                        </button>
                        {!isEditing ? (
                            <button
                                onClick={() => setIsEditing(true)}
                                className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
                            >
                                <Edit2 size={14} />
                                Modifier
                            </button>
                        ) : (
                            <div className="flex gap-2">
                                <button
                                    onClick={handleCancel}
                                    className="flex items-center gap-1 px-3 py-1.5 bg-gray-600 hover:bg-gray-700 text-white text-sm rounded-lg transition-colors"
                                    disabled={isSaving}
                                >
                                    <X size={14} />
                                    Annuler
                                </button>
                                <button
                                    onClick={handleSave}
                                    className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg transition-colors"
                                    disabled={isSaving}
                                >
                                    {isSaving ? <RefreshCw className="animate-spin" size={14} /> : <Save size={14} />}
                                    Enregistrer
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {error && (
                    <div className="mb-4 p-3 bg-red-900/30 border border-red-700 rounded-lg flex items-center text-red-300">
                        <AlertCircle size={18} className="mr-2" />
                        {error}
                    </div>
                )}

                {/* Live Balance Indicator */}
                {showLiveBalances && liveBalances && (
                    <div className="mb-4 p-2 bg-green-900/20 border border-green-700/50 rounded-lg flex items-center text-green-300 text-sm">
                        <Zap size={16} className="mr-2" />
                        Soldes en direct depuis les APIs des passerelles
                        <span className="ml-auto text-xs text-green-400">
                            {new Date(liveBalances.timestamp).toLocaleTimeString('fr-FR')}
                        </span>
                    </div>
                )}

                {/* Gateway Balances Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    {/* NOWPayments (USD) */}
                    <div className="bg-gray-700/50 rounded-lg p-4">
                        <div className="flex items-center justify-between text-sm text-gray-400 mb-2">
                            <div className="flex items-center">
                                <DollarSign size={16} className="mr-1 text-green-400" />
                                NOWPayments (USD)
                            </div>
                            {showLiveBalances && liveBalances?.nowpayments.available && (
                                <span className="text-xs bg-green-600/30 text-green-300 px-2 py-0.5 rounded">LIVE</span>
                            )}
                        </div>
                        {isEditing ? (
                            <input
                                type="number"
                                value={editForm.nowpaymentsBalanceUSD}
                                onChange={(e) => setEditForm({ ...editForm, nowpaymentsBalanceUSD: parseFloat(e.target.value) || 0 })}
                                className="w-full bg-gray-600 text-gray-100 rounded px-3 py-2 text-xl font-semibold"
                                step="0.01"
                                min="0"
                            />
                        ) : (
                            <>
                                <p className="text-2xl font-semibold text-green-400">
                                    ${showLiveBalances && liveBalances?.nowpayments.available
                                        ? liveBalances.nowpayments.totalUsd.toFixed(2)
                                        : (balances?.nowpaymentsBalanceUSD.toFixed(2) || '0.00')}
                                </p>
                                {showLiveBalances && liveBalances?.nowpayments.available && liveBalances.nowpayments.totalPendingUsd > 0 && (
                                    <p className="text-xs text-yellow-400 mt-1">
                                        + ${liveBalances.nowpayments.totalPendingUsd.toFixed(2)} en attente
                                    </p>
                                )}
                                {showLiveBalances && liveBalances?.nowpayments.error && (
                                    <p className="text-xs text-red-400 mt-1">Erreur: {liveBalances.nowpayments.error}</p>
                                )}
                                {/* Show crypto breakdown */}
                                {showLiveBalances && liveBalances?.nowpayments.available && liveBalances.nowpayments.balances.length > 0 && (
                                    <div className="mt-2 text-xs text-gray-400 max-h-20 overflow-y-auto">
                                        {liveBalances.nowpayments.balances
                                            .filter(b => b.amount > 0)
                                            .map(b => (
                                                <div key={b.currency} className="flex justify-between">
                                                    <span>{b.currency}</span>
                                                    <span>{b.amount.toFixed(6)} (~${b.usdValue.toFixed(2)})</span>
                                                </div>
                                            ))}
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    {/* FeexPay (XAF) - Always Manual */}
                    <div className="bg-gray-700/50 rounded-lg p-4">
                        <div className="flex items-center justify-between text-sm text-gray-400 mb-2">
                            <div className="flex items-center">
                                <Wallet size={16} className="mr-1 text-orange-400" />
                                FeexPay (XAF)
                            </div>
                            <span className="text-xs bg-gray-600/50 text-gray-300 px-2 py-0.5 rounded">MANUEL</span>
                        </div>
                        {isEditing ? (
                            <input
                                type="number"
                                value={editForm.feexpayBalanceXAF}
                                onChange={(e) => setEditForm({ ...editForm, feexpayBalanceXAF: parseFloat(e.target.value) || 0 })}
                                className="w-full bg-gray-600 text-gray-100 rounded px-3 py-2 text-xl font-semibold"
                                step="1"
                                min="0"
                            />
                        ) : (
                            <>
                                <p className="text-2xl font-semibold text-orange-400">
                                    {Math.round(balances?.feexpayBalanceXAF || 0).toLocaleString('en-US')} F
                                </p>
                                <p className="text-xs text-gray-500 mt-1">
                                    API non disponible - saisie manuelle
                                </p>
                            </>
                        )}
                    </div>

                    {/* CinetPay (XAF) */}
                    <div className="bg-gray-700/50 rounded-lg p-4">
                        <div className="flex items-center justify-between text-sm text-gray-400 mb-2">
                            <div className="flex items-center">
                                <Wallet size={16} className="mr-1 text-blue-400" />
                                CinetPay (XAF)
                            </div>
                            {showLiveBalances && liveBalances?.cinetpay.available && (
                                <span className="text-xs bg-green-600/30 text-green-300 px-2 py-0.5 rounded">LIVE</span>
                            )}
                        </div>
                        {isEditing ? (
                            <input
                                type="number"
                                value={editForm.cinetpayBalanceXAF}
                                onChange={(e) => setEditForm({ ...editForm, cinetpayBalanceXAF: parseFloat(e.target.value) || 0 })}
                                className="w-full bg-gray-600 text-gray-100 rounded px-3 py-2 text-xl font-semibold"
                                step="1"
                                min="0"
                            />
                        ) : (
                            <>
                                <p className="text-2xl font-semibold text-blue-400">
                                    {showLiveBalances && liveBalances?.cinetpay.available
                                        ? Math.round(liveBalances.cinetpay.available_balance).toLocaleString('en-US')
                                        : Math.round(balances?.cinetpayBalanceXAF || 0).toLocaleString('en-US')} F
                                </p>
                                {showLiveBalances && liveBalances?.cinetpay.available && (
                                    <div className="text-xs text-gray-400 mt-1">
                                        <div>Total: {Math.round(liveBalances.cinetpay.total).toLocaleString('en-US')} F</div>
                                        {liveBalances.cinetpay.inUse > 0 && (
                                            <div className="text-yellow-400">En cours: {Math.round(liveBalances.cinetpay.inUse).toLocaleString('en-US')} F</div>
                                        )}
                                    </div>
                                )}
                                {showLiveBalances && liveBalances?.cinetpay.error && (
                                    <p className="text-xs text-red-400 mt-1">Erreur: {liveBalances.cinetpay.error}</p>
                                )}
                            </>
                        )}
                    </div>
                </div>

                {/* Notes field (only in edit mode) */}
                {isEditing && (
                    <div className="mb-6">
                        <label className="block text-sm text-gray-400 mb-2">Notes (optionnel)</label>
                        <input
                            type="text"
                            value={editForm.notes}
                            onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                            placeholder="Ex: Mise a jour du 26/12/2025"
                            className="w-full bg-gray-600 text-gray-100 rounded px-3 py-2"
                        />
                    </div>
                )}

                {/* Summary Section */}
                <div className="border-t border-gray-700 pt-4">
                    {/* Totals Row */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        {/* Total External USD */}
                        <div className="bg-green-900/20 rounded-lg p-4">
                            <div className="flex items-center text-sm text-green-300 mb-1">
                                <DollarSign size={16} className="mr-1" />
                                Total Externe USD (NOWPayments)
                            </div>
                            <p className="text-2xl font-bold text-green-400">
                                ${revenue.totalExternalUSD.toFixed(2)}
                            </p>
                            <p className="text-xs text-gray-400 mt-1">
                                Passif Users USD: ${totalUserBalanceUSD.toFixed(2)}
                            </p>
                        </div>

                        {/* Total External XAF */}
                        <div className="bg-blue-900/20 rounded-lg p-4">
                            <div className="flex items-center text-sm text-blue-300 mb-1">
                                <Wallet size={16} className="mr-1" />
                                Total Externe XAF (CinetPay + FeexPay)
                            </div>
                            <p className="text-2xl font-bold text-blue-400">
                                {Math.round(revenue.totalExternalXAF).toLocaleString('en-US')} F
                            </p>
                            <p className="text-xs text-gray-400 mt-1">
                                Passif Users XAF: {Math.round(totalUserBalanceXAF).toLocaleString('en-US')} F
                            </p>
                        </div>
                    </div>

                    {/* Revenue Row */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* USD Revenue */}
                        <div className={`rounded-lg p-4 ${revenue.revenueUSD >= 0 ? 'bg-green-900/30' : 'bg-red-900/30'}`}>
                            <div className="flex items-center text-sm mb-1" style={{ color: revenue.revenueUSD >= 0 ? '#86efac' : '#fca5a5' }}>
                                <TrendingUp size={16} className="mr-1" />
                                Revenu USD (NOWPayments - Passif USD)
                            </div>
                            <p className={`text-2xl font-bold ${revenue.revenueUSD >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                ${revenue.revenueUSD.toFixed(2)}
                            </p>
                            <p className="text-xs text-gray-400 mt-1">
                                = ${revenue.totalExternalUSD.toFixed(2)} - ${totalUserBalanceUSD.toFixed(2)}
                            </p>
                        </div>

                        {/* XAF Revenue */}
                        <div className={`rounded-lg p-4 ${revenue.revenueXAF >= 0 ? 'bg-green-900/30' : 'bg-red-900/30'}`}>
                            <div className="flex items-center text-sm mb-1" style={{ color: revenue.revenueXAF >= 0 ? '#86efac' : '#fca5a5' }}>
                                <TrendingUp size={16} className="mr-1" />
                                Revenu XAF (CinetPay + FeexPay - Passif XAF)
                            </div>
                            <p className={`text-2xl font-bold ${revenue.revenueXAF >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {Math.round(revenue.revenueXAF).toLocaleString('en-US')} F
                            </p>
                            <p className="text-xs text-gray-400 mt-1">
                                = {Math.round(revenue.totalExternalXAF).toLocaleString('en-US')} - {Math.round(totalUserBalanceXAF).toLocaleString('en-US')} F
                            </p>
                        </div>
                    </div>

                    {/* Combined Totals Row */}
                    <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Combined Total External */}
                        <div className="bg-purple-900/20 rounded-lg p-3">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center text-sm text-purple-300">
                                    <CreditCard size={16} className="mr-1" />
                                    Total Externe Combine (XAF)
                                </div>
                                <p className="text-lg font-bold text-purple-400">
                                    {Math.round(revenue.totalExternalCombinedXAF).toLocaleString('en-US')} F
                                </p>
                            </div>
                            <p className="text-xs text-gray-400 mt-1">
                                Taux USD/XAF: {USD_TO_XAF_RATE} | USD converti: {Math.round(revenue.totalExternalUSD * USD_TO_XAF_RATE).toLocaleString('en-US')} F
                            </p>
                        </div>

                        {/* Combined Total Revenue */}
                        {(() => {
                            const totalRevenueCombinedXAF = revenue.revenueXAF + (revenue.revenueUSD * USD_TO_XAF_RATE);
                            const isPositive = totalRevenueCombinedXAF >= 0;
                            return (
                                <div className={`rounded-lg p-3 ${isPositive ? 'bg-green-900/30' : 'bg-red-900/30'}`}>
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center text-sm" style={{ color: isPositive ? '#86efac' : '#fca5a5' }}>
                                            <TrendingUp size={16} className="mr-1" />
                                            Revenu Total Combine (XAF)
                                        </div>
                                        <p className={`text-lg font-bold ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                                            {Math.round(totalRevenueCombinedXAF).toLocaleString('en-US')} F
                                        </p>
                                    </div>
                                    <p className="text-xs text-gray-400 mt-1">
                                        = {Math.round(revenue.revenueXAF).toLocaleString('en-US')} F + (${revenue.revenueUSD.toFixed(2)} × {USD_TO_XAF_RATE})
                                    </p>
                                </div>
                            );
                        })()}
                    </div>
                </div>

                {/* Last Updated Info */}
                {balances?.lastUpdatedAt && (
                    <div className="mt-4 text-xs text-gray-500 text-right">
                        Derniere mise a jour manuelle: {new Date(balances.lastUpdatedAt).toLocaleString('fr-FR')}
                        {balances.notes && <span className="ml-2">- {balances.notes}</span>}
                    </div>
                )}
            </div>
        </motion.div>
    );
};

export default GatewayBalancesCard;
