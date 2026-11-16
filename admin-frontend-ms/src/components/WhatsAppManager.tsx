import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, Smartphone, QrCode, LogOut, CheckCircle, AlertCircle, RefreshCw, Cloud, Settings, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';
import { HugeiconsIcon } from '@hugeicons/react';
import { SmartPhone01Icon, Building03Icon, Alert02Icon } from '@hugeicons/core-free-icons';
import { getWhatsAppStatus, getWhatsAppQr, logoutWhatsApp, forceReconnectWhatsApp, WhatsAppStatus } from '../api/whatsapp';

const WhatsAppManager: React.FC = () => {
    const [status, setStatus] = useState<WhatsAppStatus | null>(null);
    const [qrCode, setQrCode] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isLoggingOut, setIsLoggingOut] = useState(false);
    const [isReconnecting, setIsReconnecting] = useState(false);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [pollInterval, setPollInterval] = useState<number>(5000); // Dynamic polling interval

    const fetchStatus = useCallback(async () => {
        try {
            const statusData = await getWhatsAppStatus();
            setStatus(statusData);
            setLastUpdated(new Date());
        } catch (error) {
            console.error('Error fetching WhatsApp status:', error);
            toast.error('Impossible de récupérer le statut WhatsApp');
        }
    }, []);

    // Helper function to determine implementation type
    const isBaileyImplementation = (status: WhatsAppStatus | null): boolean => {
        return status !== null && (status.hasQr !== undefined || status.qrTimestamp !== undefined || status.reconnectAttempts !== undefined);
    };

    const isCloudApiImplementation = (status: WhatsAppStatus | null): boolean => {
        return status !== null && (status.implementation === 'WhatsApp Cloud API' || status.lastHealthCheck !== undefined);
    };

    const fetchQrCode = useCallback(async () => {
        if (!status?.hasQr || !isBaileyImplementation(status)) return;

        setIsLoading(true);
        try {
            const blob = await getWhatsAppQr();
            const qrUrl = URL.createObjectURL(blob);
            setQrCode(qrUrl);
        } catch (error) {
            console.error('Error fetching QR code:', error);
            toast.error('Impossible de récupérer le QR code');
        } finally {
            setIsLoading(false);
        }
    }, [status?.hasQr, status]);

    const handleLogout = async () => {
        setIsLoggingOut(true);
        const toastId = toast.loading('Déconnexion de WhatsApp…');

        try {
            const message = await logoutWhatsApp();
            toast.success(message || 'WhatsApp déconnecté', { id: toastId });
            setQrCode(null);
            // Refresh status after logout
            setTimeout(fetchStatus, 2000);
        } catch (error) {
            console.error('Error logging out WhatsApp:', error);
            toast.error('Échec de la déconnexion de WhatsApp', { id: toastId });
        } finally {
            setIsLoggingOut(false);
        }
    };

    const handleForceReconnect = async () => {
        setIsReconnecting(true);
        const toastId = toast.loading('Reconnexion forcée de WhatsApp…');

        try {
            const message = await forceReconnectWhatsApp();
            toast.success(message || 'Reconnexion de WhatsApp lancée', { id: toastId });
            setQrCode(null);
            // Refresh status after reconnect
            setTimeout(fetchStatus, 2000);
        } catch (error) {
            console.error('Error force reconnecting WhatsApp:', error);
            toast.error('Échec de la reconnexion de WhatsApp', { id: toastId });
        } finally {
            setIsReconnecting(false);
        }
    };

    const handleRefresh = () => {
        fetchStatus();
        if (status?.hasQr) {
            fetchQrCode();
        }
    };

    // Initial load
    useEffect(() => {
        fetchStatus();
    }, [fetchStatus]);

    // Fetch QR code when status indicates it's available
    useEffect(() => {
        if (status?.hasQr && !qrCode) {
            fetchQrCode();
        }
    }, [status?.hasQr, qrCode, fetchQrCode]);

    // Dynamic polling based on connection state and implementation
    useEffect(() => {
        if (!status) return;

        // Adjust polling interval based on implementation and connection state
        let newInterval = 5000; // Default 5 seconds

        if (isCloudApiImplementation(status)) {
            // Cloud API polling - less frequent since it's more stable
            if (status.isReady) {
                newInterval = 15000; // 15 seconds when connected
            } else {
                newInterval = 8000; // 8 seconds when checking connectivity
            }
        } else if (isBaileyImplementation(status)) {
            // Bailey polling - more frequent due to connection instability
            if (status.isReady) {
                newInterval = 10000; // 10 seconds when connected
            } else if (status.isInitializing || (status.reconnectAttempts && status.reconnectAttempts > 0)) {
                newInterval = 3000; // 3 seconds when initializing or reconnecting
            } else if (status.connectionState === 'waiting_for_scan') {
                newInterval = 5000; // 5 seconds when waiting for QR scan
            }
        }

        if (newInterval !== pollInterval) {
            setPollInterval(newInterval);
        }
    }, [status, pollInterval]);

    // Auto-refresh status with dynamic interval
    useEffect(() => {
        const interval = setInterval(fetchStatus, pollInterval);
        return () => clearInterval(interval);
    }, [fetchStatus, pollInterval]);

    // Clean up QR code URL when component unmounts
    useEffect(() => {
        return () => {
            if (qrCode) {
                URL.revokeObjectURL(qrCode);
            }
        };
    }, [qrCode]);

    const getStatusColor = (state: string) => {
        switch (state) {
            case 'connected':
            case 'open':
                return 'text-green-600 dark:text-green-400';
            case 'waiting_for_scan':
                return 'text-yellow-700 dark:text-yellow-400';
            case 'disconnected':
            case 'close':
                return 'text-red-600 dark:text-red-400';
            case 'connecting':
                return 'text-blue-600 dark:text-blue-400';
            default:
                return 'text-fg-muted';
        }
    };

    const getStatusIcon = (state: string) => {
        switch (state) {
            case 'connected':
            case 'open':
                return <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />;
            case 'waiting_for_scan':
                return <QrCode className="h-5 w-5 text-yellow-700 dark:text-yellow-400" />;
            case 'disconnected':
            case 'close':
                return <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400" />;
            case 'connecting':
                return <Loader2 className="h-5 w-5 text-blue-600 dark:text-blue-400 animate-spin" />;
            default:
                return <Smartphone className="h-5 w-5 text-fg-muted" />;
        }
    };

    const getStatusText = (state: string, isInitializing?: boolean, reconnectAttempts?: number) => {
        if (isInitializing) {
            return 'Initialisation…';
        }

        if (reconnectAttempts && reconnectAttempts > 0) {
            return `Reconnexion (${reconnectAttempts}/5)`;
        }

        switch (state) {
            case 'connected':
            case 'open':
                return 'Connecté et prêt';
            case 'waiting_for_scan':
                return 'En attente du scan du QR code';
            case 'disconnected':
            case 'close':
                return 'Déconnecté';
            case 'connecting':
                return 'Connexion…';
            default:
                return `Inconnu (${state})`;
        }
    };

    return (
        <div className="bg-surface rounded-lg p-6 border border-line">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center space-x-3">
                    {isCloudApiImplementation(status) ? (
                        <Cloud className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                    ) : (
                        <Smartphone className="h-6 w-6 text-green-600 dark:text-green-400" />
                    )}
                    <h2 className="text-xl font-semibold text-fg">
                        Gestion de WhatsApp
                        {status && (
                            <span className="text-sm font-normal text-fg-muted ml-2">
                                ({isCloudApiImplementation(status) ? 'Cloud API' : 'Bailey'})
                            </span>
                        )}
                    </h2>
                </div>
                <button
                    onClick={handleRefresh}
                    disabled={isLoading}
                    className="p-2 text-fg-muted hover:text-fg hover:bg-surface-2 rounded-md transition-colors"
                    title="Actualiser le statut" aria-label="Actualiser le statut"
                >
                    <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {status ? (
                <div className="space-y-6">
                    {/* Implementation Type Banner */}
                    {isCloudApiImplementation(status) ? (
                        <div className="bg-blue-100 dark:bg-blue-900 border border-blue-300 dark:border-blue-700 rounded-lg p-4">
                            <div className="flex items-center">
                                <Cloud className="h-5 w-5 text-blue-600 dark:text-blue-400 mr-3" />
                                <div className="flex-1">
                                    <p className="text-blue-800 dark:text-blue-100 font-medium">WhatsApp Cloud API</p>
                                    <p className="text-blue-800 dark:text-blue-200 text-sm">
                                        API officielle WhatsApp Business. Aucun QR code à scanner.
                                    </p>
                                </div>
                                <a
                                    href="https://business.facebook.com/wa/manage/"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center px-3 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                                >
                                    <Settings className="h-4 w-4 mr-1" />
                                    Business Manager
                                    <ExternalLink className="h-3 w-3 ml-1" />
                                </a>
                            </div>
                        </div>
                    ) : isBaileyImplementation(status) && (
                        <div className="bg-yellow-100 dark:bg-yellow-900 border border-yellow-300 dark:border-yellow-700 rounded-lg p-4">
                            <div className="flex items-center">
                                <QrCode className="h-5 w-5 text-yellow-700 dark:text-yellow-400 mr-3" />
                                <div>
                                    <p className="text-yellow-800 dark:text-yellow-100 font-medium">Bailey (WhatsApp Web)</p>
                                    <p className="text-yellow-800 dark:text-yellow-200 text-sm">
                                        Ancienne implémentation basée sur WhatsApp Web. Nécessite de scanner un QR code.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Status Display */}
                    <div className="flex items-center justify-between p-4 bg-surface-2 rounded-lg">
                        <div className="flex items-center space-x-3">
                            {getStatusIcon(status.connectionState)}
                            <div>
                                <p className={`font-medium ${getStatusColor(status.connectionState)}`}>
                                    {getStatusText(status.connectionState, status.isInitializing, status.reconnectAttempts)}
                                </p>
                                <div className="flex items-center space-x-4 text-sm text-fg-muted">
                                    {lastUpdated && (
                                        <span>Mis à jour à {lastUpdated.toLocaleTimeString('fr-FR')}</span>
                                    )}
                                    {status.lastHealthCheck && isCloudApiImplementation(status) && (
                                        <span>Dernière vérification : {new Date(status.lastHealthCheck).toLocaleTimeString('fr-FR')}</span>
                                    )}
                                    {status.reconnectAttempts !== undefined && status.reconnectAttempts > 0 && (
                                        <span className="text-yellow-700 dark:text-yellow-400">
                                            Tentatives de reconnexion : {status.reconnectAttempts}/5
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="flex space-x-2">
                            {/* Bailey-specific actions */}
                            {isBaileyImplementation(status) && (
                                <>
                                    {!status.isReady && (status.connectionState === 'disconnected' || status.connectionState === 'close') && (
                                        <button
                                            onClick={handleForceReconnect}
                                            disabled={isReconnecting || status.isInitializing}
                                            className="inline-flex items-center px-3 py-2 border border-blue-600 text-sm font-medium rounded-md text-blue-600 dark:text-blue-400 bg-transparent hover:bg-blue-600 hover:text-white focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-offset-surface focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                        >
                                            {isReconnecting ? (
                                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                            ) : (
                                                <RefreshCw className="h-4 w-4 mr-2" />
                                            )}
                                            Forcer la reconnexion
                                        </button>
                                    )}

                                    {status.isReady && (
                                        <button
                                            onClick={handleLogout}
                                            disabled={isLoggingOut}
                                            className="inline-flex items-center px-3 py-2 border border-red-600 text-sm font-medium rounded-md text-red-600 dark:text-red-400 bg-transparent hover:bg-red-600 hover:text-white focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-offset-surface focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                        >
                                            {isLoggingOut ? (
                                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                            ) : (
                                                <LogOut className="h-4 w-4 mr-2" />
                                            )}
                                            Déconnecter WhatsApp
                                        </button>
                                    )}
                                </>
                            )}

                            {/* Cloud API info - no logout/reconnect needed */}
                            {isCloudApiImplementation(status) && (
                                <div className="text-sm text-fg-muted italic">
                                    Configuration gérée dans Facebook Business Manager
                                </div>
                            )}
                        </div>
                    </div>

                    {/* QR Code Section - Only for Bailey */}
                    {isBaileyImplementation(status) && status.hasQr && status.connectionState === 'waiting_for_scan' && (
                        <div className="bg-surface-2 rounded-lg p-6">
                            <div className="text-center">
                                <h3 className="text-lg font-medium text-fg mb-4">
                                    Scannez le QR code pour connecter WhatsApp
                                </h3>
                                <p className="text-fg-muted mb-6">
                                    Ouvrez WhatsApp sur votre téléphone, allez dans Paramètres → Appareils connectés → Connecter un appareil,
                                    puis scannez ce QR code.
                                </p>

                                {isLoading ? (
                                    <div className="flex justify-center items-center h-64">
                                        <Loader2 className="h-8 w-8 animate-spin text-indigo-600 dark:text-indigo-400" />
                                    </div>
                                ) : qrCode ? (
                                    <div className="flex justify-center">
                                        <div className="bg-white p-4 rounded-lg">
                                            <img
                                                src={qrCode}
                                                alt="QR code WhatsApp"
                                                className="w-64 h-64 object-contain"
                                            />
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex justify-center items-center h-64 text-fg-muted">
                                        <p>QR code indisponible</p>
                                    </div>
                                )}

                                {status.qrTimestamp && (
                                    <p className="text-sm text-fg-muted mt-4">
                                        QR code généré le {new Date(status.qrTimestamp).toLocaleString('fr-FR')}
                                    </p>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Connected Status */}
                    {status.isReady && (
                        <div className="bg-green-100 dark:bg-green-900 border border-green-300 dark:border-green-700 rounded-lg p-4">
                            <div className="flex items-center">
                                <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400 mr-3" />
                                <div>
                                    <p className="text-green-800 dark:text-green-100 font-medium">
                                        {isCloudApiImplementation(status) ? 'WhatsApp Cloud API prête' : 'Connexion WhatsApp prête'}
                                    </p>
                                    <p className="text-green-800 dark:text-green-200 text-sm">
                                        {isCloudApiImplementation(status)
                                            ? "L'API officielle WhatsApp Business est active et prête à envoyer les notifications."
                                            : 'La connexion WhatsApp Web est active. Le système peut envoyer les notifications.'
                                        }
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Disconnected Status - Only for Bailey */}
                    {isBaileyImplementation(status) && (status.connectionState === 'disconnected' || status.connectionState === 'close') && !status.hasQr && !status.isInitializing && (
                        <div className="bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-700 rounded-lg p-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center">
                                    <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 mr-3" />
                                    <div>
                                        <p className="text-red-800 dark:text-red-100 font-medium">WhatsApp déconnecté</p>
                                        <p className="text-red-800 dark:text-red-200 text-sm">
                                            WhatsApp n'est pas connecté. {(status.reconnectAttempts || 0) >= 5 ? 'Nombre maximal de tentatives de reconnexion atteint.' : 'Un nouveau QR code devrait bientôt apparaître pour la reconnexion.'}
                                        </p>
                                    </div>
                                </div>
                                {(status.reconnectAttempts || 0) >= 5 && (
                                    <button
                                        onClick={handleForceReconnect}
                                        disabled={isReconnecting}
                                        className="inline-flex items-center px-3 py-2 text-sm font-medium rounded-md text-red-100 bg-red-800 hover:bg-red-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-offset-red-900 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                    >
                                        {isReconnecting ? (
                                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                        ) : (
                                            <RefreshCw className="h-4 w-4 mr-2" />
                                        )}
                                        Réessayer la connexion
                                    </button>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Initializing Status */}
                    {status.isInitializing && (
                        <div className="bg-blue-100 dark:bg-blue-900 border border-blue-300 dark:border-blue-700 rounded-lg p-4">
                            <div className="flex items-center">
                                <Loader2 className="h-5 w-5 text-blue-600 dark:text-blue-400 mr-3 animate-spin" />
                                <div>
                                    <p className="text-blue-800 dark:text-blue-100 font-medium">Initialisation de la connexion WhatsApp</p>
                                    <p className="text-blue-800 dark:text-blue-200 text-sm">
                                        Préparation du service WhatsApp, veuillez patienter…
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Cloud API Error Status */}
                    {isCloudApiImplementation(status) && !status.isReady && (
                        <div className="bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-700 rounded-lg p-4">
                            <div className="flex items-center">
                                <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 mr-3" />
                                <div>
                                    <p className="text-red-800 dark:text-red-100 font-medium">WhatsApp Cloud API indisponible</p>
                                    <p className="text-red-800 dark:text-red-200 text-sm">
                                        L'API WhatsApp Cloud ne répond pas correctement. Vérifiez la configuration dans Facebook Business Manager ainsi que les identifiants de l'API.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Instructions */}
                    {isBaileyImplementation(status) ? (
                        <div className="bg-blue-100 dark:bg-blue-900 border border-blue-300 dark:border-blue-700 rounded-lg p-4">
                            <h4 className="flex items-center gap-2 text-blue-800 dark:text-blue-100 font-medium mb-2"><HugeiconsIcon icon={SmartPhone01Icon} size={16} /> Connecter WhatsApp (Bailey) :</h4>
                            <ol className="text-blue-800 dark:text-blue-200 text-sm space-y-1 list-decimal list-inside">
                                <li>Ouvrez WhatsApp sur votre téléphone</li>
                                <li>Allez dans Paramètres → Appareils connectés</li>
                                <li>Touchez « Connecter un appareil »</li>
                                <li>Scannez le QR code affiché ci-dessus</li>
                                <li>Attendez la confirmation de connexion</li>
                            </ol>
                        </div>
                    ) : isCloudApiImplementation(status) ? (
                        <div className="bg-blue-100 dark:bg-blue-900 border border-blue-300 dark:border-blue-700 rounded-lg p-4">
                            <h4 className="flex items-center gap-2 text-blue-800 dark:text-blue-100 font-medium mb-2"><HugeiconsIcon icon={Building03Icon} size={16} /> Configuration de WhatsApp Cloud API :</h4>
                            <ul className="text-blue-800 dark:text-blue-200 text-sm space-y-1 list-disc list-inside">
                                <li>Configurez votre compte WhatsApp Business dans <a href="https://business.facebook.com/wa/manage/" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200 underline">Facebook Business Manager</a></li>
                                <li>Vérifiez que votre numéro est validé dans Meta Business Manager</li>
                                <li>Vérifiez que les webhooks sont bien configurés</li>
                                <li>Vérifiez que les identifiants de l'API sont définis dans les variables d'environnement</li>
                                <li>Aucun QR code à scanner : tout se gère sur la plateforme Meta</li>
                            </ul>
                        </div>
                    ) : (
                        <div className="bg-surface-2 border border-line-strong rounded-lg p-4">
                            <h4 className="flex items-center gap-2 text-fg font-medium mb-2"><HugeiconsIcon icon={Alert02Icon} size={16} className="text-yellow-700 dark:text-yellow-400" /> Implémentation inconnue</h4>
                            <p className="text-fg-muted text-sm">
                                Impossible de déterminer le type d'implémentation WhatsApp. Vérifiez la configuration.
                            </p>
                        </div>
                    )}
                </div>
            ) : (
                <div className="flex justify-center items-center h-32">
                    <Loader2 className="h-8 w-8 animate-spin text-indigo-600 dark:text-indigo-400" />
                    <span className="ml-3 text-fg-muted">Chargement du statut WhatsApp…</span>
                </div>
            )}
        </div>
    );
};

export default WhatsAppManager;