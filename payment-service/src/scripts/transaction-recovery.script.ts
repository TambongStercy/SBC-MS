#!/usr/bin/env node

import { Command } from 'commander';
import mongoose from 'mongoose';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import config from '../config';
import logger from '../utils/logger';
import { cinetpayPayoutService } from '../services/cinetpay-payout.service';
import { feexPayPayoutService } from '../services/feexpay-payout.service';
import paymentService from '../services/payment.service';
import { recoverUserTransactionRepository } from '../database/repositories/recover-user-transaction.repository';
import { transactionRepository } from '../database/repositories/transaction.repository';
import { paymentIntentRepository } from '../database/repositories/paymentIntent.repository';
import TransactionModel from '../database/models/transaction.model';
import PaymentIntentModel from '../database/models/PaymentIntent';
import { userServiceClient } from '../services/clients/user.service.client';
import { getCountryCodeFromPhoneNumber } from '../utils/operatorMaps';
import { 
    RecoveryProvider, 
    RecoveryTransactionType,
    RecoveryStatus 
} from '../database/models/recover-user-transaction.model';
import { PaymentStatus, PaymentGateway } from '../database/interfaces/IPaymentIntent';
import { TransactionStatus, TransactionType, Currency } from '../database/models/transaction.model';

const log = logger.getLogger('TransactionRecoveryScript');
const program = new Command();

interface RecoveryResult {
    totalProcessed: number;
    successfulRecoveries: number;
    failedRecoveries: number;
    savedToRecoveryCollection: number;
    timeoutErrors: number;
    webhookProcessingSucceeded: number;
    webhookProcessingFailed: number;
    errors: string[];
    timeoutReferences: string[];
    details: Array<{
        reference: string;
        status: 'recovered' | 'saved_for_recovery' | 'error' | 'skipped' | 'timeout';
        message: string;
        userId?: string;
        webhookProcessed?: boolean;
        webhookError?: string;
    }>;
}

class TransactionRecoveryService {
    
    /**
     * Read transaction references from CSV file
     */
    async readReferencesFromCSV(filePath: string): Promise<string[]> {
        try {
            log.info(`Reading references from CSV file: ${filePath}`);
            
            if (!fs.existsSync(filePath)) {
                throw new Error(`CSV file not found: ${filePath}`);
            }

            const fileContent = fs.readFileSync(filePath, 'utf-8');
            const lines = fileContent.split('\n').map(line => line.trim()).filter(line => line);
            
            // Skip header if it exists (check if first line contains 'reference')
            const startIndex = lines[0]?.toLowerCase().includes('reference') ? 1 : 0;
            const references = lines.slice(startIndex).filter(ref => ref && ref.length > 0);
            
            log.info(`Found ${references.length} references in CSV file`);
            return references;
            
        } catch (error: any) {
            log.error(`Error reading CSV file: ${error.message}`);
            throw error;
        }
    }

    /**
     * Parse CinetPay CSV row based on transaction type
     */
    private parseCinetPayCSVRow(row: string, isPayment: boolean): any {
        // Remove quotes and split by semicolon
        const values = row.split(';').map(val => val.replace(/^"|"$/g, ''));
        
        if (isPayment) {
            // Payment CSV: "Date Creation";"ID transaction";"Cpm Custom";"Téléphone";"Opérateur";"Montant Payé";"Dévise";"Service";"Statut";"Commentaire";"ID Operator";"Commission"
            return {
                dateCreation: values[0],
                transactionId: values[1],
                cpmCustom: values[2],
                phoneNumber: values[3],
                operator: values[4],
                amount: parseFloat(values[5]) || 0,
                currency: values[6],
                service: values[7],
                status: values[8],
                comment: values[9],
                operatorId: values[10],
                commission: values[11],
                transactionType: RecoveryTransactionType.PAYMENT
            };
        } else {
            // Payout CSV: "Date Création (GMT)";"Date Modification";"Date de traitement";"ID CinetPay";"ID Marchand";"ID Operateur";"Téléphone";"Opérateur";"Montant Envoyé";"Marchand verifié ?";"Statut";"Commentaire"
            return {
                dateCreation: values[0],
                dateModification: values[1],
                dateTraitement: values[2],
                cinetpayId: values[3],
                merchantId: values[4],
                operatorId: values[5],
                phoneNumber: values[6],
                operator: values[7],
                amount: parseFloat(values[8]) || 0,
                merchantVerified: values[9],
                status: values[10],
                comment: values[11],
                transactionType: RecoveryTransactionType.PAYOUT
            };
        }
    }

    /**
     * Map CinetPay operator to country code
     */
    private mapOperatorToCountry(operator: string): string {
        const operatorCountryMap: { [key: string]: string } = {
            // Cameroon
            'MTNCM': 'CM',
            'OMCM': 'CM',
            
            // Togo
            'TMONEYTG': 'TG',
            'FLOOZTG': 'TG',
            
            // Ghana
            'MOMO': 'GH',
            
            // Burkina Faso
            'OMBF': 'BF',
            'MOOVBF': 'BF',
            
            // Côte d'Ivoire
            'OMCI': 'CI',
            'WAVECI': 'CI',
            
            // Senegal
            'WAVESN': 'SN',
            'OMSN': 'SN'
        };
        
        return operatorCountryMap[operator] || 'UNKNOWN';
    }

    /**
     * Normalize phone number for better matching
     */
    private normalizePhoneNumber(phoneNumber: string, countryCode: string): string {
        if (!phoneNumber) return '';
        
        // Remove all non-digit characters
        const digits = phoneNumber.replace(/\D/g, '');
        
        // Add country prefixes if missing
        const countryPrefixes: { [key: string]: string } = {
            'CM': '237',
            'TG': '228', 
            'GH': '233',
            'BF': '226',
            'CI': '225',
            'SN': '221'
        };
        
        const prefix = countryPrefixes[countryCode];
        if (prefix && !digits.startsWith(prefix) && digits.length >= 8) {
            return prefix + digits;
        }
        
        return digits;
    }

    /**
     * Read and parse CinetPay CSV export file
     */
    async readCinetPayCSV(filePath: string, isPayment: boolean): Promise<any[]> {
        try {
            log.info(`Reading CinetPay ${isPayment ? 'payment' : 'payout'} CSV file: ${filePath}`);
            
            if (!fs.existsSync(filePath)) {
                throw new Error(`CSV file not found: ${filePath}`);
            }

            const fileContent = fs.readFileSync(filePath, 'utf-8');
            const lines = fileContent.split('\n').map(line => line.trim()).filter(line => line);
            
            // Skip header (first line)
            const dataLines = lines.slice(1);
            const transactions = [];
            
            for (const line of dataLines) {
                if (line) {
                    const parsed = this.parseCinetPayCSVRow(line, isPayment);
                    
                    // Only process successful transactions
                    if (this.isCinetPayTransactionSuccessful(parsed.status)) {
                        // Add normalized phone number and country
                        const country = this.mapOperatorToCountry(parsed.operator);
                        parsed.country = country;
                        parsed.normalizedPhone = this.normalizePhoneNumber(parsed.phoneNumber, country);
                        
                        transactions.push(parsed);
                    }
                }
            }
            
            log.info(`Found ${transactions.length} successful transactions in CinetPay CSV`);
            return transactions;
            
        } catch (error: any) {
            log.error(`Error reading CinetPay CSV file: ${error.message}`);
            throw error;
        }
    }

    /**
     * Check if CinetPay transaction status indicates success
     */
    private isCinetPayTransactionSuccessful(status: string): boolean {
        const successStatuses = ['ACCEPTED', 'VAL', 'SUCCES'];
        return successStatuses.includes(status.toUpperCase());
    }

