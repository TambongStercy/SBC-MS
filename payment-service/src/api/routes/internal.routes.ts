import { Router } from 'express';
import { paymentController } from '../controllers/payment.controller';
import { authenticateServiceRequest } from '../middleware/auth.middleware';

const router = Router();

// Apply service-to-service authentication middleware to all internal routes
router.use(authenticateServiceRequest);

/**
 * @route   POST /api/internal/deposit
 * @desc    Record an internal deposit (e.g., commission payout, refund)
 * @access  Private (Service-to-Service)
 */
router.post('/deposit', (req, res, next) => paymentController.recordInternalDeposit(req, res, next));

/**
 * @route   POST /api/internal/withdrawal
 * @desc    Record an internal withdrawal (e.g., fee, chargeback, reversal)
 * @access  Private (Service-to-Service)
 */
router.post('/withdrawal', (req, res, next) => paymentController.recordInternalWithdrawal(req, res, next));


// --- Admin Stats Sub-Router ---
// Note: Keeping general admin stats here for now, but user-specific could be separate
const statsRouter = Router();

/**
 * @route   GET /api/internal/stats/user/:userId/total-withdrawals
 * @desc    Get total completed withdrawal amount for a specific user
 * @access  Private (Service-to-Service)
 */
statsRouter.get('/user/:userId/total-withdrawals', (req, res, next) => paymentController.getUserTotalWithdrawals(req, res, next));

// General Admin Stats (Consider moving if this file becomes too large)
statsRouter.get('/transactions', (req, res, next) => paymentController.adminListTransactions(req, res)); // Pass next for consistency if needed later
statsRouter.get('/total-withdrawals', (req, res, next) => paymentController.adminGetTotalWithdrawals(req, res, next));
statsRouter.get('/total-revenue', (req, res, next) => paymentController.adminGetTotalRevenue(req, res, next));
statsRouter.get('/monthly-revenue', (req, res, next) => paymentController.adminGetMonthlyRevenue(req, res, next));
statsRouter.get('/activity-overview', (req, res, next) => paymentController.adminGetActivityOverview(req, res, next));

router.use('/stats', statsRouter); // Mount stats routes under /internal/stats
// --- End Admin Stats ---


export default router; 