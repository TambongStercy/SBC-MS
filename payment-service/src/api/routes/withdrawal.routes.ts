import { Router } from 'express';
import { withdrawalController } from '../controllers/withdrawal.controller';
import { authenticate, requireAdmin } from '../middleware/auth.middleware';
import { validateWithdrawal, validateAdminUserWithdrawal, validateAdminDirectPayout } from '../middleware/validation';
import { generalLimiter } from '../middleware/rate-limit.middleware';

const router = Router();

// Admin-only withdrawal routes
router.use(authenticate as any); // Apply authentication middleware
router.use(requireAdmin);       // Ensure only admins can access these routes
router.use(generalLimiter);     // Apply general rate limiting

/**
 * @route   POST /api/withdrawals/admin/user
 * @desc    [ADMIN] Initiate a withdrawal for a specific user's balance, bypassing OTP.
 * @access  Private (Admin only)
 */
router.post('/admin/user', validateAdminUserWithdrawal, (req, res) => {
    withdrawalController.initiateAdminUserWithdrawal(req, res);
});

/**
 * @route   POST /api/withdrawals/admin/direct
 * @desc    [ADMIN] Initiate a direct payout (e.g., from system balance), not linked to a user's wallet.
 * @access  Private (Admin only)
 */
router.post('/admin/direct', validateAdminDirectPayout, (req, res) => {
    withdrawalController.initiateAdminDirectPayout(req, res);
});

export default router;
