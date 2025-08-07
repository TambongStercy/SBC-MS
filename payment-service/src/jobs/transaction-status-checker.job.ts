import cron from 'node-cron';
import logger from '../utils/logger';
import { TransactionType } from '../database/models/transaction.model';
import transactionRepository from '../database/repositories/transaction.repository';
import paymentService from '../services/payment.service';
import { feexPayPayoutService } from '../services/feexpay-payout.service'; // Import FeexPay service

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

            // 2. Find all withdrawal transactions with processing status
            const processingTransactions = await transactionRepository.findProcessingWithdrawals(100);

            if (processingTransactions.length === 0) {
                log.info('No processing withdrawal transactions found to reconcile.');
            } else {
                log.info(`Found ${processingTransactions.length} processing withdrawal transactions to reconcile`);

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
            const serviceProvider = transaction.metadata?.selectedPayoutService;

            if (!serviceProvider) {
                log.warn(`Cannot determine service provider for transaction ${transaction.transactionId}. Skipping.`);
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