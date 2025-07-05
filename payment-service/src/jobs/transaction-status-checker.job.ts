import cron from 'node-cron';
import logger from '../utils/logger';
import { TransactionType } from '../database/models/transaction.model';
import transactionRepository from '../database/repositories/transaction.repository';
import paymentService from '../services/payment.service';

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
     * Main method to check all processing withdrawal transactions
     */
    private async checkPendingTransactions(): Promise<void> {
        if (this.isRunning) {
            log.warn('Transaction status check already running, skipping this cycle');
            return;
        }

        this.isRunning = true;
        log.info('Starting transaction status check cycle');

        try {
            // Find all withdrawal transactions with processing status
            const processingTransactions = await transactionRepository.findProcessingWithdrawals(100);

            if (processingTransactions.length === 0) {
                log.info('No processing withdrawal transactions found to reconcile.');
                return;
            }

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

            log.info('Transaction status check cycle completed');
        } catch (error) {
            log.error(`Error in transaction status check cycle: ${error}`);
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Triggers the main webhook processing logic for a given withdrawal transaction.
     * This re-uses the server-to-server check and business logic from the payment service.
     */
    private async reconcileWithdrawalStatus(transaction: any): Promise<void> {
        log.info(`Reconciling status for withdrawal transaction ${transaction.transactionId}`);

        try {
            // This job primarily handles withdrawals stuck in processing.
            if (transaction.type !== TransactionType.WITHDRAWAL) {
                log.debug(`Skipping non-withdrawal transaction ${transaction.transactionId} during reconciliation.`);
                return;
            }

            const isCinetPay = transaction.serviceProvider === 'CinetPay';
            if (!isCinetPay) {
                log.debug(`Withdrawal ${transaction.transactionId} not handled by CinetPay, skipping.`);
                return;
            }

            await paymentService.processConfirmedPayoutWebhook(
                transaction.transactionId,
                'Status check by background job',
                { fromJob: true, source: 'TransactionStatusChecker', checkedAt: new Date().toISOString() }
            );

        } catch (error) {
            // The error is already logged inside processConfirmedPayoutWebhook,
            // but we log it here as well to know the source is the job.
            log.error(`Error during reconciliation for transaction ${transaction.transactionId}: ${error}`);
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