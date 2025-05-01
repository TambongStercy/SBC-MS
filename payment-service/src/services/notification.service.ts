import axios from 'axios';
import config from '../config';
import logger from '../utils/logger';

const log = logger.getLogger('NotificationService');

class NotificationService {
    private baseUrl: string;

    constructor() {
        this.baseUrl = config.services.notificationServiceUrl as string;
    }

    /**
     * Send a transaction notification to a user
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
const notificationService = new NotificationService();
export default notificationService; 