import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, Smartphone, QrCode, LogOut, CheckCircle, AlertCircle, RefreshCw, Cloud, Settings, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';
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
            toast.error('Failed to fetch WhatsApp status');
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
            toast.error('Failed to fetch QR code');
        } finally {
            setIsLoading(false);
        }
    }, [status?.hasQr, status]);

    const handleLogout = async () => {
        setIsLoggingOut(true);
        const toastId = toast.loading('Logging out WhatsApp...');

        try {
            const message = await logoutWhatsApp();
            toast.success(message || 'WhatsApp logged out successfully', { id: toastId });
            setQrCode(null);
            // Refresh status after logout
            setTimeout(fetchStatus, 2000);
        } catch (error) {
            console.error('Error logging out WhatsApp:', error);
            toast.error('Failed to logout WhatsApp', { id: toastId });
        } finally {
            setIsLoggingOut(false);
        }
    };

    const handleForceReconnect = async () => {
        setIsReconnecting(true);
        const toastId = toast.loading('Force reconnecting WhatsApp...');

        try {
            const message = await forceReconnectWhatsApp();
            toast.success(message || 'WhatsApp reconnection initiated', { id: toastId });
            setQrCode(null);
            // Refresh status after reconnect
            setTimeout(fetchStatus, 2000);
        } catch (error) {
            console.error('Error force reconnecting WhatsApp:', error);
            toast.error('Failed to force reconnect WhatsApp', { id: toastId });
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
                return 'text-green-400';
            case 'waiting_for_scan':
                return 'text-yellow-400';
            case 'disconnected':
            case 'close':
                return 'text-red-400';
            case 'connecting':
                return 'text-blue-400';
            default:
                return 'text-gray-400';
        }
    };

    const getStatusIcon = (state: string) => {
        switch (state) {
            case 'connected':
            case 'open':
                return <CheckCircle className="h-5 w-5 text-green-400" />;
            case 'waiting_for_scan':
                return <QrCode className="h-5 w-5 text-yellow-400" />;
            case 'disconnected':
            case 'close':
                return <AlertCircle className="h-5 w-5 text-red-400" />;
            case 'connecting':
                return <Loader2 className="h-5 w-5 text-blue-400 animate-spin" />;
            default:
                return <Smartphone className="h-5 w-5 text-gray-400" />;
        }
    };

    const getStatusText = (state: string, isInitializing?: boolean, reconnectAttempts?: number) => {
        if (isInitializing) {
            return 'Initializing...';
        }

        if (reconnectAttempts && reconnectAttempts > 0) {
            return `Reconnecting (${reconnectAttempts}/5)`;
        }

        switch (state) {
            case 'connected':
            case 'open':
                return 'Connected & Ready';
            case 'waiting_for_scan':
                return 'Waiting for QR Scan';
            case 'disconnected':
            case 'close':
                return 'Disconnected';
            case 'connecting':
                return 'Connecting...';
            default:
                return `Unknown (${state})`;
        }
    };

    return (
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center space-x-3">
                    {isCloudApiImplementation(status) ? (
                        <Cloud className="h-6 w-6 text-blue-400" />
                    ) : (
                        <Smartphone className="h-6 w-6 text-green-400" />
                    )}
                    <h2 className="text-xl font-semibold text-white">
                        WhatsApp Management
                        {status && (
                            <span className="text-sm font-normal text-gray-400 ml-2">
                                ({isCloudApiImplementation(status) ? 'Cloud API' : 'Bailey'})
                            </span>
                        )}
                    </h2>
                </div>
                <button
                    onClick={handleRefresh}
                    disabled={isLoading}
                    className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-md transition-colors"
                    title="Refresh Status"
                >
                    <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {status ? (
                <div className="space-y-6">
                    {/* Implementation Type Banner */}
                    {isCloudApiImplementation(status) ? (
                        <div className="bg-blue-900 border border-blue-700 rounded-lg p-4">
                            <div className="flex items-center">
                                <Cloud className="h-5 w-5 text-blue-400 mr-3" />
                                <div className="flex-1">
                                    <p className="text-blue-100 font-medium">WhatsApp Cloud API</p>
                                    <p className="text-blue-200 text-sm">
                                        Using official WhatsApp Business API. No QR code scanning required.
                                    </p>
                                </div>
                                <a
                                    href="https://business.facebook.com/wa/manage/"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center px-3 py-2 text-sm font-medium text-blue-400 hover:text-blue-300 transition-colors"
                                >
                                    <Settings className="h-4 w-4 mr-1" />
                                    Business Manager
                                    <ExternalLink className="h-3 w-3 ml-1" />
                                </a>
                            </div>
                        </div>
                    ) : isBaileyImplementation(status) && (
                        <div className="bg-yellow-900 border border-yellow-700 rounded-lg p-4">
                            <div className="flex items-center">
                                <QrCode className="h-5 w-5 text-yellow-400 mr-3" />
                                <div>
                                    <p className="text-yellow-100 font-medium">Bailey (WhatsApp Web)</p>
                                    <p className="text-yellow-200 text-sm">
                                        Legacy implementation using WhatsApp Web protocol. Requires QR code scanning.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Status Display */}
                    <div className="flex items-center justify-between p-4 bg-gray-700 rounded-lg">
                        <div className="flex items-center space-x-3">
                            {getStatusIcon(status.connectionState)}
                            <div>
                                <p className={`font-medium ${getStatusColor(status.connectionState)}`}>
                                    {getStatusText(status.connectionState, status.isInitializing, status.reconnectAttempts)}
                                </p>
                                <div className="flex items-center space-x-4 text-sm text-gray-400">
                                    {lastUpdated && (
                                        <span>Last updated: {lastUpdated.toLocaleTimeString()}</span>
                                    )}
                                    {status.lastHealthCheck && isCloudApiImplementation(status) && (
                                        <span>Last health check: {new Date(status.lastHealthCheck).toLocaleTimeString()}</span>
                                    )}
                                    {status.reconnectAttempts !== undefined && status.reconnectAttempts > 0 && (
                                        <span className="text-yellow-400">
                                            Reconnect attempts: {status.reconnectAttempts}/5
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
                                            className="inline-flex items-center px-3 py-2 border border-blue-600 text-sm font-medium rounded-md text-blue-400 bg-transparent hover:bg-blue-600 hover:text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                        >
                                            {isReconnecting ? (
                                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                            ) : (
                                                <RefreshCw className="h-4 w-4 mr-2" />
                                            )}
                                            Force Reconnect
                                        </button>
                                    )}

                                    {status.isReady && (
                                        <button
                                            onClick={handleLogout}
                                            disabled={isLoggingOut}
                                            className="inline-flex items-center px-3 py-2 border border-red-600 text-sm font-medium rounded-md text-red-400 bg-transparent hover:bg-red-600 hover:text-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                        >
                                            {isLoggingOut ? (
                                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                            ) : (
                                                <LogOut className="h-4 w-4 mr-2" />
                                            )}
                                            Logout WhatsApp
                                        </button>
                                    )}
                                </>
                            )}

                            {/* Cloud API info - no logout/reconnect needed */}
                            {isCloudApiImplementation(status) && (
                                <div className="text-sm text-gray-400 italic">
                                    Configuration managed via Facebook Business Manager
                                </div>
                            )}
                        </div>
                    </div>

                    {/* QR Code Section - Only for Bailey */}
                    {isBaileyImplementation(status) && status.hasQr && status.connectionState === 'waiting_for_scan' && (
                        <div className="bg-gray-700 rounded-lg p-6">
                            <div className="text-center">
                                <h3 className="text-lg font-medium text-white mb-4">
                                    Scan QR Code to Connect WhatsApp
                                </h3>
                                <p className="text-gray-300 mb-6">
                                    Open WhatsApp on your phone, go to Settings → Linked Devices → Link a Device,
                                    and scan this QR code.
                                </p>

                                {isLoading ? (
                                    <div className="flex justify-center items-center h-64">
                                        <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
                                    </div>
                                ) : qrCode ? (
                                    <div className="flex justify-center">
                                        <div className="bg-white p-4 rounded-lg">
                                            <img
                                                src={qrCode}
                                                alt="WhatsApp QR Code"
                                                className="w-64 h-64 object-contain"
                                            />
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex justify-center items-center h-64 text-gray-400">
                                        <p>QR Code not available</p>
                                    </div>
                                )}

                                {status.qrTimestamp && (
                                    <p className="text-sm text-gray-400 mt-4">
                                        QR Code generated: {new Date(status.qrTimestamp).toLocaleString()}
                                    </p>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Connected Status */}
                    {status.isReady && (
                        <div className="bg-green-900 border border-green-700 rounded-lg p-4">
                            <div className="flex items-center">
                                <CheckCircle className="h-5 w-5 text-green-400 mr-3" />
                                <div>
                                    <p className="text-green-100 font-medium">
                                        WhatsApp {isCloudApiImplementation(status) ? 'Cloud API' : 'Connection'} Ready!
                                    </p>
                                    <p className="text-green-200 text-sm">
                                        {isCloudApiImplementation(status)
                                            ? 'Official WhatsApp Business API is active and ready to send notifications.'
                                            : 'WhatsApp Web connection is active. The system can now send notifications.'
                                        }
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Disconnected Status - Only for Bailey */}
                    {isBaileyImplementation(status) && (status.connectionState === 'disconnected' || status.connectionState === 'close') && !status.hasQr && !status.isInitializing && (
                        <div className="bg-red-900 border border-red-700 rounded-lg p-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center">
                                    <AlertCircle className="h-5 w-5 text-red-400 mr-3" />
                                    <div>
                                        <p className="text-red-100 font-medium">WhatsApp Disconnected</p>
                                        <p className="text-red-200 text-sm">
                                            WhatsApp is not connected. {(status.reconnectAttempts || 0) >= 5 ? 'Max reconnection attempts reached.' : 'A new QR code should appear shortly for reconnection.'}
                                        </p>
                                    </div>
                                </div>
                                {(status.reconnectAttempts || 0) >= 5 && (
                                    <button
                                        onClick={handleForceReconnect}
                                        disabled={isReconnecting}
                                        className="inline-flex items-center px-3 py-2 text-sm font-medium rounded-md text-red-100 bg-red-800 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-red-900 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                    >
                                        {isReconnecting ? (
                                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                        ) : (
                                            <RefreshCw className="h-4 w-4 mr-2" />
                                        )}
                                        Retry Connection
                                    </button>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Initializing Status */}
                    {status.isInitializing && (
                        <div className="bg-blue-900 border border-blue-700 rounded-lg p-4">
                            <div className="flex items-center">
                                <Loader2 className="h-5 w-5 text-blue-400 mr-3 animate-spin" />
                                <div>
                                    <p className="text-blue-100 font-medium">Initializing WhatsApp Connection</p>
                                    <p className="text-blue-200 text-sm">
                                        Setting up WhatsApp service, please wait...
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Cloud API Error Status */}
                    {isCloudApiImplementation(status) && !status.isReady && (
                        <div className="bg-red-900 border border-red-700 rounded-lg p-4">
                            <div className="flex items-center">
                                <AlertCircle className="h-5 w-5 text-red-400 mr-3" />
                                <div>
                                    <p className="text-red-100 font-medium">WhatsApp Cloud API Not Ready</p>
                                    <p className="text-red-200 text-sm">
                                        The WhatsApp Cloud API is not responding properly. Please check your configuration in Facebook Business Manager and verify your API credentials.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Instructions */}
                    {isBaileyImplementation(status) ? (
                        <div className="bg-blue-900 border border-blue-700 rounded-lg p-4">
                            <h4 className="text-blue-100 font-medium mb-2">📱 How to Connect WhatsApp (Bailey):</h4>
                            <ol className="text-blue-200 text-sm space-y-1 list-decimal list-inside">
                                <li>Open WhatsApp on your phone</li>
                                <li>Go to Settings (⚙️) → Linked Devices</li>
                                <li>Tap "Link a Device"</li>
                                <li>Scan the QR code shown above</li>
                                <li>Wait for connection confirmation</li>
                            </ol>
                        </div>
                    ) : isCloudApiImplementation(status) ? (
                        <div className="bg-blue-900 border border-blue-700 rounded-lg p-4">
                            <h4 className="text-blue-100 font-medium mb-2">🏢 WhatsApp Cloud API Configuration:</h4>
                            <ul className="text-blue-200 text-sm space-y-1 list-disc list-inside">
                                <li>Configure your WhatsApp Business account via <a href="https://business.facebook.com/wa/manage/" target="_blank" rel="noopener noreferrer" className="text-blue-300 hover:text-blue-200 underline">Facebook Business Manager</a></li>
                                <li>Ensure your phone number is verified in Meta Business Manager</li>
                                <li>Check that webhooks are properly configured</li>
                                <li>Verify API credentials are correctly set in environment variables</li>
                                <li>No QR code scanning required - managed entirely through Meta platform</li>
                            </ul>
                        </div>
                    ) : (
                        <div className="bg-gray-700 border border-gray-600 rounded-lg p-4">
                            <h4 className="text-gray-100 font-medium mb-2">⚠️ Unknown Implementation</h4>
                            <p className="text-gray-300 text-sm">
                                Unable to determine WhatsApp implementation type. Please check your configuration.
                            </p>
                        </div>
                    )}
                </div>
            ) : (
                <div className="flex justify-center items-center h-32">
                    <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
                    <span className="ml-3 text-gray-300">Loading WhatsApp status...</span>
                </div>
            )}
        </div>
    );
};

export default WhatsAppManager;