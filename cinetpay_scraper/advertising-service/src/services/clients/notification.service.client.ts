import axios, { AxiosInstance } from 'axios';
import config from '../../config';
import logger from '../../utils/logger';
import { AppError } from '../../utils/errors';

const log = logger.getLogger('NotificationServiceClient');

// Define structure for the internal notification payload
// Ensure this matches the expected payload of the notification service's internal endpoint
export interface InternalNotificationPayload {
    userId: string;
    type: string; // e.g., 'NEW_ADVERTISEMENT'
    channel: string; // e.g., 'PUSH', 'EMAIL'
    recipient?: string; // Required for channels like EMAIL/SMS, maybe not for PUSH to specific user
    data: {
        title?: string;
        body: string;
        imageUrl?: string;
        templateId?: string;
        variables?: Record<string, any>;
        relatedData?: Record<string, any>; // e.g., { advertisementId: '...' }
    };
}

// Define expected response (optional, depends on notification service)
interface NotificationResponse {
    success: boolean;
    message?: string;
    // Add other fields if returned
}

class NotificationServiceClient {
    private apiClient: AxiosInstance;

    constructor() {
        if (!config.services.notificationService) {
            log.error('Notification Service URL is not configured.');
            throw new Error('Notification Service URL is not configured.');
        }
        this.apiClient = axios.create({
            baseURL: config.services.notificationService,
            timeout: 5000,
            headers: {
                'Content-Type': 'application/json',
                // Use the shared secret for service-to-service auth
                'Authorization': `Bearer ${config.services.serviceSecret}`,
                'X-Service-Name': 'advertising-service' // Identify the calling service
            },
        });
        log.info(`Notification Service Client initialized for URL: ${config.services.notificationService}`);
    }

    /**
     * Sends an internal notification request to the notification service.
     */
    async createInternalNotification(payload: InternalNotificationPayload): Promise<boolean> {
        // Note: The actual endpoint path (/internal/create) might differ
        const url = '/internal/create';
        log.info(`Sending internal notification request to ${this.apiClient.defaults.baseURL}${url}`);
        log.debug('Notification payload:', payload);

        try {
            const response = await this.apiClient.post<NotificationResponse>(url, payload);
            if (response.status >= 200 && response.status < 300 && response.data?.success) {
                log.info('Internal notification request sent successfully.', { userId: payload.userId, type: payload.type });
                return true;
            } else {
                log.warn('Notification service responded with failure or unexpected status.', {
                    status: response.status,
                    responseData: response.data
                });
                return false;
            }
        } catch (error: any) {
            log.error(`Error calling notification service ${url}: ${error.message}`);
            if (axios.isAxiosError(error) && error.response) {
                log.error('Notification Service Error Response:', { status: error.response.status, data: error.response.data });
            }
            // Don't throw an error, just return false as sending notification is often non-critical
            return false;
        }
    }

    /**
     * Sends a request to the notification service to broadcast a notification.
     * Assumes the notification service has an endpoint like /internal/notifications/broadcast
     */
    async createBroadcastNotification(payload: any): Promise<boolean> {
        const endpoint = '/internal/notifications/broadcast'; // Define the broadcast endpoint
        log.info(`Sending broadcast notification request to Notification Service`);
        try {
            const response = await this.apiClient.post(endpoint, payload);

            // Assuming 202 Accepted indicates success for queued broadcast
            if (response.status === 202 && response.data.success) {
                log.info('Broadcast notification request accepted by Notification Service.');
                return true;
            } else {
                log.warn(`Notification Service returned non-success for broadcast: ${response.status}`, { data: response.data });
                return false;
            }
        } catch (error: any) {
            log.error('Error calling Notification Service for broadcast:', {
                error: error.response?.data || error.message,
                status: error.response?.status
            });
            return false;
        }
    }
}

// Export a singleton instance
export const notificationService = new NotificationServiceClient(); 