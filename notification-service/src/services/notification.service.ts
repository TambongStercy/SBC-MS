import { Types } from 'mongoose';
import {
    INotification,
    NotificationType,
    DeliveryChannel,
    NotificationStatus
} from '../database/models/notification.model';
import { notificationRepository } from '../database/repositories/notification.repository';
import { emailService } from './email.service';
import { smsService } from './sms.service';
import { getProcessedTemplate, templateExists } from '../utils/templates';
import logger from '../utils/logger';
import * as amqp from 'amqplib';
import type { Connection, Channel } from 'amqplib';
import config from '../config';
import { userServiceClient } from './clients/user.service.client';
import { AppError } from '../utils/errors';
import { queueService } from './queue.service';
import whatsappServiceFactory from './whatsapp-service-factory';

// Create a component-specific logger
const log = logger.getLogger('NotificationService');

// Interface for creating a notification
interface CreateNotificationData {
    userId: string | Types.ObjectId;
    recipient: string;
    type: NotificationType;
    channel: DeliveryChannel;
    templateId?: string;
    variables?: Record<string, any>;
    subject?: string;
    body?: string;
}

interface CreateNotificationInput {
    userId: string | Types.ObjectId;
    type: NotificationType;
    channel: DeliveryChannel;
    recipient: string; // email or phone number
    data: {
        templateId?: string;
        variables?: Record<string, any>;
        subject?: string;
        body: string;
    };
}

interface ITargetCriteria {
    regions?: string[];
    minAge?: number;
    maxAge?: number;
    sex?: 'male' | 'female' | 'other';
    interests?: string[];
    professions?: string[];
    language?: string[];
    city?: string[];
}

// NEW INTERFACE for the service method payload
interface SendAttachmentEmailInput {
    userId: string | Types.ObjectId;
    recipient: string;
    subject: string;
    body: string;
    attachmentContent: string; // Base64 encoded string
    attachmentFileName: string;
    attachmentContentType: string;
}

class NotificationService {
    constructor() {
        // Listen for WhatsApp disconnects
        whatsappServiceFactory.getService().onDisconnect(async (qrUrl: string | null) => {
            const adminEmail = config.email?.from || 'admin@example.com';
            const baseUrl = process.env.SERVER_URL || process.env.PUBLIC_URL || 'http://localhost:3002';
            const qrEndpoint = `${baseUrl}/api/notifications/whatsapp/qr`;
            const subject = 'WhatsApp Service Disconnected';
            const body = `WhatsApp service has been disconnected. Please scan the new QR code to restore service.\n\nQR Code: ${qrEndpoint}`;
            try {
                await emailService.sendEmail({
                    to: adminEmail,
                    subject,
                    text: body,
                    html: `<p>WhatsApp service has been <b>disconnected</b>.<br>Please <a href="${qrEndpoint}">scan the new QR code</a> to restore service.</p><img src="${qrEndpoint}" alt="QR Code" style="max-width:300px;">`,
                });
            } catch (err) {
                logger.error('Failed to send WhatsApp disconnect email:', err);
            }
        });
    }