    /**
     * Recover CinetPay transactions from CSV export file
     */
    async recoverFromCinetPayCSV(filePath: string, isPayment: boolean, triggerWebhooks: boolean = false): Promise<RecoveryResult> {
        const result: RecoveryResult = {
            totalProcessed: 0,
            successfulRecoveries: 0,
            failedRecoveries: 0,
            savedToRecoveryCollection: 0,
            timeoutErrors: 0,
            webhookProcessingSucceeded: 0,
            webhookProcessingFailed: 0,
            errors: [],
            timeoutReferences: [],
            details: []
        };

        log.info(`Starting CinetPay CSV recovery from ${filePath} (${isPayment ? 'payments' : 'payouts'})`);

        // Validate service dependencies if webhook processing is enabled
        if (triggerWebhooks) {
            log.info('Webhook processing enabled, validating service dependencies...');
            const serviceStatus = await this.validateServiceDependencies();
            
            if (!serviceStatus.userService) {
                const warning = 'User service is not accessible - webhook processing may fail';
                log.warn(warning);
                result.errors.push(warning);
            } else {
                log.info('User service is accessible ✓');
            }
            
            if (!serviceStatus.notificationService) {
                log.warn('Notification service is not accessible - commission notifications may not be sent');
            } else {
                log.info('Notification service is accessible ✓');
            }
        }

        try {
            const transactions = await this.readCinetPayCSV(filePath, isPayment);
            
            for (const transaction of transactions) {
                result.totalProcessed++;
                
                try {
                    await this.processCinetPayCSVTransaction(transaction, result, triggerWebhooks);
                } catch (error: any) {
                    const errorMsg = `Failed to process CinetPay ${transaction.transactionId || transaction.merchantId}: ${error.message}`;
                    result.errors.push(errorMsg);
                    result.failedRecoveries++;
                    result.details.push({
                        reference: transaction.transactionId || transaction.merchantId,
                        status: 'error',
                        message: errorMsg
                    });
                    log.error(errorMsg, error);
                }
            }

            log.info(`CinetPay CSV recovery completed: ${result.successfulRecoveries} recovered, ${result.savedToRecoveryCollection} saved for later, ${result.failedRecoveries} failed`);
            return result;
            
        } catch (error: any) {
            log.error(`Error processing CinetPay CSV file: ${error.message}`);
            throw error;
        }
    }

    /**
     * Process a single CinetPay CSV transaction
     */
    private async processCinetPayCSVTransaction(transaction: any, result: RecoveryResult, triggerWebhooks: boolean = false): Promise<void> {
        const reference = transaction.transactionId || transaction.merchantId;
        log.info(`Processing CinetPay CSV transaction: ${reference}`);

        // Check if already in recovery collection
        const existsInRecovery = await recoverUserTransactionRepository.existsByProviderAndReference(
            RecoveryProvider.CINETPAY, 
            reference
        );
        if (existsInRecovery) {
            log.info(`Transaction ${reference} already exists in recovery collection`);
            return;
        }

        // Create standardized transaction data
        const transactionData = this.standardizeCinetPayCSVData(transaction);

        // Check if user exists in database
        const user = await this.findUserByTransactionData(transactionData);
        
        if (user) {
            // User exists - restore transaction directly
            await this.restoreTransactionForExistingUser(
                RecoveryProvider.CINETPAY, 
                reference, 
                transaction.transactionType, 
                transactionData, 
                user.id, 
                result,
                triggerWebhooks
            );
        } else {
            // User doesn't exist - save to recovery collection
            await this.saveToRecoveryCollection(
                RecoveryProvider.CINETPAY, 
                reference, 
                transaction.transactionType, 
                transactionData, 
                result
            );
        }
    }

    /**
     * Map CinetPay amount with fees to actual subscription amount and subscription type
     */
    private mapCinetPayAmountToSubscriptionAmount(amount: number): { actualAmount: number; subscriptionType: string; subscriptionPlan: string } {
        switch (amount) {
            case 2142:
                return { actualAmount: 2070, subscriptionType: 'CLASSIQUE', subscriptionPlan: 'classique_monthly' };
            case 5320:
                return { actualAmount: 5140, subscriptionType: 'CIBLE', subscriptionPlan: 'cible_monthly' };
            case 3177:
                return { actualAmount: 3070, subscriptionType: 'UPGRADE', subscriptionPlan: 'upgrade_plan' };
            default:
                // Return the original amount if no mapping found
                log.warn(`No CinetPay amount mapping found for amount: ${amount}, using original amount`);
                return { actualAmount: amount, subscriptionType: 'UNKNOWN', subscriptionPlan: 'unknown_plan' };
        }
    }

    /**
     * Extract country code from operator and phone information
     */
    private extractCountryCode(transaction: any): string {
        // First try to get from country field if already mapped (but only if it's not empty/unknown)
        if (transaction.country && transaction.country !== 'N/A' && transaction.country !== 'Unknown' && transaction.country !== '') {
            return transaction.country;
        }
        
        // For FeexPay transactions, try to map from phone number
        if (transaction.phoneNumber) {
            const countryFromPhone = getCountryCodeFromPhoneNumber(transaction.phoneNumber);
            if (countryFromPhone) {
                log.info(`Mapped FeexPay phone number ${transaction.phoneNumber} to country: ${countryFromPhone}`);
                return countryFromPhone;
            }
        }
        
        // Fallback: Map operator to country code
        const countryFromOperator = this.mapOperatorToCountry(transaction.operator);
        if (countryFromOperator) {
            return countryFromOperator;
        }
        
        // Last resort: default to Cameroon
        log.warn(`Could not determine country for transaction, defaulting to CM`);
        return 'CM';
    }

    /**
     * Get subscription features based on subscription type
     */
    private getSubscriptionFeatures(subscriptionType: string): string[] {
        switch (subscriptionType) {
            case 'CLASSIQUE':
                return ['basic_access', 'standard_features', 'limited_support'];
            case 'CIBLE':
                return ['premium_access', 'advanced_features', 'priority_support', 'targeting_tools'];
            case 'UPGRADE':
                return ['upgrade_benefits', 'additional_features', 'enhanced_support'];
            default:
                return ['unknown_features'];
        }
    }

    /**
     * Calculate withdrawal details including fee and description
     */
    private calculateWithdrawalDetails(transactionData: any, provider: RecoveryProvider): {
        grossAmount: number;
        netAmount: number;
        fee: number;
        description: string;
    } {
        const amount = transactionData.amount;
        
        // Standard fee calculation (can be adjusted based on provider specifics)
        const fee = provider === RecoveryProvider.CINETPAY ? 50 : 25; // Example fees
        const netAmount = amount - fee;
        
        const description = `Recovered ${provider} withdrawal for NET ${netAmount} XAF. Débit brut: ${amount} FCFA.`;
        
        return {
            grossAmount: amount,
            netAmount: netAmount,
            fee: fee,
            description: description
        };
    }

    /**
     * Extract payment method from transaction data
     */
    private extractPaymentMethod(transactionData: any): string {
        // Try to determine payment method from available data
        if (transactionData.operator || transactionData.rawResponse?.operator) {
            const operator = transactionData.operator || transactionData.rawResponse?.operator;
            return operator.includes('ORANGE') ? 'OMCM' : 
                   operator.includes('MTN') ? 'MOMO' : 
                   operator.includes('AIRTEL') ? 'AIRTEL_MONEY' : 'MOBILE_MONEY';
        }
        return 'MOBILE_MONEY'; // Default
    }

    /**
     * Extract account information from transaction data
     */
    private extractAccountInfo(transactionData: any): any {
        const phoneNumber = transactionData.phoneNumber || transactionData.normalizedPhone || transactionData.recipient;
        const operator = transactionData.operator || transactionData.rawResponse?.operator;
        const country = transactionData.country || this.mapOperatorToCountry(operator) || 'CM';
        
        return {
            fullMomoNumber: phoneNumber,
            momoOperator: this.mapOperatorToStandardFormat(operator),
            countryCode: country
        };
    }

    /**
     * Map operator to standard format
     */
    private mapOperatorToStandardFormat(operator: string | undefined): string {
        if (!operator) return 'UNKNOWN';
        
        const upperOperator = operator.toUpperCase();
        if (upperOperator.includes('ORANGE')) return 'ORANGE_CMR';
        if (upperOperator.includes('MTN')) return 'MTN_CMR';
        if (upperOperator.includes('AIRTEL')) return 'AIRTEL_CMR';
        
        return operator; // Return as-is if no mapping found
    }

