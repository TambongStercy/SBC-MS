import axios from 'axios';
import config from '../config';
import logger from '../utils/logger';

const log = logger.getLogger('NotificationServiceClient');

// Interfaces for the payloads, mirroring those in notification-service
interface CommissionEmailPayload {
    email: string;
    amount: number | string;
    level: string | number;
    name: string;
    username: string;
    debt?: number | string;
}

interface TransactionSuccessPayload {
    email: string;
    name: string;
    transactionType: string;
    transactionId: string;
    amount: number | string;
    currency: string;
    date: string;
    productOrServiceName?: string;
}

class NotificationServiceClient {
    private baseUrl: string;
    private serviceSecret: string;

    constructor() {
        if (!config.services.notificationServiceUrl) {
            log.error('NotificationService URL is not configured in payment-service config.');
            throw new Error('NotificationService URL is not configured.');
        }
        this.baseUrl = config.services.notificationServiceUrl;
        this.serviceSecret = config.services.serviceSecret;
    }

    private async request(method: 'post', path: string, data?: any): Promise<boolean> {
        const url = `${this.baseUrl}${path}`; // Path should be relative to notificationServiceUrl
        log.debug(`Making ${method.toUpperCase()} request to Notification Service: ${url}`, data);
        try {
            const headers: { [key: string]: string } = {};
            if (this.serviceSecret) {
                // Assuming authenticateServiceRequest in notification-service expects a 'x-service-secret' or similar
                // Adjust if it expects 'Authorization: Bearer <secret>'
                headers['x-service-secret'] = this.serviceSecret;
            }
            headers['x-calling-service'] = 'payment-service'; // Good practice to identify caller

            const response = await axios({
                method,
                url,
                data,
                headers,
                timeout: config.nodeEnv === 'development' ? 30000 : 5000 // Example timeout
            });

            // Check if the response indicates success (e.g., 2xx status code)
            // and if the notification service returns a specific success flag in its body.
            if (response.status >= 200 && response.status < 300 && response.data && response.data.success === true) {
                log.info(`Notification request to ${path} successful.`);
                return true;
            }
            log.warn(`Notification request to ${path} failed or returned unsuccessful status:`, response.data);
            return false;
        } catch (error: any) {
            log.error(`Error calling Notification Service at ${url}:`, error.response?.data || error.message);
            // Do not re-throw, just return false to indicate failure to send notification
            // The calling service can then decide how to handle this (e.g., log and continue)
            return false;
        }
    }

    /**
     * Calls the new endpoint in notification-service to send a commission earned email.
     */
    async sendCommissionEarnedEmail(payload: CommissionEmailPayload): Promise<boolean> {
        // The path should match the route defined in notification-service's notification.routes.ts
        // If notificationServiceUrl includes /api/notifications, then path is just /internal/email/commission-earned
        // If notificationServiceUrl is just http://localhost:PORT, then path includes /api/notifications
        // Assuming config.services.notificationServiceUrl is the base URL of the notification service (e.g., http://localhost:3004)
        // and routes in notification-service are mounted under /api/notifications (standard practice)
        const path = '/api/notifications/internal/email/commission-earned';
        log.info('Attempting to send commission earned email via Notification Service', payload);
        return this.request('post', path, payload);
    }

    /**
     * Calls the new endpoint in notification-service to send a transaction successful email.
     */
    async sendTransactionSuccessEmail(payload: TransactionSuccessPayload): Promise<boolean> {
        const path = '/api/notifications/internal/email/transaction-successful';
        log.info('Attempting to send transaction successful email via Notification Service', payload);
        return this.request('post', path, payload);
    }

    /**
     * Send a transaction notification to a user
     * @deprecated Consider using sendTransactionSuccessEmail for specific success emails.
     */
    async sendTransactionNotification(userId: string, type: string, data: Record<string, any>): Promise<boolean> {
        try {
            const response = await axios.post(
                `${this.baseUrl}/api/notifications/send`,
                {
                    userId,
                    type: 'TRANSACTION',
                    templateId: type,
                    channel: 'EMAIL',
                    data
                },
                { headers: this.getAuthHeaders() }
            );

            log.info(`Sent transaction notification to user ${userId} with type ${type}`);
            return response.data.success;
        } catch (error) {
            log.error(`Error sending transaction notification: ${error}`);
            return false;
        }
    }

    /**
     * Send verification OTP for sensitive operations
     */
    async sendVerificationOTP(userId: string, type: string, data: Record<string, any>): Promise<boolean> {
        try {
            const response = await axios.post(
                `${this.baseUrl}/api/notifications/send-otp`,
                {
                    userId,
                    type,
                    channel: 'SMS', // Can be configured to use EMAIL or both
                    data
                },
                { headers: this.getAuthHeaders() }
            );

            log.info(`Sent verification OTP to user ${userId} for ${type}`);
            return response.data.success;
        } catch (error) {
            log.error(`Error sending verification OTP: ${error}`);
            return false;
        }
    }

    /**
     * Send alert notification for suspicious activity
     */
    async sendSecurityAlert(userId: string, alertType: string, data: Record<string, any>): Promise<boolean> {
        try {
            const response = await axios.post(
                `${this.baseUrl}/api/notifications/send-alert`,
                {
                    userId,
                    alertType,
                    channel: 'EMAIL', // Can be configured to use SMS or both
                    data,
                    priority: 'HIGH'
                },
                { headers: this.getAuthHeaders() }
            );

            log.info(`Sent security alert to user ${userId} for ${alertType}`);
            return response.data.success;
        } catch (error) {
            log.error(`Error sending security alert: ${error}`);
            return false;
        }
    }

    /**
     * Get auth headers for inter-service communication
     * @deprecated Centralized in the new `request` method.
     */
    private getAuthHeaders() {
        // Use a service-to-service authentication token
        return {
            'Authorization': `Bearer ${config.jwt.secret}`,
            'X-Service-Name': 'payment-service'
        };
    }
}

// Export singleton instance
const notificationServiceClient = new NotificationServiceClient();
export default notificationServiceClient; 