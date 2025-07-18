import Bull, { Queue, Job } from 'bull';
import config from '../config';
import logger from '../utils/logger';
import { emailService } from './email.service';
import { smsService } from './sms.service';
import { notificationRepository } from '../database/repositories/notification.repository';
import { DeliveryChannel, INotification } from '../database/models/notification.model';
import whatsappService from './whatsapp.service';
import { notificationService } from './notification.service';

const log = logger.getLogger('QueueService');

// Job data interface
interface NotificationJobData {
    notificationId: string;
    retryAttempt?: number;
}

export class QueueService {
    private emailQueue: Queue;
    private smsQueue: Queue;
    private whatsappQueue: Queue;

    constructor() {
        try {
            // Initialize Redis connection
            const redisConfig = {
                host: config.redis?.host || 'localhost',
                port: config.redis?.port || 6379,
                password: config.redis?.password,
                db: config.redis?.db || 0,
            };

            log.info(`Initializing queue service with Redis at ${redisConfig.host}:${redisConfig.port}`);

            // Create queues with Redis connection
            this.emailQueue = new Bull('email notifications', {
                redis: redisConfig,
                defaultJobOptions: {
                    attempts: 5, // Retry up to 5 times
                    backoff: {
                        type: 'exponential',
                        delay: 5000, // Start with 5 seconds, then exponential backoff
                    },
                    removeOnComplete: 100, // Keep 100 completed jobs for monitoring
                    removeOnFail: 50, // Keep 50 failed jobs for debugging
                },
            });

            this.smsQueue = new Bull('sms notifications', {
                redis: redisConfig,
                defaultJobOptions: {
                    attempts: 5,
                    backoff: {
                        type: 'exponential',
                        delay: 5000,
                    },
                    removeOnComplete: 100,
                    removeOnFail: 50,
                },
            });

            this.whatsappQueue = new Bull('whatsapp notifications', {
                redis: redisConfig,
                defaultJobOptions: {
                    attempts: 5,
                    backoff: {
                        type: 'exponential',
                        delay: 5000,
                    },
                    removeOnComplete: 100,
                    removeOnFail: 50,
                },
            });

            // Set up queue processors
            this.setupQueueProcessors();

            // Set up error handlers for queues
            this.emailQueue.on('error', (error: Error) => {
                log.error('Email queue error:', error);
            });

            this.smsQueue.on('error', (error: Error) => {
                log.error('SMS queue error:', error);
            });

            this.whatsappQueue.on('error', (error: Error) => {
                log.error('WhatsApp queue error:', error);
            });

            log.info('Queue service initialized with Redis backend');
        } catch (error) {
            log.error('Failed to initialize queue service:', error);
            throw error;
        }
    }

    /**
     * Set up queue processors for different notification types
     */
    private setupQueueProcessors(): void {
        // Email queue processor
        this.emailQueue.process('send-email', 5, async (job: Job<NotificationJobData>) => {
            return this.processEmailNotification(job);
        });

        // SMS queue processor  
        this.smsQueue.process('send-sms', 3, async (job: Job<NotificationJobData>) => {
            return this.processSmsNotification(job);
        });

        // WhatsApp queue processor
        this.whatsappQueue.process('send-whatsapp', 3, async (job: Job<NotificationJobData>) => {
            return this.processWhatsappNotification(job);
        });

        // Queue event listeners for monitoring
        this.setupQueueEventListeners();
    }

    /**
     * Set up event listeners for queue monitoring
     */
    private setupQueueEventListeners(): void {
        // Email queue events
        this.emailQueue.on('completed', (job: Job<NotificationJobData>) => {
            log.info(`Email job ${job.id} completed successfully`);
        });

        this.emailQueue.on('failed', (job: Job<NotificationJobData>, err: Error) => {
            log.error(`Email job ${job.id} failed:`, { error: err.message, notificationId: job.data.notificationId });
        });

        this.emailQueue.on('stalled', (job: Job<NotificationJobData>) => {
            log.warn(`Email job ${job.id} stalled, will be retried`);
        });

        // SMS queue events
        this.smsQueue.on('completed', (job: Job<NotificationJobData>) => {
            log.info(`SMS job ${job.id} completed successfully`);
        });

        this.smsQueue.on('failed', (job: Job<NotificationJobData>, err: Error) => {
            log.error(`SMS job ${job.id} failed:`, { error: err.message, notificationId: job.data.notificationId });
        });

        this.smsQueue.on('stalled', (job: Job<NotificationJobData>) => {
            log.warn(`SMS job ${job.id} stalled, will be retried`);
        });

        // WhatsApp queue events
        this.whatsappQueue.on('completed', (job: Job<NotificationJobData>) => {
            log.info(`WhatsApp job ${job.id} completed successfully`);
        });

        this.whatsappQueue.on('failed', (job: Job<NotificationJobData>, err: Error) => {
            log.error(`WhatsApp job ${job.id} failed:`, { error: err.message, notificationId: job.data.notificationId });
        });

        this.whatsappQueue.on('stalled', (job: Job<NotificationJobData>) => {
            log.warn(`WhatsApp job ${job.id} stalled, will be retried`);
        });
    }

