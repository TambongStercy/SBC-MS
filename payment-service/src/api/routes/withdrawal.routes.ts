import { Router } from 'express';
import { withdrawalController } from '../controllers/withdrawal.controller';
import { authenticate, requireAdmin } from '../middleware/auth.middleware';
import { validateWithdrawal, validateAdminUserWithdrawal, validateAdminDirectPayout } from '../middleware/validation';

const router = Router();

/**
 * @route POST /api/withdrawals/user
 * @desc User withdrawal - only requires amount
 * @access Private (User)
 * @body { amount: number }
 */
router.post('/user',
    authenticate,
    validateWithdrawal,
    withdrawalController.initiateUserWithdrawal.bind(withdrawalController)
);

/**
 * @route POST /api/withdrawals/admin/user
 * @desc Admin withdrawal for specific user (with optional override parameters)
 * @access Private (Admin)
 * @body { userId: string, amount: number, phoneNumber?: string, countryCode?: string, paymentMethod?: string, recipientName?: string }
 */
router.post('/admin/user',
    authenticate,
    requireAdmin,
    validateAdminUserWithdrawal,
    withdrawalController.initiateAdminUserWithdrawal.bind(withdrawalController)
);

/**
 * @route POST /api/withdrawals/admin/direct
 * @desc Admin direct payout (no user account involved)
 * @access Private (Admin)
 * @body { amount: number, phoneNumber: string, countryCode: string, recipientName: string, recipientEmail?: string, paymentMethod?: string, description?: string }
 */
router.post('/admin/direct',
    authenticate,
    requireAdmin,
    validateAdminDirectPayout,
    withdrawalController.initiateAdminDirectPayout.bind(withdrawalController)
);

export default router;
