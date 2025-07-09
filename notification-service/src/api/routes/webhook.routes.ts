import express from 'express';
import { WebhookController } from '../controllers/webhook.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = express.Router();
const webhookController = new WebhookController();

/**
 * SendGrid webhook endpoint (no auth required - verified by signature)
 * POST /api/webhook/sendgrid
 */
router.post('/sendgrid', webhookController.handleSendGridWebhook);

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
 * Test webhook endpoint (development only)
 * POST /api/webhook/test
 */
if (process.env.NODE_ENV === 'development') {
    router.post('/test', webhookController.testWebhook);
}

export default router; 