    /**
     * Validate that required services are running for webhook processing
     */
    private async validateServiceDependencies(): Promise<{ userService: boolean; notificationService: boolean }> {
        const results = {
            userService: false,
            notificationService: false
        };

        try {
            // Test user-service connectivity
            const userServiceUrl = config.services.userServiceUrl || 'http://localhost:3001';
            const userServiceResponse = await axios.get(`${userServiceUrl}/health`, {
                timeout: 3000,
                headers: {
                    'Authorization': `Bearer ${config.services.serviceSecret}`,
                    'X-Service-Name': 'payment-service'
                }
            });
            results.userService = userServiceResponse.status === 200;
        } catch (error: any) {
            log.warn(`User service not accessible: ${error.message}`);
        }

        try {
            // Test notification-service connectivity (if it has a health endpoint)
            const notificationServiceUrl = config.services.notificationServiceUrl || 'http://localhost:3002';
            const notificationServiceResponse = await axios.get(`${notificationServiceUrl}/health`, {
                timeout: 3000,
                headers: {
                    'Authorization': `Bearer ${config.services.serviceSecret}`,
                    'X-Service-Name': 'payment-service'
                }
            });
            results.notificationService = notificationServiceResponse.status === 200;
        } catch (error: any) {
            log.warn(`Notification service not accessible: ${error.message}`);
        }

        return results;
    }

    /**
     * Process webhook completion for recovered payment intent
     */
    private async processRecoveredPaymentWebhook(
        paymentIntent: any, 
        triggerWebhooks: boolean,
        result: RecoveryResult,
        reference: string
    ): Promise<void> {
        if (!triggerWebhooks) {
            log.info(`Webhook processing disabled for ${reference}, skipping`);
            return;
        }

        try {
            log.info(`Triggering webhook processing for recovered payment intent: ${paymentIntent.sessionId}`);
            
            // Ensure the payment intent has the required metadata for webhook processing
            if (!paymentIntent.metadata?.originatingService || !paymentIntent.metadata?.callbackPath) {
                log.warn(`Payment intent ${paymentIntent.sessionId} missing webhook metadata, cannot process webhooks`);
                result.webhookProcessingFailed++;
                const detailIndex = result.details.findIndex(d => d.reference === reference);
                if (detailIndex >= 0) {
                    result.details[detailIndex].webhookProcessed = false;
                    result.details[detailIndex].webhookError = 'Missing webhook metadata (originatingService or callbackPath)';
                }
                return;
            }

            // Trigger the payment completion workflow which handles webhook notifications
            await paymentService.handlePaymentCompletion(paymentIntent);
            
            result.webhookProcessingSucceeded++;
            const detailIndex = result.details.findIndex(d => d.reference === reference);
            if (detailIndex >= 0) {
                result.details[detailIndex].webhookProcessed = true;
            }
            
            log.info(`Successfully processed webhooks for payment intent: ${paymentIntent.sessionId}`);
            
        } catch (error: any) {
            log.error(`Failed to process webhooks for payment intent ${paymentIntent.sessionId}:`, error);
            result.webhookProcessingFailed++;
            
            const detailIndex = result.details.findIndex(d => d.reference === reference);
            if (detailIndex >= 0) {
                result.details[detailIndex].webhookProcessed = false;
                result.details[detailIndex].webhookError = error.message;
            }
            
            // Don't throw error here - webhook failure shouldn't fail the entire recovery
        }
    }

    /**
     * Standardize CinetPay CSV data to match our recovery format
     */
    private standardizeCinetPayCSVData(transaction: any): any {
        return {
            transactionId: transaction.transactionId || transaction.merchantId,
            status: 'completed', // Already filtered for successful transactions
            amount: transaction.amount,
            currency: transaction.currency || 'XAF',
            phoneNumber: transaction.phoneNumber,
            normalizedPhone: transaction.normalizedPhone,
            operator: transaction.operator,
            country: transaction.country,
            paymentDate: transaction.dateCreation,
            operatorId: transaction.operatorId,
            rawResponse: transaction
        };
    }

