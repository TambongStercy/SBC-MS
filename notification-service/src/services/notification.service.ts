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
    /**
     * Create and send a notification
     */
    async createAndSendNotification(data: CreateNotificationData): Promise<INotification> {
        // Prepare notification data
        let notificationData = {
            userId: data.userId,
            recipient: data.recipient,
            type: data.type,
            channel: data.channel,
            data: {
                body: data.body || '',
            } as any
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
                body: processedTemplate.body
            };
        } else if (data.subject) {
            // If no template but subject provided
            notificationData.data.subject = data.subject;
        }

        // Create notification in database VIA REPOSITORY
        const notification = await notificationRepository.create(notificationData as any);

        // Send notification immediately
        try {
            await this.sendNotification(notification);
        } catch (error) {
            log.error(`Failed to send notification ${notification._id}`, { error });
            // The notification is already saved with PENDING status,
            // it will be picked up by the background processor later
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
        return smsService.sendSms({
            to: notification.recipient,
            body: notification.data.body,
        });
    }

    /**
     * Send a WhatsApp notification
     */
    private async sendWhatsappNotification(notification: INotification): Promise<boolean> {
        //TODO: Implement WhatsApp notification
        return false;
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
                // success = await sendEmail(notification.recipient, notification.data.subject || 'Notification', notification.data.body);
                log.warn('Email sending logic not implemented'); success = true; // Placeholder success
            } else if (notification.channel === DeliveryChannel.SMS) {
                // success = await sendSMS(notification.recipient, notification.data.body);
                log.warn('SMS sending logic not implemented'); success = true; // Placeholder success
            } else if (notification.channel === DeliveryChannel.PUSH) {
                // TODO: Implement push notification logic
                log.warn('Push notification logic not implemented'); success = true; // Placeholder success
            } else if (notification.channel === DeliveryChannel.WHATSAPP) {
                // TODO: Implement WhatsApp notification logic
                log.warn('WhatsApp notification logic not implemented'); success = true; // Placeholder success
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
        log.info(`Preparing to send email with attachment to ${input.recipient} for user ${input.userId}`);
        try {
            // Decode base64 content
            const attachmentBuffer = Buffer.from(input.attachmentContent, 'base64');

            const mailOptions = {
                from: 'no-reply@sbcmicroservices.com', // **IMPORTANT: Replace with your configured sender email**
                to: input.recipient,
                subject: input.subject,
                html: `<p>${input.body.replace(/\n/g, '<br>')}</p>`, // Basic HTML, replace newlines with <br>
                attachments: [
                    {
                        filename: input.attachmentFileName,
                        content: attachmentBuffer,
                        contentType: input.attachmentContentType,
                    },
                ],
            };

            await emailService.sendEmail(mailOptions);
            log.info(`Email with attachment successfully sent to ${input.recipient}`);

            // Optionally, create a notification record for audit/user history
            await this.createNotification({
                userId: input.userId,
                type: NotificationType.ACCOUNT, // Or a specific type like 'document_export'
                channel: DeliveryChannel.EMAIL,
                recipient: input.recipient,
                data: {
                    subject: input.subject,
                    body: `Your requested file '${input.attachmentFileName}' has been sent to your email.`,
                    templateId: 'email_with_attachment', // Custom template ID
                    variables: {
                        fileName: input.attachmentFileName,
                    }
                }
            });

        } catch (error: any) {
            log.error(`Failed to send email with attachment to ${input.recipient}: ${error.message}`, error);
            throw new AppError(`Failed to send email with attachment: ${error.message}`, 500);
        }
    }
}

// Export service instance
export const notificationService = new NotificationService(); 