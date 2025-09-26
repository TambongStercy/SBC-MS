import { Request, Response } from 'express';
import { Types } from 'mongoose';
import paymentService from '../../services/payment.service';
import { userServiceClient } from '../../services/clients/user.service.client';
import { TransactionType, Currency, TransactionStatus } from '../../database/models/transaction.model';
import logger from '../../utils/logger';
import { AppError } from '../../utils/errors';
import { PaginationOptions } from '../../types/pagination';
import { cinetpayPayoutService } from '../../services/cinetpay-payout.service';

const log = logger.getLogger('TransactionController');

export class TransactionController {


    /**
     * Get transaction history for the authenticated user
     * @route GET /api/transactions/history
     */
    async getTransactionHistory(req: Request, res: Response) {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                return res.status(401).json({ success: false, message: 'User not authenticated' });
            }

            const {
                type, status, startDate, endDate,
                page = '1',
                limit = '50',
                sortBy = 'createdAt', sortOrder = 'desc'
            } = req.query;

            // Convert and validate query params
            const options: any = {
                limit: parseInt(limit as string, 10),
                page: parseInt(page as string, 10),
                sortBy: sortBy as string,
                sortOrder: sortOrder as 'asc' | 'desc',
            };

            if (type) options.type = type as TransactionType;
            if (status) options.status = status;
            if (startDate) options.startDate = new Date(startDate as string);
            if (endDate) options.endDate = new Date(endDate as string);

            const result = await paymentService.getTransactionHistory(userId, options);

