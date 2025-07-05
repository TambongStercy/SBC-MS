import { Router } from 'express';
import { transactionController } from '../controllers/transaction.controller';
import { authenticate, authenticateServiceRequest, requireAdmin } from '../middleware/auth.middleware';

const router = Router();
const adminRouter = Router();

// --- Admin Routes ---
adminRouter.use(authenticate);
adminRouter.use(requireAdmin);

// GET /api/transactions/admin - List all account transactions (NEW)
adminRouter.get('/', transactionController.adminListAccountTransactions);

// Mount admin router
router.use('/admin', adminRouter);

// User transaction routes (protected)
router.get('/history', authenticate, (req, res) => transactionController.getTransactionHistory(req, res));
router.get('/stats', authenticate, (req, res) => transactionController.getTransactionStats(req, res));
router.get('/:transactionId', authenticate, (req, res) => transactionController.getTransaction(req, res));

// Deposit routes
router.post('/deposit/initiate', authenticate, (req, res) => transactionController.initiateDeposit(req, res));
router.post('/deposit/callback', authenticateServiceRequest, (req, res) => transactionController.processDepositCallback(req, res));

// Withdrawal routes
router.post('/withdrawal/initiate', authenticate, (req, res) => transactionController.initiateWithdrawal(req, res));
router.post('/withdrawal/verify', authenticate, (req, res) => transactionController.verifyWithdrawal(req, res));
router.delete('/withdrawal/:transactionId/cancel', authenticate, (req, res) => transactionController.cancelWithdrawal(req, res));

// Payment routes
router.post('/payment', authenticate, (req, res) => transactionController.processPayment(req, res));

router.post('/test', authenticate, (req, res) => transactionController.test(req, res));

export default router; 