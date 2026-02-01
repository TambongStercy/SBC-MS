import React, { useState, useEffect } from 'react';
import { Target, Users, TrendingUp, Play, Pause, XCircle, Eye, RefreshCw, Loader2, Filter, Calendar, BarChart3, MessageSquare, Mail, CheckCircle, AlertTriangle } from 'lucide-react';
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
    const [userIdFilter, setUserIdFilter] = useState<string>('');

    useEffect(() => {
        loadCampaigns();
    }, [statusFilter, typeFilter, page]);

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
            if (userIdFilter) filters.userId = userIdFilter;

            const data = await getAllCampaigns(filters);
            setCampaigns(data.campaigns);
            setTotalPages(data.totalPages);
        } catch (error: any) {
            console.error('Error loading campaigns:', error);
            toast.error('Failed to load campaigns: ' + (error.response?.data?.message || error.message));
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
            toast.error('Failed to load campaign details: ' + (error.response?.data?.message || error.message));
        }
    };

    const handleViewTargets = async (campaign: Campaign) => {
        try {
            setSelectedCampaign(campaign);
            const data = await getCampaignTargets(campaign._id, 1, 50);
            setCampaignTargets(data.targets);
            setShowTargetsModal(true);
        } catch (error: any) {
            toast.error('Failed to load campaign targets: ' + (error.response?.data?.message || error.message));
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
            toast.error('Failed to load campaign stats: ' + (error.response?.data?.message || error.message));
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
            toast.error('Failed to load recent messages: ' + (error.response?.data?.message || error.message));
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
            toast.success('Campaign paused successfully');
            updateCampaignState(updated);
        } catch (error: any) {
            toast.error('Failed to pause campaign: ' + (error.response?.data?.message || error.message));
        }
    };

    const handleResumeCampaign = async (campaign: Campaign) => {
        try {
            const updated = await resumeCampaign(campaign._id, campaign.userId);
            toast.success('Campaign resumed successfully');
            updateCampaignState(updated);
        } catch (error: any) {
            toast.error('Failed to resume campaign: ' + (error.response?.data?.message || error.message));
        }
    };

    const handleCancelCampaign = async (campaign: Campaign) => {
        setCancellationReason('');
        setConfirmAction({
            title: 'Cancel Campaign',
            message: `Are you sure you want to cancel campaign "${campaign.name}"? All active targets will exit the loop.`,
            onConfirm: async () => {
                try {
                    const updated = await cancelCampaign(campaign._id, campaign.userId, cancellationReason || undefined);
                    toast.success('Campaign cancelled successfully');
                    updateCampaignState(updated);
                    setShowConfirmModal(false);
                    setCancellationReason('');
                } catch (error: any) {
                    toast.error('Failed to cancel campaign: ' + (error.response?.data?.message || error.message));
                }
            }
        });
        setShowConfirmModal(true);
    };

    const formatDate = (dateString?: string) => {
        if (!dateString) return 'N/A';
        return new Date(dateString).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const formatFullDate = (dateString?: string) => {
        if (!dateString) return 'N/A';
        return new Date(dateString).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const getStatusBadge = (status: string) => {
        const styles = {
            draft: 'bg-gray-600',
            scheduled: 'bg-blue-600',
            active: 'bg-green-600',
            paused: 'bg-yellow-600',
            completed: 'bg-purple-600',
            cancelled: 'bg-red-600'
        };
        return styles[status as keyof typeof styles] || 'bg-gray-600';
    };

    const getTypeBadge = (type: string) => {
        return type === 'default' ? 'bg-blue-500' : 'bg-purple-500';
    };

    const calculateSuccessRate = (campaign: Campaign) => {
        if (campaign.messagesSent === 0) return 0;
        return ((campaign.messagesDelivered / campaign.messagesSent) * 100).toFixed(1);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-screen">
                <Loader2 className="animate-spin text-blue-500" size={48} />
            </div>
        );
    }

    return (
        <div className="p-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-3xl font-bold text-gray-100 flex items-center gap-2">
                        <Target size={32} className="text-purple-500" />
                        Relance Campaigns
                    </h1>
                    <p className="text-gray-400 mt-2">Manage and monitor all relance campaigns</p>
                </div>
                <button
                    onClick={handleRefresh}
                    disabled={refreshing}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded-lg flex items-center gap-2 transition-colors"
                >
                    <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
                    {refreshing ? 'Refreshing...' : 'Refresh'}
                </button>
            </div>

            {/* Filters */}
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700 mb-6">
                <div className="flex items-center gap-2 mb-3">
                    <Filter size={20} className="text-gray-400" />
                    <h2 className="text-lg font-semibold text-gray-100">Filters</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <label className="block text-sm text-gray-400 mb-2">Status</label>
                        <select
                            value={statusFilter}
                            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-gray-100 focus:outline-none focus:border-blue-500"
                        >
                            <option value="all">All</option>
                            <option value="draft">Draft</option>
                            <option value="scheduled">Scheduled</option>
                            <option value="active">Active</option>
                            <option value="paused">Paused</option>
                            <option value="completed">Completed</option>
                            <option value="cancelled">Cancelled</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm text-gray-400 mb-2">Type</label>
                        <select
                            value={typeFilter}
                            onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
                            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-gray-100 focus:outline-none focus:border-blue-500"
                        >
                            <option value="all">All</option>
                            <option value="default">Default</option>
                            <option value="filtered">Filtered</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm text-gray-400 mb-2">User ID (optional)</label>
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
                            placeholder="Enter user ID..."
                            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-gray-100 focus:outline-none focus:border-blue-500"
                        />
                    </div>
                </div>
            </div>

            {/* Campaigns Grid */}
            {campaigns.length === 0 ? (
                <div className="bg-gray-800 rounded-lg p-12 border border-gray-700 text-center">
                    <Target size={48} className="mx-auto text-gray-600 mb-4" />
                    <p className="text-gray-400 text-lg">No campaigns found</p>
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-1 gap-4 mb-6">
                        {campaigns.map((campaign) => (
                            <div
                                key={campaign._id}
                                className="bg-gray-800 rounded-lg p-6 border border-gray-700 hover:border-gray-600 transition-colors"
                            >
                                {/* Campaign Header */}
                                <div className="flex items-start justify-between mb-4">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-3 mb-2">
                                            <h3 className="text-xl font-semibold text-gray-100">{campaign.name}</h3>
                                            <span className={`text-xs px-2 py-1 rounded ${getStatusBadge(campaign.status)}`}>
                                                {campaign.status}
                                            </span>
                                            <span className={`text-xs px-2 py-1 rounded ${getTypeBadge(campaign.type)}`}>
                                                {campaign.type}
                                            </span>
                                        </div>
                                        <p className="text-sm text-gray-400">User ID: {campaign.userId}</p>
                                        <p className="text-sm text-gray-400">Created: {formatDate(campaign.createdAt)}</p>
                                    </div>

                                    {/* Action Buttons */}
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => handleViewStats(campaign)}
                                            className="p-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
                                            title="View Analytics"
                                        >
                                            <BarChart3 size={16} />
                                        </button>
                                        <button
                                            onClick={() => handleViewMessages(campaign)}
                                            className="p-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors"
                                            title="Recent Messages"
                                        >
                                            <MessageSquare size={16} />
                                        </button>
                                        <button
                                            onClick={() => handleViewDetails(campaign)}
                                            className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                                            title="View Details"
                                        >
                                            <Eye size={16} />
                                        </button>
                                        <button
                                            onClick={() => handleViewTargets(campaign)}
                                            className="p-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
                                            title="View Targets"
                                        >
                                            <Users size={16} />
                                        </button>
                                        {campaign.status === 'active' && (
                                            <button
                                                onClick={() => handlePauseCampaign(campaign)}
                                                className="p-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg transition-colors"
                                                title="Pause Campaign"
                                            >
                                                <Pause size={16} />
                                            </button>
                                        )}
                                        {campaign.status === 'paused' && (
                                            <button
                                                onClick={() => handleResumeCampaign(campaign)}
                                                className="p-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
                                                title="Resume Campaign"
                                            >
                                                <Play size={16} />
                                            </button>
                                        )}
                                        {(campaign.status === 'active' || campaign.status === 'paused' || campaign.status === 'scheduled') && (
                                            <button
                                                onClick={() => handleCancelCampaign(campaign)}
                                                className="p-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
                                                title="Cancel Campaign"
                                            >
                                                <XCircle size={16} />
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {/* Campaign Stats */}
                                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 bg-gray-700 rounded-lg p-4">
                                    <div className="text-center">
                                        <p className="text-xs text-gray-400 mb-1">Enrolled</p>
                                        <p className="text-lg font-bold text-green-400">{campaign.targetsEnrolled}</p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-xs text-gray-400 mb-1">Messages Sent</p>
                                        <p className="text-lg font-bold text-blue-400">{campaign.messagesSent}</p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-xs text-gray-400 mb-1">Delivered</p>
                                        <p className="text-lg font-bold text-purple-400">{campaign.messagesDelivered}</p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-xs text-gray-400 mb-1">Success Rate</p>
                                        <p className="text-lg font-bold text-yellow-400">{calculateSuccessRate(campaign)}%</p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-xs text-gray-400 mb-1">Completed</p>
                                        <p className="text-lg font-bold text-gray-400">{campaign.targetsCompleted}</p>
                                    </div>
                                </div>

                                {/* Filter Info (for filtered campaigns) */}
                                {campaign.type === 'filtered' && campaign.targetFilter && (
                                    <div className="mt-4 p-3 bg-gray-700 rounded-lg">
                                        <p className="text-xs text-gray-400 mb-2">Filter Criteria:</p>
                                        <div className="flex flex-wrap gap-2">
                                            {campaign.targetFilter.countries && (
                                                <span className="text-xs px-2 py-1 bg-blue-900 text-blue-300 rounded">
                                                    Countries: {campaign.targetFilter.countries.join(', ')}
                                                </span>
                                            )}
                                            {campaign.targetFilter.gender && campaign.targetFilter.gender !== 'all' && (
                                                <span className="text-xs px-2 py-1 bg-pink-900 text-pink-300 rounded">
                                                    Gender: {campaign.targetFilter.gender}
                                                </span>
                                            )}
                                            {campaign.targetFilter.professions && (
                                                <span className="text-xs px-2 py-1 bg-purple-900 text-purple-300 rounded">
                                                    Professions: {campaign.targetFilter.professions.length}
                                                </span>
                                            )}
                                            {campaign.targetFilter.minAge && (
                                                <span className="text-xs px-2 py-1 bg-green-900 text-green-300 rounded">
                                                    Min Age: {campaign.targetFilter.minAge}
                                                </span>
                                            )}
                                            {campaign.targetFilter.maxAge && (
                                                <span className="text-xs px-2 py-1 bg-green-900 text-green-300 rounded">
                                                    Max Age: {campaign.targetFilter.maxAge}
                                                </span>
                                            )}
                                            {campaign.targetFilter.registrationDateFrom && (
                                                <span className="text-xs px-2 py-1 bg-yellow-900 text-yellow-300 rounded">
                                                    Reg From: {new Date(campaign.targetFilter.registrationDateFrom).toLocaleDateString()}
                                                </span>
                                            )}
                                            {campaign.targetFilter.registrationDateTo && (
                                                <span className="text-xs px-2 py-1 bg-yellow-900 text-yellow-300 rounded">
                                                    Reg To: {new Date(campaign.targetFilter.registrationDateTo).toLocaleDateString()}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-gray-400 mt-2">
                                            Estimated targets: {campaign.estimatedTargetCount || 'N/A'}
                                        </p>
                                    </div>
                                )}

                                {/* Scheduled Info */}
                                {campaign.scheduledStartDate && campaign.status === 'scheduled' && (
                                    <div className="mt-3 p-2 bg-blue-900 rounded-lg flex items-center gap-2">
                                        <Calendar size={16} className="text-blue-300" />
                                        <p className="text-sm text-blue-300">
                                            Scheduled to start: {formatDate(campaign.scheduledStartDate)}
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
                                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 text-gray-100 rounded-lg transition-colors"
                            >
                                Previous
                            </button>
                            <span className="text-gray-400">
                                Page {page} of {totalPages}
                            </span>
                            <button
                                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                disabled={page === totalPages}
                                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 text-gray-100 rounded-lg transition-colors"
                            >
                                Next
                            </button>
                        </div>
                    )}
                </>
            )}

            {/* Campaign Details Modal */}
            {showDetailsModal && selectedCampaign && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50" onClick={() => setShowDetailsModal(false)}>
                    <div className="bg-gray-800 rounded-lg p-6 max-w-3xl w-full max-h-[80vh] overflow-y-auto m-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-2xl font-bold text-gray-100">Campaign Details</h2>
                            <button
                                onClick={() => setShowDetailsModal(false)}
                                className="text-gray-400 hover:text-gray-100"
                            >
                                <XCircle size={24} />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <p className="text-sm text-gray-400">Name</p>
                                <p className="text-lg text-gray-100">{selectedCampaign.name}</p>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <p className="text-sm text-gray-400">Status</p>
                                    <span className={`inline-block text-sm px-3 py-1 rounded mt-1 ${getStatusBadge(selectedCampaign.status)}`}>
                                        {selectedCampaign.status}
                                    </span>
                                </div>
                                <div>
                                    <p className="text-sm text-gray-400">Type</p>
                                    <span className={`inline-block text-sm px-3 py-1 rounded mt-1 ${getTypeBadge(selectedCampaign.type)}`}>
                                        {selectedCampaign.type}
                                    </span>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <p className="text-sm text-gray-400">User ID</p>
                                    <p className="text-gray-100 font-mono text-sm">{selectedCampaign.userId}</p>
                                </div>
                                <div>
                                    <p className="text-sm text-gray-400">Max Messages/Day</p>
                                    <p className="text-gray-100">{selectedCampaign.maxMessagesPerDay || 'Default'}</p>
                                </div>
                            </div>

                            {selectedCampaign.scheduledStartDate && (
                                <div>
                                    <p className="text-sm text-gray-400">Scheduled Start</p>
                                    <p className="text-gray-100">{formatDate(selectedCampaign.scheduledStartDate)}</p>
                                </div>
                            )}

                            {selectedCampaign.startedAt && (
                                <div>
                                    <p className="text-sm text-gray-400">Actually Started</p>
                                    <p className="text-gray-100">{formatDate(selectedCampaign.startedAt)}</p>
                                </div>
                            )}

                            {selectedCampaign.actualEndDate && (
                                <div>
                                    <p className="text-sm text-gray-400">Ended</p>
                                    <p className="text-gray-100">{formatDate(selectedCampaign.actualEndDate)}</p>
                                </div>
                            )}

                            {selectedCampaign.cancellationReason && (
                                <div>
                                    <p className="text-sm text-gray-400">Cancellation Reason</p>
                                    <p className="text-gray-100">{selectedCampaign.cancellationReason}</p>
                                </div>
                            )}

                            <div className="bg-gray-700 rounded-lg p-4">
                                <h3 className="text-lg font-semibold text-gray-100 mb-3 flex items-center gap-2">
                                    <BarChart3 size={20} />
                                    Statistics
                                </h3>
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                    <div>
                                        <p className="text-xs text-gray-400">Enrolled</p>
                                        <p className="text-xl font-bold text-green-400">{selectedCampaign.targetsEnrolled}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-gray-400">Messages Sent</p>
                                        <p className="text-xl font-bold text-blue-400">{selectedCampaign.messagesSent}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-gray-400">Delivered</p>
                                        <p className="text-xl font-bold text-purple-400">{selectedCampaign.messagesDelivered}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-gray-400">Failed</p>
                                        <p className="text-xl font-bold text-red-400">{selectedCampaign.messagesFailed}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-gray-400">Completed</p>
                                        <p className="text-xl font-bold text-yellow-400">{selectedCampaign.targetsCompleted}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-gray-400">Exited</p>
                                        <p className="text-xl font-bold text-gray-400">{selectedCampaign.targetsExited}</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Campaign Analytics Modal */}
            {showStatsModal && selectedCampaign && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50" onClick={() => setShowStatsModal(false)}>
                    <div className="bg-gray-800 rounded-lg p-6 max-w-4xl w-full max-h-[85vh] overflow-y-auto m-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-2xl font-bold text-gray-100 flex items-center gap-2">
                                <BarChart3 size={24} className="text-green-400" />
                                Campaign Analytics
                            </h2>
                            <button
                                onClick={() => setShowStatsModal(false)}
                                className="text-gray-400 hover:text-gray-100"
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
                                    <h3 className="text-xl font-semibold text-gray-100">{campaignStats.campaign.name}</h3>
                                    <span className={`text-xs px-2 py-1 rounded ${getStatusBadge(campaignStats.campaign.status)}`}>
                                        {campaignStats.campaign.status}
                                    </span>
                                    <span className={`text-xs px-2 py-1 rounded ${getTypeBadge(campaignStats.campaign.type)}`}>
                                        {campaignStats.campaign.type}
                                    </span>
                                </div>

                                {/* Overview Stats */}
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    <div className="bg-gray-700 rounded-lg p-4 text-center">
                                        <Users size={24} className="mx-auto text-green-400 mb-2" />
                                        <p className="text-2xl font-bold text-green-400">{campaignStats.totalEnrolled}</p>
                                        <p className="text-xs text-gray-400">Total Enrolled</p>
                                    </div>
                                    <div className="bg-gray-700 rounded-lg p-4 text-center">
                                        <Target size={24} className="mx-auto text-blue-400 mb-2" />
                                        <p className="text-2xl font-bold text-blue-400">{campaignStats.activeTargets}</p>
                                        <p className="text-xs text-gray-400">Active Targets</p>
                                    </div>
                                    <div className="bg-gray-700 rounded-lg p-4 text-center">
                                        <CheckCircle size={24} className="mx-auto text-purple-400 mb-2" />
                                        <p className="text-2xl font-bold text-purple-400">{campaignStats.completedRelance}</p>
                                        <p className="text-xs text-gray-400">Completed</p>
                                    </div>
                                    <div className="bg-gray-700 rounded-lg p-4 text-center">
                                        <TrendingUp size={24} className="mx-auto text-yellow-400 mb-2" />
                                        <p className="text-2xl font-bold text-yellow-400">{campaignStats.deliveryPercentage}%</p>
                                        <p className="text-xs text-gray-400">Delivery Rate</p>
                                    </div>
                                </div>

                                {/* Message Stats */}
                                <div className="bg-gray-700 rounded-lg p-4">
                                    <h4 className="text-md font-semibold text-gray-100 mb-3 flex items-center gap-2">
                                        <Mail size={18} />
                                        Message Statistics
                                    </h4>
                                    <div className="grid grid-cols-3 gap-4">
                                        <div className="text-center">
                                            <p className="text-2xl font-bold text-blue-400">{campaignStats.totalMessagesSent}</p>
                                            <p className="text-xs text-gray-400">Total Sent</p>
                                        </div>
                                        <div className="text-center">
                                            <p className="text-2xl font-bold text-green-400">{campaignStats.totalMessagesDelivered}</p>
                                            <p className="text-xs text-gray-400">Delivered</p>
                                        </div>
                                        <div className="text-center">
                                            <p className="text-2xl font-bold text-red-400">{campaignStats.totalMessagesFailed}</p>
                                            <p className="text-xs text-gray-400">Failed</p>
                                        </div>
                                    </div>
                                    {/* Delivery bar */}
                                    <div className="mt-4">
                                        <div className="flex justify-between text-xs text-gray-400 mb-1">
                                            <span>Delivery Progress</span>
                                            <span>{campaignStats.deliveryPercentage}%</span>
                                        </div>
                                        <div className="w-full bg-gray-600 rounded-full h-3">
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
                                <div className="bg-gray-700 rounded-lg p-4">
                                    <h4 className="text-md font-semibold text-gray-100 mb-3">Day Progression</h4>
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
                                                    <p className="text-sm font-bold text-gray-100">{count}</p>
                                                    <p className="text-xs text-gray-400">Day {day}</p>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Exit Reasons */}
                                {Object.keys(campaignStats.exitReasons).length > 0 && (
                                    <div className="bg-gray-700 rounded-lg p-4">
                                        <h4 className="text-md font-semibold text-gray-100 mb-3">Exit Reasons</h4>
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                            {Object.entries(campaignStats.exitReasons).map(([reason, count]) => {
                                                const colors: Record<string, string> = {
                                                    paid: 'text-green-400',
                                                    completed_7_days: 'text-blue-400',
                                                    completed_7days: 'text-blue-400',
                                                    subscription_expired: 'text-yellow-400',
                                                    manual: 'text-red-400',
                                                    referrer_inactive: 'text-orange-400'
                                                };
                                                const labels: Record<string, string> = {
                                                    paid: 'Paid',
                                                    completed_7_days: 'Completed 7 Days',
                                                    completed_7days: 'Completed 7 Days',
                                                    subscription_expired: 'Sub Expired',
                                                    manual: 'Manual Exit',
                                                    referrer_inactive: 'Referrer Inactive'
                                                };
                                                return (
                                                    <div key={reason} className="bg-gray-600 rounded-lg p-3 text-center">
                                                        <p className={`text-xl font-bold ${colors[reason] || 'text-gray-300'}`}>{count}</p>
                                                        <p className="text-xs text-gray-400">{labels[reason] || reason}</p>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <p className="text-gray-400 text-center py-8">No stats available</p>
                        )}
                    </div>
                </div>
            )}

            {/* Recent Messages Modal */}
            {showMessagesModal && selectedCampaign && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50" onClick={() => { setShowMessagesModal(false); setViewingEmailHtml(null); }}>
                    <div className="bg-gray-800 rounded-lg p-6 max-w-4xl w-full max-h-[85vh] overflow-y-auto m-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-2xl font-bold text-gray-100 flex items-center gap-2">
                                <MessageSquare size={24} className="text-orange-400" />
                                {viewingEmailHtml ? 'Email Preview' : `Recent Messages - ${selectedCampaign.name}`}
                            </h2>
                            <div className="flex items-center gap-2">
                                {viewingEmailHtml && (
                                    <button
                                        onClick={() => setViewingEmailHtml(null)}
                                        className="px-3 py-1.5 bg-gray-600 hover:bg-gray-500 text-white rounded-lg text-sm transition-colors"
                                    >
                                        Back to List
                                    </button>
                                )}
                                <button
                                    onClick={() => { setShowMessagesModal(false); setViewingEmailHtml(null); }}
                                    className="text-gray-400 hover:text-gray-100"
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
                                    title="Email Preview"
                                    sandbox="allow-same-origin"
                                />
                            </div>
                        ) : loadingMessages ? (
                            <div className="flex items-center justify-center py-12">
                                <Loader2 className="animate-spin text-blue-500" size={32} />
                            </div>
                        ) : recentMessages.length === 0 ? (
                            <div className="text-center py-12">
                                <MessageSquare size={48} className="mx-auto text-gray-600 mb-4" />
                                <p className="text-gray-400">No messages sent yet for this campaign</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {recentMessages.map((msg, index) => (
                                    <div
                                        key={index}
                                        className={`p-4 rounded-lg border ${
                                            msg.status === 'delivered'
                                                ? 'bg-gray-700 border-gray-600'
                                                : 'bg-red-900/20 border-red-800'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-3">
                                                <span className="text-sm font-semibold text-gray-100">
                                                    Day {msg.day}
                                                </span>
                                                <span className={`text-xs px-2 py-0.5 rounded ${
                                                    msg.status === 'delivered'
                                                        ? 'bg-green-900 text-green-300'
                                                        : 'bg-red-900 text-red-300'
                                                }`}>
                                                    {msg.status === 'delivered' ? (
                                                        <span className="flex items-center gap-1"><CheckCircle size={12} /> Delivered</span>
                                                    ) : (
                                                        <span className="flex items-center gap-1"><AlertTriangle size={12} /> Failed</span>
                                                    )}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {msg.renderedHtml && (
                                                    <button
                                                        onClick={() => setViewingEmailHtml(msg.renderedHtml!)}
                                                        className="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs flex items-center gap-1 transition-colors"
                                                    >
                                                        <Eye size={12} />
                                                        View Email
                                                    </button>
                                                )}
                                                <span className="text-xs text-gray-400">
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
                                                <div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center">
                                                    <Users size={14} className="text-gray-400" />
                                                </div>
                                            )}
                                            <div className="flex-1">
                                                <p className="text-sm text-gray-200">
                                                    {msg.referralUser?.name || 'Unknown User'}
                                                </p>
                                                <p className="text-xs text-gray-400">
                                                    {msg.referralUser?.email || 'No email'}
                                                    {msg.referralUser?.phoneNumber && ` | ${msg.referralUser.phoneNumber}`}
                                                </p>
                                            </div>
                                        </div>
                                        {msg.errorMessage && (
                                            <div className="mt-2 text-xs text-red-400 bg-red-900/30 px-3 py-1 rounded">
                                                Error: {msg.errorMessage}
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
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50" onClick={() => setShowTargetsModal(false)}>
                    <div className="bg-gray-800 rounded-lg p-6 max-w-4xl w-full max-h-[80vh] overflow-y-auto m-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-2xl font-bold text-gray-100 flex items-center gap-2">
                                <Users size={24} />
                                Campaign Targets ({selectedCampaign.name})
                            </h2>
                            <button
                                onClick={() => setShowTargetsModal(false)}
                                className="text-gray-400 hover:text-gray-100"
                            >
                                <XCircle size={24} />
                            </button>
                        </div>

                        {campaignTargets.length === 0 ? (
                            <p className="text-gray-400 text-center py-8">No targets found</p>
                        ) : (
                            <div className="space-y-3">
                                {campaignTargets.map((target) => (
                                    <div key={target._id} className="p-4 bg-gray-700 rounded-lg border border-gray-600">
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-sm font-medium text-gray-200">
                                                Day {target.currentDay}/7
                                            </span>
                                            <span className={`text-xs px-2 py-1 rounded ${getStatusBadge(target.status)}`}>
                                                {target.status}
                                            </span>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-gray-400">
                                            <div>
                                                <p>Referral ID: {target.referralUserId}</p>
                                                <p>Referrer ID: {target.referrerUserId}</p>
                                                <p>Language: {target.language}</p>
                                            </div>
                                            <div>
                                                <p>Entered: {formatDate(target.enteredLoopAt)}</p>
                                                <p>Next message: {formatDate(target.nextMessageDue)}</p>
                                                <p>Messages: {target.messagesDelivered.length}</p>
                                            </div>
                                        </div>
                                        {target.exitReason && (
                                            <div className="mt-2 text-xs text-yellow-400">
                                                Exit reason: {target.exitReason}
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
                    confirmText="Confirm"
                    cancelText="Cancel"
                    onConfirm={confirmAction.onConfirm}
                    onCancel={() => {
                        setShowConfirmModal(false);
                        setCancellationReason('');
                    }}
                >
                    {/* Optional cancellation reason input */}
                    <div className="mt-4">
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            Cancellation Reason (Optional)
                        </label>
                        <textarea
                            value={cancellationReason}
                            onChange={(e) => setCancellationReason(e.target.value)}
                            placeholder="Enter reason for cancellation..."
                            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            rows={3}
                        />
                    </div>
                </ConfirmationModal>
            )}
        </div>
    );
};

export default RelanceCampaignsPage;
