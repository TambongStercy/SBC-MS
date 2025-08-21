#!/usr/bin/env node

import { Command } from 'commander';
import mongoose from 'mongoose';
import config from '../config';
import logger from '../utils/logger';
import { cinetpayPayoutService } from '../services/cinetpay-payout.service';
import { feexPayPayoutService } from '../services/feexpay-payout.service';
import paymentService from '../services/payment.service';
import { recoverUserTransactionRepository } from '../database/repositories/recover-user-transaction.repository';
import { transactionRepository } from '../database/repositories/transaction.repository';
import { paymentIntentRepository } from '../database/repositories/paymentIntent.repository';
import { userServiceClient } from '../services/clients/user.service.client';
import { 
    RecoveryProvider, 
    RecoveryTransactionType,
    RecoveryStatus 
} from '../database/models/recover-user-transaction.model';
import { PaymentStatus } from '../database/interfaces/IPaymentIntent';
import { TransactionStatus, TransactionType, Currency } from '../database/models/transaction.model';

const log = logger.getLogger('TransactionRecoveryScript');
const program = new Command();

interface RecoveryResult {
    totalProcessed: number;
    successfulRecoveries: number;
    failedRecoveries: number;
    savedToRecoveryCollection: number;
    errors: string[];
    details: Array<{
        reference: string;
        status: 'recovered' | 'saved_for_recovery' | 'error';
        message: string;
        userId?: string;
    }>;
}

class TransactionRecoveryService {
    
    /**
     * Recover transactions from a list of provider transaction references
     */
    async recoverTransactions(
        provider: RecoveryProvider,
        references: string[],
        transactionType: RecoveryTransactionType
    ): Promise<RecoveryResult> {
        const result: RecoveryResult = {
            totalProcessed: 0,
            successfulRecoveries: 0,
            failedRecoveries: 0,
            savedToRecoveryCollection: 0,
            errors: [],
            details: []
        };

        log.info(`Starting recovery of ${references.length} ${transactionType} transactions from ${provider}`);

        for (const reference of references) {
            result.totalProcessed++;
            
            try {
                await this.processTransactionReference(provider, reference, transactionType, result);
            } catch (error: any) {
                const errorMsg = `Failed to process ${reference}: ${error.message}`;
                result.errors.push(errorMsg);
                result.failedRecoveries++;
                result.details.push({
                    reference,
                    status: 'error',
                    message: errorMsg
                });
                log.error(errorMsg, error);
            }
        }

        log.info(`Recovery completed: ${result.successfulRecoveries} recovered, ${result.savedToRecoveryCollection} saved for later, ${result.failedRecoveries} failed`);
        return result;
    }

    /**
     * Process a single transaction reference
     */
    private async processTransactionReference(
        provider: RecoveryProvider,
        reference: string,
        transactionType: RecoveryTransactionType,
        result: RecoveryResult
    ): Promise<void> {
        log.info(`Processing ${provider} ${transactionType} transaction: ${reference}`);

        // Check if already in recovery collection
        const existsInRecovery = await recoverUserTransactionRepository.existsByProviderAndReference(provider, reference);
        if (existsInRecovery) {
            log.info(`Transaction ${reference} already exists in recovery collection`);
            return;
        }

        // Fetch transaction details from provider
        const transactionData = await this.fetchTransactionFromProvider(provider, reference, transactionType);
        
        if (!transactionData) {
            throw new Error(`Transaction not found or failed to fetch from ${provider}`);
        }

        log.info(`Fetched transaction data:`, { reference, amount: transactionData.amount, status: transactionData.status });

        // Only process successful transactions
        if (!this.isSuccessfulTransaction(transactionData.status, provider)) {
            log.info(`Transaction ${reference} is not successful (status: ${transactionData.status}), skipping`);
            return;
        }

        // Check if user exists in database
        const user = await this.findUserByTransactionData(transactionData);
        
        if (user) {
            // User exists - restore transaction directly
            await this.restoreTransactionForExistingUser(provider, reference, transactionType, transactionData, user.id, result);
        } else {
            // User doesn't exist - save to recovery collection
            await this.saveToRecoveryCollection(provider, reference, transactionType, transactionData, result);
        }
    }

