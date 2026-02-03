import { Request, Response } from 'express';
import RelanceTargetModel from '../../database/models/relance-target.model';
import logger from '../../utils/logger';

const log = logger.getLogger('SendGridWebhookController');

/**
 * SendGrid Webhook Controller
 * Handles incoming webhook events from SendGrid for email tracking
 */
class SendGridWebhookController {
    /**
     * POST /api/webhooks/sendgrid
     * Receives email events from SendGrid (delivered, open, click, bounce, etc.)
     */
    async handleWebhook(req: Request, res: Response): Promise<void> {
        try {
            const events = req.body;

            if (!Array.isArray(events)) {
                res.status(400).json({ success: false, message: 'Invalid payload' });
                return;
            }

            log.info(`Received ${events.length} SendGrid events`);

            for (const event of events) {
                await this.processEvent(event);
            }

            res.status(200).json({ success: true });
        } catch (error: any) {
            log.error('Error processing SendGrid webhook:', error);
            res.status(500).json({ success: false, message: 'Internal server error' });
        }
    }

    /**
     * Process individual SendGrid event
     */
    private async processEvent(event: any): Promise<void> {
        const { event: eventType, sg_message_id, timestamp } = event;
        const messageId = sg_message_id?.split('.')[0]; // Remove the filter ID suffix

        if (!messageId) {
            log.warn('SendGrid event missing message ID:', event);
            return;
        }

        log.info(`Processing ${eventType} event for message ${messageId}`);

        try {
            // Find the target with this message ID
            const target = await RelanceTargetModel.findOne({
                'messagesDelivered.sendGridMessageId': messageId
            });

            if (!target) {
                log.warn(`No target found for SendGrid message ID: ${messageId}`);
                return;
            }

            // Find the specific message in the array
            const messageIndex = target.messagesDelivered.findIndex(
                m => m.sendGridMessageId === messageId
            );

            if (messageIndex === -1) {
                log.warn(`Message not found in target for ID: ${messageId}`);
                return;
            }

            const message = target.messagesDelivered[messageIndex];
            const eventDate = new Date(timestamp * 1000); // Convert Unix timestamp to Date

            // Update message based on event type
            switch (eventType) {
                case 'delivered':
                    // Message successfully delivered
                    log.info(`Message ${messageId} delivered`);
                    break;

                case 'open':
                    // Email opened
                    if (!message.opened) {
                        message.opened = true;
                        message.openedAt = eventDate;
                        message.openCount = 1;
                    } else {
                        message.openCount = (message.openCount || 0) + 1;
                    }
                    log.info(`Message ${messageId} opened (count: ${message.openCount})`);
                    break;

                case 'click':
                    // Link clicked
                    if (!message.clicked) {
                        message.clicked = true;
                        message.clickedAt = eventDate;
                        message.clickCount = 1;
                    } else {
                        message.clickCount = (message.clickCount || 0) + 1;
                    }
                    log.info(`Message ${messageId} clicked (count: ${message.clickCount})`);
                    break;

                case 'bounce':
                    // Email bounced
                    message.bounced = true;
                    message.bouncedAt = eventDate;
                    message.bounceReason = event.reason || 'Unknown';
                    log.warn(`Message ${messageId} bounced: ${message.bounceReason}`);
                    break;

                case 'dropped':
                    // Email dropped (not sent)
                    log.warn(`Message ${messageId} dropped: ${event.reason}`);
                    break;

                case 'spam_report':
                case 'spamreport':
                    // Marked as spam
                    log.warn(`Message ${messageId} marked as spam`);
                    break;

                case 'unsubscribe':
                    // User unsubscribed
                    log.info(`User unsubscribed via message ${messageId}`);
                    break;

                default:
                    log.info(`Unhandled event type: ${eventType} for message ${messageId}`);
                    return;
            }

            // Save the updated target
            target.messagesDelivered[messageIndex] = message;
            target.markModified('messagesDelivered');
            await target.save();

            log.info(`Updated message ${messageId} for ${eventType} event`);

        } catch (error: any) {
            log.error(`Error processing event for message ${messageId}:`, error);
        }
    }
}

export const sendGridWebhookController = new SendGridWebhookController();
