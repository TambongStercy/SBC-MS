import axios, { AxiosInstance } from 'axios';
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

// NEW INTERFACE for attachment email request
interface AttachmentEmailRequest {
    userId: string;
    recipientEmail: string;
    subject: string;
    body: string;
    attachmentContent: string; // Base64 encoded string
    attachmentFileName: string;
    attachmentContentType: string;
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
    private apiClient: AxiosInstance;

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

    /**
     * Sends an email with a file attachment via the notification service.
     * @param data The payload for the email with attachment.
     * @returns Promise<boolean> indicating success.
     */
    async sendEmailWithAttachment(data: AttachmentEmailRequest): Promise<boolean> {
        log.info(`Attempting to send email with attachment to ${data.recipientEmail}`);
        try {
            const response = await this.apiClient.post('/notifications/send-email-attachment', data);
            if (response.data.success) {
                log.info(`Email with attachment successfully sent to ${data.recipientEmail}`);
                return true;
            } else {
                log.warn(`Failed to send email with attachment to ${data.recipientEmail}: ${response.data.message}`);
                return false;
            }
        } catch (error) {
            log.error(`Error sending email with attachment to ${data.recipientEmail}:`, error);
            return false;
        }
    }

    /**
     * Send a WhatsApp message with a file attachment via the notification service
     */
    async sendWhatsappWithAttachment({
        userId,
        recipient,
        body,
        attachmentContent,
        attachmentFileName,
        attachmentContentType,
    }: {
        userId: string;
        recipient: string;
        body?: string;
        attachmentContent: string;
        attachmentFileName?: string;
        attachmentContentType: string;
    }): Promise<boolean> {
        try {
            log.info(`Sending WhatsApp file attachment to ${recipient}`);
            const response = await this.apiClient.post('/notifications/internal/create', {
                userId,
                type: NotificationType.ACCOUNT, // Or another type if more appropriate
                channel: DeliveryChannel.WHATSAPP,
                recipient,
                data: {
                    body: body || '',
                    attachmentContent,
                    attachmentFileName,
                    attachmentContentType,
                },
            });
            if (response.status === 201 && response.data.success) {
                log.info(`WhatsApp file attachment sent successfully to ${recipient}`);
                return true;
            } else {
                log.warn(`Failed to send WhatsApp file attachment: ${response.data.message}`);
                return false;
            }
        } catch (error: any) {
            log.error(`Error sending WhatsApp file attachment: ${error.message}`, {
                userId,
                recipient,
                error: error.response?.data || error.message,
            });
            return false;
        }
    }
}

// Export singleton instance
export const notificationService = new NotificationService(); 