    /**
     * Fetch transaction details from the appropriate provider
     */
    private async fetchTransactionFromProvider(
        provider: RecoveryProvider,
        reference: string,
        transactionType: RecoveryTransactionType
    ): Promise<any> {
        switch (provider) {
            case RecoveryProvider.CINETPAY:
                if (transactionType === RecoveryTransactionType.PAYOUT) {
                    return await cinetpayPayoutService.checkPayoutStatus(reference);
                } else {
                    // For CinetPay payments, use transaction ID to check status
                    // The reference would be the cpm_trans_id from CinetPay
                    return await this.fetchCinetPayPaymentStatus(reference);
                }
            
            case RecoveryProvider.FEEXPAY:
                if (transactionType === RecoveryTransactionType.PAYOUT) {
                    return await feexPayPayoutService.checkPayoutStatus(reference);
                } else {
                    // For FeexPay payments, use reference to check status
                    return await this.fetchFeexPayPaymentStatus(reference);
                }
            
            default:
                throw new Error(`Unsupported provider: ${provider}`);
        }
    }

    /**
     * Fetch CinetPay payment status
     */
    private async fetchCinetPayPaymentStatus(transactionId: string): Promise<any> {
        // This would need to be implemented based on CinetPay API
        // For now, return a mock structure that indicates we need the actual implementation
        log.warn(`CinetPay payment status check for ${transactionId} not fully implemented`);
        
        // Mock response structure - replace with actual CinetPay API call
        return {
            transactionId,
            status: 'completed', // This should come from actual API
            amount: 0,
            currency: 'XAF',
            userEmail: null,
            userPhoneNumber: null,
            // Add other fields as needed
        };
    }

    /**
     * Fetch FeexPay payment status
     */
    private async fetchFeexPayPaymentStatus(reference: string): Promise<any> {
        // This would need to be implemented based on FeexPay API
        // For now, return a mock structure that indicates we need the actual implementation
        log.warn(`FeexPay payment status check for ${reference} not fully implemented`);
        
        // Mock response structure - replace with actual FeexPay API call
        return {
            reference,
            status: 'completed', // This should come from actual API
            amount: 0,
            currency: 'XAF',
            userEmail: null,
            userPhoneNumber: null,
            // Add other fields as needed
        };
    }

    /**
     * Check if transaction status indicates success
     */
    private isSuccessfulTransaction(status: string, provider: RecoveryProvider): boolean {
        switch (provider) {
            case RecoveryProvider.CINETPAY:
                return status === 'completed';
            case RecoveryProvider.FEEXPAY:
                return status === 'completed' || status === 'success';
            default:
                return false;
        }
    }

    /**
     * Find user by transaction data (email, phone, or provider user ID)
     */
    private async findUserByTransactionData(transactionData: any): Promise<{ id: string; email?: string; phoneNumber?: string } | null> {
        try {
            // Try to find by email first
            if (transactionData.userEmail || transactionData.recipient_email) {
                const email = transactionData.userEmail || transactionData.recipient_email;
                const user = await userServiceClient.getUserByEmail(email);
                if (user) return user;
            }

            // Try to find by phone number
            if (transactionData.userPhoneNumber || transactionData.recipient || transactionData.phoneNumber) {
                const phone = transactionData.userPhoneNumber || transactionData.recipient || transactionData.phoneNumber;
                const user = await userServiceClient.getUserByPhoneNumber(phone);
                if (user) return user;
            }

            return null;
        } catch (error: any) {
            log.warn(`Error finding user: ${error.message}`);
            return null;
        }
    }