    /**
     * Recover transactions from a list of provider transaction references
     */
    async recoverTransactions(
        provider: RecoveryProvider,
        references: string[],
        transactionType: RecoveryTransactionType | 'auto',
        triggerWebhooks: boolean = false
    ): Promise<RecoveryResult> {
        const result: RecoveryResult = {
            totalProcessed: 0,
            successfulRecoveries: 0,
            failedRecoveries: 0,
            savedToRecoveryCollection: 0,
            timeoutErrors: 0,
            webhookProcessingSucceeded: 0,
            webhookProcessingFailed: 0,
            errors: [],
            timeoutReferences: [],
            details: []
        };

        log.info(`Starting recovery of ${references.length} ${transactionType} transactions from ${provider}`);

        // Validate service dependencies if webhook processing is enabled
        if (triggerWebhooks) {
            log.info('Webhook processing enabled, validating service dependencies...');
            const serviceStatus = await this.validateServiceDependencies();
            
            if (!serviceStatus.userService) {
                const warning = 'User service is not accessible - webhook processing may fail';
                log.warn(warning);
                result.errors.push(warning);
            } else {
                log.info('User service is accessible ✓');
            }
            
            if (!serviceStatus.notificationService) {
                log.warn('Notification service is not accessible - commission notifications may not be sent');
            } else {
                log.info('Notification service is accessible ✓');
            }
            
            if (!serviceStatus.userService) {
                const error = 'Critical services not accessible. Consider running without --webhooks flag or ensure services are running.';
                log.error(error);
                result.errors.push(error);
                // Don't exit here, let user decide. They might want to continue without webhooks.
            }
        }

        for (const reference of references) {
            result.totalProcessed++;
            
            try {
                await this.processTransactionReference(provider, reference, transactionType, result, triggerWebhooks);
            } catch (error: any) {
                const errorMsg = `Failed to process ${reference}: ${error.message}`;
                const isTimeout = error.message?.includes('timeout') || error.message?.includes('exceeded') || error.message?.includes('ENOTFOUND') || error.message?.includes('EAI_AGAIN');
                
                if (isTimeout) {
                    result.timeoutErrors++;
                    result.timeoutReferences.push(reference);
                    result.details.push({
                        reference,
                        status: 'timeout',
                        message: `Timeout: ${error.message}`
                    });
                } else {
                    result.errors.push(errorMsg);
                    result.failedRecoveries++;
                    result.details.push({
                        reference,
                        status: 'error',
                        message: errorMsg
                    });
                }
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
        transactionType: RecoveryTransactionType | 'auto',
        result: RecoveryResult,
        triggerWebhooks: boolean = false
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

        // For FeexPay, use auto-detected transaction type, or if type is 'auto'
        if (provider === RecoveryProvider.FEEXPAY && (transactionType === 'auto' || transactionData.transactionType)) {
            transactionType = transactionData.transactionType || transactionType;
            log.info(`Auto-detected FeexPay transaction type: ${transactionType}`);
        }

        // Ensure we have a valid transaction type
        if (transactionType === 'auto') {
            throw new Error(`Could not auto-detect transaction type for ${reference}`);
        }

        // Only process successful transactions
        if (!this.isSuccessfulTransaction(transactionData.status, provider)) {
            log.info(`Transaction ${reference} is not successful (status: ${transactionData.status}), skipping`);
            return;
        }

        // Check if user exists in database
        let user = null;
        let userId = null;
        
        // For FeexPay, try to get userId directly from callback_info first
        if (provider === RecoveryProvider.FEEXPAY && transactionData.callback_info?.userId) {
            userId = transactionData.callback_info.userId;
            log.info(`Using userId from FeexPay callback_info: ${userId}`);
            
            // Verify this user exists by getting details (optional check)
            try {
                const userDetails = await userServiceClient.getUserDetails(userId);
                if (userDetails) {
                    user = { id: userId, ...userDetails };
                    log.info(`Verified FeexPay user exists: ${userId}`);
                } else {
                    log.warn(`FeexPay userId ${userId} from callback_info not found in user service`);
                    userId = null;
                }
            } catch (error: any) {
                log.warn(`Failed to verify FeexPay userId ${userId}: ${error.message}`);
                userId = null;
            }
        }
        
        // Fallback to phone/email lookup if direct userId approach failed
        if (!user) {
            user = await this.findUserByTransactionData(transactionData);
        }
        
        if (user) {
            // User exists - restore transaction directly
            await this.restoreTransactionForExistingUser(provider, reference, transactionType, transactionData, user.id, result, triggerWebhooks);
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
        transactionType: RecoveryTransactionType | 'auto'
    ): Promise<any> {
        switch (provider) {
            case RecoveryProvider.CINETPAY:
                if (transactionType === RecoveryTransactionType.PAYOUT) {
                    return await cinetpayPayoutService.checkPayoutStatus(reference);
                } else if (transactionType === RecoveryTransactionType.PAYMENT) {
                    // For CinetPay payments, use transaction ID to check status
                    // The reference would be the cpm_trans_id from CinetPay
                    return await this.fetchCinetPayPaymentStatus(reference);
                } else {
                    throw new Error(`CinetPay does not support auto-detection. Please specify payment or payout type.`);
                }
            
            case RecoveryProvider.FEEXPAY:
                // FeexPay uses unified endpoint for both payments and payouts
                // We'll determine the type based on the response data
                return await this.fetchFeexPayTransactionStatus(reference);
            
            default:
                throw new Error(`Unsupported provider: ${provider}`);
        }
    }

    /**
     * Fetch CinetPay payment status using the checkout verification API
     */
    private async fetchCinetPayPaymentStatus(transactionId: string): Promise<any> {
        try {
            log.info(`Fetching CinetPay payment status for transaction: ${transactionId}`);
            
            // Use CinetPay checkout verification API (same pattern as payment creation)
            // Documentation: https://docs.cinetpay.com/api-v2/
            const response = await axios.post(
                `${config.cinetpay.baseUrl}/payment/check`,
                {
                    apikey: config.cinetpay.apiKey,
                    site_id: config.cinetpay.siteId,
                    transaction_id: transactionId
                },
                {
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000
                }
            );

            const cinetpayResponse = response.data;
            console.log(cinetpayResponse)
            log.info(`CinetPay payment status response for ${transactionId}:`, cinetpayResponse);

            if (cinetpayResponse.code !== '00') {
                log.warn(`CinetPay payment status check failed for ${transactionId}:`, cinetpayResponse.message);
                return null;
            }

            const paymentData = cinetpayResponse.data;
            
            return {
                transactionId: transactionId,
                status: this.mapCinetPayPaymentStatus(paymentData.status),
                amount: parseFloat(paymentData.amount || '0'),
                currency: paymentData.currency || 'XAF',
                userEmail: paymentData.cpm_email || null, // CinetPay might not return email in check
                userPhoneNumber: paymentData.cpm_phone_num || null, // CinetPay might not return phone in check
                paymentMethod: paymentData.payment_method,
                operatorTxId: paymentData.operator_id,
                paymentDate: paymentData.payment_date,
                rawResponse: paymentData
            };

        } catch (error: any) {
            log.error(`Error fetching CinetPay payment status for ${transactionId}:`, error.response?.data || error.message);
            
            // Re-throw timeout errors to preserve them for proper classification
            const isTimeout = error.message?.includes('timeout') || error.message?.includes('exceeded') || 
                             error.message?.includes('ENOTFOUND') || error.message?.includes('EAI_AGAIN');
            if (isTimeout) {
                throw error;
            }
            
            return null;
        }
    }

    /**
     * Map CinetPay payment status to standardized status
     */
    private mapCinetPayPaymentStatus(status: string): string {
        switch (status?.toUpperCase()) {
            case 'ACCEPTED':
                return 'completed';
            case 'REFUSED':
            case 'FAILED':
                return 'failed';
            case 'PENDING':
            default:
                return 'pending';
        }
    }

    /**
     * Fetch FeexPay transaction status using the unified status API
     * This endpoint works for both payments and payouts
     * For payouts, we first try the payout endpoint to "warm up" the API, then use the main endpoint
     */
    private async fetchFeexPayTransactionStatus(reference: string): Promise<any> {
        try {
            log.info(`Fetching FeexPay transaction status for reference: ${reference}`);
            
            // First, try the payout-specific endpoint to potentially warm up the API
            // This often helps with subsequent requests to the main endpoint
            let payoutResponse = null;
            try {
                log.info(`Attempting payout status check first for reference: ${reference}`);
                payoutResponse = await axios.get(
                    `${config.feexpay.baseUrl}/payouts/status/public/${reference}`,
                    {
                        headers: {
                            'Authorization': `Bearer ${config.feexpay.apiKey}`,
                            'Content-Type': 'application/json'
                        },
                        timeout: 30000
                    }
                );
                log.info(`Payout endpoint responded for ${reference}:`, payoutResponse.data);
            } catch (payoutError: any) {
                log.info(`Payout endpoint failed for ${reference}, will try main endpoint:`, payoutError.message);
                // Continue to main endpoint even if payout endpoint fails
            }
            
            // Now use the main FeexPay unified transaction status API
            const response = await axios.get(
                `${config.feexpay.baseUrl}/transactions/public/single/status/${reference}`,
                {
                    headers: {
                        'Authorization': `Bearer ${config.feexpay.apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000
                }
            );

            const feexpayResponse = response.data;
            console.log(feexpayResponse)
            log.info(`FeexPay transaction status response for ${reference}:`, feexpayResponse);

            // Check if the response indicates success
            if (!feexpayResponse || !feexpayResponse.status) {
                log.warn(`FeexPay transaction status check failed for ${reference}: Invalid response`);
                return null;
            }

            // Determine transaction type and extract user data based on callback_info
            const transactionType = this.determineFeexPayTransactionType(feexpayResponse);
            const userData = this.extractFeexPayUserData(feexpayResponse);

            return {
                reference,
                status: this.mapFeexPayTransactionStatus(feexpayResponse.status),
                amount: parseFloat(feexpayResponse.amount || '0'),
                currency: feexpayResponse.currency || 'XAF',
                transactionType,
                userEmail: userData.userEmail,
                userPhoneNumber: userData.userPhoneNumber,
                userName: userData.userName,
                userId: userData.userId,
                transactionDate: feexpayResponse.transactionDate,
                rawResponse: feexpayResponse
            };

        } catch (error: any) {
            log.error(`Error fetching FeexPay transaction status for ${reference}:`, error.response?.data || error.message);
            
            // Re-throw timeout errors to preserve them for proper classification
            const isTimeout = error.message?.includes('timeout') || error.message?.includes('exceeded') || 
                             error.message?.includes('ENOTFOUND') || error.message?.includes('EAI_AGAIN');
            if (isTimeout) {
                throw error;
            }
            
            return null;
        }
    }

    /**
     * Determine FeexPay transaction type based on amount and callback_info
     */
    private determineFeexPayTransactionType(feexpayResponse: any): RecoveryTransactionType {
        const amount = parseFloat(feexpayResponse.amount || '0');
        const paymentAmounts = [2070, 3070, 5140]; // Known payment amounts
        
        // Check if it's a payment based on amount
        if (paymentAmounts.includes(amount)) {
            return RecoveryTransactionType.PAYMENT;
        }
        
        // Check callback_info structure for additional clues
        const callbackInfo = feexpayResponse.callback_info || {};
        
        // Payments have sessionId, userName, userEmail in callback_info
        if (callbackInfo.sessionId || callbackInfo.userName || callbackInfo.userEmail) {
            return RecoveryTransactionType.PAYMENT;
        }
        
        // Payouts typically have client_transaction_id and userId only
        if (callbackInfo.client_transaction_id && !callbackInfo.sessionId) {
            return RecoveryTransactionType.PAYOUT;
        }
        
        // Default to payout for other amounts
        return RecoveryTransactionType.PAYOUT;
    }

    /**
     * Extract user data from FeexPay response
     */
    private extractFeexPayUserData(feexpayResponse: any): {
        userEmail?: string;
        userPhoneNumber?: string;
        userName?: string;
        userId?: string;
    } {
        const callbackInfo = feexpayResponse.callback_info || {};
        
        return {
            userEmail: callbackInfo.userEmail || feexpayResponse.email,
            userPhoneNumber: callbackInfo.userPhoneNumber || feexpayResponse.phoneNumber?.toString(),
            userName: callbackInfo.userName,
            userId: callbackInfo.userId
        };
    }

    /**
     * Map FeexPay transaction status to standardized status
     */
    private mapFeexPayTransactionStatus(feexpayStatus: string): string {
        switch (feexpayStatus.toUpperCase()) {
            case 'SUCCESSFUL':
                return 'completed';
            case 'FAILED':
                return 'failed';
            case 'PENDING':
            default:
                return 'pending';
        }
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
     * Parse transaction date from provider response
     */
    private parseTransactionDate(transactionData: any, provider: RecoveryProvider): Date {
        try {
            let dateString: string | null = null;
            
            switch (provider) {
                case RecoveryProvider.CINETPAY:
                    // CinetPay format: "2025-08-20 18:53:56"
                    dateString = transactionData.paymentDate || transactionData.payment_date;
                    break;
                    
                case RecoveryProvider.FEEXPAY:
                    // FeexPay might not return transaction date in status check
                    // Look for various possible date fields
                    dateString = transactionData.transactionDate || 
                                transactionData.payment_date || 
                                transactionData.created_at ||
                                transactionData.rawResponse?.transactionDate ||
                                transactionData.rawResponse?.created_at;
                    break;
            }
            
            if (dateString) {
                const parsedDate = new Date(dateString);
                if (!isNaN(parsedDate.getTime())) {
                    log.info(`Parsed transaction date: ${parsedDate.toISOString()} from ${dateString}`);
                    return parsedDate;
                }
            }
            
            log.warn(`Could not parse transaction date from provider response, using current date`);
            return new Date();
            
        } catch (error: any) {
            log.warn(`Error parsing transaction date: ${error.message}, using current date`);
            return new Date();
        }
    }

    /**
     * Find user by transaction data (userId, email, phone, normalized phone, or momo number)
     */
    private async findUserByTransactionData(transactionData: any): Promise<{ id: string; email?: string; phoneNumber?: string } | null> {
        try {
            // Try to find by userId first (for payouts with callback_info.userId)
            if (transactionData.userId) {
                const userDetails = await userServiceClient.getUserDetails(transactionData.userId);
                if (userDetails) {
                    log.info(`Found user by userId: ${transactionData.userId}`);
                    return {
                        id: userDetails._id.toString(),
                        email: userDetails.email,
                        phoneNumber: userDetails.phoneNumber?.toString()
                    };
                }
            }

            // Try to find by email
            if (transactionData.userEmail || transactionData.recipient_email) {
                const email = transactionData.userEmail || transactionData.recipient_email;
                const user = await userServiceClient.getUserByEmail(email);
                if (user) {
                    log.info(`Found user by email: ${email}`);
                    return user;
                }
            }

            // Collect all possible phone numbers to try
            const phoneNumbers = [
                transactionData.userPhoneNumber,
                transactionData.recipient,
                transactionData.phoneNumber,
                transactionData.normalizedPhone
            ].filter(phone => phone && phone.length > 0);

            // Try to find by phone numbers
            for (const phone of phoneNumbers) {
                const user = await userServiceClient.getUserByPhoneNumber(phone);
                if (user) {
                    log.info(`Found user by phone: ${phone}`);
                    return user;
                }
            }

            // Try to find by momo numbers (in case the phone number is stored as momoNumber)
            for (const phone of phoneNumbers) {
                const user = await userServiceClient.getUserByMomoNumber(phone);
                if (user) {
                    log.info(`Found user by momo number: ${phone}`);
                    return user;
                }
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
        result: RecoveryResult,
        triggerWebhooks: boolean = false
    ): Promise<void> {
        try {
            if (transactionType === RecoveryTransactionType.PAYOUT) {
                // Check if transaction already exists
                const existingTransaction = await transactionRepository.findByExternalTransactionId(reference);
                if (existingTransaction) {
                    log.info(`Transaction ${reference} already exists in database`);
                    return;
                }

                // Parse original transaction date
                const originalDate = this.parseTransactionDate(transactionData, provider);

                // Calculate fee and net amount for withdrawal
                const withdrawalDetails = this.calculateWithdrawalDetails(transactionData, provider);
                
                // Create withdrawal transaction with original date using model directly
                const transaction = new TransactionModel({
                    userId: new mongoose.Types.ObjectId(userId),
                    type: TransactionType.WITHDRAWAL,
                    amount: withdrawalDetails.grossAmount,
                    currency: this.mapCurrency(transactionData.currency),
                    fee: withdrawalDetails.fee,
                    status: TransactionStatus.COMPLETED,
                    description: withdrawalDetails.description,
                    metadata: {
                        method: this.extractPaymentMethod(transactionData),
                        accountInfo: this.extractAccountInfo(transactionData),
                        netAmountRequested: withdrawalDetails.netAmount,
                        payoutCurrency: this.mapCurrency(transactionData.currency),
                        selectedPayoutService: provider === RecoveryProvider.CINETPAY ? 'CinetPay' : 'FeexPay',
                        recovered: true,
                        originalTransactionDate: originalDate.toISOString(),
                        recoveryDate: new Date().toISOString()
                    },
                    paymentProvider: {
                        provider,
                        transactionId: reference,
                        status: transactionData.status,
                        metadata: transactionData
                    },
                    externalTransactionId: reference,
                    transactionId: `TXN_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    deleted: false,
                    createdAt: originalDate,
                    updatedAt: originalDate
                });
                
                await transaction.save();

                // Update user balance (deduct the amount since it was withdrawn)
                await userServiceClient.updateUserBalance(userId, -transactionData.amount);

                // Trigger webhook processing for additional effects
                // If the internal transaction doesn't exist, skip webhook processing
                try {
                    if (provider === RecoveryProvider.CINETPAY) {
                        await paymentService.processConfirmedPayoutWebhook(transaction.transactionId, transactionData.status, transactionData);
                    } else if (provider === RecoveryProvider.FEEXPAY) {
                        // For FeexPay, we need to pass the raw response which contains callback_info
                        await paymentService.processFeexPayPayoutWebhook(transactionData.rawResponse);
                    }
                    log.info(`Webhook processing successful for transaction ${reference}`);
                } catch (webhookError: any) {
                    // If webhook processing fails because internal transaction doesn't exist, that's okay
                    // The transaction record was already created above and balance already updated
                    if (webhookError.message?.includes('Internal transaction not found')) {
                        log.warn(`Webhook processing skipped for ${reference}: Internal transaction not found (transaction was created directly)`);
                    } else {
                        // For other webhook errors, log but don't fail the recovery
                        log.warn(`Webhook processing failed for ${reference}: ${webhookError.message}`);
                    }
                }

                result.successfulRecoveries++;
                result.details.push({
                    reference,
                    status: 'recovered',
                    message: `Withdrawal transaction restored for user ${userId}`,
                    userId
                });

            } else if (transactionType === RecoveryTransactionType.PAYMENT) {
                // Generate sessionId and gatewayPaymentId first
                // For CinetPay: sessionId is the transaction reference, gatewayPaymentId is the operator ID
                // For FeexPay: sessionId comes from callback_info.sessionId, gatewayPaymentId is the reference
                let sessionId: string;
                let gatewayPaymentId: string;
                
                if (provider === RecoveryProvider.CINETPAY) {
                    // Generate unique sessionId for recovered transactions to avoid collisions
                    sessionId = `RECOVERED_${reference}_${userId}`;
                    gatewayPaymentId = transactionData.operatorId || transactionData.rawResponse?.operatorId || reference;
                } else if (provider === RecoveryProvider.FEEXPAY) {
                    // Extract sessionId from FeexPay callback_info
                    const callbackInfo = transactionData.rawResponse?.callback_info || {};
                    sessionId = callbackInfo.sessionId || `PI_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                    gatewayPaymentId = reference;
                    
                    if (callbackInfo.sessionId) {
                        log.info(`Using original FeexPay sessionId: ${callbackInfo.sessionId}`);
                    } else {
                        log.warn(`FeexPay transaction ${reference} missing sessionId in callback_info, generating new one: ${sessionId}`);
                    }
                } else {
                    // Fallback for other providers
                    sessionId = `PI_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                    gatewayPaymentId = reference;
                }

                // Check if payment intent already exists by sessionId first (more reliable for CinetPay)
                const existingIntentBySessionId = await paymentIntentRepository.findBySessionId(sessionId);
                if (existingIntentBySessionId) {
                    // Only skip if already SUCCEEDED - otherwise update to SUCCESS and process webhooks
                    if (existingIntentBySessionId.status === PaymentStatus.SUCCEEDED) {
                        log.info(`Payment intent with sessionId ${sessionId} already exists and is SUCCEEDED`);
                        result.details.push({
                            reference,
                            status: 'skipped',
                            message: `Payment intent with sessionId ${sessionId} already succeeded`,
                            userId
                        });
                        return;
                    } else {
                        // Update existing payment intent to SUCCEEDED and process webhooks
                        log.info(`Payment intent with sessionId ${sessionId} exists but is ${existingIntentBySessionId.status}, updating to SUCCEEDED`);
                        
                        await PaymentIntentModel.findByIdAndUpdate(existingIntentBySessionId._id, {
                            status: PaymentStatus.SUCCEEDED,
                            updatedAt: new Date(),
                            gatewayRawResponse: transactionData,
                            metadata: {
                                ...existingIntentBySessionId.metadata,
                                recovered: true,
                                recoveryDate: new Date().toISOString(),
                                originalTransactionDate: originalDate.toISOString()
                            }
                        });
                        
                        // Get updated payment intent for webhook processing
                        const updatedPaymentIntent = await paymentIntentRepository.findBySessionId(sessionId);
                        
                        // Process webhook completion for the updated payment intent
                        await this.processRecoveredPaymentWebhook(updatedPaymentIntent, triggerWebhooks, result, reference);
                        
                        result.successfulRecoveries++;
                        result.details.push({
                            reference,
                            status: 'recovered',
                            message: `Payment intent status updated to SUCCEEDED and webhooks processed`,
                            userId
                        });
                        return;
                    }
                }

                // Also check by gatewayPaymentId as backup
                const existingIntent = await paymentIntentRepository.findByGatewayPaymentId(reference, this.mapProviderToGateway(provider));
                if (existingIntent) {
                    // Only skip if already SUCCEEDED - otherwise update to SUCCESS and process webhooks
                    if (existingIntent.status === PaymentStatus.SUCCEEDED) {
                        log.info(`Payment intent ${reference} already exists and is SUCCEEDED by gatewayPaymentId`);
                        result.details.push({
                            reference,
                            status: 'skipped', 
                            message: `Payment intent ${reference} already succeeded by gatewayPaymentId`,
                            userId
                        });
                        return;
                    } else {
                        // Update existing payment intent to SUCCEEDED and process webhooks
                        log.info(`Payment intent ${reference} exists but is ${existingIntent.status}, updating to SUCCEEDED`);
                        
                        await PaymentIntentModel.findByIdAndUpdate(existingIntent._id, {
                            status: PaymentStatus.SUCCEEDED,
                            updatedAt: new Date(),
                            gatewayRawResponse: transactionData,
                            metadata: {
                                ...existingIntent.metadata,
                                recovered: true,
                                recoveryDate: new Date().toISOString(),
                                originalTransactionDate: originalDate.toISOString()
                            }
                        });
                        
                        // Get updated payment intent for webhook processing
                        const updatedPaymentIntent = await paymentIntentRepository.findByGatewayPaymentId(reference, this.mapProviderToGateway(provider));
                        
                        // Process webhook completion for the updated payment intent
                        await this.processRecoveredPaymentWebhook(updatedPaymentIntent, triggerWebhooks, result, reference);
                        
                        result.successfulRecoveries++;
                        result.details.push({
                            reference,
                            status: 'recovered',
                            message: `Payment intent status updated to SUCCEEDED and webhooks processed`,
                            userId
                        });
                        return;
                    }
                }

                // Check for existing SUCCEEDED payment intents for this user
                const existingPaymentIntent = await PaymentIntentModel.findOne({
                    userId,
                    status: PaymentStatus.SUCCEEDED
                }).exec();

                if (existingPaymentIntent) {
                    log.info(`User ${userId} already has a SUCCEEDED payment intent: ${existingPaymentIntent.sessionId}, skipping recovery`);
                    result.failedRecoveries++;
                    result.details.push({
                        reference,
                        status: 'skipped',
                        message: 'User already has successful payment intent'
                    });
                    return;
                }

                // Check for active subscriptions
                const activeSubscriptions = await userServiceClient.getUserActiveSubscriptions(userId);
                if (activeSubscriptions && activeSubscriptions.length > 0) {
                    log.info(`User ${userId} already has ${activeSubscriptions.length} active subscription(s), skipping recovery`);
                    result.failedRecoveries++;
                    result.details.push({
                        reference,
                        status: 'skipped',
                        message: 'User already has active subscription'
                    });
                    return;
                }

                // Parse original transaction date
                const originalDate = this.parseTransactionDate(transactionData, provider);

                // Create payment intent with original date using model directly
                // sessionId and gatewayPaymentId already determined above

                // Apply CinetPay amount mapping and get subscription info
                let finalAmount = transactionData.amount;
                let subscriptionMetadata: {
                    subscriptionType?: string;
                    subscriptionPlan?: string;
                    originalProviderAmount?: number;
                    planDuration?: string;
                    planFeatures?: string[];
                } = {};
                
                if (provider === RecoveryProvider.CINETPAY) {
                    const mappingResult = this.mapCinetPayAmountToSubscriptionAmount(transactionData.amount);
                    finalAmount = mappingResult.actualAmount;
                    subscriptionMetadata = {
                        subscriptionType: mappingResult.subscriptionType,
                        subscriptionPlan: mappingResult.subscriptionPlan,
                        originalProviderAmount: transactionData.amount, // Keep track of original amount
                        planDuration: '30days', // Default subscription duration
                        planFeatures: this.getSubscriptionFeatures(mappingResult.subscriptionType)
                    };
                }

                // Get country code for payment intent
                const countryCode = this.extractCountryCode(transactionData);

                const paymentIntent = new PaymentIntentModel({
                    userId,
                    amount: finalAmount, // Use mapped amount
                    currency: this.mapCurrency(transactionData.currency),
                    status: PaymentStatus.SUCCEEDED,
                    gateway: this.mapProviderToGateway(provider),
                    gatewayPaymentId,
                    gatewayRawResponse: transactionData,
                    paymentType: 'subscription', // Default assumption
                    countryCode: countryCode, // Add country code
                    metadata: { 
                        recovered: true,
                        recoveryDate: new Date().toISOString(),
                        originalTransactionDate: originalDate.toISOString(),
                        ...subscriptionMetadata, // Include subscription metadata
                        // Add webhook metadata for user-service subscription processing
                        originatingService: 'user-service',
                        callbackPath: `${config.services.userServiceUrl || 'http://localhost:3001/api'}/subscriptions/webhooks/payment-confirmation`,
                        userId: userId,
                        planId: subscriptionMetadata.subscriptionType || 'CLASSIQUE',
                        planName: subscriptionMetadata.subscriptionPlan || 'subscription'
                    },
                    sessionId,
                    createdAt: originalDate,
                    updatedAt: originalDate
                });
                
                await paymentIntent.save();

                // Process webhook completion for the recovered payment intent
                await this.processRecoveredPaymentWebhook(paymentIntent, triggerWebhooks, result, reference);

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
     * Map recovery provider to payment gateway
     */
    private mapProviderToGateway(provider: RecoveryProvider): PaymentGateway {
        switch (provider) {
            case RecoveryProvider.CINETPAY:
                return PaymentGateway.CINETPAY;
            case RecoveryProvider.FEEXPAY:
                return PaymentGateway.FEEXPAY;
            default:
                return PaymentGateway.NONE;
        }
    }

    /**
     * Process user registration to restore recoverable transactions
     */
    async processUserRegistration(userId: string, email?: string, phoneNumber?: string): Promise<number> {
        log.info(`Processing user registration for recovery: userId=${userId}, email=${email}, phone=${phoneNumber}`);
        
        const recoverableTransactions = await recoverUserTransactionRepository.findByEmailOrPhoneNotRestored(email, phoneNumber, userId);
        
        if (recoverableTransactions.length === 0) {
            log.info('No recoverable transactions found for this user');
            return 0;
        }

        log.info(`Found ${recoverableTransactions.length} recoverable transactions`);
        
        let restoredCount = 0;
        
        // Separate payments and payouts to ensure payments are restored first
        const paymentTransactions = recoverableTransactions.filter(record => record.transactionType === RecoveryTransactionType.PAYMENT);
        const payoutTransactions = recoverableTransactions.filter(record => record.transactionType === RecoveryTransactionType.PAYOUT);
        
        // Process payments first (subscriptions, activations)
        for (const record of paymentTransactions) {
            try {
                const restored = await this.restorePaymentTransaction(record, userId, true);
                
                if (restored) {
                    await recoverUserTransactionRepository.markAsRestored(
                        record._id, 
                        new mongoose.Types.ObjectId(userId),
                        record.transactionReference
                    );
                    
                    restoredCount++;
                    log.info(`Successfully restored PAYMENT transaction ${record.transactionReference} for user ${userId}`);
                } else {
                    log.warn(`Skipped PAYMENT transaction ${record.transactionReference} for user ${userId} due to validation checks`);
                }
                
            } catch (error: any) {
                log.error(`Failed to restore payment transaction ${record.transactionReference}:`, error);
            }
        }
        
        // Then process payouts (withdrawals)
        for (const record of payoutTransactions) {
            try {
                await this.restoreWithdrawalTransaction(record, userId);
                
                await recoverUserTransactionRepository.markAsRestored(
                    record._id, 
                    new mongoose.Types.ObjectId(userId),
                    record.transactionReference
                );
                
                restoredCount++;
                log.info(`Restored PAYOUT transaction ${record.transactionReference} for user ${userId}`);
                
            } catch (error: any) {
                log.error(`Failed to restore payout transaction ${record.transactionReference}:`, error);
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

        // Parse original transaction date from stored provider data
        const originalDate = this.parseTransactionDate(record.providerTransactionData, record.provider);

        // Calculate fee and net amount for withdrawal
        const withdrawalDetails = this.calculateWithdrawalDetails(record.providerTransactionData, record.provider);
        
        // Create transaction with original date using model directly
        const transaction = new TransactionModel({
            userId: new mongoose.Types.ObjectId(userId),
            type: TransactionType.WITHDRAWAL,
            amount: withdrawalDetails.grossAmount,
            currency: this.mapCurrency(record.currency),
            fee: withdrawalDetails.fee,
            status: TransactionStatus.COMPLETED,
            description: withdrawalDetails.description,
            metadata: {
                method: this.extractPaymentMethod(record.providerTransactionData),
                accountInfo: this.extractAccountInfo(record.providerTransactionData),
                netAmountRequested: withdrawalDetails.netAmount,
                payoutCurrency: this.mapCurrency(record.currency),
                selectedPayoutService: record.provider === RecoveryProvider.CINETPAY ? 'CinetPay' : 'FeexPay',
                recovered: true,
                originalTransactionDate: originalDate.toISOString(),
                recoveryDate: new Date().toISOString()
            },
            paymentProvider: {
                provider: record.provider,
                transactionId: record.transactionReference,
                status: record.status,
                metadata: record.providerTransactionData
            },
            externalTransactionId: record.transactionReference,
            transactionId: `TXN_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            deleted: false,
            createdAt: originalDate,
            updatedAt: originalDate
        });
        
        await transaction.save();

        // Update user balance
        await userServiceClient.updateUserBalance(userId, -record.amount);
    }

    /**
     * Restore payment transaction from recovery record
     * Returns true if payment intent was successfully created, false if skipped
     */
    private async restorePaymentTransaction(record: any, userId: string, triggerWebhooks: boolean = false): Promise<boolean> {
        // Generate sessionId and gatewayPaymentId first
        // For CinetPay: sessionId is the transaction reference, gatewayPaymentId is the operator ID
        // For FeexPay: sessionId comes from callback_info.sessionId, gatewayPaymentId is the reference
        let sessionId: string;
        let gatewayPaymentId: string;
        
        if (record.provider === RecoveryProvider.CINETPAY) {
            // Generate unique sessionId for recovered transactions to avoid collisions
            sessionId = `RECOVERED_${record.transactionReference}_${userId}`;
            gatewayPaymentId = record.providerTransactionData.operatorId || record.providerTransactionData.rawResponse?.operatorId || record.transactionReference;
        } else if (record.provider === RecoveryProvider.FEEXPAY) {
            // Extract sessionId from FeexPay callback_info
            const callbackInfo = record.providerTransactionData.rawResponse?.callback_info || record.providerTransactionData.callback_info || {};
            sessionId = callbackInfo.sessionId || `PI_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            gatewayPaymentId = record.transactionReference;
            
            if (callbackInfo.sessionId) {
                log.info(`Using original FeexPay sessionId from recovery record: ${callbackInfo.sessionId}`);
            } else {
                log.warn(`FeexPay recovery record ${record.transactionReference} missing sessionId in callback_info, generating new one: ${sessionId}`);
            }
        } else {
            // Fallback for other providers
            sessionId = `PI_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            gatewayPaymentId = record.transactionReference;
        }

        // Check if payment intent already exists by sessionId first
        const existingIntentBySessionId = await paymentIntentRepository.findBySessionId(sessionId);
        if (existingIntentBySessionId) {
            log.info(`Payment intent with sessionId ${sessionId} already exists, considering as successfully restored`);
            return true; // Already exists, so consider successful
        }

        // Also check by gatewayPaymentId as backup
        const existingIntent = await paymentIntentRepository.findByGatewayPaymentId(record.provider, record.transactionReference);
        if (existingIntent) {
            log.info(`Payment intent ${record.transactionReference} already exists, considering as successfully restored`);
            return true; // Already exists, so consider successful
        }

        // Check for existing SUCCEEDED payment intents for this user
        const existingPaymentIntent = await PaymentIntentModel.findOne({
            userId,
            status: PaymentStatus.SUCCEEDED
        }).exec();

        if (existingPaymentIntent) {
            log.warn(`User ${userId} already has a SUCCEEDED payment intent: ${existingPaymentIntent.sessionId}, skipping recovery to prevent duplicate subscriptions`);
            return false; // Skip recovery due to existing payment
        }

        // Check for active subscriptions
        try {
            const activeSubscriptions = await userServiceClient.getUserActiveSubscriptions(userId);
            if (activeSubscriptions && activeSubscriptions.length > 0) {
                log.warn(`User ${userId} already has ${activeSubscriptions.length} active subscription(s), skipping recovery to prevent duplicates`);
                return false; // Skip recovery due to active subscriptions
            }
        } catch (error: any) {
            log.warn(`Could not check active subscriptions for user ${userId}: ${error.message}`);
            // Continue with recovery if subscription check fails
        }

        // Parse original transaction date from stored provider data
        const originalDate = this.parseTransactionDate(record.providerTransactionData, record.provider);

        // Apply CinetPay amount mapping and get subscription info
        let finalAmount = record.amount;
        let subscriptionMetadata: {
            subscriptionType?: string;
            subscriptionPlan?: string;
            originalProviderAmount?: number;
            planDuration?: string;
            planFeatures?: string[];
        } = {};
        
        if (record.provider === RecoveryProvider.CINETPAY) {
            const mappingResult = this.mapCinetPayAmountToSubscriptionAmount(record.amount);
            finalAmount = mappingResult.actualAmount;
            subscriptionMetadata = {
                subscriptionType: mappingResult.subscriptionType,
                subscriptionPlan: mappingResult.subscriptionPlan,
                originalProviderAmount: record.amount, // Keep track of original amount
                planDuration: '30days', // Default subscription duration
                planFeatures: this.getSubscriptionFeatures(mappingResult.subscriptionType)
            };
        }

        // Get country code for payment intent
        const countryCode = this.extractCountryCode(record.providerTransactionData);

        const paymentIntent = new PaymentIntentModel({
            userId,
            amount: finalAmount, // Use mapped amount
            currency: this.mapCurrency(record.currency),
            status: PaymentStatus.SUCCEEDED,
            gateway: this.mapProviderToGateway(record.provider),
            gatewayPaymentId,
            gatewayRawResponse: record.providerTransactionData,
            paymentType: 'subscription',
            countryCode: countryCode, // Add country code
            metadata: { 
                recovered: true, 
                originalRecordId: record._id,
                recoveryDate: new Date().toISOString(),
                originalTransactionDate: originalDate.toISOString(),
                ...subscriptionMetadata, // Include subscription metadata
                // Add webhook metadata for user-service subscription processing
                originatingService: 'user-service',
                callbackPath: `${config.services.userServiceUrl || 'http://localhost:3001/api'}/subscriptions/webhooks/payment-confirmation`,
                userId: userId,
                planId: subscriptionMetadata.subscriptionType || 'CLASSIQUE',
                planName: subscriptionMetadata.subscriptionPlan || 'subscription'
            },
            sessionId,
            createdAt: originalDate,
            updatedAt: originalDate
        });
        
        await paymentIntent.save();

        // Process webhook completion for the recovered payment intent
        // Create dummy result for this method since it doesn't have access to the main result object
        const tempResult: RecoveryResult = {
            totalProcessed: 0, successfulRecoveries: 0, failedRecoveries: 0, 
            savedToRecoveryCollection: 0, timeoutErrors: 0, webhookProcessingSucceeded: 0, 
            webhookProcessingFailed: 0, errors: [], timeoutReferences: [], details: []
        };
        await this.processRecoveredPaymentWebhook(paymentIntent, triggerWebhooks, tempResult, record.transactionReference);

        // Process successful payment - may require manual processing
        log.info(`Payment intent ${paymentIntent.sessionId} restored from recovery record`);
        return true; // Successfully created payment intent
    }
}

async function connectToDatabase(): Promise<void> {
    try {
        await mongoose.connect(config.mongodb.uri);
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
    .requiredOption('-t, --type <type>', 'Transaction type (payment|payout|auto) - use "auto" for FeexPay to auto-detect')
    .requiredOption('-r, --references <references>', 'Comma-separated list of transaction references')
    .option('-w, --webhooks', 'Trigger webhook processing (requires services to be running)', false)
    .action(async (options) => {
        await connectToDatabase();
        
        try {
            const references = options.references.split(',').map((r: string) => r.trim());
            const service = new TransactionRecoveryService();
            
            const result = await service.recoverTransactions(
                options.provider as RecoveryProvider,
                references,
                options.type as RecoveryTransactionType,
                options.webhooks
            );
            
            console.log('\nRecovery Results:');
            console.log(`Total Processed: ${result.totalProcessed}`);
            console.log(`Successful Recoveries: ${result.successfulRecoveries}`);
            console.log(`Saved for Later Recovery: ${result.savedToRecoveryCollection}`);
            console.log(`Failed: ${result.failedRecoveries}`);
            console.log(`Timeout Errors: ${result.timeoutErrors}`);
            if (options.webhooks) {
                console.log(`Webhook Processing Succeeded: ${result.webhookProcessingSucceeded}`);
                console.log(`Webhook Processing Failed: ${result.webhookProcessingFailed}`);
            }
            
            if (result.errors.length > 0) {
                console.log('\nErrors:');
                result.errors.forEach(error => console.log(`- ${error}`));
            }
            
            if (result.timeoutReferences.length > 0) {
                console.log('\nTimeout Transactions (retry these manually):');
                result.timeoutReferences.forEach(ref => console.log(`- ${ref}`));
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
    .command('recover-csv')
    .description('Recover transactions from a CSV file containing references')
    .requiredOption('-p, --provider <provider>', 'Provider (cinetpay|feexpay)')
    .requiredOption('-t, --type <type>', 'Transaction type (payment|payout|auto) - use "auto" for FeexPay to auto-detect')
    .requiredOption('-f, --file <file>', 'Path to CSV file containing transaction references')
    .option('--batch-size <size>', 'Process references in batches (default: 10)', '10')
    .option('--delay <ms>', 'Delay between batches in milliseconds (default: 1000)', '1000')
    .option('-w, --webhooks', 'Trigger webhook processing (requires services to be running)', false)
    .action(async (options) => {
        await connectToDatabase();
        
        try {
            const service = new TransactionRecoveryService();
            
            // Read references from CSV file
            const references = await service.readReferencesFromCSV(options.file);
            
            if (references.length === 0) {
                console.log('No references found in CSV file');
                return;
            }
            
            console.log(`Processing ${references.length} references from CSV file in batches of ${options.batchSize}`);
            
            const batchSize = parseInt(options.batchSize, 10);
            const delay = parseInt(options.delay, 10);
            let totalResults = {
                totalProcessed: 0,
                successfulRecoveries: 0,
                failedRecoveries: 0,
                savedToRecoveryCollection: 0,
                timeoutErrors: 0,
                webhookProcessingSucceeded: 0,
                webhookProcessingFailed: 0,
                errors: [] as string[],
                timeoutReferences: [] as string[],
                details: [] as any[]
            };
            
            // Process in batches
            for (let i = 0; i < references.length; i += batchSize) {
                const batch = references.slice(i, i + batchSize);
                console.log(`\nProcessing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(references.length / batchSize)} (${batch.length} references)`);
                
                const result = await service.recoverTransactions(
                    options.provider as RecoveryProvider,
                    batch,
                    options.type as RecoveryTransactionType,
                    options.webhooks
                );
                
                // Aggregate results
                totalResults.totalProcessed += result.totalProcessed;
                totalResults.successfulRecoveries += result.successfulRecoveries;
                totalResults.failedRecoveries += result.failedRecoveries;
                totalResults.savedToRecoveryCollection += result.savedToRecoveryCollection;
                totalResults.timeoutErrors += result.timeoutErrors;
                totalResults.webhookProcessingSucceeded += result.webhookProcessingSucceeded;
                totalResults.webhookProcessingFailed += result.webhookProcessingFailed;
                totalResults.errors.push(...result.errors);
                totalResults.timeoutReferences.push(...result.timeoutReferences);
                totalResults.details.push(...result.details);
                
                console.log(`Batch completed: ${result.successfulRecoveries} recovered, ${result.savedToRecoveryCollection} saved, ${result.failedRecoveries} failed, ${result.timeoutErrors} timeout`);
                
                // Add delay between batches (except for the last batch)
                if (i + batchSize < references.length) {
                    console.log(`Waiting ${delay}ms before next batch...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
            
            console.log('\n=== FINAL RESULTS ===');
            console.log(`Total Processed: ${totalResults.totalProcessed}`);
            console.log(`Successful Recoveries: ${totalResults.successfulRecoveries}`);
            console.log(`Saved for Later Recovery: ${totalResults.savedToRecoveryCollection}`);
            console.log(`Failed: ${totalResults.failedRecoveries}`);
            console.log(`Timeout Errors: ${totalResults.timeoutErrors}`);
            console.log(`Webhook Processing Succeeded: ${totalResults.webhookProcessingSucceeded}`);
            console.log(`Webhook Processing Failed: ${totalResults.webhookProcessingFailed}`);
            
            if (totalResults.errors.length > 0) {
                console.log('\nErrors:');
                totalResults.errors.forEach(error => console.log(`- ${error}`));
            }
            
            if (totalResults.timeoutReferences.length > 0) {
                console.log('\nTimeout Transactions (retry these manually):');
                totalResults.timeoutReferences.forEach(ref => console.log(`- ${ref}`));
            }
            
        } catch (error: any) {
            log.error('CSV recovery failed:', error);
            process.exit(1);
        } finally {
            await disconnectFromDatabase();
        }
    });

program
    .command('recover-cinetpay-csv')
    .description('Recover CinetPay transactions from CSV export file (no API calls needed)')
    .requiredOption('-f, --file <file>', 'Path to CinetPay CSV export file')
    .requiredOption('-t, --type <type>', 'Transaction type: "payment" or "payout"')
    .option('--batch-size <size>', 'Process transactions in batches (default: 50)', '50')
    .option('--delay <ms>', 'Delay between batches in milliseconds (default: 500)', '500')
    .option('-w, --webhooks', 'Trigger webhook processing (requires services to be running)', false)
    .action(async (options) => {
        await connectToDatabase();
        
        try {
            const service = new TransactionRecoveryService();
            const isPayment = options.type.toLowerCase() === 'payment';
            
            if (!['payment', 'payout'].includes(options.type.toLowerCase())) {
                console.error('Type must be either "payment" or "payout"');
                process.exit(1);
            }
            
            console.log(`Processing CinetPay ${options.type} CSV file: ${options.file}`);
            
            const result = await service.recoverFromCinetPayCSV(options.file, isPayment, options.webhooks);
            
            console.log('\n=== CinetPay CSV Recovery Results ===');
            console.log(`Total Processed: ${result.totalProcessed}`);
            console.log(`Successful Recoveries: ${result.successfulRecoveries}`);
            console.log(`Saved for Later Recovery: ${result.savedToRecoveryCollection}`);
            console.log(`Failed: ${result.failedRecoveries}`);
            console.log(`Timeout Errors: ${result.timeoutErrors}`);
            if (options.webhooks) {
                console.log(`Webhook Processing Succeeded: ${result.webhookProcessingSucceeded}`);
                console.log(`Webhook Processing Failed: ${result.webhookProcessingFailed}`);
            }
            
            if (result.errors.length > 0) {
                console.log('\nErrors:');
                result.errors.forEach(error => console.log(`- ${error}`));
            }
            
            if (result.timeoutReferences.length > 0) {
                console.log('\nTimeout Transactions (retry these manually):');
                result.timeoutReferences.forEach(ref => console.log(`- ${ref}`));
            }
            
            console.log('\nSample Details:');
            result.details.slice(0, 10).forEach(detail => {
                console.log(`${detail.reference}: ${detail.status} - ${detail.message}`);
            });
            
            if (result.details.length > 10) {
                console.log(`... and ${result.details.length - 10} more transactions`);
            }
            
        } catch (error: any) {
            log.error('CinetPay CSV recovery failed:', error);
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
    program.parse(process.argv);
}

export { TransactionRecoveryService };