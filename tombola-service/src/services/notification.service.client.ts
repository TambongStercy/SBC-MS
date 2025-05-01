import axios from 'axios';
import config from '../config';
import logger from '../utils/logger';
import { AppError } from '../utils/errors';

const log = logger.getLogger('NotificationServiceClient');

// Define structure for the internal notification payload
// This should match the expected input of notification-service POST /internal/create
interface InternalNotificationPayload {
    userId: string;             // ID of the user receiving the notification
    type: string;               // Notification type (e.g., 'TOMBOLA_WINNER', 'SYSTEM_ALERT')
    channel: string;            // Preferred channel (e.g., 'PUSH', 'EMAIL', 'SMS') - notification service might decide final channel
    recipient?: string;          // Specific recipient address (e.g., email, phone) if channel requires it
    data: {                   // Data for the notification content
        title?: string;
        body: string;             // Main message content
        imageUrl?: string;
        templateId?: string;     // Optional template identifier
        variables?: Record<string, any>; // Variables for the template
        relatedData?: Record<string, any>; // Extra data (e.g., { tombolaMonthId: '...', prize: '...' })
    };
}

// Define expected response (might just be success/failure)
interface NotificationResponse {
    success: boolean;
    message: string;
    data?: any; // Optional data returned by notification service
}

const notificationServiceClient = axios.create({
    baseURL: config.services.notificationService,
    timeout: 5000, // Timeout for notification requests
    headers: {
        'Content-Type': 'application/json',
        // --- Service-to-Service Authentication --- 
        // Add API Key or Service JWT header matching notification-service expectation
        'Authorization': `Bearer ${config.services.serviceSecret}`,
        'X-Service-Name': 'tombola-service',
    },
});

/**
 * Sends an internal notification request to the notification service.
 */
const createInternalNotification = async (payload: InternalNotificationPayload): Promise<boolean> => {
    try {
        log.info('Sending internal notification request', { userId: payload.userId, type: payload.type });
        const response = await notificationServiceClient.post<NotificationResponse>('/internal/create', payload);

        if (response.data && response.data.success) {
            log.info('Notification request sent successfully.', { userId: payload.userId, type: payload.type });
            return true;
        } else {
            log.warn('Notification service responded with failure', { responseData: response.data });
            // Don't throw an error that stops the caller, just log and return false
            return false;
        }
    } catch (error: any) {
        log.error('Error calling notification service /internal/create:', error.message);
        if (axios.isAxiosError(error)) {
            log.error('Notification Service Error Response:', error.response?.data);
        }
        // Do not throw - allow caller (e.g., drawWinners) to continue
        return false;
    }
};

export const notificationService = {
    createInternalNotification,
}; 