    /**
     * Restore transaction for existing user
     */
    private async restoreTransactionForExistingUser(
        provider: RecoveryProvider,
        reference: string,
        transactionType: RecoveryTransactionType,
        transactionData: any,
        userId: string,
        result: RecoveryResult
    ): Promise<void> {
        try {
            if (transactionType === RecoveryTransactionType.PAYOUT) {
                // Check if transaction already exists
                const existingTransaction = await transactionRepository.findByExternalTransactionId(reference);
                if (existingTransaction) {
                    log.info(`Transaction ${reference} already exists in database`);
                    return;
                }

                // Create withdrawal transaction
                const transaction = await transactionRepository.create({
                    userId: new mongoose.Types.ObjectId(userId),
                    type: TransactionType.WITHDRAWAL,
                    amount: transactionData.amount,
                    currency: this.mapCurrency(transactionData.currency),
                    status: TransactionStatus.COMPLETED,
                    description: `Recovered ${provider} withdrawal`,
                    paymentProvider: {
                        provider,
                        transactionId: reference,
                        status: transactionData.status,
                        metadata: transactionData
                    },
                    externalTransactionId: reference
                });

                // Update user balance (deduct the amount since it was withdrawn)
                await userServiceClient.updateUserBalance(userId, -transactionData.amount);

                // Trigger webhook processing for additional effects
                if (provider === RecoveryProvider.CINETPAY) {
                    await paymentService.processConfirmedPayoutWebhook(transaction.transactionId, transactionData.status, transactionData);
                } else if (provider === RecoveryProvider.FEEXPAY) {
                    await paymentService.processFeexPayPayoutWebhook(transactionData);
                }

                result.successfulRecoveries++;
                result.details.push({
                    reference,
                    status: 'recovered',
                    message: `Withdrawal transaction restored for user ${userId}`,
                    userId
                });

            } else if (transactionType === RecoveryTransactionType.PAYMENT) {
                // Check if payment intent already exists
                const existingIntent = await paymentIntentRepository.findByGatewayPaymentId(provider, reference);
                if (existingIntent) {
                    log.info(`Payment intent ${reference} already exists in database`);
                    return;
                }

                // Create payment intent
                const paymentIntent = await paymentIntentRepository.create({
                    userId,
                    amount: transactionData.amount,
                    currency: this.mapCurrency(transactionData.currency),
                    status: PaymentStatus.COMPLETED,
                    gateway: provider,
                    gatewayPaymentId: reference,
                    gatewayRawResponse: transactionData,
                    paymentType: 'subscription', // Default assumption
                    metadata: { recovered: true }
                });

                // Process as successful payment (activate subscription, share commissions, etc.)
                await paymentService.processSuccessfulPayment(paymentIntent.sessionId);

                result.successfulRecoveries++;
                result.details.push({
                    reference,
                    status: 'recovered',
                    message: `Payment intent restored for user ${userId}`,
                    userId
                });
            }

        } catch (error: any) {
            log.error(`Error restoring transaction ${reference} for user ${userId}:`, error);
            throw error;
        }
    }

    /**
     * Save transaction to recovery collection for later restoration
     */
    private async saveToRecoveryCollection(
        provider: RecoveryProvider,
        reference: string,
        transactionType: RecoveryTransactionType,
        transactionData: any,
        result: RecoveryResult
    ): Promise<void> {
        await recoverUserTransactionRepository.create({
            transactionReference: reference,
            provider,
            transactionType,
            userEmail: transactionData.userEmail || transactionData.recipient_email,
            userPhoneNumber: transactionData.userPhoneNumber || transactionData.recipient || transactionData.phoneNumber,
            userIdFromProvider: transactionData.userId,
            amount: transactionData.amount,
            currency: transactionData.currency || 'XAF',
            status: transactionData.status,
            providerTransactionData: transactionData,
            recoveryStatus: RecoveryStatus.NOT_RESTORED
        });

        result.savedToRecoveryCollection++;
        result.details.push({
            reference,
            status: 'saved_for_recovery',
            message: `Transaction saved to recovery collection (user not found)`
        });

        log.info(`Saved transaction ${reference} to recovery collection`);
    }

