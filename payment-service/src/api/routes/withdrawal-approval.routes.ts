import { Router } from 'express';
import { withdrawalApprovalController } from '../controllers/withdrawal-approval.controller';
import { authenticate, requireAdmin } from '../middleware/auth.middleware';
import { generalLimiter } from '../middleware/rate-limit.middleware';

const router = Router();

// Apply authentication and admin-only middleware to all routes
router.use(authenticate as any);
router.use(requireAdmin);
router.use(generalLimiter);

/**
 * @route   GET /api/admin/withdrawals/pending
 * @desc    Get all pending withdrawals awaiting admin approval
 * @access  Private (Admin only)
 * @query   page: number (default: 1)
 * @query   limit: number (default: 20)
 * @query   withdrawalType: 'mobile_money' | 'crypto' (optional)
 */
router.get('/pending', (req, res) => {
    withdrawalApprovalController.getPendingWithdrawals(req, res);
});

/**
 * @route   GET /api/admin/withdrawals/stats
 * @desc    Get withdrawal statistics for admin dashboard
 * @access  Private (Admin only)
 */
router.get('/stats', (req, res) => {
    withdrawalApprovalController.getWithdrawalStats(req, res);
});

/**
 * @route   GET /api/admin/withdrawals/:transactionId
 * @desc    Get withdrawal details by transaction ID
 * @access  Private (Admin only)
 */
router.get('/:transactionId', (req, res) => {
    withdrawalApprovalController.getWithdrawalDetails(req, res);
});

/**
 * @route   POST /api/admin/withdrawals/:transactionId/approve
 * @desc    Approve a withdrawal request
 * @access  Private (Admin only)
 * @body    adminNotes: string (optional)
 */
router.post('/:transactionId/approve', (req, res) => {
    withdrawalApprovalController.approveWithdrawal(req, res);
});

/**
 * @route   POST /api/admin/withdrawals/:transactionId/reject
 * @desc    Reject a withdrawal request
 * @access  Private (Admin only)
 * @body    rejectionReason: string (required)
 * @body    adminNotes: string (optional)
 */
router.post('/:transactionId/reject', (req, res) => {
    withdrawalApprovalController.rejectWithdrawal(req, res);
});

/**
 * @route   POST /api/admin/withdrawals/bulk-approve
 * @desc    Bulk approve multiple withdrawals
 * @access  Private (Admin only)
 * @body    transactionIds: string[] (required)
 * @body    adminNotes: string (optional)
 */
router.post('/bulk-approve', (req, res) => {
    withdrawalApprovalController.bulkApproveWithdrawals(req, res);
});

export default router;
