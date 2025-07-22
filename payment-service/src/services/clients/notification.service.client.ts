import axios from 'axios';
import config from '../../config';
import logger from '../../utils/logger';

const log = logger.getLogger('NotificationServiceClient');

// Interface for OTP notification request
interface OtpNotificationRequest {
    userId: string;
    recipient: string;
    channel: DeliveryChannel;
    code: string;
    expireMinutes: number;
    isRegistration: boolean;
    userName?: string;
    purpose?: string;
    description?: string;
    language?: string;
}

// Define notification types
export enum NotificationType {
    OTP = 'otp',
    TRANSACTION = 'transaction',
    SYSTEM = 'system',
    MARKETING = 'marketing',
    REFERRAL = 'referral',
    ACCOUNT = 'account',
}

// Define delivery channels
export enum DeliveryChannel {
    EMAIL = 'email',
    SMS = 'sms',
    WHATSAPP = 'whatsapp',
    PUSH = 'push',
}


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

// NEW: Interface for Transaction Failure Payload
interface TransactionFailurePayload extends TransactionSuccessPayload {
    reason?: string; // The reason for the failure
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
                headers['Authorization'] = `Bearer ${this.serviceSecret}`;
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
        // Assuming notificationServiceUrl includes /api, path should be relative to that.
        const path = '/notifications/internal/email/commission-earned'; // Removed leading /api
        log.info('Attempting to send commission earned email via Notification Service', payload);
        return this.request('post', path, payload);
    }

    /**
     * Calls the new endpoint in notification-service to send a transaction successful email.
     */
    async sendTransactionSuccessEmail(payload: TransactionSuccessPayload): Promise<boolean> {
        // Assuming notificationServiceUrl includes /api, path should be relative to that.
        const path = '/notifications/internal/email/transaction-successful'; // Removed leading /api
        log.info('Attempting to send transaction successful email via Notification Service', payload);
        return this.request('post', path, payload);
    }

    // NEW: Method to send transaction failure emails
    async sendTransactionFailureEmail(payload: TransactionFailurePayload): Promise<boolean> {
        const path = '/notifications/internal/email/transaction-failed'; // Assuming a new endpoint for failures
        log.info('Attempting to send transaction failure email via Notification Service', payload);
        return this.request('post', path, payload);
    }

    /**
     * Send a transaction notification to a user
     * @deprecated Consider using sendTransactionSuccessEmail for specific success emails.
     */
    async sendTransactionNotification(userId: string, type: string, data: Record<string, any>): Promise<boolean> {
        try {
            // This method uses axios directly, path needs adjustment if baseUrl includes /api
            const response = await axios.post(
                `${this.baseUrl}/notifications/send`, // Adjusted path assuming baseUrl has /api
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
    async sendVerificationOTP(data: OtpNotificationRequest): Promise<boolean> {
        try {
            // This method uses axios directly, path needs adjustment if baseUrl includes /api
            const response = await axios.post(
                `${this.baseUrl}/notifications/otp`, // Adjusted path assuming baseUrl has /api
                data,
                { headers: this.getAuthHeaders() }
            );

            log.info(`Sent verification OTP to user ${data.userId} for ${data.purpose}`);
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
            // This method uses axios directly, path needs adjustment if baseUrl includes /api
            const response = await axios.post(
                `${this.baseUrl}/notifications/send-alert`, // Adjusted path assuming baseUrl has /api
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
            'Authorization': `Bearer ${config.services.serviceSecret}`, // Corrected: Use serviceSecret from config
            'X-Service-Name': 'payment-service'
        };
    }
}

// Export singleton instance
const notificationServiceClient = new NotificationServiceClient();
export default notificationServiceClient; 