    /**
     * Create and send a notification
     */
    async createAndSendNotification(data: CreateNotificationData): Promise<INotification> {
        // Prepare notification data
        let notificationData: any = {
            userId: data.userId,
            recipient: data.recipient,
            type: data.type,
            channel: data.channel,
            data: {
                body: data.body || '',
                plainText: data.body ? data.body.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : '',
            }
        };

        // If a template ID is provided, process the template
        if (data.templateId && templateExists(data.type, data.templateId)) {
            const processedTemplate = getProcessedTemplate(
                data.type,
                data.templateId,
                data.variables || {}
            );

            notificationData.data = {
                templateId: data.templateId,
                variables: data.variables,
                subject: processedTemplate.subject,
                body: processedTemplate.body,
                plainText: processedTemplate.plainText,
                whatsappCode: processedTemplate.whatsappCode, // Add WhatsApp code support
            };

            // Extract and store language from variables if present
            if (data.variables && data.variables.language) {
                notificationData.data.language = data.variables.language;
            }
        } else if (data.subject) {
            // If no template but subject provided
            notificationData.data.subject = data.subject;
        }

        // Create notification in database VIA REPOSITORY
        const notification = await notificationRepository.create(notificationData as any);

        // Try to queue notification, with fallback to immediate sending for critical notifications
        let queueSuccess = false;
        try {
            await queueService.queueNotification(notification);
            log.info(`Notification ${notification._id} queued successfully for ${notification.recipient}`);
            queueSuccess = true;
        } catch (error) {
            log.error(`Failed to queue notification ${notification._id}`, { error });

            // For critical notifications (like OTP and account-related), attempt immediate sending as fallback
            if (data.type === NotificationType.OTP || data.type === NotificationType.ACCOUNT) {
                log.warn(`Attempting immediate send for critical notification ${notification._id} due to queue failure`);
                try {
                    await this.sendNotification(notification);
                    log.info(`Critical notification ${notification._id} sent immediately as fallback`);
                } catch (sendError) {
                    log.error(`Failed to send critical notification ${notification._id} immediately:`, sendError);
                    // The notification remains PENDING for the background processor to retry
                }
            }
        }

        return notification;
    }

    /**
     * Send notification based on its channel
     */
    async sendNotification(notification: INotification): Promise<void> {
        try {
            let success = false;

            // Send based on channel
            switch (notification.channel) {
                case DeliveryChannel.EMAIL:
                    success = await this.sendEmailNotification(notification);
                    break;

                case DeliveryChannel.SMS:
                    success = await this.sendSmsNotification(notification);
                    break;
                case DeliveryChannel.WHATSAPP:
                    success = await this.sendWhatsappNotification(notification);
                    break;

                case DeliveryChannel.PUSH:
                    throw new Error('Push notifications not implemented yet');

                default:
                    throw new Error(`Unknown delivery channel: ${notification.channel}`);
            }

            // Update notification status VIA REPOSITORY
            if (success) {
                await notificationRepository.markAsSent(notification._id);
            } else {
                log.warn(`Marking notification ${notification._id} as FAILED after send attempt.`);
                await notificationRepository.markAsFailed(notification._id, 'SMS provider failed to send message.');
            }
        } catch (error: any) {
            log.error(`Error handling notification ${notification._id}:`, error);
            await notificationRepository.markAsFailed(notification._id, error.message || 'Unknown sending error');
        }
    }

    /**
     * Send an email notification
     */
    private async sendEmailNotification(notification: INotification): Promise<boolean> {
        if (!notification.data.subject) {
            throw new Error('Email subject is required');
        }

        return emailService.sendEmail({
            to: notification.recipient,
            subject: notification.data.subject,
            html: notification.data.body,
            text: notification.data.body.replace(/<[^>]*>/g, ''),
        });
    }

    /**
     * Send an SMS notification using the consolidated smsService
     */
    private async sendSmsNotification(notification: INotification): Promise<boolean> {
        // Always strip HTML tags for SMS
        let body = '';
        if (typeof notification.data.plainText === 'string' && notification.data.plainText.trim()) {
            // Remove any HTML tags from plainText just in case
            body = notification.data.plainText.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        } else if (notification.data.body) {
            body = notification.data.body.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        }
        return smsService.sendSms({
            to: notification.recipient,
            body,
        });
    }

