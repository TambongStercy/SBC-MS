import { Router } from 'express';
import { eventOrganizerBalanceController } from '../controllers/event-organizer-balance.controller';
import { authenticate, authenticateServiceRequest } from '../middleware/auth.middleware';
import { generalLimiter } from '../middleware/rate-limit.middleware';

const router = Router();

/**
 * @route   GET /api/event-organizer-balance
 * @desc    Organizer's SBC Event earnings and the minimum transfer amount
 * @access  Private
 */
router.get('/', authenticate as any, generalLimiter, (req, res) =>
    eventOrganizerBalanceController.getBalance(req as any, res)
);

/**
 * @route   POST /api/event-organizer-balance/transfer
 * @desc    Move organizer earnings into the main balance so they can be withdrawn
 * @access  Private
 */
router.post('/transfer', authenticate as any, generalLimiter, (req, res) =>
    eventOrganizerBalanceController.transferToMain(req as any, res)
);

/**
 * @route   POST /api/event-organizer-balance/internal/credit
 * @desc    Credit verified organizer earnings (event-service only)
 * @access  Service
 */
router.post('/internal/credit', authenticateServiceRequest as any, (req, res) =>
    eventOrganizerBalanceController.creditEarnings(req as any, res)
);

/**
 * @route   POST /api/event-organizer-balance/internal/debit
 * @desc    Debit seller earnings for a resale refund (event-service only)
 * @access  Service
 */
router.post('/internal/debit', authenticateServiceRequest as any, (req, res) =>
    eventOrganizerBalanceController.debitEarnings(req as any, res)
);

export default router;
