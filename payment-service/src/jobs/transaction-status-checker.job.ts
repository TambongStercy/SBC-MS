import cron from 'node-cron';
import logger from '../utils/logger';
import TransactionModel, { TransactionType, TransactionStatus } from '../database/models/transaction.model';
import transactionRepository from '../database/repositories/transaction.repository';
import paymentService from '../services/payment.service';
import { feexPayPayoutService } from '../services/feexpay-payout.service'; // Import FeexPay service
import nowPaymentsService from '../services/nowpayments.service'; // Import NOWPayments service

const log = logger.getLogger('TransactionStatusChecker');

export class TransactionStatusChecker {
    private isRunning = false;
    private cronJob: any = null;

    constructor() {
        // Schedule to run every 5 minutes
        this.cronJob = cron.schedule('*/5 * * * *', async () => {
            await this.checkPendingTransactions();
        }, {
            name: 'transaction-status-checker'
        });
        // We will start it manually from the server to control startup sequence
        this.cronJob.stop();
    }

    /**
     * Start the background job and run an initial check
     */
    public start(): void {
        if (this.cronJob && !this.cronJob.running) {
            this.cronJob.start();
            log.info('Transaction status checker started - runs every 5 minutes');
            // Run an initial check immediately on start
            this.checkPendingTransactions().catch(err => {
                log.error('Error during initial transaction status check:', err);
            });
        }
    }

    /**
     * Stop the background job
     */
    public stop(): void {
        if (this.cronJob && this.cronJob.running) {
            this.cronJob.stop();
            log.info('Transaction status checker stopped');
        }
    }

