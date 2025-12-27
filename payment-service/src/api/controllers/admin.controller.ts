import { Request, Response } from 'express';
import logger from '../../utils/logger';
import { transactionStatusChecker } from '../../jobs/transaction-status-checker.job';
import transactionRepository from '../../database/repositories/transaction.repository';
import paymentService from '../../services/payment.service';
import { withdrawalMonitor } from '../../utils/withdrawal-monitor';
import nowpaymentsService from '../../services/nowpayments.service';
import { cinetpayPayoutService } from '../../services/cinetpay-payout.service';

const log = logger.getLogger('AdminController');

export class AdminController {

    /**
     * Manually trigger transaction status check for all processing withdrawals
     */
    public async checkAllTransactionStatuses(req: Request, res: Response): Promise<void> {
        try {
            log.info('Manual transaction status check triggered via API');

            // Run the check asynchronously
            transactionStatusChecker.runManualCheck()
                .then(() => {
                    log.info('Manual transaction status check completed');
                })
                .catch((error) => {
                    log.error(`Manual transaction status check failed: ${error}`);
                });

            res.status(200).json({
                success: true,
                message: 'Transaction status check initiated. Check logs for results.',
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            log.error(`Error triggering manual transaction status check: ${error}`);
            res.status(500).json({
                success: false,
                message: 'Failed to trigger transaction status check',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Check status of a specific transaction
     */
    public async checkSpecificTransaction(req: Request, res: Response): Promise<void> {
        try {
            const { transactionId } = req.params;

            if (!transactionId) {
                res.status(400).json({
                    success: false,
                    message: 'Transaction ID is required'
                });
                return;
            }

            log.info(`Manual check triggered for transaction ${transactionId}`);

            // Run the check asynchronously
            transactionStatusChecker.checkSpecificTransaction(transactionId)
                .then(() => {
                    log.info(`Manual check completed for transaction ${transactionId}`);
                })
                .catch((error) => {
                    log.error(`Manual check failed for transaction ${transactionId}: ${error}`);
                });

            res.status(200).json({
                success: true,
                message: `Status check initiated for transaction ${transactionId}. Check logs for results.`,
                transactionId,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            log.error(`Error checking specific transaction: ${error}`);
            res.status(500).json({
                success: false,
                message: 'Failed to check transaction status',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Get current stats on processing transactions
     */
    public async getProcessingTransactionsStats(req: Request, res: Response): Promise<void> {
        try {
            const processingTransactions = await transactionRepository.findProcessingWithdrawals(1000);

            // Group by created date for better insights
            const dateGroups: { [key: string]: number } = {};
            const providerGroups: { [key: string]: number } = {};

            processingTransactions.forEach(tx => {
                const dateKey = tx.createdAt.toISOString().split('T')[0];
                dateGroups[dateKey] = (dateGroups[dateKey] || 0) + 1;

                const provider = tx.metadata?.selectedPayoutService || 'unknown';
                providerGroups[provider] = (providerGroups[provider] || 0) + 1;
            });

            res.status(200).json({
                success: true,
                data: {
                    totalProcessing: processingTransactions.length,
                    byDate: dateGroups,
                    byProvider: providerGroups,
                    oldestTransaction: processingTransactions.length > 0 ? {
                        id: processingTransactions[0].transactionId,
                        createdAt: processingTransactions[0].createdAt,
                        amount: processingTransactions[0].amount,
                        currency: processingTransactions[0].currency
                    } : null
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            log.error(`Error getting processing transactions stats: ${error}`);
            res.status(500).json({
                success: false,
                message: 'Failed to get processing transactions statistics',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Get withdrawal service status for monitoring
     */
    public async getWithdrawalServiceStatus(req: Request, res: Response): Promise<void> {
        try {
            const serviceStatus = paymentService.getWithdrawalServiceStatus();
            const blockedStats = withdrawalMonitor.getBlockedAttemptsStats();

            res.status(200).json({
                success: true,
                data: {
                    ...serviceStatus,
                    blockedAttempts: blockedStats
                },
                message: serviceStatus.feexpayWithdrawalsEnabled 
                    ? 'All withdrawal services are operational' 
                    : 'FeexPay withdrawals are currently disabled',
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            log.error(`Error getting withdrawal service status: ${error}`);
            res.status(500).json({
                success: false,
                message: 'Failed to get withdrawal service status',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Get recent blocked withdrawal attempts for monitoring
     */
    public async getBlockedWithdrawalAttempts(req: Request, res: Response): Promise<void> {
        try {
            const limit = parseInt(req.query.limit as string) || 50;
            const recentAttempts = withdrawalMonitor.getRecentBlockedAttempts(limit);

            res.status(200).json({
                success: true,
                data: {
                    attempts: recentAttempts,
                    count: recentAttempts.length,
                    limit: limit
                },
                message: `Retrieved ${recentAttempts.length} recent blocked withdrawal attempts`,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            log.error(`Error getting blocked withdrawal attempts: ${error}`);
            res.status(500).json({
                success: false,
                message: 'Failed to get blocked withdrawal attempts',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Get transaction details by ID
     */
    public async getTransactionDetails(req: Request, res: Response): Promise<void> {
        try {
            const { transactionId } = req.params;

            if (!transactionId) {
                res.status(400).json({
                    success: false,
                    message: 'Transaction ID is required'
                });
                return;
            }

            const transaction = await transactionRepository.findByTransactionId(transactionId);

            if (!transaction) {
                res.status(404).json({
                    success: false,
                    message: 'Transaction not found'
                });
                return;
            }

            res.status(200).json({
                success: true,
                data: {
                    transactionId: transaction.transactionId,
                    status: transaction.status,
                    type: transaction.type,
                    amount: transaction.amount,
                    currency: transaction.currency,
                    createdAt: transaction.createdAt,
                    updatedAt: transaction.updatedAt,
                    paymentProvider: transaction.paymentProvider,
                    metadata: transaction.metadata,
                    externalTransactionId: transaction.externalTransactionId
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            log.error(`Error getting transaction details: ${error}`);
            res.status(500).json({
                success: false,
                message: 'Failed to get transaction details',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    /**
     * Get live gateway balances from payment providers
     * Fetches real-time balances from NOWPayments, CinetPay, and FeexPay (if available)
     */
    public async getGatewayBalances(req: Request, res: Response): Promise<void> {
        try {
            log.info('Fetching live gateway balances...');

            const results: {
                nowpayments: {
                    available: boolean;
                    totalUsd: number;
                    totalPendingUsd: number;
                    balances: Array<{ currency: string; amount: number; pendingAmount: number; usdValue: number }>;
                    error?: string;
                };
                cinetpay: {
                    available: boolean;
                    total: number;
                    available_balance: number;
                    inUse: number;
                    currency: string;
                    error?: string;
                };
                feexpay: {
                    available: boolean;
                    message: string;
                };
                timestamp: string;
            } = {
                nowpayments: {
                    available: false,
                    totalUsd: 0,
                    totalPendingUsd: 0,
                    balances: []
                },
                cinetpay: {
                    available: false,
                    total: 0,
                    available_balance: 0,
                    inUse: 0,
                    currency: 'XAF'
                },
                feexpay: {
                    available: false,
                    message: 'FeexPay does not provide a balance API endpoint'
                },
                timestamp: new Date().toISOString()
            };

            // Fetch NOWPayments balance (with USD conversion)
            try {
                const nowpaymentsBalance = await nowpaymentsService.getTotalUsdBalance();
                results.nowpayments = {
                    available: true,
                    totalUsd: nowpaymentsBalance.totalUsd,
                    totalPendingUsd: nowpaymentsBalance.totalPendingUsd,
                    balances: nowpaymentsBalance.balances
                };
                log.info('NOWPayments balance fetched successfully', {
                    totalUsd: nowpaymentsBalance.totalUsd
                });
            } catch (nowError: any) {
                log.error('Failed to fetch NOWPayments balance:', nowError.message);
                results.nowpayments.error = nowError.message;
            }

            // Fetch CinetPay balance
            try {
                const cinetpayBalance = await cinetpayPayoutService.getBalance();
                results.cinetpay = {
                    available: true,
                    total: cinetpayBalance.total,
                    available_balance: cinetpayBalance.available,
                    inUse: cinetpayBalance.inUse,
                    currency: 'XAF'
                };
                log.info('CinetPay balance fetched successfully', {
                    total: cinetpayBalance.total,
                    available: cinetpayBalance.available
                });
            } catch (cinetError: any) {
                log.error('Failed to fetch CinetPay balance:', cinetError.message);
                results.cinetpay.error = cinetError.message;
            }

            // FeexPay does not have a balance API endpoint
            // The balance can only be checked via their web dashboard

            res.status(200).json({
                success: true,
                data: results,
                message: 'Gateway balances fetched successfully'
            });

        } catch (error) {
            log.error(`Error fetching gateway balances: ${error}`);
            res.status(500).json({
                success: false,
                message: 'Failed to fetch gateway balances',
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
}

export default new AdminController();