import apiClient from './apiClient';

export interface WhatsAppStatus {
    isReady: boolean;
    hasQr?: boolean; // Only available for Bailey
    qrTimestamp?: number | null; // Only available for Bailey
    connectionState: 'connected' | 'waiting_for_scan' | 'disconnected' | 'close' | 'open' | 'connecting' | 'error';
    reconnectAttempts?: number; // Only available for Bailey
    isInitializing?: boolean; // Only available for Bailey
    implementation?: string; // 'WhatsApp Cloud API' or 'Bailey'
    lastHealthCheck?: Date | null; // Only available for Cloud API
}

export interface WhatsAppStatusResponse {
    success: boolean;
    data: WhatsAppStatus;
}

export interface WhatsAppLogoutResponse {
    success: boolean;
    message: string;
}

/**
 * Get current WhatsApp connection status
 */
export const getWhatsAppStatus = async (): Promise<WhatsAppStatus> => {
    const response = await apiClient.get<WhatsAppStatusResponse>('/whatsapp/status');
    return response.data.data;
};

/**
 * Get WhatsApp QR code as blob
 */
export const getWhatsAppQr = async (): Promise<Blob> => {
    const response = await apiClient.get('/whatsapp/qr', {
        responseType: 'blob',
    });
    return response.data;
};

/**
 * Logout current WhatsApp session
 */
export const logoutWhatsApp = async (): Promise<string> => {
    const response = await apiClient.post<WhatsAppLogoutResponse>('/whatsapp/logout');
    return response.data.message;
};

/**
 * Force reconnect WhatsApp
 */
export const forceReconnectWhatsApp = async (): Promise<string> => {
    const response = await apiClient.post<WhatsAppLogoutResponse>('/whatsapp/reconnect');
    return response.data.message;
};

/**
 * Test WhatsApp notification
 */
export const testWhatsAppNotification = async (data: {
    phoneNumber: string;
    name: string;
    transactionType: string;
    transactionId: string;
    amount: number | string;
    currency: string;
    date: string;
}): Promise<void> => {
    await apiClient.post('/whatsapp/test-notification', data);
};