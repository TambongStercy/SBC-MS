import express from 'express';
import { WebhookController } from '../controllers/webhook.controller';
import { WhatsAppWebhookController } from '../controllers/whatsapp-webhook.controller';
import { authenticate } from '../middleware/auth.middleware';
import { rawBodyMiddleware } from '../middleware/raw-body.middleware';

const router = express.Router();
const webhookController = new WebhookController();
const whatsappWebhookController = new WhatsAppWebhookController();

/**
 * SendGrid webhook endpoint (no auth required - verified by signature)
 * POST /api/webhook/sendgrid
 */
router.post('/sendgrid', webhookController.handleSendGridWebhook);

/**
 * WhatsApp Cloud API webhook verification endpoint (GET)
 * This endpoint is called by WhatsApp during initial webhook configuration
 * GET /api/webhook/whatsapp
 */
router.get('/whatsapp', whatsappWebhookController.verifyWebhook);

/**
 * WhatsApp Cloud API webhook endpoint (POST)
 * This endpoint receives message status updates and other events
 * POST /api/webhook/whatsapp
 * Uses rawBodyMiddleware to preserve the raw request body for signature verification
 */
router.post('/whatsapp', rawBodyMiddleware, whatsappWebhookController.handleWebhook);

/**
 * Get bounce statistics (admin only)
 * GET /api/webhook/bounce-stats
 */
router.get('/bounce-stats', authenticate, webhookController.getBounceStats);

/**
 * Check email reputation
 * GET /api/webhook/email-reputation/:email
 */
router.get('/email-reputation/:email', authenticate, webhookController.checkEmailReputation);

/**
 * Cleanup bounce data (admin only)
 * POST /api/webhook/cleanup-bounces
 */
router.post('/cleanup-bounces', authenticate, webhookController.cleanupBounceData);

/**
 * Test webhook endpoints (development only)
 */
if (process.env.NODE_ENV === 'development') {
    router.post('/test', webhookController.testWebhook);
    router.post('/whatsapp/test', whatsappWebhookController.testWebhook);
}

export default router; 