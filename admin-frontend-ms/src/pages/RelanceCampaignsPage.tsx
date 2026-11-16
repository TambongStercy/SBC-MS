import React, { useState, useEffect } from 'react';
import { Target, Users, TrendingUp, Play, Pause, XCircle, Eye, RefreshCw, Loader2, Filter, Calendar, BarChart3, MessageSquare, Mail, CheckCircle, AlertTriangle, Smartphone, Layers } from 'lucide-react';
import toast from 'react-hot-toast';
import {
    getAllCampaigns,
    getCampaignById,
    getCampaignTargets,
    getCampaignStatsById,
    getCampaignRecentMessages,
    pauseCampaign,
    resumeCampaign,
    cancelCampaign,
    Campaign,
    CampaignTarget,
    RecentMessage
} from '../services/adminRelanceApi';
import ConfirmationModal from '../components/common/ConfirmationModal';

const STATUS_LABELS: Record<string, string> = {
    draft: 'Brouillon', scheduled: 'Programmée', active: 'Active', paused: 'En pause', completed: 'Terminée', cancelled: 'Annulée', failed: 'Échouée',
};
const TYPE_LABELS: Record<string, string> = { default: 'Par défaut', filtered: 'Filtrée' };
const CHANNEL_LABELS: Record<string, string> = { email: 'E-mail', sms: 'SMS', both: 'E-mail + SMS' };
const GENDER_LABELS: Record<string, string> = { male: 'Homme', female: 'Femme', other: 'Autre' };
const EXIT_REASON_LABELS: Record<string, string> = {
    paid: 'Payé', completed_7_days: '7 jours terminés', completed_7days: '7 jours terminés', subscription_expired: 'Abonnement expiré',
    manual: 'Sortie manuelle', referrer_inactive: 'Parrain inactif', expired: 'Expiré',
};
/** Display label of a campaign's channel (`channel` is not on the Campaign type). */
const channelLabel = (c: Campaign) => {
    const channel = (c as { channel?: string }).channel || 'email';
    return CHANNEL_LABELS[channel] ?? channel;
};
const LANGUAGE_LABELS: Record<string, string> = { fr: 'Français', en: 'Anglais' };

