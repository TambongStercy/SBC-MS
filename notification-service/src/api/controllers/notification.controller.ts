import { Request, Response, NextFunction } from 'express';
import { notificationService } from '../../services/notification.service';
import {
    NotificationType,
    DeliveryChannel
} from '../../database/models/notification.model';
import { isValidObjectId } from 'mongoose';
import logger from '../../utils/logger';
import { emailService } from '../../services/email.service';
import { AppError } from '../../utils/errors';
import { queueService } from '../../services/queue.service';

// Define AuthenticatedRequest interface matching expected structure
interface AuthenticatedRequest extends Request {
    user?: {
        id: string; // Use 'id'
        email: string;
        role: string;
    };
}

const log = logger.getLogger('NotificationController');

export class NotificationController {
    private notificationService: typeof notificationService; // Use typeof for type inference

    constructor() {
        this.notificationService = notificationService;
    }

    /**
     * Get notifications for the authenticated user
     * @route GET /api/notifications/me
     */
    async getUserNotifications(req: AuthenticatedRequest, res: Response): Promise<void> {
        const userId = req.user?.id;
        log.info(`Fetching notifications for user ${userId}`);
        try {
            if (!userId) {
                res.status(401).json({ success: false, message: 'Unauthorized' });
                return;
            }

            const limit = parseInt(req.query.limit as string) || 50;
            const skip = parseInt(req.query.skip as string) || 0;

            const notifications = await this.notificationService.getUserNotifications(
                userId,
                limit,
                skip
            );

            res.status(200).json({
                success: true,
                data: notifications,
                pagination: {
                    limit,
                    skip,
                    total: notifications.length
                }
            });
        } catch (error: any) {
            console.error('[NotificationController]: Error fetching user notifications:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch notifications',
                error: error.message
            });
        }
    }

    /**
     * Get notification statistics for the authenticated user
     * @route GET /api/notifications/me/stats
     */
    async getUserNotificationStats(req: AuthenticatedRequest, res: Response): Promise<void> {
        const userId = req.user?.id;
        log.info(`Fetching notification stats for user ${userId}`);
        try {
            if (!userId) {
                res.status(401).json({ success: false, message: 'Unauthorized' });
                return;
            }

            const stats = await this.notificationService.getUserNotificationStats(userId);

            res.status(200).json({
                success: true,
                data: stats
            });
        } catch (error: any) {
            console.error('[NotificationController]: Error fetching notification stats:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch notification statistics',
                error: error.message
            });
        }
    }

    /**
     * Send an OTP via email or SMS
     * This endpoint is typically called by other services, not by end-users directly
     * @route POST /api/notifications/otp
     */
    async sendOtp(req: Request, res: Response): Promise<void> {
        log.info('Received OTP request:', req.body);
        try {
            const {
                userId,
                recipient,
                channel,
                code,
                expireMinutes = 10,
                isRegistration = false,
                userName,
                purpose,
                language // Add language field extraction
            } = req.body;

            // Validate required fields
            if (!userId || !recipient || !channel || !code) {
                res.status(400).json({
                    success: false,
                    message: 'Missing required fields: userId, recipient, channel, code'
                });
                return;
            }

            // Validate userId format
            if (!isValidObjectId(userId)) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid userId format'
                });
                return;
            }

            // Validate channel
            if (!Object.values(DeliveryChannel).includes(channel)) {
                res.status(400).json({
                    success: false,
                    message: `Invalid channel. Must be one of: ${Object.values(DeliveryChannel).join(', ')}`
                });
                return;
            }

            // Send OTP notification
            const notification = await this.notificationService.sendOtpNotification(
                userId,
                recipient,
                channel as DeliveryChannel,
                code,
                expireMinutes,
                isRegistration,
                userName,
                purpose,
                language // Pass language to service
            );

            res.status(200).json({
                success: true,
                message: 'OTP sent successfully. If you don\'t see the email, please check your spam folder.',
                data: {
                    notificationId: notification._id,
                    status: notification.status
                }
            });
        } catch (error: any) {
            console.error('[NotificationController]: Error sending OTP:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to send OTP',
                error: error.message
            });
        }
    }

    /**
     * Send a custom notification - admin access only
     * @route POST /api/notifications/custom
     */
    async sendCustomNotification(req: AuthenticatedRequest, res: Response): Promise<void> {
        log.info('Received custom notification request:', req.body);
        try {
            // Check admin permissions
            if (!req.user?.role || req.user.role !== 'ADMIN') {
                res.status(403).json({
                    success: false,
                    message: 'Permission denied. Admin access required.'
                });
                return;
            }

            const {
                userId,
                recipient,
                type,
                channel,
                subject,
                body
            } = req.body;

            // Validate required fields
            if (!userId || !recipient || !type || !channel) {
                res.status(400).json({
                    success: false,
                    message: 'Missing required fields: userId, recipient, type, channel'
                });
                return;
            }

            // Validate required content based on channel
            if (channel === DeliveryChannel.EMAIL && (!subject || !body)) {
                res.status(400).json({
                    success: false,
                    message: 'Email notifications require subject and body'
                });
                return;
            }

            if (channel === DeliveryChannel.SMS && !body) {
                res.status(400).json({
                    success: false,
                    message: 'SMS notifications require body'
                });
                return;
            }

            // Validate type
            if (!Object.values(NotificationType).includes(type)) {
                res.status(400).json({
                    success: false,
                    message: `Invalid notification type. Must be one of: ${Object.values(NotificationType).join(', ')}`
                });
                return;
            }

            // Validate channel
            if (!Object.values(DeliveryChannel).includes(channel)) {
                res.status(400).json({
                    success: false,
                    message: `Invalid channel. Must be one of: ${Object.values(DeliveryChannel).join(', ')}`
                });
                return;
            }

            // Send notification
            const notification = await this.notificationService.createAndSendNotification({
                userId,
                recipient,
                type,
                channel,
                subject,
                body
            });

            // Include spam folder hint for email channel
            const emailHint = channel === DeliveryChannel.EMAIL
                ? ' If you don\'t see the email, please check your spam folder.'
                : '';

            res.status(200).json({
                success: true,
                message: `Notification sent successfully.${emailHint}`,
                data: {
                    notificationId: notification._id,
                    status: notification.status
                }
            });
        } catch (error: any) {
            console.error('[NotificationController]: Error sending custom notification:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to send notification',
                error: error.message
            });
        }
    }

    /**
     * Send a templated notification - admin access only
     * @route POST /api/notifications/templated
     */
    async sendTemplatedNotification(req: AuthenticatedRequest, res: Response): Promise<void> {
        log.info('Received templated notification request:', req.body);
        try {
            // Check admin permissions
            if (!req.user?.role || req.user.role !== 'ADMIN') {
                res.status(403).json({
                    success: false,
                    message: 'Permission denied. Admin access required.'
                });
                return;
            }

            const {
                userId,
                recipient,
                type,
                channel,
                templateId,
                variables
            } = req.body;

            // Validate required fields
            if (!userId || !recipient || !type || !channel || !templateId) {
                res.status(400).json({
                    success: false,
                    message: 'Missing required fields: userId, recipient, type, channel, templateId'
                });
                return;
            }

            // Validate type
            if (!Object.values(NotificationType).includes(type)) {
                res.status(400).json({
                    success: false,
                    message: `Invalid notification type. Must be one of: ${Object.values(NotificationType).join(', ')}`
                });
                return;
            }

            // Validate channel
            if (!Object.values(DeliveryChannel).includes(channel)) {
                res.status(400).json({
                    success: false,
                    message: `Invalid channel. Must be one of: ${Object.values(DeliveryChannel).join(', ')}`
                });
                return;
            }

            // Send notification
            const notification = await this.notificationService.createAndSendNotification({
                userId,
                recipient,
                type,
                channel,
                templateId,
                variables
            });

            // Include spam folder hint for email channel
            const emailHint = channel === DeliveryChannel.EMAIL
                ? ' If you don\'t see the email, please check your spam folder.'
                : '';

            res.status(200).json({
                success: true,
                message: `Templated notification sent successfully.${emailHint}`,
                data: {
                    notificationId: notification._id,
                    status: notification.status
                }
            });
        } catch (error: any) {
            console.error('[NotificationController]: Error sending templated notification:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to send templated notification',
                error: error.message
            });
        }
    }

    // POST /internal/create
    async createInternalNotification(req: Request, res: Response): Promise<void> {
        log.info('Received internal request to create notification:', req.body);
        try {
            const { userId, type, channel, recipient, data } = req.body;

            // Basic validation - Make recipient optional if channel is PUSH or IN_APP
            const isRecipientRequired = channel !== DeliveryChannel.PUSH && channel !== 'IN_APP'; // Assuming IN_APP is another potential channel
            if (!userId || !type || !channel || (isRecipientRequired && !recipient) || !data || !data.body) {
                let missingFields = [];
                if (!userId) missingFields.push('userId');
                if (!type) missingFields.push('type');
                if (!channel) missingFields.push('channel');
                if (isRecipientRequired && !recipient) missingFields.push('recipient');
                if (!data) missingFields.push('data');
                else if (!data.body) missingFields.push('data.body');

                res.status(400).json({ success: false, message: `Missing required fields for internal notification creation: ${missingFields.join(', ')}` });
                return;
            }

            // Validate enums
            if (!Object.values(NotificationType).includes(type as NotificationType)) {
                res.status(400).json({ success: false, message: `Invalid notification type: ${type}` });
                return;
            }
            if (!Object.values(DeliveryChannel).includes(channel as DeliveryChannel)) {
                res.status(400).json({ success: false, message: `Invalid delivery channel: ${channel}` });
                return;
            }

            // Call the service to create the notification
            // Pass the validated (or whole) body - ensure service handles optional recipient
            const notification = await this.notificationService.createNotification(req.body);

            res.status(201).json({ success: true, message: 'Notification created', data: notification });
        } catch (error: any) {
            log.error('Error creating internal notification:', error);
            res.status(500).json({ success: false, message: error.message || 'Failed to create notification' });
        }
    }

    // POST /internal/broadcast
    async handleBroadcastNotification(req: Request, res: Response, next: Function): Promise<void> {
        const callingService = req.headers['x-calling-service'] as string;
        log.info(`Received broadcast notification request from ${callingService}:`, req.body);
        try {
            // Add basic security check (e.g., service key, IP check) here in real implementation

            // Process the broadcast notification request
            await this.notificationService.queueBroadcastNotification(req.body);

            res.status(202).json({ success: true, message: 'Broadcast notification request accepted.' });
        } catch (error: any) {
            log.error(`Error handling broadcast notification request from ${callingService}:`, error);
            // Use generic error handler since AppError is not available
            next(error);
        }
    }

    /**
     * Send follow-up notifications (Email & SMS) based on criteria.
     * @route POST /api/notifications/follow-up
     * @access Private (Admin only)
     */
    async sendFollowUpNotifications(req: AuthenticatedRequest, res: Response): Promise<void> {
        log.info('Received follow-up notification request');
        try {
            // Check admin permissions
            if (req.user?.role !== 'ADMIN') { // Adjust role check as needed
                res.status(403).json({ success: false, message: 'Permission denied. Admin access required.' });
                return;
            }

            const {
                criteria,
                emailSubject,
                emailBodyHtml,
                smsBody,
                defaultLanguage
            } = req.body;

            // Basic validation
            if (!criteria || typeof criteria !== 'object') {
                res.status(400).json({ success: false, message: 'Missing or invalid \'criteria\' object in request body.' });
                return;
            }
            if (!emailSubject || !emailBodyHtml || !smsBody) {
                res.status(400).json({ success: false, message: 'Missing required content fields: emailSubject, emailBodyHtml, smsBody.' });
                return;
            }

            log.info('Initiating follow-up send process...');
            log.debug('Follow-up criteria:', criteria);

            // Call the service method asynchronously (don't wait for it to finish)
            // Let the client know the process has started.
            this.notificationService.sendFollowUp(
                criteria,
                emailSubject,
                emailBodyHtml,
                smsBody,
                defaultLanguage // Optional, will use service default if not provided
            ).then(result => {
                log.info(`Follow-up process completed asynchronously. Results: ${JSON.stringify(result)}`);
                // Optionally, send a completion notification via another channel (e.g., websocket, email to admin)
            }).catch(error => {
                log.error('Asynchronous follow-up process failed:', error);
                // Optionally, log failure to a persistent store or notify admin
            });

            // Respond immediately to the API request
            res.status(202).json({
                success: true,
                message: 'Follow-up process initiated successfully. Notifications will be sent in the background.'
            });

        } catch (error: any) {
            log.error('[NotificationController]: Error initiating follow-up:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to initiate follow-up process',
                error: error.message
            });
        }
    }

    // --- NEW EMAIL HANDLERS ---

    /**
     * Handle request to send a commission earned email.
     * @route POST /internal/email/commission-earned
     */
    async handleCommissionEarnedEmail(req: Request, res: Response, next: Function): Promise<void> {
        const callingService = req.headers['x-calling-service'] as string || 'Unknown Service';
        log.info(`Received commission earned email request from ${callingService}:`, req.body);
        try {
            const { email, amount, level, name, username, debt, currency = 'FCFA' } = req.body;

            // Basic validation
            if (!email || !amount || !level || !name || !username) {
                res.status(400).json({
                    success: false,
                    message: 'Missing required fields for commission email: email, amount, level, name, username'
                });
                return;
            }

            const success = await emailService.sendCommissionEarnedEmail({
                email,
                amount,
                level,
                name,
                username,
                debt,
                currency // Now including the currency field
            });

            if (success) {
                res.status(200).json({
                    success: true,
                    message: 'Commission earned email sent successfully. If you don\'t see the email, please check your spam folder.'
                });
            } else {
                // emailService already logs the error, so we send a generic server error
                res.status(500).json({ success: false, message: 'Failed to send commission earned email.' });
            }

        } catch (error: any) {
            log.error(`Error handling commission earned email request from ${callingService}:`, error);
            next(error); // Pass to global error handler
        }
    }

    /**
     * Handle request to send a transaction successful email.
     * @route POST /internal/email/transaction-successful
     */
    async handleTransactionSuccessEmail(req: Request, res: Response, next: Function): Promise<void> {
        const callingService = req.headers['x-calling-service'] as string || 'Unknown Service';
        log.info(`Received transaction successful email request from ${callingService}:`, req.body);
        try {
            const { email, name, transactionType, transactionId, amount, currency, date, productOrServiceName } = req.body;

            // Basic validation
            if (!email || !name || !transactionType || !transactionId || !amount || !currency || !date) {
                res.status(400).json({
                    success: false,
                    message: 'Missing required fields for transaction successful email: email, name, transactionType, transactionId, amount, currency, date'
                });
                return;
            }

            const success = await emailService.sendTransactionSuccessEmail({
                email,
                name,
                transactionType,
                transactionId,
                amount,
                currency,
                date,
                productOrServiceName
            });

            if (success) {
                res.status(200).json({
                    success: true,
                    message: 'Transaction successful email sent successfully. If you don\'t see the email, please check your spam folder.'
                });
            } else {
                res.status(500).json({ success: false, message: 'Failed to send transaction successful email.' });
            }

        } catch (error: any) {
            log.error(`Error handling transaction successful email request from ${callingService}:`, error);
            next(error);
        }
    }

    async handleTransactionFailureEmail(req: Request, res: Response, next: Function): Promise<void> {
        const callingService = req.headers['x-calling-service'] as string || 'Unknown Service';
        log.info(`Received transaction failure email request from ${callingService}:`, req.body);
        try {
            const { email, name, transactionId, amount, currency, date, reason, transactionType, productOrServiceName } = req.body;

            // Basic validation
            if (!email || !name || !transactionId || !amount || !currency || !date || !reason) {
                res.status(400).json({ success: false, message: 'Missing required fields for transaction failure email: email, name, transactionId, amount, currency, date, reason' });
                return;
            }

            const success = await emailService.sendTransactionFailureEmail({
                email,
                name,
                transactionId,
                amount,
                currency,
                date,
                reason,
                transactionType,
                productOrServiceName
            });

            if (success) {
                res.status(200).json({
                    success: true,
                    message: 'Transaction failure email sent successfully. If you don\'t see the email, please check your spam folder.'
                });
            } else {
                res.status(500).json({ success: false, message: 'Failed to send transaction failure email.' });
            }

        } catch (error: any) {
            log.error(`Error handling transaction failure email request from ${callingService}:`, error);
            next(error);
        }
    }

    /**
     * Handle request to send a contact export email with VCF attachment
     * @route POST /contact-export-email
     */
    async handleContactExportEmail(req: Request, res: Response, next: Function): Promise<void> {
        const callingService = req.headers['x-calling-service'] as string || 'Unknown Service';
        log.info(`Received contact export email request from ${callingService}:`, req.body);
        try {
            const { userId, recipientEmail, userName, vcfContent, fileName } = req.body;

            // Basic validation
            if (!userId || !recipientEmail || !userName || !vcfContent) {
                res.status(400).json({
                    success: false,
                    message: 'Missing required fields for contact export email: userId, recipientEmail, userName, vcfContent'
                });
                return;
            }

            await this.notificationService.sendContactExportEmail({
                userId,
                recipientEmail,
                userName,
                vcfContent,
                fileName: fileName || 'contacts.vcf'
            });

            res.status(200).json({
                success: true,
                message: 'Contact export email sent successfully. If you don\'t see the email, please check your spam folder.'
            });

        } catch (error: any) {
            log.error(`Error handling contact export email request from ${callingService}:`, error);
            next(error);
        }
    }

    /**
     * Handle request to send a welcome email to a new user
     * @route POST /internal/email/welcome
     */
    async handleWelcomeEmail(req: Request, res: Response, next: Function): Promise<void> {
        const callingService = req.headers['x-calling-service'] as string || 'Unknown Service';
        log.info(`Received welcome email request from ${callingService}:`, req.body);
        try {
            const { email, name, referralCode, referrerName, language } = req.body;

            if (!email || !name) {
                res.status(400).json({
                    success: false,
                    message: 'Missing required fields for welcome email: email, name'
                });
                return;
            }

            const success = await emailService.sendWelcomeEmail({
                email,
                name,
                referralCode,
                referrerName,
                language: language || 'fr'
            });

            if (success) {
                res.status(200).json({
                    success: true,
                    message: 'Welcome email sent successfully'
                });
            } else {
                res.status(500).json({
                    success: false,
                    message: 'Failed to send welcome email'
                });
            }

        } catch (error: any) {
            log.error(`Error handling welcome email request from ${callingService}:`, error);
            next(error);
        }
    }

    /**
     * Handle request to send an account activation email
     * @route POST /internal/email/account-activation
     */
    async handleAccountActivationEmail(req: Request, res: Response, next: Function): Promise<void> {
        const callingService = req.headers['x-calling-service'] as string || 'Unknown Service';
        log.info(`Received account activation email request from ${callingService}:`, req.body);
        try {
            const { email, name, subscriptionType, sponsorName, language } = req.body;

            // Basic validation
            if (!email || !name || !subscriptionType) {
                res.status(400).json({
                    success: false,
                    message: 'Missing required fields for account activation email: email, name, subscriptionType'
                });
                return;
            }

            // Validate subscriptionType
            if (!['CLASSIQUE', 'CIBLE', 'UPGRADE'].includes(subscriptionType)) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid subscriptionType. Must be CLASSIQUE, CIBLE, or UPGRADE'
                });
                return;
            }

            const success = await emailService.sendAccountActivationEmail({
                email,
                name,
                subscriptionType,
                sponsorName,
                language: language || 'fr'
            });

            if (success) {
                res.status(200).json({
                    success: true,
                    message: 'Account activation email sent successfully'
                });
            } else {
                res.status(500).json({
                    success: false,
                    message: 'Failed to send account activation email'
                });
            }

        } catch (error: any) {
            log.error(`Error handling account activation email request from ${callingService}:`, error);
            next(error);
        }
    }

    // --- END NEW EMAIL HANDLERS ---

    /**
     * Endpoint to send an email with an attachment.
     * @route POST /send-email-attachment
     * @param req
     * @param res
     * @param next
     */
    async sendEmailWithAttachment(req: Request, res: Response, next: NextFunction): Promise<void> {
        const { userId, recipientEmail, subject, body, attachmentContent, attachmentFileName, attachmentContentType } = req.body;
        log.info(`Received request to send email with attachment to ${recipientEmail} for user ${userId}.`);

        // Basic validation
        if (!userId || !recipientEmail || !subject || !body || !attachmentContent || !attachmentFileName || !attachmentContentType) {
            log.warn('Missing required fields for sendEmailWithAttachment', { userId: !!userId, recipientEmail: !!recipientEmail, subject: !!subject, body: !!body, attachmentContent: !!attachmentContent, attachmentFileName: !!attachmentFileName, attachmentContentType: !!attachmentContentType });
            res.status(400).json({ success: false, message: 'Missing required email fields or attachment data.' });
            return;
        }

        try {
            // Call service method to handle the actual sending
            await this.notificationService.sendEmailWithAttachment({
                userId,
                recipient: recipientEmail,
                subject,
                body,
                attachmentContent: attachmentContent, // This is expected to be base64
                attachmentFileName,
                attachmentContentType,
            });

            res.status(200).json({
                success: true,
                message: 'Email with attachment sent successfully. If you don\'t see the email, please check your spam folder.'
            });
        } catch (error: any) {
            log.error(`Error sending email with attachment to ${recipientEmail}: ${error.message}`, error);
            if (error instanceof AppError) {
                res.status(error.statusCode).json({ success: false, message: error.message });
            } else {
                res.status(500).json({ success: false, message: 'Failed to send email with attachment.' });
            }
        }
    }

    /**
     * Get queue statistics for monitoring
     * @route GET /api/notifications/queue/stats
     */
    async getQueueStats(req: Request, res: Response): Promise<void> {
        try {
            const stats = await queueService.getQueueStats();
            res.status(200).json({
                success: true,
                data: stats,
                timestamp: new Date().toISOString()
            });
        } catch (error: any) {
            log.error('Error fetching queue stats:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch queue statistics',
                error: error.message
            });
        }
    }
}

// Export an instance of the controller for use in routes
export const notificationController = new NotificationController(); 