    /**
     * Send WhatsApp notification with enhanced tracking and fallback mechanisms
     */
    private async sendWhatsappNotification(notification: INotification): Promise<boolean> {
        const data = notification.data || {};

        // First check if WhatsApp is connected and ready
        const whatsappStatus = whatsappServiceFactory.getService().getConnectionStatus();
        if (!whatsappStatus.isReady) {
            log.warn(`WhatsApp is not ready (status: ${whatsappStatus.connectionState}). Cannot send notification to ${notification.recipient}`);

            // Implement fallback mechanism for critical OTP notifications
            if (notification.type === NotificationType.OTP) {
                log.info(`OTP notification ${notification._id} failed via WhatsApp - attempting email fallback`);

                try {
                    // Try email fallback for OTP
                    const emailSuccess = await this.sendEmailNotification(notification);
                    if (emailSuccess) {
                        log.info(`OTP notification ${notification._id} successfully sent via email fallback`);
                        // Update notification to indicate fallback was used
                        await notificationRepository.update(notification._id, {
                            errorDetails: 'WhatsApp unavailable - sent via email fallback',
                            sentAt: new Date(),
                            status: NotificationStatus.SENT
                        });
                        return true;
                    }
                } catch (emailError) {
                    log.error(`Email fallback also failed for OTP notification ${notification._id}:`, emailError);
                }

                // Mark as failed if both WhatsApp and email failed
                await notificationRepository.update(notification._id, {
                    status: NotificationStatus.FAILED,
                    failedAt: new Date(),
                    errorDetails: 'WhatsApp unavailable and email fallback failed'
                });
                return false;
            }

            // For non-OTP notifications, mark as failed but don't try fallback
            await notificationRepository.update(notification._id, {
                status: NotificationStatus.FAILED,
                failedAt: new Date(),
                errorDetails: `WhatsApp service not ready: ${whatsappStatus.connectionState}`
            });
            return false;
        }

        try {
            const whatsappService = whatsappServiceFactory.getService();
            let result;

            // Check if we have a separate WhatsApp code to send as a second message
            if (data.whatsappCode && typeof data.whatsappCode === 'string' && data.whatsappCode.trim()) {
                // Send two separate messages: main message + code
                const mainMessage = (typeof data.plainText === 'string' && data.plainText.trim())
                    ? data.plainText.trim()
                    : (data.body ? data.body.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : '');

                const codeMessage = data.whatsappCode.trim();
                const messages = [mainMessage, codeMessage].filter(msg => msg); // Remove empty messages

                log.info(`[WhatsApp] Sending dual messages to ${notification.recipient}: ${messages.length} messages`);

                // Use enhanced method if available (Cloud API)
                if (whatsappServiceFactory.supportsEnhancedMethods() && 'sendMultipleTextMessagesEnhanced' in whatsappService) {
                    result = await (whatsappService as any).sendMultipleTextMessagesEnhanced({
                        phoneNumber: notification.recipient,
                        messages,
                    });

                    if (result.success) {
                        // Update notification with message IDs
                        const updateData: any = {
                            status: NotificationStatus.SENT,
                            sentAt: new Date(),
                            whatsappStatus: 'sent'
                        };

                        // Store first message ID as primary and all IDs in a custom field
                        if (result.messageIds && result.messageIds.length > 0) {
                            updateData.whatsappMessageId = result.messageIds[0];
                            // Store additional message IDs in error details field (temporary solution)
                            if (result.messageIds.length > 1) {
                                updateData.errorDetails = `Additional message IDs: ${result.messageIds.slice(1).join(', ')}`;
                            }
                        }

                        await notificationRepository.update(notification._id, updateData);
                        log.info(`WhatsApp notification ${notification._id} sent successfully with ${result.sentCount}/${result.totalCount} messages`);
                        return true;
                    } else {
                        // Handle partial success or complete failure
                        await this.handleWhatsAppFailure(notification, result.error || 'Unknown error', result.sentCount || 0, result.totalCount || messages.length);
                        return result.sentCount && result.sentCount > 0; // Return true if at least one message was sent
                    }
                } else {
                    // Fallback to legacy method for Bailey
                    const success = await whatsappService.sendMultipleTextMessages({
                        phoneNumber: notification.recipient,
                        messages,
                    });

                    if (success) {
                        await notificationRepository.markAsSent(notification._id);
                        log.info(`WhatsApp notification ${notification._id} sent successfully (legacy method)`);
                        return true;
                    } else {
                        await this.handleWhatsAppFailure(notification, 'Failed to send multiple messages via legacy method');
                        return false;
                    }
                }
            } else {
                // Send single message (original behavior)
                let message = '';
                if (typeof data.plainText === 'string' && data.plainText.trim()) {
                    message = data.plainText.trim();
                } else if (data.body) {
                    // Fallback: strip HTML tags
                    message = data.body.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
                }

                log.info(`[WhatsApp] Sending single message to ${notification.recipient}: ${message.substring(0, 50)}...`);

                // Use enhanced method if available (Cloud API)
                if (whatsappServiceFactory.supportsEnhancedMethods() && 'sendTextMessageEnhanced' in whatsappService) {
                    result = await (whatsappService as any).sendTextMessageEnhanced({
                        phoneNumber: notification.recipient,
                        message,
                    });

                    if (result.success) {
                        // Update notification with message ID
                        const updateData: any = {
                            status: NotificationStatus.SENT,
                            sentAt: new Date(),
                            whatsappStatus: 'sent'
                        };

                        if (result.messageId) {
                            updateData.whatsappMessageId = result.messageId;
                        }

                        await notificationRepository.update(notification._id, updateData);
                        log.info(`WhatsApp notification ${notification._id} sent successfully with message ID: ${result.messageId}`);
                        return true;
                    } else {
                        await this.handleWhatsAppFailure(notification, result.error || 'Unknown error');
                        return false;
                    }
                } else {
                    // Fallback to legacy method for Bailey
                    const success = await whatsappService.sendTextMessage({
                        phoneNumber: notification.recipient,
                        message,
                    });

                    if (success) {
                        await notificationRepository.markAsSent(notification._id);
                        log.info(`WhatsApp notification ${notification._id} sent successfully (legacy method)`);
                        return true;
                    } else {
                        await this.handleWhatsAppFailure(notification, 'Failed to send text message via legacy method');
                        return false;
                    }
                }
            }
        } catch (error: any) {
            log.error(`Unexpected error sending WhatsApp notification ${notification._id}:`, error);
            await this.handleWhatsAppFailure(notification, error.message || 'Unexpected error occurred');
            return false;
        }
    }

