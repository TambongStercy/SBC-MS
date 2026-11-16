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
    XCircle,
    DollarSign,
    Cloud
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
import { HugeiconsIcon } from '@hugeicons/react';
import { Shield01Icon, Alert02Icon } from '@hugeicons/core-free-icons';

const HEALTH_LABELS: Record<string, string> = { HEALTHY: 'Sain', MODERATE: 'Modéré', WARNING: 'Attention', CRITICAL: 'Critique' };
const ALERT_LEVEL_LABELS: Record<string, string> = { info: 'Info', warning: 'Attention', critical: 'Critique' };

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
            toast.error('Impossible de charger les données de stockage');
        } finally {
            setLoading(false);
        }
    };

    const handleManualCheck = async () => {
        try {
            setChecking(true);
            const toastId = toast.loading('Vérification du stockage…');
            await runStorageCheck();
            toast.success('Vérification du stockage terminée', { id: toastId });
            // Refresh data after check
            await fetchStorageData();
        } catch (error: any) {
            console.error('Error running storage check:', error);
            toast.error('La vérification du stockage a échoué');
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
            case 'HEALTHY': return 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border-green-500';
            case 'MODERATE': return 'text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border-blue-500';
            case 'WARNING': return 'text-yellow-800 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 border-yellow-500';
            case 'CRITICAL': return 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-500';
            default: return 'text-fg-muted bg-surface-2 border-line-strong';
        }
    };

    const getHealthStatusIcon = (status: string) => {
        switch (status) {
            case 'HEALTHY': return <CheckCircle className="w-5 h-5" />;
            case 'MODERATE': return <Cloud className="w-5 h-5" />;
            case 'WARNING': return <AlertTriangle className="w-5 h-5" />;
            case 'CRITICAL': return <XCircle className="w-5 h-5" />;
            default: return <Database className="w-5 h-5" />;
        }
    };

    const getCostBarColor = (percentage: number) => {
        if (percentage >= 80) return 'bg-red-500';
        if (percentage >= 50) return 'bg-yellow-500';
        if (percentage >= 25) return 'bg-blue-500';
        return 'bg-green-500';
    };

    if (loading) {
        return (
            <div>
                <div className="flex items-center justify-center h-64">
                    <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
                    <span className="ml-2 text-fg-muted">Chargement des données de stockage…</span>
                </div>
            </div>
        );
    }

    if (!storageData) {
        return (
            <div>
                <div className="text-center text-red-600 dark:text-red-400">
                    <XCircle className="w-12 h-12 mx-auto mb-4" />
                    <p>Impossible de charger les données de stockage</p>
                    <button
                        onClick={fetchStorageData}
                        className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                    >
                        Réessayer
                    </button>
                </div>
            </div>
        );
    }

    const { data } = storageData;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight text-fg mb-1">Suivi du stockage cloud</h1>
                    <p className="text-fg-muted">Utilisation du stockage et coûts mensuels</p>
                </div>
                <div className="flex items-center space-x-4">
                    <label className="flex items-center space-x-2 text-sm text-fg-muted">
                        <input
                            type="checkbox"
                            checked={autoRefresh}
                            onChange={(e) => setAutoRefresh(e.target.checked)}
                            className="rounded-sm"
                        />
                        <span>Actualisation auto</span>
                    </label>
                    <button
                        onClick={handleManualCheck}
                        disabled={checking}
                        className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                        <RefreshCw className={`w-4 h-4 ${checking ? 'animate-spin' : ''}`} />
                        <span>{checking ? 'Vérification…' : 'Lancer une vérification'}</span>
                    </button>
                    <button
                        onClick={fetchStorageData}
                        className="flex items-center space-x-2 px-4 py-2 bg-surface-3 text-fg rounded-lg hover:bg-surface-2"
                    >
                        <RefreshCw className="w-4 h-4" />
                        <span>Actualiser</span>
                    </button>
                </div>
            </div>

            {/* Last Updated */}
            {lastUpdated && (
                <div className="flex items-center space-x-2 text-sm text-fg-muted">
                    <Clock className="w-4 h-4" />
                    <span>Mis à jour le {lastUpdated.toLocaleString('fr-FR')}</span>
                </div>
            )}

            {/* Storage Overview */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Usage and Cost Summary */}
                <div className="lg:col-span-2 bg-surface border border-line rounded-lg p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-xl font-semibold text-fg">Utilisation et coûts</h2>
                        <div className={`flex items-center space-x-2 px-3 py-1 rounded-full border ${getHealthStatusColor(data.healthStatus)}`}>
                            {getHealthStatusIcon(data.healthStatus)}
                            <span className="font-medium">{HEALTH_LABELS[data.healthStatus] ?? data.healthStatus}</span>
                        </div>
                    </div>

                    {/* Cost-based Progress Bar */}
                    <div className="mb-6">
                        <div className="flex justify-between items-center mb-2">
                            <span className="text-sm text-fg-muted">Impact sur le coût mensuel</span>
                            <span className="text-sm font-medium text-fg">{data.usage.percentage}</span>
                        </div>
                        <div className="w-full bg-surface-2 rounded-full h-3">
                            <div
                                className={`h-3 rounded-full transition-all duration-300 ${getCostBarColor(data.usage.raw.percentage)}`}
                                style={{ width: data.usage.percentage }}
                            ></div>
                        </div>
                        <div className="flex justify-between items-center mt-2 text-sm text-fg-muted">
                            <span>{data.usage.used} stockés</span>
                            <span>{data.costs.total} FCFA/mois</span>
                        </div>
                    </div>

                    {/* Usage Stats */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="text-center">
                            <div className="text-2xl font-bold text-fg">{data.usage.used}</div>
                            <div className="text-sm text-fg-muted">Stockage utilisé</div>
                        </div>
                        <div className="text-center">
                            <div className="text-2xl font-bold text-fg">{data.usage.raw.fileCount.toLocaleString('fr-FR')}</div>
                            <div className="text-sm text-fg-muted">Fichiers</div>
                        </div>
                    </div>

                    {/* Cost Breakdown */}
                    <div className="mt-6 border-t border-line pt-4">
                        <h3 className="text-lg font-semibold text-fg mb-3">Détail des coûts mensuels</h3>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="text-center">
                                <div className="text-lg font-bold text-blue-600 dark:text-blue-400">{data.costs.storage}</div>
                                <div className="text-xs text-fg-muted">Stockage</div>
                            </div>
                            <div className="text-center">
                                <div className="text-lg font-bold text-green-600 dark:text-green-400">{data.costs.bandwidth}</div>
                                <div className="text-xs text-fg-muted">Bande passante</div>
                            </div>
                            <div className="text-center">
                                <div className="text-lg font-bold text-purple-600 dark:text-purple-400">{data.costs.operations}</div>
                                <div className="text-xs text-fg-muted">Opérations</div>
                            </div>
                            <div className="text-center">
                                <div className="text-xl font-bold text-yellow-700 dark:text-yellow-400">{data.costs.total}</div>
                                <div className="text-xs text-fg-muted">Total/mois</div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* File Breakdown */}
                <div className="bg-surface border border-line rounded-lg p-6">
                    <h2 className="text-xl font-semibold text-fg mb-4">Répartition des fichiers</h2>
                    {data.breakdown ? (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center space-x-2">
                                    <Image className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                                    <span className="text-fg-muted">Photos de profil</span>
                                </div>
                                <span className="font-semibold text-fg">{data.breakdown.profilePictureFiles}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center space-x-2">
                                    <Package className="w-5 h-5 text-green-600 dark:text-green-400" />
                                    <span className="text-fg-muted">Images produits</span>
                                </div>
                                <span className="font-semibold text-fg">{data.breakdown.productFiles}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center space-x-2">
                                    <FileText className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                                    <span className="text-fg-muted">Documents</span>
                                </div>
                                <span className="font-semibold text-fg">{data.breakdown.documentFiles}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center space-x-2">
                                    <FileText className="w-5 h-5 text-fg-muted" />
                                    <span className="text-fg-muted">Autres fichiers</span>
                                </div>
                                <span className="font-semibold text-fg">{data.breakdown.otherFiles}</span>
                            </div>
                            <div className="border-t border-line pt-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-fg-muted font-medium">Total des fichiers</span>
                                    <span className="font-bold text-fg">{data.breakdown.totalFiles}</span>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <p className="text-fg-muted">Aucune répartition disponible</p>
                    )}
                </div>
            </div>

            {/* Alert Section */}
            {data.alert && data.alert.level !== 'info' && (
                <div className={`rounded-lg p-6 border-l-4 ${data.alert.level === 'critical' ? 'bg-red-50 dark:bg-red-900/20 border-red-500' :
                        'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-500'
                    }`}>
                    <div className="flex items-start space-x-3">
                        <AlertTriangle className={`w-6 h-6 mt-0.5 ${data.alert.level === 'critical' ? 'text-red-600 dark:text-red-400' : 'text-yellow-700 dark:text-yellow-400'
                            }`} />
                        <div className="grow">
                            <h3 className={`font-semibold mb-2 ${data.alert.level === 'critical' ? 'text-red-600 dark:text-red-300' : 'text-yellow-700 dark:text-yellow-300'
                                }`}>
                                {(ALERT_LEVEL_LABELS[data.alert.level] ?? data.alert.level).toUpperCase()} - Alerte de coût
                            </h3>
                            <p className="text-fg-muted mb-3">{data.alert.message}</p>
                            <div className="space-y-1">
                                <p className="text-sm font-medium text-fg-muted">Actions recommandées :</p>
                                <ul className="text-sm text-fg-muted list-disc list-inside space-y-1">
                                    {data.alert.recommendedActions.map((action, index) => (
                                        <li key={index}>{action}</li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Lower Section */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Protection Policy */}
                <div className="bg-surface border border-line rounded-lg p-6">
                    <div className="flex items-center space-x-2 mb-4">
                        <Shield className="w-5 h-5 text-green-600 dark:text-green-400" />
                        <h2 className="text-xl font-semibold text-fg">Protection du contenu</h2>
                    </div>
                    <div className="space-y-3">
                        <div className="flex justify-between items-center">
                            <span className="text-fg-muted">Photos de profil :</span>
                            <span className="text-green-600 dark:text-green-400 font-medium">{data.protectionPolicy.profilePictures}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-fg-muted">Images produits :</span>
                            <span className="text-green-600 dark:text-green-400 font-medium">{data.protectionPolicy.productImages}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-fg-muted">Contenu des membres :</span>
                            <span className="text-green-600 dark:text-green-400 font-medium">{data.protectionPolicy.userGeneratedContent}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-fg-muted">Fichiers temporaires :</span>
                            <span className="text-yellow-700 dark:text-yellow-400 font-medium">{data.protectionPolicy.temporaryFiles}</span>
                        </div>
                    </div>
                    <div className="mt-4 p-3 bg-green-50 dark:bg-green-900/20 rounded-sm border border-green-500/30">
                        <p className="flex items-center gap-2 text-sm text-green-700 dark:text-green-300">
                            <HugeiconsIcon icon={Shield01Icon} size={16} className="shrink-0" /> Le contenu des membres est automatiquement protégé des nettoyages
                        </p>
                    </div>
                </div>

                {/* Recommendations */}
                <div className="bg-surface border border-line rounded-lg p-6">
                    <div className="flex items-center space-x-2 mb-4">
                        <TrendingUp className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                        <h2 className="text-xl font-semibold text-fg">Optimisation des coûts</h2>
                    </div>
                    {data.recommendations.length > 0 ? (
                        <ul className="space-y-2">
                            {data.recommendations.map((recommendation, index) => (
                                <li key={index} className="text-sm text-fg-muted flex items-start">
                                    <span className="text-blue-600 dark:text-blue-400 mr-2">•</span>
                                    {recommendation}
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-fg-muted">Aucune recommandation pour le moment</p>
                    )}
                </div>
            </div>

            {/* Cleanup Information */}
            {cleanupData && (
                <div className="bg-surface border border-line rounded-lg p-6">
                    <h2 className="text-xl font-semibold text-fg mb-4">Fichiers supprimables sans risque</h2>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                        <div className="text-center">
                            <div className="text-2xl font-bold text-fg">{cleanupData.data.totalFiles}</div>
                            <div className="text-sm text-fg-muted">Fichiers concernés</div>
                        </div>
                        <div className="text-center">
                            <div className="text-2xl font-bold text-fg">{cleanupData.data.totalSizeToFree}</div>
                            <div className="text-sm text-fg-muted">Espace libérable</div>
                        </div>
                        <div className="text-center">
                            <div className="text-2xl font-bold text-green-600 dark:text-green-400">{cleanupData.data.estimatedCostSavings}</div>
                            <div className="text-sm text-fg-muted">Économies mensuelles</div>
                        </div>
                        <div className="text-center">
                            <div className="text-2xl font-bold text-fg">{cleanupData.data.daysOld}+</div>
                            <div className="text-sm text-fg-muted">Jours d'ancienneté</div>
                        </div>
                    </div>
                    <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-sm border border-yellow-500/30">
                        <p className="flex items-center gap-2 text-sm text-yellow-800 dark:text-yellow-300">
                            <HugeiconsIcon icon={Alert02Icon} size={16} className="shrink-0" /> {data.cleanupCandidates.note}
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default StorageMonitoringPage; 