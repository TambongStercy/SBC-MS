import { Request, Response } from 'express';
import { BounceHandlerService } from '../../services/bounceHandler.service';
import logger from '../../utils/logger';
import config from '../../config';
import crypto from 'crypto';

const log = logger.getLogger('WebhookController');

export class WebhookController {
    private bounceHandler: BounceHandlerService;

    constructor() {
        this.bounceHandler = new BounceHandlerService();
    }

    /**
     * Handle SendGrid webhook events
     */
    handleSendGridWebhook = async (req: Request, res: Response): Promise<void> => {
        try {
            // Verify webhook signature for security
            if (!this.verifyWebhookSignature(req)) {
                log.error('Invalid webhook signature');
                res.status(401).json({ success: false, message: 'Unauthorized' });
                return;
            }

            const events = req.body;

            if (!Array.isArray(events)) {
                log.error('Invalid webhook payload - expected array');
                res.status(400).json({ success: false, message: 'Invalid payload' });
                return;
            }

            log.info(`Processing ${events.length} webhook events`);

            // Process each event
            for (const event of events) {
                await this.processWebhookEvent(event);
            }

            res.status(200).json({
                success: true,
                message: 'Webhook processed successfully',
                eventsProcessed: events.length
            });

        } catch (error) {
            log.error('Error processing SendGrid webhook', { error });
            res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    };

    /**
     * Process individual webhook event
     */
    private async processWebhookEvent(event: any): Promise<void> {
        const { event: eventType, email, timestamp, reason } = event;

        log.info('Processing webhook event', {
            eventType,
            email,
            timestamp,
            reason
        });

        switch (eventType) {
            case 'bounce':
            case 'dropped':
                await this.bounceHandler.processBounceWebhook([event]);
                break;

            case 'spam_report':
                log.warn('Spam report received', { email, timestamp });
                await this.bounceHandler.processBounceWebhook([{
                    ...event,
                    event: 'bounce',
                    reason: 'Spam report'
                }]);
                break;

            case 'unsubscribe':
                log.info('Unsubscribe event', { email, timestamp });
                // Handle unsubscribe logic here
                break;

            case 'delivered':
                log.info('Email delivered successfully', { email, timestamp });
                break;

            case 'open':
                log.info('Email opened', { email, timestamp });
                break;

            case 'click':
                log.info('Email link clicked', { email, timestamp });
                break;

            default:
                log.info('Unhandled webhook event type', { eventType, email });
        }
    }

    /**
     * Verify webhook signature for security
     */
    private verifyWebhookSignature(req: Request): boolean {
        if (!config.email.bounceHandling.webhookSecret) {
            log.warn('No webhook secret configured - skipping signature verification');
            return true; // Allow in development
        }

        const signature = req.headers['x-twilio-email-event-webhook-signature'] as string;
        const timestamp = req.headers['x-twilio-email-event-webhook-timestamp'] as string;

        if (!signature || !timestamp) {
            log.error('Missing webhook signature headers');
            return false;
        }

        // Verify timestamp is recent (within 10 minutes)
        const eventTimestamp = parseInt(timestamp, 10);
        const now = Math.floor(Date.now() / 1000);
        if (Math.abs(now - eventTimestamp) > 600) {
            log.error('Webhook timestamp too old', {
                eventTimestamp,
                now,
                diff: Math.abs(now - eventTimestamp)
            });
            return false;
        }

        // Verify signature
        const payload = JSON.stringify(req.body);
        const expectedSignature = crypto
            .createHmac('sha256', config.email.bounceHandling.webhookSecret)
            .update(timestamp + payload)
            .digest('base64');

        return crypto.timingSafeEqual(
            Buffer.from(signature),
            Buffer.from(expectedSignature)
        );
    }

    /**
     * Get bounce statistics
     */
    getBounceStats = async (req: Request, res: Response): Promise<void> => {
        try {
            const report = this.bounceHandler.generateBounceReport();

            res.json({
                success: true,
                data: report
            });
        } catch (error) {
            log.error('Error generating bounce stats', { error });
            res.status(500).json({
                success: false,
                message: 'Failed to generate bounce statistics'
            });
        }
    };

    /**
     * Check email reputation
     */
    checkEmailReputation = async (req: Request, res: Response): Promise<void> => {
        try {
            const { email } = req.params;

            if (!email) {
                res.status(400).json({
                    success: false,
                    message: 'Email parameter required'
                });
                return;
            }

            const reputation = this.bounceHandler.getEmailReputation(email);
            const isBlacklisted = this.bounceHandler.isBlacklisted(email);

            res.json({
                success: true,
                data: {
                    email,
                    reputation,
                    isBlacklisted,
                    canSendEmail: !isBlacklisted
                }
            });
        } catch (error) {
            log.error('Error checking email reputation', { error });
            res.status(500).json({
                success: false,
                message: 'Failed to check email reputation'
            });
        }
    };

    /**
     * Manual cleanup of bounce data
     */
    cleanupBounceData = async (req: Request, res: Response): Promise<void> => {
        try {
            await this.bounceHandler.cleanup();

            res.json({
                success: true,
                message: 'Bounce data cleanup completed'
            });
        } catch (error) {
            log.error('Error during bounce cleanup', { error });
            res.status(500).json({
                success: false,
                message: 'Failed to cleanup bounce data'
            });
        }
    };

    /**
     * Test webhook endpoint (for development)
     */
    testWebhook = async (req: Request, res: Response): Promise<void> => {
        try {
            // Create a test bounce event
            const testEvent = {
                email: 'test@example.com',
                timestamp: Math.floor(Date.now() / 1000),
                event: 'bounce',
                reason: 'Test bounce for debugging',
                bounce_classification: 'Technical Failure'
            };

            await this.processWebhookEvent(testEvent);

            res.json({
                success: true,
                message: 'Test webhook processed successfully',
                testEvent
            });
        } catch (error) {
            log.error('Error processing test webhook', { error });
            res.status(500).json({
                success: false,
                message: 'Failed to process test webhook'
            });
        }
    };
}

export default WebhookController; 