    /**
     * Handle WhatsApp message failure with appropriate fallback mechanisms
     */
    private async handleWhatsAppFailure(notification: INotification, errorMessage: string, sentCount?: number, totalCount?: number): Promise<void> {
        log.error(`WhatsApp notification ${notification._id} failed:`, errorMessage);

        // For OTP messages, attempt fallback to email or SMS
        if (notification.type === NotificationType.OTP) {
            log.info(`Attempting fallback delivery for OTP notification ${notification._id}`);

            try {
                // Try email first
                if (notification.recipient.includes('@')) {
                    const emailSuccess = await this.sendEmailNotification(notification);
                    if (emailSuccess) {
                        log.info(`OTP notification ${notification._id} successfully sent via email fallback`);
                        await notificationRepository.update(notification._id, {
                            status: NotificationStatus.SENT,
                            sentAt: new Date(),
                            errorDetails: `WhatsApp failed: ${errorMessage} - sent via email fallback`
                        });
                        return;
                    }
                }

                // Try SMS as last resort (if recipient looks like phone number)
                if (/^\+?\d{7,15}$/.test(notification.recipient)) {
                    try {
                        const smsSuccess = await this.sendSmsNotification(notification);
                        if (smsSuccess) {
                            log.info(`OTP notification ${notification._id} successfully sent via SMS fallback`);
                            await notificationRepository.update(notification._id, {
                                status: NotificationStatus.SENT,
                                sentAt: new Date(),
                                errorDetails: `WhatsApp failed: ${errorMessage} - sent via SMS fallback`
                            });
                            return;
                        }
                    } catch (smsError) {
                        log.error(`SMS fallback also failed for OTP notification ${notification._id}:`, smsError);
                    }
                }
            } catch (fallbackError) {
                log.error(`Fallback delivery failed for OTP notification ${notification._id}:`, fallbackError);
            }
        }

        // Mark as failed if no fallback succeeded
        const failureMessage = sentCount && totalCount ?
            `Partial failure: ${sentCount}/${totalCount} messages sent. Error: ${errorMessage}` :
            errorMessage;

        await notificationRepository.update(notification._id, {
            status: NotificationStatus.FAILED,
            failedAt: new Date(),
            errorDetails: failureMessage,
            whatsappError: {
                code: 0,
                title: 'Delivery Failed',
                message: errorMessage
            }
        });
    }

