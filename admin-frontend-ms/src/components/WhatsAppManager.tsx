import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, Smartphone, QrCode, LogOut, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { getWhatsAppStatus, getWhatsAppQr, logoutWhatsApp, WhatsAppStatus } from '../api/whatsapp';

const WhatsAppManager: React.FC = () => {
    const [status, setStatus] = useState<WhatsAppStatus | null>(null);
    const [qrCode, setQrCode] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isLoggingOut, setIsLoggingOut] = useState(false);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

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

    const fetchQrCode = useCallback(async () => {
        if (!status?.hasQr) return;
        
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
    }, [status?.hasQr]);

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

    // Auto-refresh status every 5 seconds for better responsiveness
    useEffect(() => {
        const interval = setInterval(fetchStatus, 5000);
        return () => clearInterval(interval);
    }, [fetchStatus]);

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
                return 'text-green-400';
            case 'waiting_for_scan':
                return 'text-yellow-400';
            case 'disconnected':
                return 'text-red-400';
            default:
                return 'text-gray-400';
        }
    };

    const getStatusIcon = (state: string) => {
        switch (state) {
            case 'connected':
                return <CheckCircle className="h-5 w-5 text-green-400" />;
            case 'waiting_for_scan':
                return <QrCode className="h-5 w-5 text-yellow-400" />;
            case 'disconnected':
                return <AlertCircle className="h-5 w-5 text-red-400" />;
            default:
                return <Smartphone className="h-5 w-5 text-gray-400" />;
        }
    };

    const getStatusText = (state: string) => {
        switch (state) {
            case 'connected':
                return 'Connected & Ready';
            case 'waiting_for_scan':
                return 'Waiting for QR Scan';
            case 'disconnected':
                return 'Disconnected';
            default:
                return 'Unknown';
        }
    };

    return (
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center space-x-3">
                    <Smartphone className="h-6 w-6 text-green-400" />
                    <h2 className="text-xl font-semibold text-white">WhatsApp Management</h2>
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
                    {/* Status Display */}
                    <div className="flex items-center justify-between p-4 bg-gray-700 rounded-lg">
                        <div className="flex items-center space-x-3">
                            {getStatusIcon(status.connectionState)}
                            <div>
                                <p className={`font-medium ${getStatusColor(status.connectionState)}`}>
                                    {getStatusText(status.connectionState)}
                                </p>
                                {lastUpdated && (
                                    <p className="text-sm text-gray-400">
                                        Last updated: {lastUpdated.toLocaleTimeString()}
                                    </p>
                                )}
                            </div>
                        </div>
                        
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
                    </div>

                    {/* QR Code Section */}
                    {status.hasQr && status.connectionState === 'waiting_for_scan' && (
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
                                    <p className="text-green-100 font-medium">WhatsApp Connected Successfully!</p>
                                    <p className="text-green-200 text-sm">
                                        The system can now send WhatsApp notifications to users.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Disconnected Status */}
                    {status.connectionState === 'disconnected' && !status.hasQr && (
                        <div className="bg-red-900 border border-red-700 rounded-lg p-4">
                            <div className="flex items-center">
                                <AlertCircle className="h-5 w-5 text-red-400 mr-3" />
                                <div>
                                    <p className="text-red-100 font-medium">WhatsApp Disconnected</p>
                                    <p className="text-red-200 text-sm">
                                        WhatsApp is not connected. A new QR code should appear shortly for reconnection.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Instructions */}
                    <div className="bg-blue-900 border border-blue-700 rounded-lg p-4">
                        <h4 className="text-blue-100 font-medium mb-2">📱 How to Connect WhatsApp:</h4>
                        <ol className="text-blue-200 text-sm space-y-1 list-decimal list-inside">
                            <li>Open WhatsApp on your phone</li>
                            <li>Go to Settings (⚙️) → Linked Devices</li>
                            <li>Tap "Link a Device"</li>
                            <li>Scan the QR code shown above</li>
                            <li>Wait for connection confirmation</li>
                        </ol>
                    </div>
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