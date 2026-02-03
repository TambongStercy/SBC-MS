import { Router } from 'express';
import { sendGridWebhookController } from '../controllers/sendgrid-webhook.controller';

const router = Router();

/**
 * SendGrid Webhook Routes
 * Base path: /api/webhooks/sendgrid
 *
 * This endpoint receives email tracking events from SendGrid:
 * - delivered: Email successfully delivered
 * - open: Email opened by recipient
 * - click: Link clicked in email
 * - bounce: Email bounced
 * - dropped: Email dropped before delivery
 * - spam_report: Email marked as spam
 * - unsubscribe: User unsubscribed
 */

// POST /api/webhooks/sendgrid
// Receives events from SendGrid Event Webhook
router.post('/', (req, res) => sendGridWebhookController.handleWebhook(req, res));

export default router;
