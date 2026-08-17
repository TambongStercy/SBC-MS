import { Router } from 'express';
import { advertisingBalanceController } from '../controllers/advertising-balance.controller';
import { authenticate, authenticateServiceRequest } from '../middleware/auth.middleware';
import { generalLimiter } from '../middleware/rate-limit.middleware';

const router = Router();

/**
 * @route   GET /api/advertising-balance
 * @desc    Diffuseur's advertising earnings and the minimum transfer amount
 * @access  Private
 */
router.get('/', authenticate as any, generalLimiter, (req, res) =>
    advertisingBalanceController.getBalance(req as any, res)
);

/**
 * @route   POST /api/advertising-balance/transfer
 * @desc    Move advertising earnings into the main balance so they can be withdrawn
 * @access  Private
 *
 * Not subscription-gated, unlike the activation transfer: these are earnings the
 * diffuseur worked for, and withholding access to their own money behind a
 * subscription would be a different product decision than gating a spend feature.
 */
router.post('/transfer', authenticate as any, generalLimiter, (req, res) =>
    advertisingBalanceController.transferToMain(req as any, res)
);

/**
 * @route   POST /api/advertising-balance/internal/credit
 * @desc    Credit verified campaign earnings (advertising-service only)
 * @access  Service
 */
router.post('/internal/credit', authenticateServiceRequest as any, (req, res) =>
    advertisingBalanceController.creditEarnings(req as any, res)
);

export default router;
