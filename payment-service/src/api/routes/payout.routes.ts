import { Router } from 'express';
import { payoutController } from '../controllers/payout.controller';
import { authenticate } from '../middleware/auth.middleware';
import { generalLimiter } from '../middleware/rate-limit.middleware';

const router = Router();

/**
 * @route   GET /api/payouts/countries
 * @desc    Get supported countries for payouts
 * @access  Public
 */
router.get('/countries', generalLimiter, (req, res) => {
    payoutController.getSupportedCountries(req, res);
});

/**
 * @route   GET /api/payouts/balance
 * @desc    Get CinetPay account balance for payouts
 * @access  Private (Admin only)
 */
router.get('/balance', authenticate as any, generalLimiter, (req, res) => {
    payoutController.getBalance(req, res);
});

/**
 * @route   POST /api/payouts/initiate
 * @desc    Initiate a payout to a user
 * @access  Private (Admin only)
 */
router.post('/initiate', authenticate as any, generalLimiter, (req, res) => {
    payoutController.initiatePayout(req, res);
});

/**
 * @route   GET /api/payouts/status/:transactionId
 * @desc    Check the status of a payout
 * @access  Private (Admin only)
 */
router.get('/status/:transactionId', authenticate as any, generalLimiter, (req, res) => {
    payoutController.checkPayoutStatus(req, res);
});

/**
 * @route   POST /api/payouts/cinetpay/webhook
 * @desc    Handle CinetPay webhook notifications
 * @access  Public (webhook endpoint)
 */
router.post('/cinetpay/webhook', (req, res) => {
    payoutController.handleCinetPayWebhook(req, res);
});

/**
 * @route   POST /api/payouts/test
 * @desc    Test payout functionality (development only)
 * @access  Private (Admin only)
 */
router.post('/test', authenticate as any, generalLimiter, (req, res) => {
    payoutController.testPayout(req, res);
});

export default router;