    /**
     * Process pending notifications (to be called by a background job)
     */
    async processPendingNotifications(batchSize: number = 20): Promise<number> {
        const pendingNotifications = await notificationRepository.findPendingNotifications(batchSize);

        if (pendingNotifications.length === 0) {
            return 0;
        }

        log.info(`Processing ${pendingNotifications.length} pending notifications`);

        let successCount = 0;

        // Process each notification
        for (const notification of pendingNotifications) {
            try {
                await this.sendNotification(notification);
                successCount++;
            } catch (error) {
                log.error(`Failed to process notification ${notification._id}`, { error });
                // The notification is already marked as failed in the sendNotification method
            }
        }

        log.info(`Processed ${pendingNotifications.length} notifications, ${successCount} successful`);

        return successCount;
    }

    /**
     * Get notifications for a user
     */
    async getUserNotifications(
        userId: string | Types.ObjectId,
        limit: number = 50,
        skip: number = 0
    ): Promise<INotification[]> {
        return notificationRepository.findByUserId(userId, limit, skip);
    }

    /**
     * Get notification statistics for a user
     */
    async getUserNotificationStats(
        userId: string | Types.ObjectId
    ): Promise<Record<string, number>> {
        return notificationRepository.getNotificationStats(userId);
    }

    // --- Specialized notification methods ---

    /**
     * Send an OTP notification
     * @param userId - User ID 
     * @param recipient - Email, phone number, or WhatsApp number
     * @param channel - Delivery channel (email, sms, whatsapp)
     * @param code - OTP code to send
     * @param expireMinutes - Minutes until code expires
     * @param isRegistration - Whether this is for user registration
     * @param userName - Optional user name for personalization
     * @param purpose - Purpose of OTP (e.g., 'withdrawal_verification')
     * @param language - Language code (e.g., 'en', 'fr', 'es') - will be converted to supported template language
     */
    async sendOtpNotification(
        userId: string | Types.ObjectId,
        recipient: string,
        channel: DeliveryChannel,
        code: string,
        expireMinutes: number,
        isRegistration: boolean = false,
        userName?: string,
        purpose?: string,
        language?: string, // Simple language codes like 'en', 'fr', 'es' are automatically converted
    ): Promise<INotification> {
        const templateId = purpose === 'withdrawal_verification' ? 'withdrawal-verification' : isRegistration ? 'verify-registration' : 'verify-login';

        const variables: Record<string, any> = {
            code,
            expireMinutes: expireMinutes.toString(),
            purpose
        };

        if (userName) {
            variables.name = userName;
        }

        // Add language to variables if provided
        if (language) {
            variables.language = language;
        }

        return this.createAndSendNotification({
            userId,
            recipient,
            type: NotificationType.OTP,
            channel,
            templateId,
            variables,
        });
    }

    /**
     * Send a transaction notification
     */
    async sendTransactionNotification(
        userId: string | Types.ObjectId,
        recipient: string,
        userName: string,
        transactionId: string,
        amount: string,
        currency: string,
        isSuccessful: boolean
    ): Promise<INotification> {
        const templateId = isSuccessful ? 'transaction-completed' : 'transaction-failed';

        const variables: Record<string, any> = {
            name: userName,
            transactionId,
            amount,
            currency,
            date: new Date().toLocaleDateString(),
        };

        if (!isSuccessful) {
            variables.reason = 'Payment processing failed';
        }

        return this.createAndSendNotification({
            userId,
            recipient,
            type: NotificationType.TRANSACTION,
            channel: DeliveryChannel.EMAIL, // Transactions are typically sent by email
            templateId,
            variables,
        });
    }

    /**
     * Send a referral notification
     */
    async sendReferralNotification(
        userId: string | Types.ObjectId,
        recipient: string,
        userName: string,
        level: number
    ): Promise<INotification> {
        return this.createAndSendNotification({
            userId,
            recipient,
            type: NotificationType.REFERRAL,
            channel: DeliveryChannel.EMAIL,
            templateId: 'referral-signup',
            variables: {
                name: userName,
                level: level.toString(),
                date: new Date().toLocaleDateString(),
            },
        });
    }