            return res.status(200).json({
                success: true,
                transactions: result.transactions,
                pagination: {
                    total: result.total,
                    limit: options.limit,
                    skip: options.skip,
                    page: options.page,
                }
            });
        } catch (error) {
            log.error(`Error in getTransactionHistory: ${error}`);
            return res.status(500).json({
                success: false,
                message: 'Failed to retrieve transaction history'
            });
        }
    }

    /**
     * Get a specific transaction by ID
     * @route GET /api/transactions/:transactionId
     */
    async getTransaction(req: Request, res: Response) {
        try {
            const { transactionId } = req.params;
            const userId = req.user?.userId;

            if (!userId) {
                return res.status(401).json({ success: false, message: 'User not authenticated' });
            }

            const transaction = await paymentService.getTransaction(transactionId);

            if (!transaction) {
                return res.status(404).json({ success: false, message: 'Transaction not found' });
            }

            // Ensure user can only access their own transactions
            if (transaction.userId.toString() !== userId) {
                return res.status(403).json({ success: false, message: 'Access denied' });
            }

            return res.status(200).json({
                success: true,
                transaction
            });
        } catch (error) {
            log.error(`Error in getTransaction: ${error}`);
            return res.status(500).json({
                success: false,
                message: 'Failed to retrieve transaction'
            });
        }
    }

    /**
     * Initiate a deposit transaction
     * @route POST /api/transactions/deposit/initiate
     */
    async initiateDeposit(req: Request, res: Response) {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                return res.status(401).json({ success: false, message: 'User not authenticated' });
            }

            const { amount, currency, paymentMethod, description } = req.body;

            if (!amount || !currency || !paymentMethod) {
                return res.status(400).json({
                    success: false,
                    message: 'Amount, currency, and payment method are required'
                });
            }

            // TODO: Generate a session or redirect URL for the payment gateway
            // This is a placeholder for the actual payment gateway integration
            // For now, this is directly processing, which might not be how payment gateways work.
            // If payment gateways give a URL, the `processDeposit` should be called via webhook.
            // For demo, let's keep it simple.
            const transaction = await paymentService.processDeposit(
                userId,
                amount,
                currency as Currency,
                { provider: paymentMethod, transactionId: `gateway_${Date.now()}` }, // Mock gateway details
                description || `Deposit via ${paymentMethod}` // Pass description
            );

            return res.status(200).json({
                success: true,
                message: 'Deposit processed successfully',
                transactionId: transaction.transactionId,
                amount: transaction.amount,
                currency: transaction.currency,
                status: transaction.status
            });
        } catch (error: any) {
            log.error(`Error in initiateDeposit: ${error.message}`, error);
            if (error instanceof AppError) {
                return res.status(error.statusCode).json({ success: false, message: error.message });
            }
            return res.status(500).json({
                success: false,
                message: 'Failed to initiate deposit'
            });
        }
    }

    /**
     * Process a deposit callback from the payment gateway
     * @route POST /api/transactions/deposit/callback
     */
    async processDepositCallback(req: Request, res: Response) {
        try {
            // This would be called by the payment gateway with transaction details
            const { userId, amount, currency, transactionId, status, metadata, description } = req.body;

            if (!userId || !amount || !currency || !transactionId || !status) {
                return res.status(400).json({
                    success: false,
                    message: 'Missing required fields'
                });
            }

            // Verify the request is from a valid payment gateway (implement proper validation)
            // For production, add signature verification and other security measures

            if (status === 'success') {
                // Process the successful deposit
                const transaction = await paymentService.processDeposit(
                    userId,
                    amount,
                    currency as Currency,
                    {
                        provider: metadata?.provider || 'payment_gateway_name',
                        transactionId,
                        metadata
                    },
                    description || 'Payment gateway deposit' // Pass description
                );

                return res.status(200).json({
                    success: true,
                    message: 'Deposit processed successfully',
                    transactionId: transaction.transactionId
                });
            } else {
                // Handle failed deposit
                return res.status(200).json({
                    success: false,
                    message: 'Deposit failed',
                    reason: metadata?.failureReason
                });
            }
        } catch (error: any) {
            log.error(`Error in processDepositCallback: ${error.message}`, error);
            if (error instanceof AppError) {
                return res.status(error.statusCode).json({ success: false, message: error.message });
            }
            return res.status(500).json({
                success: false,
                message: 'Failed to process deposit callback'
            });
        }
    }

    /**
     * Initiate a withdrawal transaction for the authenticated user.
     * Supports both mobile money and crypto withdrawals with OTP verification.
     * @route POST /api/transactions/withdrawal/initiate
     */
    async initiateWithdrawal(req: Request, res: Response) {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                return res.status(401).json({ success: false, message: 'User not authenticated' });
            }

            const { amount, withdrawalType } = req.body;

            if (!amount || !withdrawalType) {
                return res.status(400).json({
                    success: false,
                    message: 'Amount and withdrawal type are required. Use "mobile_money" or "crypto" for withdrawalType.'
                });
            }

            if (!['mobile_money', 'crypto'].includes(withdrawalType)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid withdrawal type. Use "mobile_money" or "crypto".'
                });
            }

            const ipAddress = req.ip || '';
            const deviceInfo = req.get('User-Agent') || '';

            // Route to appropriate withdrawal method based on type
            let withdrawalResult;
            if (withdrawalType === 'crypto') {
                withdrawalResult = await paymentService.initiateCryptoWithdrawalWithOTP(
                    userId,
                    amount,
                    ipAddress,
                    deviceInfo
                );
            } else {
                
                // Mobile money withdrawal (existing flow)
                withdrawalResult = await paymentService.initiateWithdrawal(
                    userId,
                    amount,
                    ipAddress,
                    deviceInfo
                );
            }

            log.info(`${withdrawalType} withdrawal result: ${JSON.stringify(withdrawalResult)}`);

            // If a message about existing pending withdrawal is returned, include it
            if (withdrawalResult.message) {
                return res.status(200).json({
                    success: true,
                    data: withdrawalResult,
                    message: withdrawalResult.message,
                    transactionId: withdrawalResult.transactionId,
                    amount: withdrawalResult.amount,
                    fee: withdrawalResult.fee,
                    total: withdrawalResult.total,
                    status: withdrawalResult.status,
                    expiresAt: withdrawalResult.expiresAt
                });
            }

            return res.status(200).json({
                success: true,
                data: withdrawalResult,
                message: 'Withdrawal initiation successful. Please check your registered contact for an OTP.',
                transactionId: withdrawalResult.transactionId,
                amount: withdrawalResult.amount,
                fee: withdrawalResult.fee,
                total: withdrawalResult.total,
                status: withdrawalResult.status,
                expiresAt: withdrawalResult.expiresAt
            });
        } catch (error: any) {
            log.error(`Error in initiateWithdrawal: ${error.message}`, error);
            if (error instanceof AppError) {
                return res.status(error.statusCode).json({ success: false, message: error.message });
            }
            return res.status(500).json({
                success: false,
                message: 'Failed to initiate withdrawal'
            });
        }
    }

    /**
     * Estimate withdrawal fees and final amounts
     * @route GET /api/transactions/withdrawal/estimate
     */
    async estimateWithdrawal(req: Request, res: Response) {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                return res.status(401).json({ success: false, message: 'User not authenticated' });
            }

            const { amount, withdrawalType } = req.query;

            if (!amount || !withdrawalType) {
                return res.status(400).json({
                    success: false,
                    message: 'Amount and withdrawal type are required. Use "mobile_money" or "crypto" for withdrawalType.'
                });
            }

            if (!['mobile_money', 'crypto'].includes(withdrawalType as string)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid withdrawal type. Use "mobile_money" or "crypto".'
                });
            }

            const withdrawalAmount = parseFloat(amount as string);
            if (isNaN(withdrawalAmount) || withdrawalAmount <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Amount must be a positive number.'
                });
            }

            const estimation = await paymentService.estimateWithdrawal(
                userId,
                withdrawalAmount,
                withdrawalType as 'crypto' | 'mobile_money'
            );

            return res.status(200).json({
                success: true,
                data: estimation,
                message: 'Withdrawal estimation completed successfully.'
            });

        } catch (error: any) {
            log.error(`Error in estimateWithdrawal: ${error.message}`, error);
            if (error instanceof AppError) {
                return res.status(error.statusCode).json({ success: false, message: error.message });
            }
            return res.status(500).json({
                success: false,
                message: 'Failed to estimate withdrawal'
            });
        }
    }

    /**
     * Verify a withdrawal with verification code
     * @route POST /api/transactions/withdrawal/verify
     */
    async verifyWithdrawal(req: Request, res: Response) {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                return res.status(401).json({ success: false, message: 'User not authenticated' });
            }

            const { transactionId, verificationCode } = req.body;

            if (!transactionId || !verificationCode) {
                return res.status(400).json({
                    success: false,
                    message: 'Transaction ID and verification code are required'
                });
            }

            // Verify and process the withdrawal using transactionId
            const result = await paymentService.verifyWithdrawal(transactionId, verificationCode);

            if (!result.success) {
                // The service will throw AppError for specific failures now.
                // This path might be for unexpected non-AppError failures from service.
                return res.status(400).json({
                    success: false,
                    message: result.transaction?.message || 'Withdrawal verification failed'
                });
            }

            return res.status(200).json({
                success: true,
                transaction: result.transaction,
                message: result.transaction?.message || 'Withdrawal verified and processing.'
            });
        } catch (error: any) {
            log.error(`Error in verifyWithdrawal: ${error.message}`, error);
            if (error instanceof AppError) {
                return res.status(error.statusCode).json({ success: false, message: error.message });
            }
            return res.status(500).json({
                success: false,
                message: 'Failed to verify withdrawal'
            });
        }
    }


    async test(req: Request, res: Response) {
        try {
            const userId = '65d2b0344a7e2b9efbf6205d';

            const transaction = await paymentService.processDeposit(
                userId,
                5000,
                Currency.XAF,
                { provider: 'test', transactionId: 'test' },
                'Test deposit'
            );

            return res.status(200).json({
                success: true,
                message: 'Test successful',
                transaction
            });
        } catch (error: any) {
            log.error(`Error in test: ${error.message}`, error);
            return res.status(500).json({
                success: false,
                message: 'Failed to test'
            });
        }
    }

    /**
     * Process a payment to another user
     * @route POST /api/transactions/payment
     */
    async processPayment(req: Request, res: Response) {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                return res.status(401).json({ success: false, message: 'User not authenticated' });
            }

            const { recipientId, amount, currency, description, metadata } = req.body;

            if (!recipientId || !amount || !currency || !description) {
                return res.status(400).json({
                    success: false,
                    message: 'Recipient ID, amount, currency, and description are required'
                });
            }

            // TODO: Use rabbitmq to check user validation
            const recipientValid = await userServiceClient.validateUser(recipientId); // Assume recipient is valid for now

            if (!recipientValid) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid recipient'
                });
            }

            // Process the payment
            const result = await paymentService.processPayment(
                userId,
                recipientId,
                amount,
                currency as Currency,
                description,
                metadata,
                req.ip,
                req.get('User-Agent')
            );

            return res.status(200).json({
                success: true,
                payment: {
                    transactionId: result.senderTransaction.transactionId,
                    amount,
                    currency,
                    recipientId,
                    status: result.senderTransaction.status
                }
            });
        } catch (error) {
            log.error(`Error in processPayment: ${error}`);

            // Handle specific error cases
            if (error instanceof Error) {
                if (error.message === 'Insufficient balance') {
                    return res.status(400).json({
                        success: false,
                        message: 'Insufficient balance for this payment'
                    });
                }
            }

            return res.status(500).json({
                success: false,
                message: 'Failed to process payment'
            });
        }
    }

    /**
     * Get transaction statistics for the authenticated user
     * @route GET /api/transactions/stats
     */
    async getTransactionStats(req: Request, res: Response) {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                return res.status(401).json({ success: false, message: 'User not authenticated' });
            }

            const stats = await paymentService.getTransactionStats(userId);

            return res.status(200).json({
                success: true,
                stats
            });
        } catch (error) {
            log.error(`Error in getTransactionStats: ${error}`);
            return res.status(500).json({
                success: false,
                message: 'Failed to retrieve transaction statistics'
            });
        }
    }

    /**
     * [ADMIN] List all account transactions (deposits, withdrawals, etc.)
     * @route GET /api/transactions/admin
     * @access Admin
     */
    async adminListAccountTransactions(req: Request, res: Response): Promise<Response> {
        log.info('Admin request: List all account transactions');
        try {
            // Extract query parameters for filtering and pagination
            const {
                page = '1',
                limit = '20',
                status,
                type,
                userSearchTerm, // Use search term instead of direct ID
                startDate,
                endDate,
                minAmount,
                maxAmount,
                currency,
                sortBy = 'createdAt',
                sortOrder = 'desc'
            } = req.query as { [key: string]: string };

            // Construct filter object (pass search term to service)
            const filters: Record<string, any> = {};
            if (status) filters.status = status;
            if (type) filters.type = type;
            if (userSearchTerm) filters.userSearchTerm = userSearchTerm;
            if (currency) filters.currency = currency;

            // Handle Date Range (adjusted to include full end day)
            if (startDate) {
                try {
                    const start = new Date(startDate);
                    start.setHours(0, 0, 0, 0);
                    filters.createdAt = { ...filters.createdAt, $gte: start };
                } catch (e) { log.warn('Invalid start date format:', startDate); }
            }
            if (endDate) {
                try {
                    const end = new Date(endDate);
                    end.setHours(23, 59, 59, 999);
                    filters.createdAt = { ...filters.createdAt, $lte: end };
                } catch (e) { log.warn('Invalid end date format:', endDate); }
            }

            // Handle Amount Range
            const min = parseFloat(minAmount);
            const max = parseFloat(maxAmount);
            if (!isNaN(min) || !isNaN(max)) {
                filters.amount = {};
                if (!isNaN(min)) filters.amount.$gte = min;
                if (!isNaN(max)) filters.amount.$lte = max;
                // Note: This filters on the main 'amount' field which might be negative for withdrawals.
                // If filtering on absolute value is needed, service layer adjustment is required.
            }

            // Construct pagination options
            const options: PaginationOptions = {
                page: parseInt(page, 10),
                limit: parseInt(limit, 10),
                sortBy: sortBy,
                sortOrder: sortOrder as 'asc' | 'desc'
            };
            // Validate pagination
            if (isNaN(options.page) || options.page < 1) options.page = 1;
            if (isNaN(options.limit) || options.limit < 1) options.limit = 20;
            if (options.limit > 100) options.limit = 100; // Max limit

            // Call the service layer method (to be created in paymentService)
            const result = await paymentService.adminGetAllAccountTransactions(filters, options);

            return res.status(200).json({
                success: true,
                message: 'Account transactions retrieved successfully',
                data: result.transactions,
                pagination: result.pagination
            });

        } catch (error) {
            log.error('Error in adminListAccountTransactions:', error);
            if (error instanceof AppError) {
                return res.status(error.statusCode).json({ success: false, message: error.message });
            }
            return res.status(500).json({ success: false, message: 'Failed to retrieve account transactions' });
        }
    }

    /**
     * [NEW] Cancel a pending withdrawal request.
     * @route DELETE /api/transactions/withdrawal/:transactionId/cancel
     */
    async cancelWithdrawal(req: Request, res: Response) {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                return res.status(401).json({ success: false, message: 'User not authenticated' });
            }

            const { transactionId } = req.params;

            if (!transactionId) {
                return res.status(400).json({
                    success: false,
                    message: 'Transaction ID is required to cancel a withdrawal.'
                });
            }

            await paymentService.cancelWithdrawal(userId, transactionId);

            return res.status(200).json({
                success: true,
                message: `Withdrawal request ${transactionId} cancelled successfully.`
            });
        } catch (error: any) {
            log.error(`Error in cancelWithdrawal for transaction ${req.params.transactionId}: ${error.message}`, error);
            if (error instanceof AppError) {
                return res.status(error.statusCode).json({ success: false, message: error.message });
            }
            return res.status(500).json({
                success: false,
                message: 'Failed to cancel withdrawal'
            });
        }
    }
    /**
     * Get conversion transactions for the authenticated user
     * @route GET /api/transactions/conversions
     */
    async getUserConversionTransactions(req: Request, res: Response) {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                return res.status(401).json({ success: false, message: 'User not authenticated' });
            }

            const {
                page = '1',
                limit = '50',
                sortBy = 'createdAt',
                sortOrder = 'desc'
            } = req.query;

            const options: any = {
                type: TransactionType.CONVERSION,
                limit: parseInt(limit as string, 10),
                page: parseInt(page as string, 10),
                sortBy: sortBy as string,
                sortOrder: sortOrder as 'asc' | 'desc',
            };

            const result = await paymentService.getTransactionHistory(userId, options);

            return res.status(200).json({
                success: true,
                data: {
                    transactions: result.transactions,
                    pagination: {
                        page: options.page,
                        limit: options.limit,
                        total: result.total,
                        totalPages: Math.ceil(result.total / options.limit)
                    }
                },
                message: 'Conversion transactions retrieved successfully'
            });
        } catch (error: any) {
            log.error('Error getting user conversion transactions:', error);
            return res.status(500).json({
                success: false,
                message: 'Failed to retrieve conversion transactions'
            });
        }
    }
}

// Export singleton instance
export const transactionController = new TransactionController(); 