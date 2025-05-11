import { Request, Response } from 'express';
import { Types } from 'mongoose';
import paymentService from '../../services/payment.service';
import { userServiceClient } from '../../services/clients/user.service.client';
import { TransactionType, Currency } from '../../database/models/transaction.model';
import logger from '../../utils/logger';
import { AppError } from '../../utils/errors';
import { PaginationOptions } from '../../types/pagination';

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
                limit = '50', skip = '0',
                sortBy = 'createdAt', sortOrder = 'desc'
            } = req.query;

            // Convert and validate query params
            const options: any = {
                limit: parseInt(limit as string, 10),
                skip: parseInt(skip as string, 10),
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

            const { amount, currency, paymentMethod } = req.body;

            if (!amount || !currency || !paymentMethod) {
                return res.status(400).json({
                    success: false,
                    message: 'Amount, currency, and payment method are required'
                });
            }

            // TODO: Generate a session or redirect URL for the payment gateway
            // This is a placeholder for the actual payment gateway integration
            const depositSession = {
                sessionId: `session_${Date.now()}`,
                amount,
                currency,
                paymentUrl: `https://payment-gateway.com/pay?session=${Date.now()}&amount=${amount}`,
                expiresAt: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes
            };

            return res.status(200).json({
                success: true,
                depositSession
            });
        } catch (error) {
            log.error(`Error in initiateDeposit: ${error}`);
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
            const { userId, amount, currency, transactionId, status, metadata } = req.body;

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
                        provider: 'payment_gateway_name',
                        transactionId,
                        metadata
                    },
                    req.ip as string
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
        } catch (error) {
            log.error(`Error in processDepositCallback: ${error}`);
            return res.status(500).json({
                success: false,
                message: 'Failed to process deposit callback'
            });
        }
    }

    /**
     * Initiate a withdrawal transaction
     * @route POST /api/transactions/withdrawal/initiate
     */
    async initiateWithdrawal(req: Request, res: Response) {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                return res.status(401).json({ success: false, message: 'User not authenticated' });
            }

            const { amount, currency, method, accountInfo } = req.body;

            if (!amount || !currency || !method || !accountInfo) {
                return res.status(400).json({
                    success: false,
                    message: 'Amount, currency, method, and account information are required'
                });
            }

            // TODO: Use rabbitmq to check withdrawal limits
            const limitCheck = await userServiceClient.checkWithdrawalLimits(userId, amount);

            if (!limitCheck.allowed) {
                return res.status(400).json({
                    success: false,
                    message: limitCheck.reason || 'Withdrawal limit exceeded'
                });
            }

            // Initiate the withdrawal process
            const withdrawal = await paymentService.initiateWithdrawal(
                userId,
                amount,
                currency as Currency,
                { method, accountInfo },
                req.ip,
                req.get('User-Agent')
            );

            return res.status(200).json({
                success: true,
                withdrawal
            });
        } catch (error) {
            log.error(`Error in initiateWithdrawal: ${error}`);

            // Handle specific error cases
            if (error instanceof Error) {
                if (error.message === 'Insufficient balance') {
                    return res.status(400).json({
                        success: false,
                        message: 'Insufficient balance for this withdrawal'
                    });
                }
            }

            return res.status(500).json({
                success: false,
                message: 'Failed to initiate withdrawal'
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

            const { pendingId, verificationCode } = req.body;

            if (!pendingId || !verificationCode) {
                return res.status(400).json({
                    success: false,
                    message: 'Pending ID and verification code are required'
                });
            }

            // Verify and process the withdrawal
            const result = await paymentService.verifyWithdrawal(pendingId, verificationCode);

            if (!result.success) {
                return res.status(400).json({
                    success: false,
                    message: result.message
                });
            }

            return res.status(200).json({
                success: true,
                transaction: result.transaction
            });
        } catch (error) {
            log.error(`Error in verifyWithdrawal: ${error}`);
            return res.status(500).json({
                success: false,
                message: 'Failed to verify withdrawal'
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
}

// Export singleton instance
export const transactionController = new TransactionController(); 