    /**
     * Creates a notification record in the database only (Internal Call).
     */
    async createNotification(input: CreateNotificationInput): Promise<INotification> {
        log.info(`Service: Creating notification record for user ${input.userId}, type: ${input.type}, channel: ${input.channel}`);
        try {
            // Use repository to create
            const notification = await notificationRepository.create({
                ...input,
                userId: new Types.ObjectId(input.userId),
                status: NotificationStatus.PENDING
            });
            log.info(`Notification ${notification._id} created successfully via internal call.`);

            this.triggerNotificationSending(notification);
            return notification;
        } catch (error: any) {
            log.error(`Error creating notification via internal call: ${error.message}`, { input });
            throw error;
        }
    }

    /**
     * (Private) Triggers the actual sending of the notification based on its channel.
     */
    private async triggerNotificationSending(notification: INotification): Promise<void> {
        log.info(`Triggering send for notification ${notification._id}, channel: ${notification.channel}`);
        try {
            let success = false;
            if (notification.channel === DeliveryChannel.EMAIL) {
                log.warn('Email sending logic not implemented'); success = true; // Placeholder success
            } else if (notification.channel === DeliveryChannel.SMS) {
                log.warn('SMS sending logic not implemented'); success = true; // Placeholder success
            } else if (notification.channel === DeliveryChannel.PUSH) {
                log.warn('Push notification logic not implemented'); success = true; // Placeholder success
            } else if (notification.channel === DeliveryChannel.WHATSAPP) {
                success = await this.sendWhatsappNotification(notification);
            }

            // Update status based on sending result VIA REPOSITORY
            const finalStatus = success ? NotificationStatus.SENT : NotificationStatus.FAILED;
            const updateData = { status: finalStatus, sentAt: success ? new Date() : undefined, failedAt: !success ? new Date() : undefined, errorDetails: !success ? 'Send logic failed' : undefined };

            await notificationRepository.update(notification._id, updateData);
            log.info(`Notification ${notification._id} status updated to ${finalStatus}`);

        } catch (error: any) {
            log.error(`Error triggering send for notification ${notification._id}: ${error.message}`);
            // Update status to FAILED if an error occurs during trigger VIA REPOSITORY
            await notificationRepository.update(notification._id, { status: NotificationStatus.FAILED, failedAt: new Date(), errorDetails: error.message });
        }
    }

    /**
     * Queues a broadcast notification request.
     * Connects to RabbitMQ, ensures a durable queue exists,
     * and publishes the payload as a persistent message.
     * @param notificationPayload - The payload to be broadcast.
     */
    async queueBroadcastNotification(notificationPayload: any): Promise<void> {
        const queueName = 'broadcast_jobs_queue';
        // Use inferred types
        let connection: Awaited<ReturnType<typeof amqp.connect>> | null = null;
        let channel: Channel | null = null; // Channel type is usually simpler, keep explicit for now
        log.info(`Attempting to queue broadcast notification: ${JSON.stringify(notificationPayload).substring(0, 100)}...`); // Log start

        try {
            // 1. Connect to RabbitMQ
            if (!config.rabbitMQ || !config.rabbitMQ.url) {
                throw new Error('RabbitMQ URL not configured.');
            }
            connection = await amqp.connect(config.rabbitMQ.url);
            log.info('Successfully connected to RabbitMQ for broadcast queuing.');

            // Connection is non-null here
            // Infer channel type as well
            channel = await connection.createChannel();
            log.info('RabbitMQ channel created.');

            // Channel is non-null here
            await channel.assertQueue(queueName, { durable: true });
            log.info(`Queue '${queueName}' asserted successfully (durable).`);

            const messageBuffer = Buffer.from(JSON.stringify(notificationPayload));

            // Channel is non-null here
            channel.sendToQueue(queueName, messageBuffer, { persistent: true });
            log.info(`Broadcast notification payload successfully sent to queue '${queueName}'.`);

        } catch (error: any) {
            log.error(`Error queuing broadcast notification to '${queueName}'`, {
                error: error.message,
                stack: error.stack,
                payload: JSON.stringify(notificationPayload).substring(0, 500),
            });
            throw new Error(`Failed to queue broadcast notification: ${error.message}`);
        } finally {
            // Close Channel and Connection
            if (channel) {
                try {
                    await channel.close();
                    log.info('RabbitMQ channel closed.');
                } catch (closeError: any) {
                    log.error('Error closing RabbitMQ channel', { error: closeError.message });
                }
            }
            if (connection) {
                try {
                    await connection.close();
                    log.info('RabbitMQ connection closed.');
                } catch (closeError: any) {
                    log.error('Error closing RabbitMQ connection', { error: closeError.message });
                }
            }
        }
    }

