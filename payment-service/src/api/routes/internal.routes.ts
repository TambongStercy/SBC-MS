import { Router } from 'express';
import { paymentController } from '../controllers/payment.controller';
import { authenticateServiceRequest } from '../middleware/auth.middleware';
import { Types } from 'mongoose';
import TransactionModel, { TransactionStatus, TransactionType, Currency } from '../../database/models/transaction.model';
import transactionRepository from '../../database/repositories/transaction.repository';
import { activityPayments } from '../../services/payment-conversion.service';

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
 * @route   GET /api/internal/activity/payments?from=YYYY-MM-DD&to=YYYY-MM-DD
 * @desc    Unfinished payments per Douala day and country (Security plan Phase 11 rollup)
 * @access  Private (Service-to-Service)
 */
router.get('/activity/payments', async (req, res) => {
    try {
        const data = await activityPayments({ from: String(req.query.from || ''), to: String(req.query.to || '') });
        res.json({ success: true, data });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error?.message || 'activity payments failed' });
    }
});

/**
 * @route   GET /api/internal/intents/:sessionId
 * @desc    Authoritative status + amount of a payment intent (callback verification)
 * @access  Private (Service-to-Service)
 */
router.get('/intents/:sessionId', (req, res) => paymentController.getInternalIntent(req, res));

/**
 * @route   POST /api/internal/withdrawal
 * @desc    Record an internal withdrawal (e.g., fee, chargeback, reversal)
 * @access  Private (Service-to-Service)
 */
router.post('/withdrawal', (req, res, next) => paymentController.recordInternalWithdrawal(req, res, next));

/** Ads Network campaigns paid with the SBC balance: atomic debit, and its refund (at most once). */
router.post('/balance-spend', (req, res, next) => paymentController.spendFromBalance(req, res, next));
router.post('/balance-refund', (req, res, next) => paymentController.refundBalanceSpend(req, res, next));

/**
 * @route   POST /api/internal/adjustment-transaction
 * @desc    Record (only) an admin balance adjustment made by user-service. Idempotent on
 *          `reference` (= the wallet ledger reference): 'pending' creates it once,
 *          'completed' / 'failed' close it once.
 * @access  Private (Service-to-Service)
 */
router.post('/adjustment-transaction', async (req, res) => {
    try {
        const { userId, amount, reason, adminId, reference, status } = req.body || {};
        if (!Types.ObjectId.isValid(String(userId)) || !Number.isFinite(Number(amount)) || !reference || !['pending', 'completed', 'failed'].includes(status)) {
            return res.status(400).json({ success: false, message: 'userId, amount, reference and status are required' });
        }
        let tx = await TransactionModel.findOne({ type: TransactionType.ADMIN_ADJUSTMENT, 'metadata.adjustmentRef': String(reference) });
        if (!tx) {
            tx = await transactionRepository.create({
                userId: String(userId),
                type: TransactionType.ADMIN_ADJUSTMENT,
                amount: Number(amount),
                currency: Currency.XAF,
                status: TransactionStatus.PENDING,
                description: `Ajustement admin du solde : ${String(reason || '').slice(0, 300)}`,
                metadata: { adjustmentRef: String(reference), adminId: String(adminId || ''), reason: String(reason || '').slice(0, 500) },
            }) as any;
        }
        if (status !== 'pending') {
            await TransactionModel.updateOne(
                { _id: tx!._id, status: TransactionStatus.PENDING },
                { $set: { status: status === 'completed' ? TransactionStatus.COMPLETED : TransactionStatus.FAILED } },
            );
        }
        return res.status(200).json({ success: true, data: { transactionId: tx!.transactionId } });
    } catch (error: any) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * @route   POST /api/internal/conversion
 * @desc    Create a conversion transaction record
 * @access  Private (Service-to-Service)
 */
router.post('/conversion', (req, res, next) => paymentController.createConversionTransaction(req, res, next));

/**
 * @route   POST /api/internal/activation-transaction
 * @desc    Record an activation balance transaction (transfer-in, transfer-out, sponsor activation)
 * @access  Private (Service-to-Service)
 * @body    { userId: string, type: 'activation_transfer_in' | 'activation_transfer_out' | 'sponsor_activation',
 *            amount: number, description: string, metadata?: object }
 */
router.post('/activation-transaction', (req, res, next) => paymentController.recordActivationTransaction(req, res, next));


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

/**
 * @route   GET /api/internal/user/:userId/has-pending-withdrawal
 * @desc    Check if user has a pending withdrawal specifically (gates activation transfers)
 * @access  Private (Service-to-Service)
 */
router.get('/user/:userId/has-pending-withdrawal', (req, res, next) => paymentController.checkUserPendingWithdrawal(req, res, next));

/**
 * @route   POST /api/internal/user/:userId/commissions-from
 * @desc    Sum of referral commissions the user earned from given filleuls (read-only)
 * @access  Private (Service-to-Service)
 */
router.post('/user/:userId/commissions-from', (req, res, next) => paymentController.getCommissionsFromSources(req, res, next));

/**
 * @route   POST /api/internal/transactions/:transactionId/mark-reconciled
 * @desc    Mark a transaction as RECONCILED with audit metadata (admin-driven reversals)
 * @access  Private (Service-to-Service)
 */
router.post('/transactions/:transactionId/mark-reconciled', (req, res, next) => paymentController.markTransactionReconciled(req, res, next));

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