    /**
     * Map provider currency to system currency
     */
    private mapCurrency(currency: string): Currency {
        const upperCurrency = currency?.toUpperCase();
        if (Object.values(Currency).includes(upperCurrency as Currency)) {
            return upperCurrency as Currency;
        }
        return Currency.XAF; // Default fallback
    }

    /**
     * Process user registration to restore recoverable transactions
     */
    async processUserRegistration(userId: string, email?: string, phoneNumber?: string): Promise<number> {
        log.info(`Processing user registration for recovery: userId=${userId}, email=${email}, phone=${phoneNumber}`);
        
        const recoverableTransactions = await recoverUserTransactionRepository.findByEmailOrPhoneNotRestored(email, phoneNumber);
        
        if (recoverableTransactions.length === 0) {
            log.info('No recoverable transactions found for this user');
            return 0;
        }

        log.info(`Found ${recoverableTransactions.length} recoverable transactions`);
        
        let restoredCount = 0;
        
        for (const record of recoverableTransactions) {
            try {
                if (record.transactionType === RecoveryTransactionType.PAYOUT) {
                    await this.restoreWithdrawalTransaction(record, userId);
                } else {
                    await this.restorePaymentTransaction(record, userId);
                }
                
                await recoverUserTransactionRepository.markAsRestored(
                    record._id, 
                    new mongoose.Types.ObjectId(userId),
                    record.transactionReference
                );
                
                restoredCount++;
                log.info(`Restored transaction ${record.transactionReference} for user ${userId}`);
                
            } catch (error: any) {
                log.error(`Failed to restore transaction ${record.transactionReference}:`, error);
            }
        }

        // Mark all other transactions for this user as restored
        await recoverUserTransactionRepository.markMultipleAsRestored(
            email, 
            phoneNumber, 
            new mongoose.Types.ObjectId(userId)
        );

        log.info(`Restored ${restoredCount} transactions for user ${userId}`);
        return restoredCount;
    }

    /**
     * Restore withdrawal transaction from recovery record
     */
    private async restoreWithdrawalTransaction(record: any, userId: string): Promise<void> {
        // Check if transaction already exists
        const existingTransaction = await transactionRepository.findByExternalTransactionId(record.transactionReference);
        if (existingTransaction) {
            log.info(`Transaction ${record.transactionReference} already exists`);
            return;
        }

        // Create transaction
        const transaction = await transactionRepository.create({
            userId: new mongoose.Types.ObjectId(userId),
            type: TransactionType.WITHDRAWAL,
            amount: record.amount,
            currency: this.mapCurrency(record.currency),
            status: TransactionStatus.COMPLETED,
            description: `Recovered ${record.provider} withdrawal`,
            paymentProvider: {
                provider: record.provider,
                transactionId: record.transactionReference,
                status: record.status,
                metadata: record.providerTransactionData
            },
            externalTransactionId: record.transactionReference
        });

        // Update user balance
        await userServiceClient.updateUserBalance(userId, -record.amount);
    }

    /**
     * Restore payment transaction from recovery record
     */
    private async restorePaymentTransaction(record: any, userId: string): Promise<void> {
        // Check if payment intent already exists
        const existingIntent = await paymentIntentRepository.findByGatewayPaymentId(record.provider, record.transactionReference);
        if (existingIntent) {
            log.info(`Payment intent ${record.transactionReference} already exists`);
            return;
        }

        // Create payment intent
        const paymentIntent = await paymentIntentRepository.create({
            userId,
            amount: record.amount,
            currency: this.mapCurrency(record.currency),
            status: PaymentStatus.COMPLETED,
            gateway: record.provider,
            gatewayPaymentId: record.transactionReference,
            gatewayRawResponse: record.providerTransactionData,
            paymentType: 'subscription',
            metadata: { recovered: true, originalRecordId: record._id }
        });

        // Process successful payment
        await paymentService.processSuccessfulPayment(paymentIntent.sessionId);
    }
}

