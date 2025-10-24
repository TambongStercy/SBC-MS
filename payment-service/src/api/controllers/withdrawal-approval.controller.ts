import { Request, Response } from 'express';
import paymentService from '../../services/payment.service';
import transactionRepository from '../../database/repositories/transaction.repository';
import TransactionModel, { TransactionStatus, TransactionType } from '../../database/models/transaction.model';
import logger from '../../utils/logger';
import { AppError } from '../../utils/errors';
import { userServiceClient } from '../../services/clients/user.service.client';

type AuthenticatedRequest = Request & { user?: { userId: string; email: string; role: string } };

const log = logger.getLogger('WithdrawalApprovalController');

export class WithdrawalApprovalController {

    /**
     * Get all pending withdrawals awaiting admin approval
     * GET /api/admin/withdrawals/pending
     */
    async getPendingWithdrawals(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const adminId = req.user?.userId;
            if (!adminId) {
                res.status(401).json({ success: false, message: 'Admin not authenticated' });
                return;
            }

            const { page = '1', limit = '20', withdrawalType } = req.query;

            const pageNum = parseInt(page as string);
            const limitNum = parseInt(limit as string);
            const skip = (pageNum - 1) * limitNum;

            const filter: any = {
                type: TransactionType.WITHDRAWAL,
                status: TransactionStatus.PENDING_ADMIN_APPROVAL,
                deleted: false
            };

            // Filter by withdrawal type if specified
            if (withdrawalType === 'mobile_money') {
                filter['metadata.withdrawalType'] = 'mobile_money';
            } else if (withdrawalType === 'crypto') {
                filter['metadata.withdrawalType'] = 'crypto';
            }

            const transactions = await TransactionModel.find(filter)
                .skip(skip)
                .limit(limitNum)
                .sort({ createdAt: -1 })
                .lean();

            const total = await TransactionModel.countDocuments(filter);
            const totalPages = Math.ceil(total / limitNum);

            log.info(`[ENRICHMENT] Starting user enrichment for ${transactions.length} transactions`);

            // Enrich transactions with user information
            const enrichedTransactions = await Promise.all(
                transactions.map(async (transaction: any) => {
                    try {
                        log.info(`Fetching user details for user ${transaction.userId}`);
                        const userDetails = await userServiceClient.getUserDetails(transaction.userId.toString());

                        if (!userDetails) {
                            log.warn(`User details returned null for user ${transaction.userId}`);
                            return {
                                ...transaction,
                                userName: 'Unknown',
                                userEmail: 'Unknown',
                                userPhoneNumber: 'Unknown',
                                userBalance: {}
                            };
                        }

                        log.info(`Successfully fetched user details for ${transaction.userId}: ${userDetails.name}`);
                        return {
                            ...transaction,
                            userName: userDetails.name || 'Unknown',
                            userEmail: userDetails.email || 'Unknown',
                            userPhoneNumber: userDetails.phoneNumber?.toString() || 'Unknown',
                            userBalance: userDetails.balance || {}
                        };
                    } catch (error: any) {
                        log.error(`Failed to fetch user details for ${transaction.userId}:`, error?.message || error);
                        return {
                            ...transaction,
                            userName: 'Error fetching',
                            userEmail: 'Error fetching',
                            userPhoneNumber: 'Error fetching',
                            userBalance: {}
                        };
                    }
                })
            );

            log.info(`[ENRICHMENT] Completed user enrichment. Enriched ${enrichedTransactions.length} transactions`);
            log.info(`[ENRICHMENT] First transaction userName: ${enrichedTransactions[0]?.userName || 'undefined'}`);

            log.info(`Admin ${adminId} fetched ${transactions.length} pending withdrawals`);

            res.status(200).json({
                success: true,
                data: {
                    withdrawals: enrichedTransactions,
                    pagination: {
                        page: pageNum,
                        limit: limitNum,
                        total,
                        totalPages
                    }
                }
            });

        } catch (error: any) {
            log.error('Error fetching pending withdrawals:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch pending withdrawals',
                error: error.message
            });
        }
    }

    /**
     * Get withdrawal details by ID
     * GET /api/admin/withdrawals/:transactionId
     */
    async getWithdrawalDetails(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const adminId = req.user?.userId;
            if (!adminId) {
                res.status(401).json({ success: false, message: 'Admin not authenticated' });
                return;
            }

            const { transactionId } = req.params;

            const transaction = await transactionRepository.findByTransactionId(transactionId);

            if (!transaction) {
                res.status(404).json({
                    success: false,
                    message: 'Withdrawal transaction not found'
                });
                return;
            }

            if (transaction.type !== TransactionType.WITHDRAWAL) {
                res.status(400).json({
                    success: false,
                    message: 'Transaction is not a withdrawal'
                });
                return;
            }

            // Enrich transaction with user information
            let enrichedTransaction: any = { ...transaction };
            try {
                const userDetails = await userServiceClient.getUserDetails(transaction.userId.toString());
                if (!userDetails) {
                    enrichedTransaction = {
                        ...transaction,
                        userName: 'Unknown',
                        userEmail: 'Unknown',
                        userPhoneNumber: 'Unknown',
                        userBalance: {}
                    };
                } else {
                    enrichedTransaction = {
                        ...transaction,
                        userName: userDetails.name || 'Unknown',
                        userEmail: userDetails.email || 'Unknown',
                        userPhoneNumber: userDetails.phoneNumber || 'Unknown',
                        userBalance: userDetails.balance || {}
                    };
                }
            } catch (error) {
                log.error(`Failed to fetch user details for ${transaction.userId}:`, error);
                enrichedTransaction = {
                    ...transaction,
                    userName: 'Unknown',
                    userEmail: 'Unknown',
                    userPhoneNumber: 'Unknown',
                    userBalance: {}
                };
            }

            res.status(200).json({
                success: true,
                data: enrichedTransaction
            });

        } catch (error: any) {
            log.error('Error fetching withdrawal details:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch withdrawal details',
                error: error.message
            });
        }
    }

    /**
     * Approve a withdrawal
     * POST /api/admin/withdrawals/:transactionId/approve
     */
    async approveWithdrawal(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const adminId = req.user?.userId;
            if (!adminId) {
                res.status(401).json({ success: false, message: 'Admin not authenticated' });
                return;
            }

            const { transactionId } = req.params;
            const { adminNotes } = req.body;

            log.info(`Admin ${adminId} approving withdrawal ${transactionId}`);

            const result = await paymentService.approveWithdrawal(
                transactionId,
                adminId,
                adminNotes
            );

            if (result.success) {
                res.status(200).json({
                    success: true,
                    message: 'Withdrawal approved successfully and processing initiated',
                    data: result.transaction
                });
            } else {
                res.status(400).json({
                    success: false,
                    message: result.error || 'Failed to approve withdrawal'
                });
            }

        } catch (error: any) {
            log.error('Error approving withdrawal:', error);
            if (error instanceof AppError) {
                res.status(error.statusCode).json({ success: false, message: error.message });
                return;
            }
            res.status(500).json({
                success: false,
                message: 'Failed to approve withdrawal',
                error: error.message
            });
        }
    }

    /**
     * Reject a withdrawal
     * POST /api/admin/withdrawals/:transactionId/reject
     */
    async rejectWithdrawal(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const adminId = req.user?.userId;
            if (!adminId) {
                res.status(401).json({ success: false, message: 'Admin not authenticated' });
                return;
            }

            const { transactionId } = req.params;
            const { rejectionReason, adminNotes } = req.body;

            if (!rejectionReason) {
                res.status(400).json({
                    success: false,
                    message: 'Rejection reason is required'
                });
                return;
            }

            log.info(`Admin ${adminId} rejecting withdrawal ${transactionId}: ${rejectionReason}`);

            const result = await paymentService.rejectWithdrawal(
                transactionId,
                adminId,
                rejectionReason,
                adminNotes
            );

            if (result.success) {
                res.status(200).json({
                    success: true,
                    message: 'Withdrawal rejected successfully',
                    data: result.transaction
                });
            } else {
                res.status(400).json({
                    success: false,
                    message: result.error || 'Failed to reject withdrawal'
                });
            }

        } catch (error: any) {
            log.error('Error rejecting withdrawal:', error);
            if (error instanceof AppError) {
                res.status(error.statusCode).json({ success: false, message: error.message });
                return;
            }
            res.status(500).json({
                success: false,
                message: 'Failed to reject withdrawal',
                error: error.message
            });
        }
    }

    /**
     * Get withdrawal statistics for admin dashboard
     * GET /api/admin/withdrawals/stats
     */
    async getWithdrawalStats(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const adminId = req.user?.userId;
            if (!adminId) {
                res.status(401).json({ success: false, message: 'Admin not authenticated' });
                return;
            }

            const pendingCount = await transactionRepository.count({
                type: TransactionType.WITHDRAWAL,
                status: TransactionStatus.PENDING_ADMIN_APPROVAL,
                deleted: false
            });

            const approvedToday = await transactionRepository.count({
                type: TransactionType.WITHDRAWAL,
                status: { $in: [TransactionStatus.PROCESSING, TransactionStatus.COMPLETED] },
                approvedAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
                deleted: false
            });

            const rejectedToday = await transactionRepository.count({
                type: TransactionType.WITHDRAWAL,
                status: TransactionStatus.REJECTED_BY_ADMIN,
                rejectedAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
                deleted: false
            });

            const processingCount = await transactionRepository.count({
                type: TransactionType.WITHDRAWAL,
                status: TransactionStatus.PROCESSING,
                deleted: false
            });

            res.status(200).json({
                success: true,
                data: {
                    pendingApproval: pendingCount,
                    approvedToday,
                    rejectedToday,
                    processing: processingCount
                }
            });

        } catch (error: any) {
            log.error('Error fetching withdrawal stats:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch withdrawal statistics',
                error: error.message
            });
        }
    }

    /**
     * Bulk approve withdrawals
     * POST /api/admin/withdrawals/bulk-approve
     */
    async bulkApproveWithdrawals(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const adminId = req.user?.userId;
            if (!adminId) {
                res.status(401).json({ success: false, message: 'Admin not authenticated' });
                return;
            }

            const { transactionIds, adminNotes } = req.body;

            if (!Array.isArray(transactionIds) || transactionIds.length === 0) {
                res.status(400).json({
                    success: false,
                    message: 'Transaction IDs array is required'
                });
                return;
            }

            log.info(`Admin ${adminId} bulk approving ${transactionIds.length} withdrawals`);

            const results = {
                approved: 0,
                failed: 0,
                errors: [] as string[]
            };

            for (const transactionId of transactionIds) {
                try {
                    const result = await paymentService.approveWithdrawal(
                        transactionId,
                        adminId,
                        adminNotes
                    );
                    if (result.success) {
                        results.approved++;
                    } else {
                        results.failed++;
                        results.errors.push(`${transactionId}: ${result.error}`);
                    }
                } catch (error: any) {
                    results.failed++;
                    results.errors.push(`${transactionId}: ${error.message}`);
                }
            }

            res.status(200).json({
                success: true,
                message: `Bulk approval completed: ${results.approved} approved, ${results.failed} failed`,
                data: results
            });

        } catch (error: any) {
            log.error('Error in bulk approval:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to process bulk approval',
                error: error.message
            });
        }
    }
}

export const withdrawalApprovalController = new WithdrawalApprovalController();