    /**
     * Sends follow-up messages (Email and SMS) to users matching target criteria.
     *
     * @param criteria - Criteria to select target users.
     * @param emailSubject - Subject line for the email.
     * @param emailBodyHtml - HTML content for the email body.
     * @param smsBody - Content for the SMS message.
     * @param defaultLanguage - Fallback language if user preference is unknown (e.g., 'fr').
     * @returns Promise<void>
     */
    async sendFollowUp(
        criteria: ITargetCriteria,
        emailSubject: string,
        emailBodyHtml: string, // Basic version: use raw HTML
        smsBody: string,
        defaultLanguage: string = 'fr' // Example default
    ): Promise<{ sentCount: number; failedCount: number; totalTargets: number }> {
        log.info('Starting follow-up process with criteria:', criteria);

        let sentCount = 0;
        let failedCount = 0;

        // 1. Find target user IDs
        const userIds = await userServiceClient.findUserIdsByCriteria(criteria);
        const totalTargets = userIds.length;

        if (totalTargets === 0) {
            log.info('No users matched the follow-up criteria.');
            return { sentCount, failedCount, totalTargets };
        }

        log.info(`Found ${totalTargets} users matching criteria. Fetching details...`);

        // 2. Iterate and send (Consider batching/queuing for large numbers)
        for (const userId of userIds) {
            try {
                // 3. Get user details (email, phone, language)
                const userDetails = await userServiceClient.getUserDetails(userId);

                if (!userDetails) {
                    log.warn(`Could not fetch details for user ${userId}. Skipping follow-up.`);
                    failedCount++;
                    continue;
                }

                // 4. Determine language (use first preference or default)
                const lang = userDetails.language?.[0]?.toLowerCase() || defaultLanguage;

                // 5. Prepare content (basic version - assumes same content for all languages)
                // TODO: Implement template processing based on language (lang)
                const finalEmailSubject = emailSubject; // Replace with template logic
                const finalEmailBody = emailBodyHtml; // Replace with template logic
                const finalSmsBody = smsBody;      // Replace with template logic

                let emailSent = false;
                let smsSent = false;

                // 6. Send Email
                if (userDetails.email) {
                    emailSent = await emailService.sendEmail({
                        to: userDetails.email,
                        subject: finalEmailSubject,
                        html: finalEmailBody,
                        // text: generateTextFromHtml(finalEmailBody) // Optional: generate plain text
                    });
                    if (emailSent) log.info(`Follow-up email sent to user ${userId}`);
                    else log.warn(`Follow-up email failed for user ${userId}`);
                } else {
                    log.warn(`User ${userId} has no email address. Skipping email follow-up.`);
                }

                // 7. Send SMS
                if (userDetails.phoneNumber) {
                    // Pass options object to consolidated smsService
                    smsSent = await smsService.sendSms({
                        to: userDetails.phoneNumber,
                        body: finalSmsBody
                    });
                    if (smsSent) log.info(`Follow-up SMS sent to user ${userId}`);
                    else log.warn(`Follow-up SMS failed for user ${userId}`);
                } else {
                    log.warn(`User ${userId} has no phone number. Skipping SMS follow-up.`);
                }

                if (emailSent || smsSent) {
                    sentCount++;
                } else {
                    // Only count as failure if *both* email and SMS failed or were skipped
                    if (!userDetails.email && !userDetails.phoneNumber) {
                        log.warn(`User ${userId} has neither email nor phone. Counted as failed.`);
                        failedCount++;
                    } else if ((userDetails.email && !emailSent) || (userDetails.phoneNumber && !smsSent)) {
                        log.warn(`User ${userId} notification attempt failed (Email: ${emailSent}, SMS: ${smsSent}). Counted as failed.`);
                        failedCount++;
                    }
                }

            } catch (error) {
                log.error(`Error processing follow-up for user ${userId}:`, error);
                failedCount++;
            }
        }

        log.info(`Follow-up process completed. Total Targets: ${totalTargets}, Sent (at least one channel): ${sentCount}, Failed/Skipped: ${failedCount}`);
        return { sentCount, failedCount, totalTargets };
    }

