import { Router } from 'express';
import { payoutController } from '../controllers/payout.controller';
import { requireAdmin, authenticate } from '../middleware/auth.middleware';
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
router.get('/balance', authenticate as any, requireAdmin, generalLimiter, (req, res) => {
    payoutController.getBalance(req, res);
});

/**
 * @route   POST /api/payouts/initiate
 * @desc    Initiate a payout to a user
 * @access  Private (Admin only)
 */
router.post('/initiate', authenticate as any, requireAdmin, generalLimiter, (req, res) => {
    payoutController.initiatePayout(req, res);
});

/**
 * @route   GET /api/payouts/status/:transactionId
 * @desc    Check the status of a payout
 * @access  Private (Admin only)
 */
router.get('/status/:transactionId', authenticate as any, requireAdmin, generalLimiter, (req, res) => {
    payoutController.checkPayoutStatus(req, res);
});

/**
 * @route   POST /api/payouts/webhooks/cinetpay
 * @desc    Handle CinetPay webhook notifications (for actual status updates)
 * @access  Public (webhook endpoint)
 */
router.post('/webhooks/cinetpay', (req, res) => {
    payoutController.handleCinetPayWebhook(req, res);
});

/**
 * @route   GET /api/payouts/webhooks/cinetpay
 * @desc    CinetPay sends a GET request to verify webhook URL availability.
 * @access  Public (webhook endpoint)
 */
router.get('/webhooks/cinetpay', (req, res) => {
    // Respond with 200 OK to acknowledge receipt of the ping
    res.status(200).send('OK');
});

/**
 * @route   POST /api/payouts/webhooks/feexpay
 * @desc    Handle FeexPay webhook notifications for Payouts/Transfers.
 * @access  Public (webhook endpoint)
 */
router.post('/webhooks/feexpay', (req, res) => {
    payoutController.handleFeexPayWebhook(req, res);
});

/**
 * @route   GET /api/payouts/webhooks/feexpay
 * @desc    FeexPay might send a GET request to verify webhook URL availability.
 * @access  Public (webhook endpoint)
 */
router.get('/webhooks/feexpay', (req, res) => {
    // Respond with 200 OK to acknowledge receipt of the ping
    res.status(200).send('OK');
});

/**
 * @route   POST /api/payouts/test
 * @desc    Test payout functionality (development only)
 * @access  Private (Admin only)
 */
router.post('/test', authenticate as any, requireAdmin, generalLimiter, (req, res) => {
    payoutController.testPayout(req, res);
});

export default router;