const RelanceCampaignsPage: React.FC = () => {
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
    const [campaignTargets, setCampaignTargets] = useState<CampaignTarget[]>([]);
    const [showDetailsModal, setShowDetailsModal] = useState(false);
    const [showTargetsModal, setShowTargetsModal] = useState(false);
    const [showStatsModal, setShowStatsModal] = useState(false);
    const [showMessagesModal, setShowMessagesModal] = useState(false);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);

    // Campaign stats
    const [campaignStats, setCampaignStats] = useState<{
        campaign: { _id: string; name: string; status: string; type: string };
        totalEnrolled: number;
        activeTargets: number;
        completedRelance: number;
        totalMessagesSent: number;
        totalMessagesDelivered: number;
        totalMessagesFailed: number;
        deliveryPercentage: number;
        dayProgression: { day: number; count: number }[];
        exitReasons: Record<string, number>;
    } | null>(null);
    const [loadingStats, setLoadingStats] = useState(false);

    // Recent messages
    const [recentMessages, setRecentMessages] = useState<RecentMessage[]>([]);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [viewingEmailHtml, setViewingEmailHtml] = useState<string | null>(null);

    // Confirmation modal
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [confirmAction, setConfirmAction] = useState<{
        title: string;
        message: string;
        onConfirm: () => void;
    } | null>(null);
    const [cancellationReason, setCancellationReason] = useState<string>('');

    // Filters
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [typeFilter, setTypeFilter] = useState<string>('all');
    const [channelFilter, setChannelFilter] = useState<string>('all');
    const [userIdFilter, setUserIdFilter] = useState<string>('');

    useEffect(() => {
        loadCampaigns();
    }, [statusFilter, typeFilter, channelFilter, page]);

    const loadCampaigns = async (isRefresh = false) => {
        try {
            if (isRefresh) {
                setRefreshing(true);
            } else {
                setLoading(true);
            }

            const filters: any = {
                page,
                limit: 20
            };

            if (statusFilter !== 'all') filters.status = statusFilter;
            if (typeFilter !== 'all') filters.type = typeFilter;
            if (channelFilter !== 'all') filters.channel = channelFilter;
            if (userIdFilter) filters.userId = userIdFilter;

            const data = await getAllCampaigns(filters);
            setCampaigns(data.campaigns);
            setTotalPages(data.totalPages);
        } catch (error: any) {
            console.error('Error loading campaigns:', error);
            toast.error('Impossible de charger les campagnes : ' + (error.response?.data?.message || error.message));
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    const handleRefresh = () => {
        loadCampaigns(true);
    };

    const handleViewDetails = async (campaign: Campaign) => {
        try {
            const fullCampaign = await getCampaignById(campaign._id);
            setSelectedCampaign(fullCampaign);
            setShowDetailsModal(true);
        } catch (error: any) {
            toast.error('Impossible de charger le détail de la campagne : ' + (error.response?.data?.message || error.message));
        }
    };

    const handleViewTargets = async (campaign: Campaign) => {
        try {
            setSelectedCampaign(campaign);
            const data = await getCampaignTargets(campaign._id, 1, 50);
            setCampaignTargets(data.targets);
            setShowTargetsModal(true);
        } catch (error: any) {
            toast.error('Impossible de charger les cibles de la campagne : ' + (error.response?.data?.message || error.message));
        }
    };

    const handleViewStats = async (campaign: Campaign) => {
        try {
            setSelectedCampaign(campaign);
            setLoadingStats(true);
            setShowStatsModal(true);
            const stats = await getCampaignStatsById(campaign._id);
            setCampaignStats(stats);
        } catch (error: any) {
            toast.error('Impossible de charger les statistiques de la campagne : ' + (error.response?.data?.message || error.message));
        } finally {
            setLoadingStats(false);
        }
    };

    const handleViewMessages = async (campaign: Campaign) => {
        try {
            setSelectedCampaign(campaign);
            setLoadingMessages(true);
            setShowMessagesModal(true);
            const data = await getCampaignRecentMessages(campaign._id, 15);
            setRecentMessages(data.messages);
        } catch (error: any) {
            toast.error('Impossible de charger les messages récents : ' + (error.response?.data?.message || error.message));
        } finally {
            setLoadingMessages(false);
        }
    };

    const updateCampaignState = (updatedCampaign: Campaign) => {
        // Update in the campaigns list
        setCampaigns(prev => prev.map(c => c._id === updatedCampaign._id ? updatedCampaign : c));
        // Update selectedCampaign if it's the same one
        setSelectedCampaign(prev => prev && prev._id === updatedCampaign._id ? updatedCampaign : prev);
    };

    const handlePauseCampaign = async (campaign: Campaign) => {
        try {
            const updated = await pauseCampaign(campaign._id, campaign.userId);
            toast.success('Campagne mise en pause');
            updateCampaignState(updated);
        } catch (error: any) {
            toast.error('Impossible de mettre la campagne en pause : ' + (error.response?.data?.message || error.message));
        }
    };

    const handleResumeCampaign = async (campaign: Campaign) => {
        try {
            const updated = await resumeCampaign(campaign._id, campaign.userId);
            toast.success('Campagne relancée');
            updateCampaignState(updated);
        } catch (error: any) {
            toast.error('Impossible de reprendre la campagne : ' + (error.response?.data?.message || error.message));
        }
    };

    const handleCancelCampaign = async (campaign: Campaign) => {
        setCancellationReason('');
        setConfirmAction({
            title: 'Annuler la campagne',
            message: `Voulez-vous vraiment annuler la campagne « ${campaign.name} » ? Toutes les cibles actives sortiront de la boucle.`,
            onConfirm: async () => {
                try {
                    const updated = await cancelCampaign(campaign._id, campaign.userId, cancellationReason || undefined);
                    toast.success('Campagne annulée');
                    updateCampaignState(updated);
                    setShowConfirmModal(false);
                    setCancellationReason('');
                } catch (error: any) {
                    toast.error("Impossible d'annuler la campagne : " + (error.response?.data?.message || error.message));
                }
            }
        });
        setShowConfirmModal(true);
    };

    const formatDate = (dateString?: string) => {
        if (!dateString) return 'N/A';
        return new Date(dateString).toLocaleString('fr-FR', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const formatFullDate = (dateString?: string) => {
        if (!dateString) return 'N/A';
        return new Date(dateString).toLocaleString('fr-FR', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const getStatusBadge = (status: string) => {
        const styles = {
            draft: 'bg-surface-3 text-fg',
            scheduled: 'bg-blue-600 text-white',
            active: 'bg-green-600 text-white',
            paused: 'bg-yellow-600 text-white',
            completed: 'bg-purple-600 text-white',
            cancelled: 'bg-red-600 text-white'
        };
        return styles[status as keyof typeof styles] || 'bg-surface-3 text-fg';
    };

    const getTypeBadge = (type: string) => {
        return type === 'default' ? 'bg-blue-500 text-white' : 'bg-purple-500 text-white';
    };

    const getChannelBadge = (channel?: string) => {
        const styles: Record<string, string> = { email: 'bg-blue-700 text-blue-200', sms: 'bg-green-700 text-green-200', both: 'bg-indigo-700 text-indigo-200' };
        return styles[channel || 'email'] || styles.email;
    };

    const channelIcon = (channel?: string) => {
        if (channel === 'sms') return <Smartphone size={12} />;
        if (channel === 'both') return <Layers size={12} />;
        return <Mail size={12} />;
    };

    const calculateSuccessRate = (campaign: Campaign) => {
        if (campaign.messagesSent === 0) return 0;
        return ((campaign.messagesDelivered / campaign.messagesSent) * 100).toFixed(1);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="animate-spin text-blue-500" size={48} />
            </div>
        );
    }

    return (
        <div>
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight text-fg flex items-center gap-2">
                        <Target size={28} className="text-purple-500" />
                        Campagnes de relance
                    </h1>
                    <p className="text-fg-muted mt-2">Gérez et suivez toutes les campagnes de relance</p>
                </div>
                <button
                    onClick={handleRefresh}
                    disabled={refreshing}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 dark:disabled:bg-gray-600 text-white rounded-lg flex items-center gap-2 transition-colors"
                >
                    <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                    {refreshing ? 'Actualisation…' : 'Actualiser'}
                </button>
            </div>

            {/* Filters */}
            <div className="bg-surface rounded-lg p-4 border border-line mb-6">
                <div className="flex items-center gap-2 mb-3">
                    <Filter size={20} className="text-fg-muted" />
                    <h2 className="text-lg font-semibold text-fg">Filtres</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div>
                        <label className="block text-sm text-fg-muted mb-2">Statut</label>
                        <select
                            value={statusFilter}
                            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                            className="w-full px-3 py-2 bg-surface border border-line-strong rounded-lg text-fg focus:outline-hidden focus:border-blue-500"
                        >
                            <option value="all">Tous les statuts</option>
                            <option value="draft">Brouillon</option>
                            <option value="scheduled">Programmée</option>
                            <option value="active">Active</option>
                            <option value="paused">En pause</option>
                            <option value="completed">Terminée</option>
                            <option value="cancelled">Annulée</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm text-fg-muted mb-2">Type</label>
                        <select
                            value={typeFilter}
                            onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
                            className="w-full px-3 py-2 bg-surface border border-line-strong rounded-lg text-fg focus:outline-hidden focus:border-blue-500"
                        >
                            <option value="all">Tous les types</option>
                            <option value="default">Par défaut</option>
                            <option value="filtered">Filtrée</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm text-fg-muted mb-2">Canal</label>
                        <select
                            value={channelFilter}
                            onChange={(e) => { setChannelFilter(e.target.value); setPage(1); }}
                            className="w-full px-3 py-2 bg-surface border border-line-strong rounded-lg text-fg focus:outline-hidden focus:border-blue-500"
                        >
                            <option value="all">Tous</option>
                            <option value="email">E-mail</option>
                            <option value="sms">SMS</option>
                            <option value="both">E-mail + SMS</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm text-fg-muted mb-2">ID membre (facultatif)</label>
                        <input
                            type="text"
                            value={userIdFilter}
                            onChange={(e) => setUserIdFilter(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    setPage(1);
                                    loadCampaigns();
                                }
                            }}
                            placeholder="Saisir un ID membre…"
                            className="w-full px-3 py-2 bg-surface border border-line-strong rounded-lg text-fg focus:outline-hidden focus:border-blue-500"
                        />
                    </div>
                </div>
            </div>

            {/* Campaigns Grid */}
            {campaigns.length === 0 ? (
                <div className="bg-surface rounded-lg p-12 border border-line text-center">
                    <Target size={48} className="mx-auto text-fg-subtle mb-4" />
                    <p className="text-fg-muted text-lg">Aucune campagne trouvée</p>
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-1 gap-4 mb-6">
                        {campaigns.map((campaign) => (
                            <div
                                key={campaign._id}
                                className="bg-surface rounded-lg p-6 border border-line hover:border-line-strong transition-colors"
                            >
                                {/* Campaign Header */}
                                <div className="flex items-start justify-between mb-4">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                                            <h3 className="text-xl font-semibold text-fg">{campaign.name}</h3>
                                            <span className={`text-xs px-2 py-1 rounded-sm ${getStatusBadge(campaign.status)}`}>
                                                {STATUS_LABELS[campaign.status] ?? campaign.status}
                                            </span>
                                            <span className={`text-xs px-2 py-1 rounded-sm ${getTypeBadge(campaign.type)}`}>
                                                {TYPE_LABELS[campaign.type] ?? campaign.type}
                                            </span>
                                            {(campaign as any).channel && (
                                                <span className={`text-xs px-2 py-1 rounded-sm flex items-center gap-1 ${getChannelBadge((campaign as any).channel)}`}>
                                                    {channelIcon((campaign as any).channel)} {channelLabel(campaign)}
                                                </span>
                                            )}
                                            {(campaign as any).contactBatch && (
                                                <span className="text-xs px-2 py-1 rounded-sm bg-surface-3 text-fg-muted">
                                                    Lot: {(campaign as any).contactBatch.offset}–{(campaign as any).contactBatch.offset + (campaign as any).contactBatch.limit - 1}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-sm text-fg-muted">ID membre : {campaign.userId}</p>
                                        <p className="text-sm text-fg-muted">Créée le {formatDate(campaign.createdAt)}</p>
                                    </div>

                                    {/* Action Buttons */}
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => handleViewStats(campaign)}
                                            className="p-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
                                            title="Statistiques" aria-label="Statistiques"
                                        >
                                            <BarChart3 size={16} />
                                        </button>
                                        <button
                                            onClick={() => handleViewMessages(campaign)}
                                            className="p-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors"
                                            title="Messages récents" aria-label="Messages récents"
                                        >
                                            <MessageSquare size={16} />
                                        </button>
                                        <button
                                            onClick={() => handleViewDetails(campaign)}
                                            className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                                            title="Voir le détail" aria-label="Voir le détail"
                                        >
                                            <Eye size={16} />
                                        </button>
                                        <button
                                            onClick={() => handleViewTargets(campaign)}
                                            className="p-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
                                            title="Voir les cibles" aria-label="Voir les cibles"
                                        >
                                            <Users size={16} />
                                        </button>
                                        {campaign.status === 'active' && (
                                            <button
                                                onClick={() => handlePauseCampaign(campaign)}
                                                className="p-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg transition-colors"
                                                title="Mettre en pause" aria-label="Mettre en pause"
                                            >
                                                <Pause size={16} />
                                            </button>
                                        )}
                                        {campaign.status === 'paused' && (
                                            <button
                                                onClick={() => handleResumeCampaign(campaign)}
                                                className="p-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
                                                title="Reprendre" aria-label="Reprendre"
                                            >
                                                <Play size={16} />
                                            </button>
                                        )}
                                        {(campaign.status === 'active' || campaign.status === 'paused' || campaign.status === 'scheduled') && (
                                            <button
                                                onClick={() => handleCancelCampaign(campaign)}
                                                className="p-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
                                                title="Annuler la campagne" aria-label="Annuler la campagne"
                                            >
                                                <XCircle size={16} />
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {/* Campaign Stats */}
                                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 bg-surface-2 rounded-lg p-4">
                                    <div className="text-center">
                                        <p className="text-xs text-fg-muted mb-1">Inscrits</p>
                                        <p className="text-lg font-bold text-green-600 dark:text-green-400">{campaign.targetsEnrolled}</p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-xs text-fg-muted mb-1">Messages envoyés</p>
                                        <p className="text-lg font-bold text-blue-600 dark:text-blue-400">{campaign.messagesSent}</p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-xs text-fg-muted mb-1">Remis</p>
                                        <p className="text-lg font-bold text-purple-600 dark:text-purple-400">{campaign.messagesDelivered}</p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-xs text-fg-muted mb-1">Taux de réussite</p>
                                        <p className="text-lg font-bold text-yellow-700 dark:text-yellow-400">{calculateSuccessRate(campaign)}%</p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-xs text-fg-muted mb-1">Terminées</p>
                                        <p className="text-lg font-bold text-fg-muted">{campaign.targetsCompleted}</p>
                                    </div>
                                </div>

                                {/* Filter Info (for filtered campaigns) */}
                                {campaign.type === 'filtered' && campaign.targetFilter && (
                                    <div className="mt-4 p-3 bg-surface-2 rounded-lg">
                                        <p className="text-xs text-fg-muted mb-2">Critères de filtre :</p>
                                        <div className="flex flex-wrap gap-2">
                                            {campaign.targetFilter.countries && (
                                                <span className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded-sm">
                                                    Pays : {campaign.targetFilter.countries.join(', ')}
                                                </span>
                                            )}
                                            {campaign.targetFilter.gender && campaign.targetFilter.gender !== 'all' && (
                                                <span className="text-xs px-2 py-1 bg-pink-100 dark:bg-pink-900 text-pink-700 dark:text-pink-300 rounded-sm">
                                                    Sexe : {GENDER_LABELS[campaign.targetFilter.gender] ?? campaign.targetFilter.gender}
                                                </span>
                                            )}
                                            {campaign.targetFilter.professions && (
                                                <span className="text-xs px-2 py-1 bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 rounded-sm">
                                                    Professions : {campaign.targetFilter.professions.length}
                                                </span>
                                            )}
                                            {campaign.targetFilter.minAge && (
                                                <span className="text-xs px-2 py-1 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded-sm">
                                                    Âge min. : {campaign.targetFilter.minAge}
                                                </span>
                                            )}
                                            {campaign.targetFilter.maxAge && (
                                                <span className="text-xs px-2 py-1 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded-sm">
                                                    Âge max. : {campaign.targetFilter.maxAge}
                                                </span>
                                            )}
                                            {campaign.targetFilter.registrationDateFrom && (
                                                <span className="text-xs px-2 py-1 bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-300 rounded-sm">
                                                    Inscrits depuis le {new Date(campaign.targetFilter.registrationDateFrom).toLocaleDateString('fr-FR')}
                                                </span>
                                            )}
                                            {campaign.targetFilter.registrationDateTo && (
                                                <span className="text-xs px-2 py-1 bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-300 rounded-sm">
                                                    Inscrits jusqu'au {new Date(campaign.targetFilter.registrationDateTo).toLocaleDateString('fr-FR')}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-fg-muted mt-2">
                                            Cibles estimées : {campaign.estimatedTargetCount || 'N/A'}
                                        </p>
                                    </div>
                                )}

                                {/* Scheduled Info */}
                                {campaign.scheduledStartDate && campaign.status === 'scheduled' && (
                                    <div className="mt-3 p-2 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center gap-2">
                                        <Calendar size={16} className="text-blue-600 dark:text-blue-300" />
                                        <p className="text-sm text-blue-600 dark:text-blue-300">
                                            Démarrage prévu le {formatDate(campaign.scheduledStartDate)}
                                        </p>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-center gap-2">
                            <button
                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                disabled={page === 1}
                                className="px-4 py-2 bg-surface-2 hover:bg-surface-3 disabled:bg-surface-2 text-fg rounded-lg transition-colors"
                            >
                                Précédent
                            </button>
                            <span className="text-fg-muted">
                                Page {page} sur {totalPages}
                            </span>
                            <button
                                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                disabled={page === totalPages}
                                className="px-4 py-2 bg-surface-2 hover:bg-surface-3 disabled:bg-surface-2 text-fg rounded-lg transition-colors"
                            >
                                Suivant
                            </button>
                        </div>
                    )}
                </>
            )}

            {/* Campaign Details Modal */}
            {showDetailsModal && selectedCampaign && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowDetailsModal(false)}>
                    <div className="bg-surface rounded-lg p-6 max-w-3xl w-full max-h-[80vh] overflow-y-auto m-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-2xl font-bold text-fg">Détail de la campagne</h2>
                            <button
                                onClick={() => setShowDetailsModal(false)}
                                className="text-fg-muted hover:text-fg"
                                aria-label="Fermer"
                            >
                                <XCircle size={24} />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <p className="text-sm text-fg-muted">Nom</p>
                                <p className="text-lg text-fg">{selectedCampaign.name}</p>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <p className="text-sm text-fg-muted">Statut</p>
                                    <span className={`inline-block text-sm px-3 py-1 rounded-sm mt-1 ${getStatusBadge(selectedCampaign.status)}`}>
                                        {STATUS_LABELS[selectedCampaign.status] ?? selectedCampaign.status}
                                    </span>
                                </div>
                                <div>
                                    <p className="text-sm text-fg-muted">Type</p>
                                    <span className={`inline-block text-sm px-3 py-1 rounded-sm mt-1 ${getTypeBadge(selectedCampaign.type)}`}>
                                        {TYPE_LABELS[selectedCampaign.type] ?? selectedCampaign.type}
                                    </span>
                                </div>
                            </div>

                            <div>
                                <p className="text-sm text-fg-muted">ID membre</p>
                                <p className="text-fg font-mono text-sm">{selectedCampaign.userId}</p>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <p className="text-sm text-fg-muted">Canal d'envoi</p>
                                    <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-sm mt-1 ${getChannelBadge((selectedCampaign as any).channel)}`}>
                                        {channelIcon((selectedCampaign as any).channel)} {channelLabel(selectedCampaign)}
                                    </span>
                                </div>
                                {(selectedCampaign as any).contactBatch && (
                                    <div>
                                        <p className="text-sm text-fg-muted">Lot de contacts</p>
                                        <p className="text-fg text-sm mt-1">
                                            Positions {(selectedCampaign as any).contactBatch.offset} → {(selectedCampaign as any).contactBatch.offset + (selectedCampaign as any).contactBatch.limit - 1}
                                            <span className="text-fg-muted ml-1">({(selectedCampaign as any).contactBatch.limit} contacts)</span>
                                        </p>
                                    </div>
                                )}
                            </div>

                            {selectedCampaign.scheduledStartDate && (
                                <div>
                                    <p className="text-sm text-fg-muted">Démarrage prévu</p>
                                    <p className="text-fg">{formatDate(selectedCampaign.scheduledStartDate)}</p>
                                </div>
                            )}

                            {selectedCampaign.startedAt && (
                                <div>
                                    <p className="text-sm text-fg-muted">Démarrée le</p>
                                    <p className="text-fg">{formatDate(selectedCampaign.startedAt)}</p>
                                </div>
                            )}

                            {selectedCampaign.actualEndDate && (
                                <div>
                                    <p className="text-sm text-fg-muted">Terminée le</p>
                                    <p className="text-fg">{formatDate(selectedCampaign.actualEndDate)}</p>
                                </div>
                            )}

                            {selectedCampaign.cancellationReason && (
                                <div>
                                    <p className="text-sm text-fg-muted">Motif d'annulation</p>
                                    <p className="text-fg">{selectedCampaign.cancellationReason}</p>
                                </div>
                            )}

                            <div className="bg-surface-2 rounded-lg p-4">
                                <h3 className="text-lg font-semibold text-fg mb-3 flex items-center gap-2">
                                    <BarChart3 size={20} />
                                    Statistiques
                                </h3>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                    <div>
                                        <p className="text-xs text-fg-muted">Inscrits</p>
                                        <p className="text-xl font-bold text-green-600 dark:text-green-400">{selectedCampaign.targetsEnrolled}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-fg-muted">Messages envoyés</p>
                                        <p className="text-xl font-bold text-blue-600 dark:text-blue-400">{selectedCampaign.messagesSent}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-fg-muted">Remis</p>
                                        <p className="text-xl font-bold text-purple-600 dark:text-purple-400">{selectedCampaign.messagesDelivered}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-fg-muted">Échecs</p>
                                        <p className="text-xl font-bold text-red-600 dark:text-red-400">{selectedCampaign.messagesFailed}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-fg-muted">Terminées</p>
                                        <p className="text-xl font-bold text-yellow-700 dark:text-yellow-400">{selectedCampaign.targetsCompleted}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-fg-muted">Sorties</p>
                                        <p className="text-xl font-bold text-fg-muted">{selectedCampaign.targetsExited}</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Campaign Analytics Modal */}
            {showStatsModal && selectedCampaign && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowStatsModal(false)}>
                    <div className="bg-surface rounded-lg p-6 max-w-4xl w-full max-h-[85vh] overflow-y-auto m-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-2xl font-bold text-fg flex items-center gap-2">
                                <BarChart3 size={24} className="text-green-600 dark:text-green-400" />
                                Statistiques de la campagne
                            </h2>
                            <button
                                onClick={() => setShowStatsModal(false)}
                                className="text-fg-muted hover:text-fg"
                                aria-label="Fermer"
                            >
                                <XCircle size={24} />
                            </button>
                        </div>

                        {loadingStats ? (
                            <div className="flex items-center justify-center py-12">
                                <Loader2 className="animate-spin text-blue-500" size={32} />
                            </div>
                        ) : campaignStats ? (
                            <div className="space-y-6">
                                {/* Campaign Info */}
                                <div className="flex items-center gap-3">
                                    <h3 className="text-xl font-semibold text-fg">{campaignStats.campaign.name}</h3>
                                    <span className={`text-xs px-2 py-1 rounded-sm ${getStatusBadge(campaignStats.campaign.status)}`}>
                                        {STATUS_LABELS[campaignStats.campaign.status] ?? campaignStats.campaign.status}
                                    </span>
                                    <span className={`text-xs px-2 py-1 rounded-sm ${getTypeBadge(campaignStats.campaign.type)}`}>
                                        {TYPE_LABELS[campaignStats.campaign.type] ?? campaignStats.campaign.type}
                                    </span>
                                </div>

                                {/* Overview Stats */}
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    <div className="bg-surface-2 rounded-lg p-4 text-center">
                                        <Users size={24} className="mx-auto text-green-600 dark:text-green-400 mb-2" />
                                        <p className="text-2xl font-bold text-green-600 dark:text-green-400">{campaignStats.totalEnrolled}</p>
                                        <p className="text-xs text-fg-muted">Total inscrits</p>
                                    </div>
                                    <div className="bg-surface-2 rounded-lg p-4 text-center">
                                        <Target size={24} className="mx-auto text-blue-600 dark:text-blue-400 mb-2" />
                                        <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{campaignStats.activeTargets}</p>
                                        <p className="text-xs text-fg-muted">Cibles actives</p>
                                    </div>
                                    <div className="bg-surface-2 rounded-lg p-4 text-center">
                                        <CheckCircle size={24} className="mx-auto text-purple-600 dark:text-purple-400 mb-2" />
                                        <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">{campaignStats.completedRelance}</p>
                                        <p className="text-xs text-fg-muted">Terminées</p>
                                    </div>
                                    <div className="bg-surface-2 rounded-lg p-4 text-center">
                                        <TrendingUp size={24} className="mx-auto text-yellow-700 dark:text-yellow-400 mb-2" />
                                        <p className="text-2xl font-bold text-yellow-700 dark:text-yellow-400">{campaignStats.deliveryPercentage}%</p>
                                        <p className="text-xs text-fg-muted">Taux de remise</p>
                                    </div>
                                </div>

                                {/* Message Stats */}
                                <div className="bg-surface-2 rounded-lg p-4">
                                    <h4 className="text-md font-semibold text-fg mb-3 flex items-center gap-2">
                                        <Mail size={18} />
                                        Statistiques des messages
                                    </h4>
                                    <div className="grid grid-cols-3 gap-4">
                                        <div className="text-center">
                                            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{campaignStats.totalMessagesSent}</p>
                                            <p className="text-xs text-fg-muted">Total envoyés</p>
                                        </div>
                                        <div className="text-center">
                                            <p className="text-2xl font-bold text-green-600 dark:text-green-400">{campaignStats.totalMessagesDelivered}</p>
                                            <p className="text-xs text-fg-muted">Remis</p>
                                        </div>
                                        <div className="text-center">
                                            <p className="text-2xl font-bold text-red-600 dark:text-red-400">{campaignStats.totalMessagesFailed}</p>
                                            <p className="text-xs text-fg-muted">Échecs</p>
                                        </div>
                                    </div>
                                    {/* Delivery bar */}
                                    <div className="mt-4">
                                        <div className="flex justify-between text-xs text-fg-muted mb-1">
                                            <span>Progression des envois</span>
                                            <span>{campaignStats.deliveryPercentage}%</span>
                                        </div>
                                        <div className="w-full bg-surface-3 rounded-full h-3">
                                            <div
                                                className="h-3 rounded-full transition-all"
                                                style={{
                                                    width: `${campaignStats.deliveryPercentage}%`,
                                                    background: `linear-gradient(90deg, #10B981, #115CF6)`
                                                }}
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Day Progression */}
                                <div className="bg-surface-2 rounded-lg p-4">
                                    <h4 className="text-md font-semibold text-fg mb-3">Progression par jour</h4>
                                    <div className="grid grid-cols-7 gap-2">
                                        {campaignStats.dayProgression.map(({ day, count }) => {
                                            const maxCount = Math.max(...campaignStats.dayProgression.map(d => d.count), 1);
                                            const heightPct = (count / maxCount) * 100;
                                            return (
                                                <div key={day} className="text-center">
                                                    <div className="h-24 flex items-end justify-center mb-1">
                                                        <div
                                                            className="w-8 rounded-t transition-all"
                                                            style={{
                                                                height: `${Math.max(heightPct, 4)}%`,
                                                                background: `linear-gradient(180deg, #115CF6, #10B981)`
                                                            }}
                                                        />
                                                    </div>
                                                    <p className="text-sm font-bold text-fg">{count}</p>
                                                    <p className="text-xs text-fg-muted">Jour {day}</p>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Exit Reasons */}
                                {Object.keys(campaignStats.exitReasons).length > 0 && (
                                    <div className="bg-surface-2 rounded-lg p-4">
                                        <h4 className="text-md font-semibold text-fg mb-3">Motifs de sortie</h4>
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                            {Object.entries(campaignStats.exitReasons).map(([reason, count]) => {
                                                const colors: Record<string, string> = {
                                                    paid: 'text-green-600 dark:text-green-400',
                                                    completed_7_days: 'text-blue-600 dark:text-blue-400',
                                                    completed_7days: 'text-blue-600 dark:text-blue-400',
                                                    subscription_expired: 'text-yellow-700 dark:text-yellow-400',
                                                    manual: 'text-red-600 dark:text-red-400',
                                                    referrer_inactive: 'text-orange-600 dark:text-orange-400'
                                                };
                                                const labels = EXIT_REASON_LABELS;
                                                return (
                                                    <div key={reason} className="bg-surface-3 rounded-lg p-3 text-center">
                                                        <p className={`text-xl font-bold ${colors[reason] || 'text-fg-muted'}`}>{count}</p>
                                                        <p className="text-xs text-fg-muted">{labels[reason] || reason}</p>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <p className="text-fg-muted text-center py-8">Aucune statistique disponible</p>
                        )}
                    </div>
                </div>
            )}

            {/* Recent Messages Modal */}
            {showMessagesModal && selectedCampaign && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => { setShowMessagesModal(false); setViewingEmailHtml(null); }}>
                    <div className="bg-surface rounded-lg p-6 max-w-4xl w-full max-h-[85vh] overflow-y-auto m-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-2xl font-bold text-fg flex items-center gap-2">
                                <MessageSquare size={24} className="text-orange-600 dark:text-orange-400" />
                                {viewingEmailHtml ? "Aperçu de l'e-mail" : `Messages récents - ${selectedCampaign.name}`}
                            </h2>
                            <div className="flex items-center gap-2">
                                {viewingEmailHtml && (
                                    <button
                                        onClick={() => setViewingEmailHtml(null)}
                                        className="px-3 py-1.5 bg-surface-3 hover:bg-line-strong text-fg rounded-lg text-sm transition-colors"
                                    >
                                        Retour à la liste
                                    </button>
                                )}
                                <button
                                    onClick={() => { setShowMessagesModal(false); setViewingEmailHtml(null); }}
                                    className="text-fg-muted hover:text-fg"
                                    aria-label="Fermer"
                                >
                                    <XCircle size={24} />
                                </button>
                            </div>
                        </div>

                        {viewingEmailHtml ? (
                            <div className="bg-white rounded-lg overflow-hidden">
                                <iframe
                                    srcDoc={viewingEmailHtml}
                                    className="w-full border-0"
                                    style={{ height: 'calc(85vh - 140px)', minHeight: '500px' }}
                                    title="Aperçu de l'e-mail"
                                    sandbox="allow-same-origin"
                                />
                            </div>
                        ) : loadingMessages ? (
                            <div className="flex items-center justify-center py-12">
                                <Loader2 className="animate-spin text-blue-500" size={32} />
                            </div>
                        ) : recentMessages.length === 0 ? (
                            <div className="text-center py-12">
                                <MessageSquare size={48} className="mx-auto text-fg-subtle mb-4" />
                                <p className="text-fg-muted">Aucun message envoyé pour cette campagne</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {recentMessages.map((msg, index) => (
                                    <div
                                        key={index}
                                        className={`p-4 rounded-lg border ${
                                            msg.status === 'delivered'
                                                ? 'bg-surface-2 border-line-strong'
                                                : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-3">
                                                <span className="text-sm font-semibold text-fg">
                                                    Jour {msg.day}
                                                </span>
                                                <span className={`text-xs px-2 py-0.5 rounded ${
                                                    msg.status === 'delivered'
                                                        ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300'
                                                        : 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300'
                                                }`}>
                                                    {msg.status === 'delivered' ? (
                                                        <span className="flex items-center gap-1"><CheckCircle size={12} /> Remis</span>
                                                    ) : (
                                                        <span className="flex items-center gap-1"><AlertTriangle size={12} /> Échec</span>
                                                    )}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {msg.renderedHtml && (
                                                    <button
                                                        onClick={() => setViewingEmailHtml(msg.renderedHtml!)}
                                                        className="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded-sm text-xs flex items-center gap-1 transition-colors"
                                                    >
                                                        <Eye size={12} />
                                                        Voir l'e-mail
                                                    </button>
                                                )}
                                                <span className="text-xs text-fg-muted">
                                                    {formatFullDate(msg.sentAt)}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            {msg.referralUser?.avatar ? (
                                                <img
                                                    src={msg.referralUser.avatar}
                                                    alt=""
                                                    className="w-8 h-8 rounded-full object-cover"
                                                />
                                            ) : (
                                                <div className="w-8 h-8 rounded-full bg-surface-3 flex items-center justify-center">
                                                    <Users size={14} className="text-fg-muted" />
                                                </div>
                                            )}
                                            <div className="flex-1">
                                                <p className="text-sm text-fg">
                                                    {msg.referralUser?.name || 'Membre inconnu'}
                                                </p>
                                                <p className="text-xs text-fg-muted">
                                                    {msg.referralUser?.email || 'Pas d\'e-mail'}
                                                    {msg.referralUser?.phoneNumber && ` | ${msg.referralUser.phoneNumber}`}
                                                </p>
                                            </div>
                                        </div>
                                        {msg.errorMessage && (
                                            <div className="mt-2 text-xs text-red-700 dark:text-red-400 bg-red-100 dark:bg-red-900/30 px-3 py-1 rounded-sm">
                                                Erreur : {msg.errorMessage}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Campaign Targets Modal */}
            {showTargetsModal && selectedCampaign && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowTargetsModal(false)}>
                    <div className="bg-surface rounded-lg p-6 max-w-4xl w-full max-h-[80vh] overflow-y-auto m-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-2xl font-bold text-fg flex items-center gap-2">
                                <Users size={24} />
                                Cibles de la campagne ({selectedCampaign.name})
                            </h2>
                            <button
                                onClick={() => setShowTargetsModal(false)}
                                className="text-fg-muted hover:text-fg"
                                aria-label="Fermer"
                            >
                                <XCircle size={24} />
                            </button>
                        </div>

                        {campaignTargets.length === 0 ? (
                            <p className="text-fg-muted text-center py-8">Aucune cible trouvée</p>
                        ) : (
                            <div className="space-y-3">
                                {campaignTargets.map((target) => (
                                    <div key={target._id} className="p-4 bg-surface-2 rounded-lg border border-line-strong">
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-sm font-medium text-fg">
                                                Jour {target.currentDay}/7
                                            </span>
                                            <span className={`text-xs px-2 py-1 rounded-sm ${getStatusBadge(target.status)}`}>
                                                {STATUS_LABELS[target.status] ?? target.status}
                                            </span>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-fg-muted">
                                            <div>
                                                <p>ID filleul : {target.referralUserId}</p>
                                                <p>ID parrain : {target.referrerUserId}</p>
                                                <p>Langue : {LANGUAGE_LABELS[target.language] ?? target.language}</p>
                                            </div>
                                            <div>
                                                <p>Entrée : {formatDate(target.enteredLoopAt)}</p>
                                                <p>Prochain message : {formatDate(target.nextMessageDue)}</p>
                                                <p>Messages : {target.messagesDelivered.length}</p>
                                            </div>
                                        </div>
                                        {target.exitReason && (
                                            <div className="mt-2 text-xs text-yellow-700 dark:text-yellow-400">
                                                Motif de sortie : {EXIT_REASON_LABELS[target.exitReason] ?? target.exitReason}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Confirmation Modal */}
            {confirmAction && (
                <ConfirmationModal
                    isOpen={showConfirmModal}
                    title={confirmAction.title}
                    message={confirmAction.message}
                    confirmText="Confirmer"
                    cancelText="Fermer"
                    onConfirm={confirmAction.onConfirm}
                    onCancel={() => {
                        setShowConfirmModal(false);
                        setCancellationReason('');
                    }}
                >
                    {/* Optional cancellation reason input */}
                    <div className="mt-4">
                        <label className="block text-sm font-medium text-fg-muted mb-2">
                            Motif d'annulation (facultatif)
                        </label>
                        <textarea
                            value={cancellationReason}
                            onChange={(e) => setCancellationReason(e.target.value)}
                            placeholder="Saisir le motif de l'annulation…"
                            className="w-full px-3 py-2 bg-surface border border-line-strong rounded-lg text-fg placeholder-fg-subtle focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                            rows={3}
                        />
                    </div>
                </ConfirmationModal>
            )}
        </div>
    );
};

export default RelanceCampaignsPage;
