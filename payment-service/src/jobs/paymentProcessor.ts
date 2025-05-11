import { TransactionStatus } from '../database/models/transaction.model';
import { PendingStatus } from '../database/models/pending.model';
import transactionRepository from '../database/repositories/transaction.repository';
import pendingRepository from '../database/repositories/pending.repository';
import { userServiceClient } from '../services/clients/user.service.client';
import notificationService from '../services/clients/notification.service.client';
import logger from '../utils/logger';

const log = logger.getLogger('PaymentProcessor');

class PaymentProcessor {
    private running: boolean = false;
    private interval: NodeJS.Timeout | null = null;
    private processingInterval: number = 60000 * 60; // 1 hour by default

    /**
     * Start the payment processor
     */
    start(interval: number = 60000 * 60) {
        if (this.running) {
            log.warn('Payment processor is already running');
            return;
        }

        this.processingInterval = interval;
        this.running = true;

        log.info(`Starting payment processor with interval of ${interval}ms`);

        // Schedule the first processing
        this.interval = setInterval(() => this.processPayments(), this.processingInterval);

        // Immediately run the first processing
        this.processPayments();
    }

    /**
     * Stop the payment processor
     */
    stop() {
        if (!this.running) {
            log.warn('Payment processor is not running');
            return;
        }

        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }

        this.running = false;
        log.info('Payment processor stopped');
    }

    /**
     * Process pending payments
     */
    private async processPayments() {
        try {
            log.info('Running payment processor');

            // Process expired pending transactions
            await this.processExpiredPending();

            // Process pending withdrawals that need to be completed
            await this.processPendingWithdrawals();

            log.info('Payment processor completed');
        } catch (error) {
            log.error(`Error in payment processor: ${error}`);
        }
    }

    /**
     * Process expired pending transactions
     */
    private async processExpiredPending() {
        try {
            // Get expired pending transactions
            const expiredPending = await pendingRepository.findExpired(100);

            if (expiredPending.length === 0) {
                return;
            }

            log.info(`Found ${expiredPending.length} expired pending transactions`);

            // Process each expired pending transaction
            for (const pending of expiredPending) {
                try {
                    // Mark as expired
                    await pendingRepository.updateStatus(pending.pendingId, PendingStatus.EXPIRED);

                    // Send notification
                    await notificationService.sendTransactionNotification(
                        pending.userId.toString(),
                        'transaction_expired',
                        {
                            pendingId: pending.pendingId,
                            amount: pending.amount,
                            currency: pending.currency,
                            transactionType: pending.transactionType
                        }
                    );

                    log.info(`Marked pending transaction ${pending.pendingId} as expired`);
                } catch (error) {
                    log.error(`Error processing expired pending ${pending.pendingId}: ${error}`);
                }
            }
        } catch (error) {
            log.error(`Error processing expired pending transactions: ${error}`);
        }
    }

    /**
     * Process pending withdrawals that need to be completed
     * This is a placeholder for actual withdrawal processing
     * In a real system, you would integrate with payment providers
     */
    private async processPendingWithdrawals() {
        try {
            // Here you would integrate with your payment provider to process withdrawals
            // For this example, we'll simulate the process

            // In a real implementation, you would:
            // 1. Get pending withdrawal transactions from your database
            // 2. Send them to your payment provider
            // 3. Update the transaction status based on the response

            log.info('Processed pending withdrawals');
        } catch (error) {
            log.error(`Error processing pending withdrawals: ${error}`);
        }
    }
}

// Create and export a singleton instance
export const paymentProcessor = new PaymentProcessor();
export default paymentProcessor; 