async function connectToDatabase(): Promise<void> {
    try {
        await mongoose.connect(config.database.url);
        log.info('Connected to MongoDB');
    } catch (error: any) {
        log.error('Failed to connect to MongoDB:', error);
        process.exit(1);
    }
}

async function disconnectFromDatabase(): Promise<void> {
    await mongoose.disconnect();
    log.info('Disconnected from MongoDB');
}

// CLI Commands
program
    .name('transaction-recovery')
    .description('Recover lost transactions from payment providers')
    .version('1.0.0');

program
    .command('recover')
    .description('Recover transactions from a list of references')
    .requiredOption('-p, --provider <provider>', 'Provider (cinetpay|feexpay)')
    .requiredOption('-t, --type <type>', 'Transaction type (payment|payout)')
    .requiredOption('-r, --references <references>', 'Comma-separated list of transaction references')
    .action(async (options) => {
        await connectToDatabase();
        
        try {
            const references = options.references.split(',').map((r: string) => r.trim());
            const service = new TransactionRecoveryService();
            
            const result = await service.recoverTransactions(
                options.provider as RecoveryProvider,
                references,
                options.type as RecoveryTransactionType
            );
            
            console.log('\nRecovery Results:');
            console.log(`Total Processed: ${result.totalProcessed}`);
            console.log(`Successful Recoveries: ${result.successfulRecoveries}`);
            console.log(`Saved for Later Recovery: ${result.savedToRecoveryCollection}`);
            console.log(`Failed: ${result.failedRecoveries}`);
            
            if (result.errors.length > 0) {
                console.log('\nErrors:');
                result.errors.forEach(error => console.log(`- ${error}`));
            }
            
            console.log('\nDetails:');
            result.details.forEach(detail => {
                console.log(`${detail.reference}: ${detail.status} - ${detail.message}`);
            });
            
        } catch (error: any) {
            log.error('Recovery failed:', error);
            process.exit(1);
        } finally {
            await disconnectFromDatabase();
        }
    });

program
    .command('process-user-registration')
    .description('Process user registration to restore recoverable transactions')
    .requiredOption('-u, --userId <userId>', 'User ID')
    .option('-e, --email <email>', 'User email')
    .option('-p, --phone <phone>', 'User phone number')
    .action(async (options) => {
        await connectToDatabase();
        
        try {
            const service = new TransactionRecoveryService();
            const restoredCount = await service.processUserRegistration(
                options.userId,
                options.email,
                options.phone
            );
            
            console.log(`Restored ${restoredCount} transactions for user ${options.userId}`);
            
        } catch (error: any) {
            log.error('User registration processing failed:', error);
            process.exit(1);
        } finally {
            await disconnectFromDatabase();
        }
    });

program
    .command('stats')
    .description('Show recovery statistics')
    .action(async () => {
        await connectToDatabase();
        
        try {
            const stats = await recoverUserTransactionRepository.getRecoveryStats();
            
            console.log('\nRecovery Statistics:');
            console.log(`Total Records: ${stats.total}`);
            console.log(`Not Restored: ${stats.notRestored}`);
            console.log(`Restored: ${stats.restored}`);
            
            console.log('\nBy Provider:');
            Object.entries(stats.byProvider).forEach(([provider, count]) => {
                console.log(`  ${provider}: ${count}`);
            });
            
            console.log('\nBy Transaction Type:');
            Object.entries(stats.byTransactionType).forEach(([type, count]) => {
                console.log(`  ${type}: ${count}`);
            });
            
        } catch (error: any) {
            log.error('Failed to get stats:', error);
            process.exit(1);
        } finally {
            await disconnectFromDatabase();
        }
    });

// Handle uncaught errors
process.on('unhandledRejection', (error) => {
    log.error('Unhandled rejection:', error);
    process.exit(1);
});

process.on('uncaughtException', (error) => {
    log.error('Uncaught exception:', error);
    process.exit(1);
});

if (require.main === module) {
    program.parse();
}

export { TransactionRecoveryService };