import React, { useState, useEffect } from 'react';
import {
    RefreshCw,
    AlertTriangle,
    Database,
    Shield,
    TrendingUp,
    Clock,
    FileText,
    Image,
    Package,
    CheckCircle,
    AlertCircle,
    XCircle
} from 'lucide-react';
import {
    getStorageStatus,
    runStorageCheck,
    getCleanupCandidates,
    StorageStatusResponse,
    StorageCheckResponse,
    CleanupCandidatesResponse
} from '../api/storageApi';
import toast from 'react-hot-toast';

const StorageMonitoringPage: React.FC = () => {
    const [storageData, setStorageData] = useState<StorageStatusResponse | null>(null);
    const [cleanupData, setCleanupData] = useState<CleanupCandidatesResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [checking, setChecking] = useState(false);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [autoRefresh, setAutoRefresh] = useState(false);

    const fetchStorageData = async () => {
        try {
            setLoading(true);
            const [statusData, cleanupInfo] = await Promise.all([
                getStorageStatus(),
                getCleanupCandidates(7)
            ]);
            setStorageData(statusData);
            setCleanupData(cleanupInfo);
            setLastUpdated(new Date());
        } catch (error: any) {
            console.error('Error fetching storage data:', error);
            toast.error('Failed to load storage data');
        } finally {
            setLoading(false);
        }
    };

    const handleManualCheck = async () => {
        try {
            setChecking(true);
            const toastId = toast.loading('Running storage check...');
            await runStorageCheck();
            toast.success('Storage check completed', { id: toastId });
            // Refresh data after check
            await fetchStorageData();
        } catch (error: any) {
            console.error('Error running storage check:', error);
            toast.error('Failed to run storage check');
        } finally {
            setChecking(false);
        }
    };

    useEffect(() => {
        fetchStorageData();
    }, []);

    // Auto-refresh effect
    useEffect(() => {
        if (!autoRefresh) return;

        const interval = setInterval(() => {
            fetchStorageData();
        }, 60000); // Refresh every minute

        return () => clearInterval(interval);
    }, [autoRefresh]);

    const getHealthStatusColor = (status: string) => {
        switch (status) {
            case 'HEALTHY': return 'text-green-400 bg-green-900/20 border-green-500';
            case 'MODERATE': return 'text-yellow-400 bg-yellow-900/20 border-yellow-500';
            case 'WARNING': return 'text-orange-400 bg-orange-900/20 border-orange-500';
            case 'CRITICAL': return 'text-red-400 bg-red-900/20 border-red-500';
            case 'EMERGENCY': return 'text-red-600 bg-red-900/40 border-red-400 animate-pulse';
            default: return 'text-gray-400 bg-gray-900/20 border-gray-500';
        }
    };

    const getHealthStatusIcon = (status: string) => {
        switch (status) {
            case 'HEALTHY': return <CheckCircle className="w-5 h-5" />;
            case 'MODERATE': return <AlertCircle className="w-5 h-5" />;
            case 'WARNING': return <AlertTriangle className="w-5 h-5" />;
            case 'CRITICAL': return <XCircle className="w-5 h-5" />;
            case 'EMERGENCY': return <XCircle className="w-5 h-5" />;
            default: return <Database className="w-5 h-5" />;
        }
    };

    const getProgressBarColor = (percentage: number) => {
        if (percentage >= 95) return 'bg-red-500';
        if (percentage >= 80) return 'bg-orange-500';
        if (percentage >= 60) return 'bg-yellow-500';
        return 'bg-green-500';
    };

    if (loading) {
        return (
            <div className="p-6 max-w-7xl mx-auto">
                <div className="flex items-center justify-center h-64">
                    <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
                    <span className="ml-2 text-gray-300">Loading storage data...</span>
                </div>
            </div>
        );
    }

    if (!storageData) {
        return (
            <div className="p-6 max-w-7xl mx-auto">
                <div className="text-center text-red-400">
                    <XCircle className="w-12 h-12 mx-auto mb-4" />
                    <p>Failed to load storage data</p>
                    <button
                        onClick={fetchStorageData}
                        className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                        Try Again
                    </button>
                </div>
            </div>
        );
    }

    const { data } = storageData;

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-white mb-2">Storage Monitoring</h1>
                    <p className="text-gray-400">Monitor Google Drive storage usage and health</p>
                </div>
                <div className="flex items-center space-x-4">
                    <label className="flex items-center space-x-2 text-sm text-gray-300">
                        <input
                            type="checkbox"
                            checked={autoRefresh}
                            onChange={(e) => setAutoRefresh(e.target.checked)}
                            className="rounded"
                        />
                        <span>Auto-refresh</span>
                    </label>
                    <button
                        onClick={handleManualCheck}
                        disabled={checking}
                        className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                        <RefreshCw className={`w-4 h-4 ${checking ? 'animate-spin' : ''}`} />
                        <span>{checking ? 'Checking...' : 'Run Check'}</span>
                    </button>
                    <button
                        onClick={fetchStorageData}
                        className="flex items-center space-x-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
                    >
                        <RefreshCw className="w-4 h-4" />
                        <span>Refresh</span>
                    </button>
                </div>
            </div>

            {/* Last Updated */}
            {lastUpdated && (
                <div className="flex items-center space-x-2 text-sm text-gray-400">
                    <Clock className="w-4 h-4" />
                    <span>Last updated: {lastUpdated.toLocaleString()}</span>
                </div>
            )}

            {/* Storage Overview */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Usage Summary */}
                <div className="lg:col-span-2 bg-gray-800 rounded-lg p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-xl font-semibold text-white">Storage Usage</h2>
                        <div className={`flex items-center space-x-2 px-3 py-1 rounded-full border ${getHealthStatusColor(data.healthStatus)}`}>
                            {getHealthStatusIcon(data.healthStatus)}
                            <span className="font-medium">{data.healthStatus}</span>
                        </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="mb-6">
                        <div className="flex justify-between items-center mb-2">
                            <span className="text-sm text-gray-300">Storage Used</span>
                            <span className="text-sm font-medium text-white">{data.usage.percentage}</span>
                        </div>
                        <div className="w-full bg-gray-700 rounded-full h-3">
                            <div
                                className={`h-3 rounded-full transition-all duration-300 ${getProgressBarColor(data.usage.raw.percentage)}`}
                                style={{ width: data.usage.percentage }}
                            ></div>
                        </div>
                        <div className="flex justify-between items-center mt-2 text-sm text-gray-400">
                            <span>{data.usage.used} used</span>
                            <span>{data.usage.available} available</span>
                        </div>
                    </div>

                    {/* Usage Stats */}
                    <div className="grid grid-cols-3 gap-4">
                        <div className="text-center">
                            <div className="text-2xl font-bold text-white">{data.usage.used}</div>
                            <div className="text-sm text-gray-400">Used</div>
                        </div>
                        <div className="text-center">
                            <div className="text-2xl font-bold text-white">{data.usage.total}</div>
                            <div className="text-sm text-gray-400">Total</div>
                        </div>
                        <div className="text-center">
                            <div className="text-2xl font-bold text-white">{data.usage.available}</div>
                            <div className="text-sm text-gray-400">Available</div>
                        </div>
                    </div>
                </div>

                {/* File Breakdown */}
                <div className="bg-gray-800 rounded-lg p-6">
                    <h2 className="text-xl font-semibold text-white mb-4">File Breakdown</h2>
                    {data.breakdown ? (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center space-x-2">
                                    <Image className="w-5 h-5 text-blue-400" />
                                    <span className="text-gray-300">Profile Pictures</span>
                                </div>
                                <span className="font-semibold text-white">{data.breakdown.userContent.profilePictures}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center space-x-2">
                                    <Package className="w-5 h-5 text-green-400" />
                                    <span className="text-gray-300">Product Images</span>
                                </div>
                                <span className="font-semibold text-white">{data.breakdown.userContent.productImages}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center space-x-2">
                                    <FileText className="w-5 h-5 text-gray-400" />
                                    <span className="text-gray-300">Other Files</span>
                                </div>
                                <span className="font-semibold text-white">{data.breakdown.otherFiles}</span>
                            </div>
                            <div className="pt-2 border-t border-gray-700">
                                <div className="flex items-center justify-between">
                                    <span className="text-gray-300 font-medium">Total Files</span>
                                    <span className="font-bold text-white">{data.breakdown.totalFiles}</span>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <p className="text-gray-400">No breakdown available</p>
                    )}
                </div>
            </div>

            {/* Alert Section */}
            {data.alert && (
                <div className={`rounded-lg p-6 border-l-4 ${data.alert.level === 'emergency' ? 'bg-red-900/20 border-red-500' :
                        data.alert.level === 'critical' ? 'bg-orange-900/20 border-orange-500' :
                            'bg-yellow-900/20 border-yellow-500'
                    }`}>
                    <div className="flex items-start space-x-3">
                        <AlertTriangle className={`w-6 h-6 mt-1 ${data.alert.level === 'emergency' ? 'text-red-400' :
                                data.alert.level === 'critical' ? 'text-orange-400' :
                                    'text-yellow-400'
                            }`} />
                        <div className="flex-1">
                            <h3 className={`text-lg font-semibold ${data.alert.level === 'emergency' ? 'text-red-300' :
                                    data.alert.level === 'critical' ? 'text-orange-300' :
                                        'text-yellow-300'
                                }`}>
                                {data.alert.level.toUpperCase()} ALERT
                            </h3>
                            <p className="text-gray-300 mt-1">{data.alert.message}</p>
                            <div className="mt-3">
                                <h4 className="text-sm font-medium text-gray-300 mb-2">Recommended Actions:</h4>
                                <ul className="space-y-1">
                                    {data.alert.recommendedActions.map((action, index) => (
                                        <li key={index} className="text-sm text-gray-400 flex items-start">
                                            <span className="text-gray-500 mr-2">•</span>
                                            {action}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Protection Policy & Recommendations */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Protection Policy */}
                <div className="bg-gray-800 rounded-lg p-6">
                    <div className="flex items-center space-x-2 mb-4">
                        <Shield className="w-5 h-5 text-green-400" />
                        <h2 className="text-xl font-semibold text-white">Content Protection</h2>
                    </div>
                    <div className="space-y-3">
                        <div className="flex justify-between items-center">
                            <span className="text-gray-300">Profile Pictures:</span>
                            <span className="text-green-400 font-medium">{data.protectionPolicy.profilePictures}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-gray-300">Product Images:</span>
                            <span className="text-green-400 font-medium">{data.protectionPolicy.productImages}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-gray-300">User Content:</span>
                            <span className="text-green-400 font-medium">{data.protectionPolicy.userGeneratedContent}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-gray-300">Temp Files:</span>
                            <span className="text-yellow-400 font-medium">{data.protectionPolicy.temporaryFiles}</span>
                        </div>
                    </div>
                    <div className="mt-4 p-3 bg-green-900/20 rounded border border-green-500/30">
                        <p className="text-sm text-green-300">
                            🛡️ User content is automatically protected from cleanup operations
                        </p>
                    </div>
                </div>

                {/* Recommendations */}
                <div className="bg-gray-800 rounded-lg p-6">
                    <div className="flex items-center space-x-2 mb-4">
                        <TrendingUp className="w-5 h-5 text-blue-400" />
                        <h2 className="text-xl font-semibold text-white">Recommendations</h2>
                    </div>
                    {data.recommendations.length > 0 ? (
                        <ul className="space-y-2">
                            {data.recommendations.map((recommendation, index) => (
                                <li key={index} className="text-sm text-gray-300 flex items-start">
                                    <span className="text-blue-400 mr-2">•</span>
                                    {recommendation}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-gray-400">No recommendations at this time</p>
                    )}
                </div>
            </div>

            {/* Cleanup Information */}
            {cleanupData && (
                <div className="bg-gray-800 rounded-lg p-6">
                    <h2 className="text-xl font-semibold text-white mb-4">Safe Cleanup Candidates</h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                        <div className="text-center">
                            <div className="text-2xl font-bold text-white">{cleanupData.data.totalFiles}</div>
                            <div className="text-sm text-gray-400">Safe Files</div>
                        </div>
                        <div className="text-center">
                            <div className="text-2xl font-bold text-white">{cleanupData.data.totalSizeToFree}</div>
                            <div className="text-sm text-gray-400">Potential Space</div>
                        </div>
                        <div className="text-center">
                            <div className="text-2xl font-bold text-white">{cleanupData.data.daysOld}+</div>
                            <div className="text-sm text-gray-400">Days Old</div>
                        </div>
                    </div>
                    <div className="p-3 bg-yellow-900/20 rounded border border-yellow-500/30">
                        <p className="text-sm text-yellow-300">
                            ⚠️ {data.cleanupCandidates.note}
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default StorageMonitoringPage; 