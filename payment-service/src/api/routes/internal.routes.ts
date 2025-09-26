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

/**
 * @route   POST /api/internal/conversion
 * @desc    Create a conversion transaction record
 * @access  Private (Service-to-Service)
 */
router.post('/conversion', (req, res, next) => paymentController.createConversionTransaction(req, res, next));


// --- Admin Stats Sub-Router ---
// Note: Keeping general admin stats here for now, but user-specific could be separate
const statsRouter = Router();

/**
 * @route   GET /api/internal/stats/user/:userId/total-withdrawals
 * @desc    Get total completed withdrawal amount for a specific user
 * @access  Private (Service-to-Service)
 */
statsRouter.get('/user/:userId/total-withdrawals', (req, res, next) => paymentController.getUserTotalWithdrawals(req, res, next));

/**
 * @route   GET /api/internal/user/:userId/has-pending-transactions
 * @desc    Check if user has any pending transactions that would block currency conversion
 * @access  Private (Service-to-Service)
 */
router.get('/user/:userId/has-pending-transactions', (req, res, next) => paymentController.checkUserPendingTransactions(req, res, next));

// General Admin Stats (Consider moving if this file becomes too large)
statsRouter.get('/transactions', (req, res, next) => paymentController.adminGetTotalTransactionsCount(req, res, next));
statsRouter.get('/total-withdrawals', (req, res, next) => paymentController.adminGetTotalWithdrawals(req, res, next));
statsRouter.get('/total-deposits', (req, res, next) => paymentController.adminGetTotalDeposits(req, res, next));
statsRouter.get('/total-revenue', (req, res, next) => paymentController.adminGetTotalRevenue(req, res, next));
statsRouter.get('/monthly-revenue', (req, res, next) => paymentController.adminGetMonthlyRevenue(req, res, next));
statsRouter.get('/activity-overview', (req, res, next) => paymentController.adminGetActivityOverview(req, res, next));

router.use('/stats', statsRouter); // Mount stats routes under /internal/stats
// --- End Admin Stats ---


export default router; 