    /**
     * Add a notification to the appropriate queue
     */
    async queueNotification(notification: INotification, priority: number = 0): Promise<void> {
        const jobData: NotificationJobData = {
            notificationId: notification._id.toString(),
        };

        const jobOptions = {
            priority, // Higher numbers = higher priority
            delay: 0, // Send immediately by default
        };

        try {
            switch (notification.channel) {
                case DeliveryChannel.EMAIL:
                    await this.emailQueue.add('send-email', jobData, jobOptions);
                    log.info(`Email notification ${notification._id} queued for ${notification.recipient}`);
                    break;

                case DeliveryChannel.SMS:
                    await this.smsQueue.add('send-sms', jobData, jobOptions);
                    log.info(`SMS notification ${notification._id} queued for ${notification.recipient}`);
                    break;

                case DeliveryChannel.WHATSAPP:
                    await this.whatsappQueue.add('send-whatsapp', jobData, jobOptions);
                    log.info(`WhatsApp notification ${notification._id} queued for ${notification.recipient}`);
                    break;

                default:
                    throw new Error(`Unsupported delivery channel: ${notification.channel}`);
            }
        } catch (error) {
            log.error(`Failed to queue notification ${notification._id}:`, error);
            throw error;
        }
    }

    /**
     * Process email notification job
     */
    private async processEmailNotification(job: Job<NotificationJobData>): Promise<void> {
        const { notificationId } = job.data;

        try {
            // Fetch notification from database
            const notification = await notificationRepository.findById(notificationId);
            if (!notification) {
                throw new Error(`Notification ${notificationId} not found`);
            }

            if (!notification.data.subject) {
                throw new Error(`Email notification ${notificationId} missing subject`);
            }

            // Attempt to send email
            const success = await emailService.sendEmail({
                to: notification.recipient,
                subject: notification.data.subject,
                html: notification.data.body,
                text: notification.data.body.replace(/<[^>]*>/g, ''),
            });

            if (success) {
                // Mark as sent
                await notificationRepository.markAsSent(notification._id);
                log.info(`Email notification ${notificationId} sent successfully to ${notification.recipient}`);
            } else {
                throw new Error('Email service returned false');
            }

        } catch (error: any) {
            log.error(`Failed to process email notification ${notificationId}:`, error);

            // If this is the final attempt, mark as failed
            if (job.attemptsMade >= (job.opts.attempts || 5)) {
                try {
                    await notificationRepository.markAsFailed(notificationId, error.message);
                    log.error(`Email notification ${notificationId} permanently failed after ${job.attemptsMade} attempts`);
                } catch (dbError) {
                    log.error(`Failed to mark notification ${notificationId} as failed:`, dbError);
                }
            }

            throw error; // Re-throw to trigger Bull's retry mechanism
        }
    }

    /**
     * Process SMS notification job
     */
    private async processSmsNotification(job: Job<NotificationJobData>): Promise<void> {
        const { notificationId } = job.data;

        try {
            // Fetch notification from database
            const notification = await notificationRepository.findById(notificationId);
            if (!notification) {
                throw new Error(`Notification ${notificationId} not found`);
            }

            // Attempt to send SMS
            const success = await smsService.sendSms({
                to: notification.recipient,
                body: notification.data.body,
            });

            if (success) {
                // Mark as sent
                await notificationRepository.markAsSent(notification._id);
                log.info(`SMS notification ${notificationId} sent successfully to ${notification.recipient}`);
            } else {
                throw new Error('SMS service returned false');
            }

        } catch (error: any) {
            log.error(`Failed to process SMS notification ${notificationId}:`, error);

            // If this is the final attempt, mark as failed
            if (job.attemptsMade >= (job.opts.attempts || 5)) {
                try {
                    await notificationRepository.markAsFailed(notificationId, error.message);
                    log.error(`SMS notification ${notificationId} permanently failed after ${job.attemptsMade} attempts`);
                } catch (dbError) {
                    log.error(`Failed to mark notification ${notificationId} as failed:`, dbError);
                }
            }

            throw error; // Re-throw to trigger Bull's retry mechanism
        }
    }

