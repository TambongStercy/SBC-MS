import axios from 'axios';
import config from '../../config';
import logger from '../../utils/logger';

// Create a component-specific logger
const log = logger.getLogger('NotificationService');

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


class NotificationService {
    private apiClient;

    constructor() {
        // Create axios instance with base URL
        this.apiClient = axios.create({
            baseURL: config.services.notificationService,
            timeout: 5000,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.services.serviceSecret}`
            },
        });

        log.info('Notification service client initialized');
    }

    /**
     * Send an OTP code via email or SMS for 2FA
     */
    async sendOtp(data: OtpNotificationRequest): Promise<boolean> {
        try {
            log.info(`Sending ${data.channel} OTP for user ${data.userId}`);

            const response = await this.apiClient.post('/notifications/otp', data);

            if (response.status === 200 && response.data.success) {
                log.info(`OTP sent successfully to ${data.recipient}`);
                return true;
            } else {
                log.warn(`Failed to send OTP: ${response.data.message}`);
                return false;
            }
        } catch (error: any) {
            log.error(`Error sending OTP notification: ${error.message}`, {
                userId: data.userId,
                channel: data.channel,
                error: error.response?.data || error.message,
            });
            return false;
        }
    }

    /**
     * Send a 2FA email with OTP code
     */
    async send2FAEmail(
        userId: string,
        email: string,
        code: string,
        userName: string,
        isRegistration: boolean = false
    ): Promise<boolean> {
        return this.sendOtp({
            userId,
            recipient: email,
            channel: DeliveryChannel.EMAIL,
            code,
            expireMinutes: 10,
            isRegistration,
            userName,
        });
    }

    /**
     * Send a 2FA SMS with OTP code
     */
    async send2FASMS(
        userId: string,
        phoneNumber: string,
        code: string,
        userName: string,
        isRegistration: boolean = false
    ): Promise<boolean> {
        return this.sendOtp({
            userId,
            recipient: phoneNumber,
            channel: DeliveryChannel.SMS,
            code,
            expireMinutes: 10,
            isRegistration,
            userName,
        });
    }
}

// Export singleton instance
export const notificationService = new NotificationService(); 