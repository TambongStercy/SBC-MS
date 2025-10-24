import { Router } from 'express';
import { withdrawalApprovalController } from '../controllers/withdrawal-approval.controller';
import { authenticate, requireWithdrawalAccess } from '../middleware/auth.middleware';
import { generalLimiter } from '../middleware/rate-limit.middleware';

const router = Router();

// Apply authentication and withdrawal access middleware to all routes
// This allows both admin and withdrawal_admin roles
router.use(authenticate as any);
router.use(requireWithdrawalAccess);
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
 * @route   GET /api/admin/withdrawals/validated
 * @desc    Get all validated (completed/rejected) withdrawals
 * @access  Private (Admin only)
 * @query   page: number (default: 1)
 * @query   limit: number (default: 20)
 * @query   status: 'completed' | 'rejected_by_admin' | 'all' (optional)
 */
router.get('/validated', (req, res) => {
    withdrawalApprovalController.getValidatedWithdrawals(req, res);
});

/**
 * @route   GET /api/admin/withdrawals/history/:userId
 * @desc    Get withdrawal history for a specific user
 * @access  Private (Admin only)
 * @query   page: number (default: 1)
 * @query   limit: number (default: 20)
 */
router.get('/history/:userId', (req, res) => {
    withdrawalApprovalController.getUserWithdrawalHistory(req, res);
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

export default router;
