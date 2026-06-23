import axios from 'axios';
import config from '../../config';
import logger from '../../utils/logger';

const log = logger.getLogger('NotificationServiceClient');

// Matches the expected input of notification-service POST /internal/create
// (same contract used by tombola-service).
interface InternalNotificationPayload {
    userId: string;
    type: string;
    channel: string;      // e.g. 'EMAIL'
    recipient?: string;
    data: {
        title?: string;
        body: string;
        templateId?: string;
        variables?: Record<string, any>;
        relatedData?: Record<string, any>;
    };
}

interface NotificationResponse {
    success: boolean;
    message: string;
    data?: any;
}

const notificationServiceClient = axios.create({
    baseURL: config.services.notificationService,
    timeout: 5000,
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.services.serviceSecret}`,
        'X-Service-Name': 'sbclove-service',
    },
});

/**
 * Sends an internal notification request. Never throws — match/contact flows
 * must continue even if notification delivery fails (best-effort).
 */
const createInternalNotification = async (payload: InternalNotificationPayload): Promise<boolean> => {
    try {
        log.info('Sending internal notification request', { userId: payload.userId, type: payload.type });
        const response = await notificationServiceClient.post<NotificationResponse>('/internal/create', payload);
        if (response.data?.success) {
            return true;
        }
        log.warn('Notification service responded with failure', { responseData: response.data });
        return false;
    } catch (error: any) {
        log.error('Error calling notification service /internal/create:', error.message);
        if (axios.isAxiosError(error)) {
            log.error('Notification Service Error Response:', error.response?.data);
        }
        return false;
    }
};

export const notificationServiceClient_ = {
    createInternalNotification,
};

export { createInternalNotification };