    /**
     * Sends an email with a file attachment.
     * @param input The details for sending the email with attachment.
     * @returns Promise<void>
     */
    async sendEmailWithAttachment(input: SendAttachmentEmailInput): Promise<void> {
        try {
            // Use the sendEmail method directly to handle attachment since this is a simple operation
            const attachmentBuffer = Buffer.from(input.attachmentContent, 'base64');

            const success = await emailService.sendEmail({
                to: input.recipient,
                subject: input.subject,
                html: input.body,
                attachments: [
                    {
                        filename: input.attachmentFileName,
                        content: attachmentBuffer,
                        contentType: input.attachmentContentType,
                    },
                ],
            });

            if (!success) {
                throw new AppError(`Failed to send email with attachment to ${input.recipient}`, 500);
            }

            log.info(`Email with attachment sent successfully to ${input.recipient}`);
        } catch (error: any) {
            log.error(`Error sending email with attachment to ${input.recipient}:`, error);
            throw error; // Rethrow so caller can handle
        }
    }

    /**
     * Send contact export email with VCF attachment using beautiful template
     */
    async sendContactExportEmail(input: {
        userId: string | Types.ObjectId;
        recipientEmail: string;
        userName: string;
        vcfContent: string;
        fileName?: string;
    }): Promise<void> {
        try {
            const fileName = input.fileName || 'contacts.vcf';

            // Use the new beautiful email template from email service
            const success = await emailService.sendContactExportEmail(
                input.recipientEmail,
                input.userName,
                input.vcfContent,
                fileName
            );

            if (!success) {
                throw new AppError(`Failed to send contact export email to ${input.recipientEmail}`, 500);
            }

            log.info(`Contact export email sent successfully to ${input.recipientEmail} for user ${input.userId}`);
        } catch (error: any) {
            log.error(`Error sending contact export email to ${input.recipientEmail}:`, error);
            throw error; // Rethrow so caller can handle
        }
    }

    /**
     * Sends a WhatsApp message with a file attachment.
     * @param input The details for sending the WhatsApp file message.
     * @returns Promise<void>
     */
    async sendWhatsappWithAttachment(input: {
        userId: string | Types.ObjectId,
        recipient: string,
        body?: string,
        attachmentContent: string, // base64
        attachmentFileName?: string,
        attachmentContentType: string,
    }): Promise<void> {
        log.info(`Preparing to send WhatsApp file message to ${input.recipient} for user ${input.userId}`);
        try {
            // Decode base64 content
            const fileBuffer = Buffer.from(input.attachmentContent, 'base64');
            const caption = input.body || '';
            const mimetype = input.attachmentContentType;
            const fileName = input.attachmentFileName;

            const success = await whatsappServiceFactory.getService().sendFileMessage({
                phoneNumber: input.recipient,
                buffer: fileBuffer,
                mimetype,
                fileName,
                caption,
            });

            if (success) {
                log.info(`WhatsApp file message successfully sent to ${input.recipient}`);
            } else {
                log.warn(`Failed to send WhatsApp file message to ${input.recipient}`);
            }

            // Optionally, create a notification record for audit/user history
            const metaSummary = `File: ${fileName || 'N/A'}, Type: ${mimetype}, Status: ${success ? 'SENT' : 'FAILED'}`;
            await this.createNotification({
                userId: input.userId,
                type: NotificationType.ACCOUNT, // Or a specific type like 'document_export'
                channel: DeliveryChannel.WHATSAPP,
                recipient: input.recipient,
                data: {
                    body: `${caption}\n${metaSummary}`,
                }
            });
        } catch (error: any) {
            log.error(`Failed to send WhatsApp file message to ${input.recipient}: ${error.message}`, error);
            throw new AppError(`Failed to send WhatsApp file message: ${error.message}`, 500);
        }
    }
}

// Export service instance
export const notificationService = new NotificationService();