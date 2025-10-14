import React, { useState, useEffect } from 'react';
import { Activity, Users, MessageSquare, TrendingUp, CheckCircle, XCircle, Clock, RefreshCw, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { getStats, getActiveTargets, getActiveConfigs, RelanceStats, RelanceTarget, RelanceConfig } from '../services/adminRelanceApi';

const RelanceDashboardPage: React.FC = () => {
    const [stats, setStats] = useState<RelanceStats | null>(null);
    const [activeTargets, setActiveTargets] = useState<RelanceTarget[]>([]);
    const [activeConfigs, setActiveConfigs] = useState<RelanceConfig[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    useEffect(() => {
        loadDashboardData();
    }, []);

    const loadDashboardData = async (isRefresh = false) => {
        try {
            if (isRefresh) {
                setRefreshing(true);
            } else {
                setLoading(true);
            }

            const [statsData, targetsData, configsData] = await Promise.all([
                getStats(),
                getActiveTargets(1, 10),
                getActiveConfigs()
            ]);

            setStats(statsData);
            setActiveTargets(targetsData.targets);
            setActiveConfigs(configsData);
        } catch (error: any) {
            console.error('Error loading dashboard data:', error);
            toast.error('Failed to load dashboard: ' + (error.response?.data?.message || error.message));
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    const handleRefresh = () => {
        loadDashboardData(true);
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const getStatusBadge = (status: string) => {
        const colors = {
            active: 'bg-green-600',
            completed: 'bg-blue-600',
            failed: 'bg-red-600'
        };
        return colors[status as keyof typeof colors] || 'bg-gray-600';
    };

    const getWhatsAppStatusBadge = (status: string) => {
        const colors = {
            connected: 'bg-green-600',
            connecting: 'bg-yellow-600',
            disconnected: 'bg-gray-600',
            failed: 'bg-red-600'
        };
        return colors[status as keyof typeof colors] || 'bg-gray-600';
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-screen">
                <Loader2 className="animate-spin text-blue-500" size={48} />
            </div>
        );
    }

    if (!stats) {
        return (
            <div className="flex items-center justify-center h-screen text-gray-400">
                <p>No data available</p>
            </div>
        );
    }

    return (
        <div className="p-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-3xl font-bold text-gray-100 flex items-center gap-2">
                        <Activity size={32} className="text-blue-500" />
                        Relance Dashboard
                    </h1>
                    <p className="text-gray-400 mt-2">Monitor WhatsApp follow-up campaigns</p>
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

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                {/* Active Targets */}
                <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
                    <div className="flex items-center justify-between mb-2">
                        <Users size={24} className="text-blue-500" />
                        <span className="text-xs text-gray-400">ACTIVE</span>
                    </div>
                    <p className="text-3xl font-bold text-gray-100">{stats.totalActiveTargets}</p>
                    <p className="text-sm text-gray-400 mt-1">In 7-day loop</p>
                </div>

                {/* Messages Sent Today */}
                <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
                    <div className="flex items-center justify-between mb-2">
                        <MessageSquare size={24} className="text-green-500" />
                        <span className="text-xs text-gray-400">TODAY</span>
                    </div>
                    <p className="text-3xl font-bold text-gray-100">{stats.messagesSentToday}</p>
                    <p className="text-sm text-gray-400 mt-1">Messages sent</p>
                </div>

                {/* Success Rate */}
                <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
                    <div className="flex items-center justify-between mb-2">
                        <TrendingUp size={24} className="text-purple-500" />
                        <span className="text-xs text-gray-400">RATE</span>
                    </div>
                    <p className="text-3xl font-bold text-gray-100">{stats.totalSuccessRate.toFixed(1)}%</p>
                    <p className="text-sm text-gray-400 mt-1">Success rate</p>
                </div>

                {/* Active Configs */}
                <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
                    <div className="flex items-center justify-between mb-2">
                        <CheckCircle size={24} className="text-yellow-500" />
                        <span className="text-xs text-gray-400">CONFIGS</span>
                    </div>
                    <p className="text-3xl font-bold text-gray-100">{stats.activeConfigsCount}</p>
                    <p className="text-sm text-gray-400 mt-1">Active users</p>
                </div>
            </div>

            {/* Exit Reasons */}
            <div className="bg-gray-800 rounded-lg p-6 border border-gray-700 mb-6">
                <h2 className="text-lg font-semibold text-gray-100 mb-4">Exit Reasons (Completed Loops)</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="text-center">
                        <p className="text-2xl font-bold text-green-400">{stats.exitReasons.paid}</p>
                        <p className="text-xs text-gray-400 mt-1">Paid Subscription</p>
                    </div>
                    <div className="text-center">
                        <p className="text-2xl font-bold text-blue-400">{stats.exitReasons.completed_7_days}</p>
                        <p className="text-xs text-gray-400 mt-1">Completed 7 Days</p>
                    </div>
                    <div className="text-center">
                        <p className="text-2xl font-bold text-yellow-400">{stats.exitReasons.subscription_expired}</p>
                        <p className="text-xs text-gray-400 mt-1">Subscription Expired</p>
                    </div>
                    <div className="text-center">
                        <p className="text-2xl font-bold text-gray-400">{stats.exitReasons.manual}</p>
                        <p className="text-xs text-gray-400 mt-1">Manual Exit</p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Active Targets */}
                <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
                    <h2 className="text-lg font-semibold text-gray-100 mb-4 flex items-center gap-2">
                        <Clock size={20} />
                        Recent Active Targets
                    </h2>
                    {activeTargets.length === 0 ? (
                        <p className="text-gray-400 text-center py-4">No active targets</p>
                    ) : (
                        <div className="space-y-3 max-h-96 overflow-y-auto">
                            {activeTargets.map((target) => (
                                <div key={target._id} className="p-3 bg-gray-700 rounded border border-gray-600">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-sm font-medium text-gray-200">
                                            Day {target.currentDay}/7
                                        </span>
                                        <span className={`text-xs px-2 py-1 rounded ${getStatusBadge(target.status)}`}>
                                            {target.status}
                                        </span>
                                    </div>
                                    <div className="text-xs text-gray-400 space-y-1">
                                        <p>Entered: {formatDate(target.enteredLoopAt)}</p>
                                        <p>Next message: {formatDate(target.nextMessageDue)}</p>
                                        <p>Messages delivered: {target.messagesDelivered.length}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Active Configs */}
                <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
                    <h2 className="text-lg font-semibold text-gray-100 mb-4 flex items-center gap-2">
                        <Users size={20} />
                        Active WhatsApp Connections
                    </h2>
                    {activeConfigs.length === 0 ? (
                        <p className="text-gray-400 text-center py-4">No active configurations</p>
                    ) : (
                        <div className="space-y-3 max-h-96 overflow-y-auto">
                            {activeConfigs.map((config) => (
                                <div key={config._id} className="p-3 bg-gray-700 rounded border border-gray-600">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className={`text-xs px-2 py-1 rounded ${getWhatsAppStatusBadge(config.whatsappStatus)}`}>
                                            {config.whatsappStatus}
                                        </span>
                                        <div className="flex gap-2">
                                            {config.enabled ? (
                                                <CheckCircle size={16} className="text-green-400" />
                                            ) : (
                                                <XCircle size={16} className="text-red-400" />
                                            )}
                                        </div>
                                    </div>
                                    <div className="text-xs text-gray-400 space-y-1">
                                        <p>Messages today: {config.messagesSentToday}</p>
                                        {config.lastQrScanDate && (
                                            <p>Last scan: {formatDate(config.lastQrScanDate)}</p>
                                        )}
                                        <div className="flex gap-2 mt-2">
                                            {config.enrollmentPaused && (
                                                <span className="px-2 py-1 bg-yellow-900 text-yellow-300 rounded text-xs">
                                                    Enrollment Paused
                                                </span>
                                            )}
                                            {config.sendingPaused && (
                                                <span className="px-2 py-1 bg-red-900 text-red-300 rounded text-xs">
                                                    Sending Paused
                                                </span>
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
            <div className="mt-6 bg-gray-800 rounded-lg p-6 border border-gray-700">
                <h2 className="text-lg font-semibold text-gray-100 mb-4">Summary</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div>
                        <p className="text-gray-400">Total Enrolled Today</p>
                        <p className="text-2xl font-bold text-gray-100">{stats.targetsEnrolledToday}</p>
                    </div>
                    <div>
                        <p className="text-gray-400">Total Completed</p>
                        <p className="text-2xl font-bold text-gray-100">{stats.totalCompletedTargets}</p>
                    </div>
                    <div>
                        <p className="text-gray-400">Total Messages Sent</p>
                        <p className="text-2xl font-bold text-gray-100">{stats.totalMessagesSent}</p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default RelanceDashboardPage;