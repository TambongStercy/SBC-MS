import { Router } from 'express';
import { subscriptionController } from '../controllers/subscription.controller';
import { authenticate, authenticateServiceRequest } from '../middleware/auth.middleware';
import { generalLimiter, webhookLimiter } from '../middleware/rate-limit.middleware';

const router = Router();

/**
 * @route   GET /api/subscriptions/plans
 * @desc    Get list of available subscription plans
 * @access  Public (or Private if plans are user-specific)
 */
// Assuming public access for now, add authenticate if needed
router.get('/plans', (req, res) => subscriptionController.getAvailablePlans(req, res));

/**
 * @route   POST /api/subscriptions/purchase
 * @desc    Initiate purchase for a specific subscription plan type (CLASSIQUE, CIBLE, or RELANCE)
 * @access  Private
 */
router.post('/purchase', authenticate as any, generalLimiter, (req, res) => subscriptionController.initiatePurchase(req as any, res));

/**
 * @route   POST /api/subscriptions/upgrade
 * @desc    Initiate upgrade from CLASSIQUE to CIBLE plan
 * @access  Private
 */
router.post('/upgrade', authenticate as any, generalLimiter, (req, res) => subscriptionController.initiateUpgrade(req as any, res));

/**
 * @route   POST /api/subscriptions/webhooks/payment-confirmation
 * @desc    Webhook endpoint for Payment Service to confirm successful payment
 * @access  Internal (Verify source in controller/middleware)
 */
// Note: Needs robust verification (signature/shared secret) in production
router.post('/webhooks/payment-confirmation', webhookLimiter, (req, res) => subscriptionController.handlePaymentWebhook(req, res));

/**
 * @route   GET /api/subscriptions
 * @desc    Get all user subscriptions with pagination (supports ?category=registration|feature)
 * @access  Private
 */
router.get('/', authenticate as any, generalLimiter, (req, res) => subscriptionController.getUserSubscriptions(req as any, res));

/**
 * @route   GET /api/subscriptions/active
 * @desc    Get active subscriptions for a user with pagination
 * @access  Private
 */
router.get('/active', authenticate as any, generalLimiter, (req, res) => subscriptionController.getActiveSubscriptions(req as any, res));

/**
 * @route   GET /api/subscriptions/expired
 * @desc    Get expired subscriptions for a user with pagination
 * @access  Private
 */
router.get('/expired', authenticate as any, generalLimiter, (req, res) => subscriptionController.getExpiredSubscriptions(req as any, res));

/**
 * @route   GET /api/subscriptions/check/:type
 * @desc    Check if user has an active subscription of a specific type (CLASSIQUE, CIBLE, or RELANCE)
 * @access  Private
 */
router.get('/check/:type', authenticate as any, generalLimiter, (req, res) => subscriptionController.checkSubscription(req as any, res));

export default router;