    /**
     * Process WhatsApp notification job
     */
    private async processWhatsappNotification(job: Job<NotificationJobData>): Promise<void> {
        const { notificationId } = job.data;

        try {
            // Fetch notification from database
            const notification = await notificationRepository.findById(notificationId);
            if (!notification) {
                throw new Error(`Notification ${notificationId} not found`);
            }

            // Check for WhatsApp file attachment fields
            const data = notification.data || {};
            if (data.attachmentContent && data.attachmentFileName && data.attachmentContentType) {
                log.info(`[QueueService] Detected WhatsApp attachment for notification ${notificationId}`);
                await notificationService.sendWhatsappWithAttachment({
                    userId: notification.userId,
                    recipient: notification.recipient,
                    body: (typeof data.plainText === 'string' && data.plainText.trim()) ? data.plainText.trim() : (data.body || ''),
                    attachmentContent: data.attachmentContent,
                    attachmentFileName: data.attachmentFileName,
                    attachmentContentType: data.attachmentContentType,
                });
                await notificationRepository.markAsSent(notification._id);
                log.info(`WhatsApp file notification ${notificationId} sent successfully to ${notification.recipient}`);
                return;
            }

            // Check if we have a separate WhatsApp code to send as a second message
            let success = false;
            if (data.whatsappCode && typeof data.whatsappCode === 'string' && data.whatsappCode.trim()) {
                // Send two separate messages: main message + code
                const mainMessage = (typeof data.plainText === 'string' && data.plainText.trim()) 
                    ? data.plainText.trim() 
                    : (data.body ? data.body.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : '');
                
                const codeMessage = data.whatsappCode.trim();
                
                const messages = [mainMessage, codeMessage].filter(msg => msg); // Remove empty messages
                
                success = await whatsappService.sendMultipleTextMessages({
                    phoneNumber: notification.recipient,
                    messages,
                });
            } else {
                // Send single message (original behavior)
                let message = '';
                if (typeof data.plainText === 'string' && data.plainText.trim()) {
                    message = data.plainText.trim();
                } else if (data.body) {
                    // Fallback: strip HTML tags
                    message = data.body.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
                }

                success = await whatsappService.sendTextMessage({
                    phoneNumber: notification.recipient,
                    message,
                });
            }

            if (success) {
                // Mark as sent
                await notificationRepository.markAsSent(notification._id);
                log.info(`WhatsApp notification ${notificationId} sent successfully to ${notification.recipient}`);
            } else {
                throw new Error('WhatsApp service returned false');
            }

        } catch (error: any) {
            log.error(`Failed to process WhatsApp notification ${notificationId}:`, error);

            // If this is the final attempt, mark as failed
            if (job.attemptsMade >= (job.opts.attempts || 5)) {
                try {
                    await notificationRepository.markAsFailed(notificationId, error.message);
                    log.error(`WhatsApp notification ${notificationId} permanently failed after ${job.attemptsMade} attempts`);
                } catch (dbError) {
                    log.error(`Failed to mark notification ${notificationId} as failed:`, dbError);
                }
            }

            throw error; // Re-throw to trigger Bull's retry mechanism
        }
    }

    /**
     * Get queue statistics for monitoring
     */
    async getQueueStats(): Promise<{ email: any; sms: any; whatsapp: any }> {
        const [emailWaiting, emailActive, emailCompleted, emailFailed] = await Promise.all([
            this.emailQueue.getWaiting(),
            this.emailQueue.getActive(),
            this.emailQueue.getCompleted(),
            this.emailQueue.getFailed(),
        ]);

        const [smsWaiting, smsActive, smsCompleted, smsFailed] = await Promise.all([
            this.smsQueue.getWaiting(),
            this.smsQueue.getActive(),
            this.smsQueue.getCompleted(),
            this.smsQueue.getFailed(),
        ]);

        const [whatsappWaiting, whatsappActive, whatsappCompleted, whatsappFailed] = await Promise.all([
            this.whatsappQueue.getWaiting(),
            this.whatsappQueue.getActive(),
            this.whatsappQueue.getCompleted(),
            this.whatsappQueue.getFailed(),
        ]);

        return {
            email: {
                waiting: emailWaiting.length,
                active: emailActive.length,
                completed: emailCompleted.length,
                failed: emailFailed.length,
            },
            sms: {
                waiting: smsWaiting.length,
                active: smsActive.length,
                completed: smsCompleted.length,
                failed: smsFailed.length,
            },
            whatsapp: {
                waiting: whatsappWaiting.length,
                active: whatsappActive.length,
                completed: whatsappCompleted.length,
                failed: whatsappFailed.length,
            },
        };
    }

    /**
     * Graceful shutdown
     */
    async shutdown(): Promise<void> {
        log.info('Shutting down queue service...');

        await Promise.all([
            this.emailQueue.close(),
            this.smsQueue.close(),
            this.whatsappQueue.close(),
        ]);

        log.info('Queue service shut down successfully');
    }
}

// Export singleton instance
export const queueService = new QueueService(); 