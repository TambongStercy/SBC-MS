import { Router } from 'express';
import { activationBalanceController } from '../controllers/activation-balance.controller';
import { authenticate } from '../middleware/auth.middleware';
import { generalLimiter } from '../middleware/rate-limit.middleware';

const router = Router();

/**
 * @route   GET /api/activation-balance
 * @desc    Get user's activation balance and summary (balance, total sponsored, count)
 * @access  Private
 */
router.get('/', authenticate as any, generalLimiter, (req, res) =>
    activationBalanceController.getActivationBalance(req as any, res)
);

/**
 * @route   GET /api/activation-balance/pricing
 * @desc    Get pricing information for different activation types
 * @access  Private
 */
router.get('/pricing', authenticate as any, generalLimiter, (req, res) =>
    activationBalanceController.getPricing(req as any, res)
);

/**
 * @route   POST /api/activation-balance/transfer
 * @desc    Transfer funds from main balance to activation balance
 * @access  Private
 * @body    { amount: number }
 */
router.post('/transfer', authenticate as any, generalLimiter, (req, res) =>
    activationBalanceController.transferToActivationBalance(req as any, res)
);

/**
 * @route   POST /api/activation-balance/transfer-to-user
 * @desc    Transfer activation balance to another user's activation balance (P2P)
 * @access  Private
 * @body    { recipientId: string, amount: number }
 */
router.post('/transfer-to-user', authenticate as any, generalLimiter, (req, res) =>
    activationBalanceController.transferActivationToUser(req as any, res)
);

/**
 * @route   GET /api/activation-balance/referrals
 * @desc    Get referrals that can be activated or upgraded by the sponsor
 * @access  Private
 * @query   page (default: 1), limit (default: 20), filter (all|activatable|upgradable)
 */
router.get('/referrals', authenticate as any, generalLimiter, (req, res) =>
    activationBalanceController.getReferralsForActivation(req as any, res)
);

/**
 * @route   POST /api/activation-balance/sponsor
 * @desc    Sponsor a referral's account activation using activation balance
 * @access  Private
 * @body    { beneficiaryId: string, subscriptionType: 'CLASSIQUE' | 'CIBLE' | 'UPGRADE' }
 */
router.post('/sponsor', authenticate as any, generalLimiter, (req, res) =>
    activationBalanceController.sponsorReferralActivation(req as any, res)
);

/**
 * @route   GET /api/activation-balance/history
 * @desc    Get sponsored activation history
 * @access  Private
 * @query   page (default: 1), limit (default: 20)
 */
router.get('/history', authenticate as any, generalLimiter, (req, res) =>
    activationBalanceController.getSponsoredActivationHistory(req as any, res)
);

export default router;
