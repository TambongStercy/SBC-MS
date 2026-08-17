import { Router } from 'express';
import { transactionController } from '../controllers/transaction.controller';
import { authenticate, authenticateServiceRequest, requireAdmin } from '../middleware/auth.middleware';
import { requireActiveSubscription } from '../middleware/requireActiveSubscription.middleware';
import { validateWithdrawal } from '../middleware/validation';

const router = Router();
const adminRouter = Router();

// --- Admin Routes ---
adminRouter.use(authenticate);
adminRouter.use(requireAdmin);

// GET /api/transactions/admin - List all account transactions (NEW)
adminRouter.get('/', transactionController.adminListAccountTransactions);

// GET /api/transactions/admin/user-analytics - Aggregated user financial analytics
adminRouter.get('/user-analytics', transactionController.adminGetUserAnalytics);

// Mount admin router
router.use('/admin', adminRouter);

// User transaction routes (protected by auth AND active subscription — these are
// wallet views in the SBC-WEB-UI's RequireSubscription-guarded pages)
router.get('/history', authenticate, requireActiveSubscription, (req, res) => transactionController.getTransactionHistory(req, res));
router.get('/activation-history', authenticate, requireActiveSubscription, (req, res) => transactionController.getActivationTransactionHistory(req, res));
router.get('/stats', authenticate, requireActiveSubscription, (req, res) => transactionController.getTransactionStats(req, res));
router.get('/conversions', authenticate, requireActiveSubscription, (req, res) => transactionController.getUserConversionTransactions(req, res));
router.get('/:transactionId', authenticate, requireActiveSubscription, (req, res) => transactionController.getTransaction(req, res));

// Deposit routes — intentionally NOT paywalled. The deposit/initiate path is also
// exercised by the subscription-purchase flow on the frontend (user pays into their
// SBC wallet so the activation cost can be deducted). The callback uses service auth
// only and is provider-driven.
router.post('/deposit/initiate', authenticate, (req, res) => transactionController.initiateDeposit(req, res));
router.post('/deposit/callback', authenticateServiceRequest, (req, res) => transactionController.processDepositCallback(req, res));

// Withdrawal routes — paywalled. Only subscribed users can withdraw.
router.get('/withdrawal/estimate', authenticate, requireActiveSubscription, (req, res) => transactionController.estimateWithdrawal(req, res));
router.post('/withdrawal/initiate', authenticate, requireActiveSubscription, validateWithdrawal, (req, res) => transactionController.initiateWithdrawal(req, res));
router.post('/withdrawal/verify', authenticate, requireActiveSubscription, (req, res) => transactionController.verifyWithdrawal(req, res));
router.delete('/withdrawal/:transactionId/cancel', authenticate, requireActiveSubscription, (req, res) => transactionController.cancelWithdrawal(req, res));

// Payment routes — intentionally NOT paywalled. Reuses the same path as deposit
// for the subscription-purchase flow. Unsubscribed users hit this when paying for
// their first activation.
router.post('/payment', authenticate, (req, res) => transactionController.processPayment(req, res));

router.post('/test', authenticate, (req, res) => transactionController.test(req, res));

export default router; 