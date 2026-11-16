import React, { useState, useEffect } from 'react';
import { Activity, Users, MessageSquare, TrendingUp, CheckCircle, XCircle, Clock, RefreshCw, Loader2, Mail, Smartphone, ShoppingCart, AlertTriangle, X } from 'lucide-react';
import toast from 'react-hot-toast';
import {
    getStats, getActiveTargets, getActiveConfigs, getBalance, getPacks, purchasePack,
    RelanceStats, RelanceTarget, RelanceConfig, RelanceBalance, RelancePack
} from '../services/adminRelanceApi';

const RelanceDashboardPage: React.FC = () => {
    const [stats, setStats] = useState<RelanceStats | null>(null);
    const [activeTargets, setActiveTargets] = useState<RelanceTarget[]>([]);
    const [activeConfigs, setActiveConfigs] = useState<RelanceConfig[]>([]);
    const [balance, setBalance] = useState<RelanceBalance | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    // Pack purchase modal
    const [showPackModal, setShowPackModal] = useState(false);
    const [packChannel, setPackChannel] = useState<'email' | 'sms'>('email');
    const [packs, setPacks] = useState<{ emailPacks: RelancePack[]; smsPacks: RelancePack[] } | null>(null);
    const [loadingPacks, setLoadingPacks] = useState(false);
    const [purchasing, setPurchasing] = useState<string | null>(null);

    useEffect(() => {
        loadDashboardData();
    }, []);

    const loadDashboardData = async (isRefresh = false) => {
        try {
            if (isRefresh) setRefreshing(true);
            else setLoading(true);

            const [statsData, targetsData, configsData, balanceData] = await Promise.all([
                getStats(),
                getActiveTargets(1, 10),
                getActiveConfigs(),
                getBalance().catch(() => null),
            ]);

            setStats(statsData);
            setActiveTargets(targetsData.targets);
            setActiveConfigs(configsData);
            setBalance(balanceData);
        } catch (error: any) {
            toast.error('Impossible de charger le tableau de bord : ' + (error.response?.data?.message || error.message));
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    const openPackModal = async (channel: 'email' | 'sms') => {
        setPackChannel(channel);
        setShowPackModal(true);
        if (!packs) {
            setLoadingPacks(true);
            try {
                const data = await getPacks();
                setPacks(data);
            } catch {
                toast.error('Erreur lors du chargement des packs');
            } finally {
                setLoadingPacks(false);
            }
        }
    };

    const handlePurchase = async (packId: string) => {
        setPurchasing(packId);
        try {
            const { checkoutUrl } = await purchasePack(packId);
            window.open(checkoutUrl, '_blank');
            setShowPackModal(false);
        } catch (error: any) {
            toast.error('Erreur lors de l\'achat : ' + (error.response?.data?.message || error.message));
        } finally {
            setPurchasing(null);
        }
    };

    const formatDate = (dateString: string) =>
        new Date(dateString).toLocaleString('fr-FR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    const getStatusBadge = (status: string) => {
        const colors: Record<string, string> = { active: 'bg-green-600 text-white', completed: 'bg-blue-600 text-white', failed: 'bg-red-600 text-white' };
        return colors[status] || 'bg-surface-3 text-fg';
    };

    const getWhatsAppStatusBadge = (status: string) => {
        const colors: Record<string, string> = { connected: 'bg-green-600 text-white', connecting: 'bg-yellow-600 text-white', disconnected: 'bg-surface-3 text-fg', failed: 'bg-red-600 text-white' };
        return colors[status] || 'bg-surface-3 text-fg';
    };

    const TARGET_STATUS_LABELS: Record<string, string> = { active: 'Active', paused: 'En pause', completed: 'Terminée', failed: 'Échouée' };
    const WHATSAPP_STATUS_LABELS: Record<string, string> = { connected: 'Connecté', connecting: 'Connexion…', disconnected: 'Déconnecté', failed: 'Échec' };

    const formatPrice = (xaf: number) => `${xaf.toLocaleString('fr-FR')} FCFA`;

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="animate-spin text-blue-500" size={48} />
            </div>
        );
    }

    if (!stats) {
        return <div className="flex items-center justify-center h-64 text-fg-muted"><p>Aucune donnée disponible</p></div>;
    }

    const displayPacks = packs ? (packChannel === 'email' ? packs.emailPacks : packs.smsPacks) : [];

    return (
        <div>
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight text-fg flex items-center gap-2">
                        <Activity size={28} className="text-blue-500" />
                        Tableau de bord Relance
                    </h1>
                    <p className="text-fg-muted mt-2">Suivi des campagnes de relance</p>
                </div>
                <button
                    onClick={() => loadDashboardData(true)}
                    disabled={refreshing}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 dark:disabled:bg-gray-600 text-white rounded-lg flex items-center gap-2 transition-colors"
                >
                    <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                    {refreshing ? 'Actualisation…' : 'Actualiser'}
                </button>
            </div>

            {/* Credit Balance Cards */}
            {balance && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    {/* Email balance */}
                    <div className={`rounded-xl border p-5 ${balance.emailBalance <= 50 ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/10' : 'border-line bg-surface'}`}>
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <Mail className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                                <span className="font-semibold text-fg">Crédits Email</span>
                            </div>
                            {balance.emailBalance <= 50 && (
                                <span className="flex items-center gap-1 text-xs text-orange-700 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/30 px-2 py-0.5 rounded-full">
                                    <AlertTriangle className="w-3 h-3" /> Faible
                                </span>
                            )}
                        </div>
                        <p className="text-4xl font-bold text-fg mb-1">{balance.emailBalance.toLocaleString('fr-FR')}</p>
                        <p className="text-xs text-fg-muted mb-4">emails disponibles</p>
                        <button
                            onClick={() => openPackModal('email')}
                            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
                        >
                            <ShoppingCart className="w-4 h-4" />
                            Acheter des crédits email
                        </button>
                    </div>

                    {/* SMS balance */}
                    {balance.smsEnabled && (
                        <div className={`rounded-xl border p-5 ${balance.smsBalance <= 20 ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/10' : 'border-line bg-surface'}`}>
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                    <Smartphone className="w-5 h-5 text-green-600 dark:text-green-400" />
                                    <span className="font-semibold text-fg">Crédits SMS</span>
                                </div>
                                {balance.smsBalance <= 20 && (
                                    <span className="flex items-center gap-1 text-xs text-orange-700 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/30 px-2 py-0.5 rounded-full">
                                        <AlertTriangle className="w-3 h-3" /> Faible
                                    </span>
                                )}
                            </div>
                            <p className="text-4xl font-bold text-fg mb-1">{balance.smsBalance.toLocaleString('fr-FR')}</p>
                            <p className="text-xs text-fg-muted mb-4">SMS disponibles (CM +237)</p>
                            <button
                                onClick={() => openPackModal('sms')}
                                className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium transition-colors"
                            >
                                <ShoppingCart className="w-4 h-4" />
                                Acheter des crédits SMS
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <div className="bg-surface rounded-lg p-6 border border-line">
                    <div className="flex items-center justify-between mb-2">
                        <Users size={24} className="text-blue-500" />
                        <span className="text-xs text-fg-muted">ACTIFS</span>
                    </div>
                    <p className="text-3xl font-bold text-fg">{stats.totalActiveTargets}</p>
                    <p className="text-sm text-fg-muted mt-1">Dans la boucle</p>
                </div>

                <div className="bg-surface rounded-lg p-6 border border-line">
                    <div className="flex items-center justify-between mb-2">
                        <MessageSquare size={24} className="text-green-600 dark:text-green-500" />
                        <span className="text-xs text-fg-muted">AUJOURD'HUI</span>
                    </div>
                    <p className="text-3xl font-bold text-fg">{stats.messagesSentToday}</p>
                    <p className="text-sm text-fg-muted mt-1">Messages envoyés</p>
                </div>

                <div className="bg-surface rounded-lg p-6 border border-line">
                    <div className="flex items-center justify-between mb-2">
                        <TrendingUp size={24} className="text-purple-500" />
                        <span className="text-xs text-fg-muted">TAUX</span>
                    </div>
                    <p className="text-3xl font-bold text-fg">{stats.totalSuccessRate.toFixed(1)}%</p>
                    <p className="text-sm text-fg-muted mt-1">Taux de réussite</p>
                </div>

                <div className="bg-surface rounded-lg p-6 border border-line">
                    <div className="flex items-center justify-between mb-2">
                        <CheckCircle size={24} className="text-yellow-600 dark:text-yellow-500" />
                        <span className="text-xs text-fg-muted">CONFIGURATIONS</span>
                    </div>
                    <p className="text-3xl font-bold text-fg">{stats.activeConfigsCount}</p>
                    <p className="text-sm text-fg-muted mt-1">Utilisateurs actifs</p>
                </div>
            </div>

            {/* Exit Reasons */}
            <div className="bg-surface rounded-lg p-6 border border-line mb-6">
                <h2 className="text-lg font-semibold text-fg mb-4">Motifs de sortie (boucles terminées)</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="text-center">
                        <p className="text-2xl font-bold text-green-600 dark:text-green-400">{stats.exitReasons.paid}</p>
                        <p className="text-xs text-fg-muted mt-1">Abonnement payé</p>
                    </div>
                    <div className="text-center">
                        <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{stats.exitReasons.completed_7_days}</p>
                        <p className="text-xs text-fg-muted mt-1">7 jours terminés</p>
                    </div>
                    <div className="text-center">
                        <p className="text-2xl font-bold text-yellow-700 dark:text-yellow-400">{stats.exitReasons.subscription_expired}</p>
                        <p className="text-xs text-fg-muted mt-1">Abonnement expiré</p>
                    </div>
                    <div className="text-center">
                        <p className="text-2xl font-bold text-fg-muted">{stats.exitReasons.manual}</p>
                        <p className="text-xs text-fg-muted mt-1">Sortie manuelle</p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Active Targets */}
                <div className="bg-surface rounded-lg p-6 border border-line">
                    <h2 className="text-lg font-semibold text-fg mb-4 flex items-center gap-2">
                        <Clock size={20} />
                        Cibles actives récentes
                    </h2>
                    {activeTargets.length === 0 ? (
                        <p className="text-fg-muted text-center py-4">Aucune cible active</p>
                    ) : (
                        <div className="space-y-3 max-h-96 overflow-y-auto">
                            {activeTargets.map((target) => (
                                <div key={target._id} className="p-3 bg-surface-2 rounded-sm border border-line-strong">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-sm font-medium text-fg">Jour {target.currentDay}/7</span>
                                        <span className={`text-xs px-2 py-1 rounded-sm ${getStatusBadge(target.status)}`}>{TARGET_STATUS_LABELS[target.status] ?? target.status}</span>
                                    </div>
                                    <div className="text-xs text-fg-muted space-y-1">
                                        <p>Entrée : {formatDate(target.enteredLoopAt)}</p>
                                        <p>Prochain message : {formatDate(target.nextMessageDue)}</p>
                                        <p>Messages remis : {target.messagesDelivered.length}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Active Configs */}
                <div className="bg-surface rounded-lg p-6 border border-line">
                    <h2 className="text-lg font-semibold text-fg mb-4 flex items-center gap-2">
                        <Users size={20} />
                        Connexions actives
                    </h2>
                    {activeConfigs.length === 0 ? (
                        <p className="text-fg-muted text-center py-4">Aucune configuration active</p>
                    ) : (
                        <div className="space-y-3 max-h-96 overflow-y-auto">
                            {activeConfigs.map((config) => (
                                <div key={config._id} className="p-3 bg-surface-2 rounded-sm border border-line-strong">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className={`text-xs px-2 py-1 rounded-sm ${getWhatsAppStatusBadge(config.whatsappStatus)}`}>
                                            {WHATSAPP_STATUS_LABELS[config.whatsappStatus] ?? config.whatsappStatus}
                                        </span>
                                        <div className="flex gap-2">
                                            {config.enabled
                                                ? <CheckCircle size={16} className="text-green-600 dark:text-green-400" />
                                                : <XCircle size={16} className="text-red-600 dark:text-red-400" />}
                                        </div>
                                    </div>
                                    <div className="text-xs text-fg-muted space-y-1">
                                        <p>Messages aujourd'hui : {config.messagesSentToday}</p>
                                        {config.lastQrScanDate && <p>Dernier scan : {formatDate(config.lastQrScanDate)}</p>}
                                        <div className="flex gap-2 mt-2">
                                            {config.enrollmentPaused && (
                                                <span className="px-2 py-1 bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-300 rounded-sm text-xs">Inscriptions en pause</span>
                                            )}
                                            {config.sendingPaused && (
                                                <span className="px-2 py-1 bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 rounded-sm text-xs">Envoi en pause</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Summary */}
            <div className="mt-6 bg-surface rounded-lg p-6 border border-line">
                <h2 className="text-lg font-semibold text-fg mb-4">Résumé</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div>
                        <p className="text-fg-muted">Inscrits aujourd'hui</p>
                        <p className="text-2xl font-bold text-fg">{stats.targetsEnrolledToday}</p>
                    </div>
                    <div>
                        <p className="text-fg-muted">Total terminées</p>
                        <p className="text-2xl font-bold text-fg">{stats.totalCompletedTargets}</p>
                    </div>
                    <div>
                        <p className="text-fg-muted">Total des messages envoyés</p>
                        <p className="text-2xl font-bold text-fg">{stats.totalMessagesSent}</p>
                    </div>
                </div>
            </div>

            {/* Pack Purchase Modal */}
            {showPackModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowPackModal(false)}>
                    <div className="bg-surface rounded-2xl border border-line p-6 w-full max-w-lg m-4" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-5">
                            <h2 className="text-xl font-bold text-fg flex items-center gap-2">
                                <ShoppingCart className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                                Acheter des crédits
                            </h2>
                            <button onClick={() => setShowPackModal(false)} className="text-fg-muted hover:text-fg" aria-label="Fermer">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Channel toggle */}
                        <div className="flex gap-2 mb-5">
                            <button
                                onClick={() => setPackChannel('email')}
                                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-colors ${packChannel === 'email' ? 'bg-blue-600 text-white' : 'bg-surface-2 text-fg-muted hover:bg-surface-3'}`}
                            >
                                <Mail className="w-4 h-4" /> Email
                            </button>
                            <button
                                onClick={() => setPackChannel('sms')}
                                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-colors ${packChannel === 'sms' ? 'bg-green-600 text-white' : 'bg-surface-2 text-fg-muted hover:bg-surface-3'}`}
                            >
                                <Smartphone className="w-4 h-4" /> SMS
                            </button>
                        </div>

                        {loadingPacks ? (
                            <div className="flex items-center justify-center py-8">
                                <Loader2 className="animate-spin text-blue-500" size={28} />
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {displayPacks.map(pack => (
                                    <div key={pack.id} className="flex items-center justify-between p-4 bg-surface-2 rounded-xl border border-line-strong">
                                        <div>
                                            <p className="font-semibold text-fg">{pack.credits.toLocaleString('fr-FR')} {packChannel === 'email' ? 'emails' : 'SMS'}</p>
                                            <p className="text-sm text-fg-muted">{formatPrice(pack.priceXAF)}</p>
                                        </div>
                                        <button
                                            onClick={() => handlePurchase(pack.id)}
                                            disabled={purchasing === pack.id}
                                            className={`px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50 ${packChannel === 'email' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-green-600 hover:bg-green-700'}`}
                                        >
                                            {purchasing === pack.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Acheter'}
                                        </button>
                                    </div>
                                ))}
                                {displayPacks.length === 0 && (
                                    <p className="text-fg-muted text-center py-4">Aucun pack disponible</p>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default RelanceDashboardPage;