    /**
     * Main method to check all processing withdrawal transactions and stale OTP verifications
     */
    private async checkPendingTransactions(): Promise<void> {
        if (this.isRunning) {
            log.warn('Transaction status check already running, skipping this cycle');
            return;
        }

        this.isRunning = true;
        log.info('Starting transaction status check cycle');

        try {
            // 1. Check and cancel stale OTP verification withdrawals
            await this.checkStaleOtpVerifications();

            // 2. Auto-expire pending withdrawals older than 24 hours
            await this.autoExpireOldWithdrawals();

            // 3. Find all withdrawal transactions with pending or processing status
            const processingTransactions = await transactionRepository.findProcessingWithdrawals(100);

            if (processingTransactions.length === 0) {
                log.info('No pending/processing withdrawal transactions found to reconcile.');
            } else {
                log.info(`Found ${processingTransactions.length} pending/processing withdrawal transactions to reconcile`);

                // Process each transaction
                for (const transaction of processingTransactions) {
                    try {
                        await this.reconcileWithdrawalStatus(transaction);
                        // Add small delay between API calls to be respectful
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    } catch (error) {
                        log.error(`Error reconciling status for transaction ${transaction.transactionId}: ${error}`);
                        // Continue with next transaction even if one fails
                    }
                }
            }

            log.info('Transaction status check cycle completed');
        } catch (error) {
            log.error(`Error in transaction status check cycle: ${error}`);
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Checks for and cancels withdrawal transactions stuck in PENDING_OTP_VERIFICATION
     * status for more than 20 minutes.
     */
    private async checkStaleOtpVerifications(): Promise<void> {
        try {
            log.info('Checking for stale OTP verification withdrawals...');
            const result = await paymentService.systemCancelStaleWithdrawals();
            if (result.cancelledCount > 0) {
                log.info(`Cancelled ${result.cancelledCount} stale OTP verification withdrawals.`);
            } else {
                log.debug('No stale OTP verification withdrawals found.');
            }
        } catch (error) {
            log.error('Error checking stale OTP verifications:', error);
        }
    }

    /**
     * Auto-expires pending withdrawal transactions that are older than 24 hours.
     * This includes both PENDING and PENDING_ADMIN_APPROVAL statuses.
     *
     * NOTE: No balance refund is needed because user balance is only debited
     * when the payment provider confirms successful payout via webhook.
     */
    private async autoExpireOldWithdrawals(): Promise<void> {
        try {
            log.info('Checking for pending withdrawals older than 24 hours...');

            const twentyFourHoursAgo = new Date();
            twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

            // Find all PENDING or PENDING_ADMIN_APPROVAL withdrawals older than 24 hours
            const expiredWithdrawals = await TransactionModel.find({
                type: TransactionType.WITHDRAWAL,
                status: { $in: [TransactionStatus.PENDING, TransactionStatus.PENDING_ADMIN_APPROVAL] },
                createdAt: { $lt: twentyFourHoursAgo },
                deleted: { $ne: true }
            }).lean();

            if (expiredWithdrawals.length === 0) {
                log.debug('No expired pending withdrawals found.');
                return;
            }

            log.info(`Found ${expiredWithdrawals.length} pending withdrawals older than 24 hours. Auto-expiring...`);

            let expiredCount = 0;
            let failedCount = 0;

            for (const withdrawal of expiredWithdrawals) {
                try {
                    const hoursOld = Math.floor((Date.now() - new Date(withdrawal.createdAt).getTime()) / (1000 * 60 * 60));
                    const previousStatus = withdrawal.status;

                    // Use EXPIRED status - no balance refund needed since balance
                    // is only debited when payment provider confirms success
                    await transactionRepository.updateStatus(
                        withdrawal.transactionId,
                        TransactionStatus.EXPIRED,
                        {
                            metadata: {
                                ...(withdrawal.metadata || {}),
                                expirationReason: `Auto-expired: Approval window expired after ${hoursOld} hours (24 hour limit)`,
                                previousStatus: previousStatus,
                                autoExpiredAt: new Date(),
                                autoExpired: true
                            }
                        }
                    );

                    log.info(`Auto-expired withdrawal ${withdrawal.transactionId} for user ${withdrawal.userId} (was ${previousStatus}, ${hoursOld} hours old). No balance changes.`);
                    expiredCount++;

                } catch (error) {
                    log.error(`Error auto-expiring withdrawal ${withdrawal.transactionId}:`, error);
                    failedCount++;
                }
            }

            log.info(`Auto-expiration complete: ${expiredCount} expired, ${failedCount} failed`);

        } catch (error) {
            log.error('Error in autoExpireOldWithdrawals:', error);
        }
    }

    /**
     * Triggers the main webhook processing logic for a given withdrawal transaction.
     * This re-uses the server-to-server check and business logic from the payment service.
     */
    private async reconcileWithdrawalStatus(transaction: any): Promise<void> {
        log.info(`Reconciling status for withdrawal transaction ${transaction.transactionId}`);

        try {
            if (transaction.type !== TransactionType.WITHDRAWAL) {
                log.debug(`Skipping non-withdrawal transaction ${transaction.transactionId}.`);
                return;
            }

            // Determine the payout service provider from transaction metadata
            // Check multiple possible field names for service provider
            const serviceProvider = transaction.metadata?.selectedPayoutService ||
                                  transaction.metadata?.serviceProvider ||
                                  transaction.metadata?.payoutMethod;

            if (!serviceProvider) {
                log.warn(`Cannot determine service provider for transaction ${transaction.transactionId}. Metadata: ${JSON.stringify(transaction.metadata)}. Skipping.`);
                return;
            }

            log.info(`Transaction ${transaction.transactionId} was processed by ${serviceProvider}.`);

            switch (serviceProvider) {
                case 'CinetPay':
                    await this.reconcileCinetPayTransaction(transaction);
                    break;

                case 'FeexPay':
                    await this.reconcileFeexPayTransaction(transaction);
                    break;

                case 'nowpayments':
                case 'NOWPayments':
                    await this.reconcileNOWPaymentsTransaction(transaction);
                    break;

                default:
                    log.warn(`Unknown service provider '${serviceProvider}' for transaction ${transaction.transactionId}.`);
                    break;
            }

        } catch (error) {
            log.error(`Error during reconciliation for transaction ${transaction.transactionId}: ${error}`);
        }
    }

    /**
     * Reconciles a transaction handled by CinetPay.
     */
    private async reconcileCinetPayTransaction(transaction: any): Promise<void> {
        log.info(`Reconciling CinetPay transaction ${transaction.transactionId}...`);
        // Use the existing webhook processing logic which checks status with CinetPay
        await paymentService.processConfirmedPayoutWebhook(
            transaction.transactionId,
            'Status check by background job',
            { fromJob: true, source: 'TransactionStatusChecker' }
        );
    }

    /**
     * Reconciles a transaction handled by FeexPay.
     */
    private async reconcileFeexPayTransaction(transaction: any): Promise<void> {
        log.info(`Reconciling FeexPay transaction ${transaction.transactionId}...`);
        // CORRECTED: The FeexPay reference is stored in the `externalTransactionId` field.
        const feexpayReference = transaction.externalTransactionId;

        if (!feexpayReference) {
            log.error(`FeexPay reference not found for transaction ${transaction.transactionId}. Cannot check status.`);
            return;
        }

        try {
            const currentStatus = transaction.status;
            const feexpayStatus = await feexPayPayoutService.checkPayoutStatus(feexpayReference);

            // If the status from FeexPay is different from our DB status, update it.
            if (feexpayStatus.status !== currentStatus) {
                log.info(`Status for FeexPay transaction ${transaction.transactionId} has changed from '${currentStatus}' to '${feexpayStatus.status}'. Updating...`);

                // Call a new method in PaymentService to handle the update
                await paymentService.handleFeexPayStatusUpdate({
                    internalTransactionId: transaction.transactionId,
                    feexpayReference: feexpayReference,
                    newStatus: feexpayStatus.status,
                    amount: transaction.amount, // The gross amount debited
                    comment: `Status updated to ${feexpayStatus.status} by background job. Original comment: ${feexpayStatus.comment}`
                });

            } else {
                log.info(`FeexPay transaction ${transaction.transactionId} status is still '${currentStatus}'. No update needed.`);
            }
        } catch (error) {
            log.error(`Failed to check or update status for FeexPay transaction ${transaction.transactionId}:`, error);
        }
    }

    /**
     * Reconciles a transaction handled by NOWPayments.
     */
    private async reconcileNOWPaymentsTransaction(transaction: any): Promise<void> {
        log.info(`Reconciling NOWPayments transaction ${transaction.transactionId}...`);

        // The NOWPayments payout ID is stored in the externalTransactionId field
        const nowpaymentsPayoutId = transaction.externalTransactionId;

        if (!nowpaymentsPayoutId) {
            log.error(`NOWPayments payout ID not found for transaction ${transaction.transactionId}. Cannot check status.`);
            return;
        }

        try {
            const currentStatus = transaction.status;

            // Get current status from NOWPayments
            const nowpaymentsStatus = await nowPaymentsService.getPayoutStatus(nowpaymentsPayoutId);

            log.debug(`NOWPayments status response for transaction ${transaction.transactionId}:`, {
                nowpaymentsStatus,
                statusField: nowpaymentsStatus.status,
                hasStatus: 'status' in nowpaymentsStatus
            });

            // Map NOWPayments status to our internal status
            const newInternalStatus = nowPaymentsService.mapPayoutStatusToInternal(nowpaymentsStatus.status);

            // If the status from NOWPayments is different from our DB status, update it
            if (newInternalStatus !== currentStatus) {
                log.info(`Status for NOWPayments transaction ${transaction.transactionId} has changed from '${currentStatus}' to '${newInternalStatus}'. Updating...`);

                // Process the status update through the existing webhook handler
                // Use the correct NOWPayments API response structure
                await paymentService.handleNowPaymentsPayoutWebhook({
                    id: nowpaymentsStatus.id,
                    address: nowpaymentsStatus.address,
                    currency: nowpaymentsStatus.currency,
                    amount: nowpaymentsStatus.amount,
                    batch_withdrawal_id: nowpaymentsStatus.batch_withdrawal_id,
                    status: nowpaymentsStatus.status,
                    extra_id: nowpaymentsStatus.extra_id,
                    hash: nowpaymentsStatus.hash,
                    error: nowpaymentsStatus.error,
                    is_request_payouts: nowpaymentsStatus.is_request_payouts,
                    ipn_callback_url: nowpaymentsStatus.ipn_callback_url,
                    unique_external_id: nowpaymentsStatus.unique_external_id,
                    payout_description: nowpaymentsStatus.payout_description,
                    created_at: nowpaymentsStatus.created_at,
                    requested_at: nowpaymentsStatus.requested_at,
                    updated_at: nowpaymentsStatus.updated_at
                });

                log.info(`Successfully updated NOWPayments transaction ${transaction.transactionId} status to ${newInternalStatus}`);
            } else {
                log.info(`NOWPayments transaction ${transaction.transactionId} status is still '${currentStatus}'. No update needed.`);
            }
        } catch (error) {
            log.error(`Failed to check or update status for NOWPayments transaction ${transaction.transactionId}:`, error);

            // If it's a network error, don't mark as failed - just log and retry next cycle
            if (error && typeof error === 'object' && 'code' in error) {
                const errorCode = (error as any).code;
                if (errorCode === 'ENOTFOUND' || errorCode === 'ECONNREFUSED' || errorCode === 'ETIMEDOUT') {
                    log.warn(`Network error checking NOWPayments status for ${transaction.transactionId}. Will retry next cycle.`);
                }
            }
        }
    }

    /**
     * Manually triggers a check of all pending withdrawal transactions.
     */
    public async runManualCheck(): Promise<void> {
        await this.checkPendingTransactions();
    }

    /**
     * Manually checks a specific transaction.
     */
    public async checkSpecificTransaction(transactionId: string): Promise<void> {
        log.info(`Manual check for specific transaction: ${transactionId}`);
        const transaction = await transactionRepository.findByTransactionId(transactionId);
        if (transaction) {
            await this.reconcileWithdrawalStatus(transaction);
        } else {
            log.warn(`Manual check: Transaction ${transactionId} not found.`);
        }
    }
}

// Export singleton instance
export const transactionStatusChecker = new TransactionStatusChecker();
export default transactionStatusChecker;