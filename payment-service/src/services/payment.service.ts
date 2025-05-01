import { Types, Aggregate } from 'mongoose';
import transactionRepository, { CreateTransactionInput } from '../database/repositories/transaction.repository';
import pendingRepository, { CreatePendingInput } from '../database/repositories/pending.repository';
import paymentIntentRepository, { CreatePaymentIntentInput, UpdatePaymentIntentInput } from '../database/repositories/paymentIntent.repository';
import { TransactionStatus, TransactionType, Currency, ITransaction } from '../database/models/transaction.model';
import TransactionModel from '../database/models/transaction.model';
import { PendingStatus, VerificationType } from '../database/models/pending.model';
import { userServiceClient, UserDetails } from './user.service.client';
import { productServiceClient } from './product.service.client';
import notificationService from './notification.service';
import logger from '../utils/logger';
import axios from 'axios';
import { IPaymentIntent, PaymentStatus, PaymentGateway } from '../database/interfaces/IPaymentIntent';
import config from '../config'; // Import central config
import { AppError } from '../utils/errors'; // Corrected AppError import path
import { PaginationOptions } from '../types/pagination'; // Corrected Import Path

const log = logger.getLogger('PaymentService');

// Interface for generic payment intent creation data (replacing subscription specific)
interface GenericPaymentIntentInput {
    userId: string;
    amount: number;
    currency: string;
    paymentType: string; // e.g., 'SUBSCRIPTION', 'AD_PURCHASE', 'TOMBOLA_TICKET'
    metadata?: Record<string, any>; // Include service-specific details
}

interface PaymentDetails {
    amount: number;
    currency: string;
    phoneNumber: string;
    countryCode: string;
}

// Define a type for enriched transaction data including user name
// Re-define explicitly instead of extending to avoid lean() type issues
interface EnrichedPaymentIntent {
    // Fields from IPaymentIntent (ensure these match IPaymentIntent)
    _id: Types.ObjectId | string; // Use union type for flexibility
    sessionId: string;
    userId: string;
    paymentType?: string;
    subscriptionType?: string;
    subscriptionPlan?: string;
    amount?: number;
    currency?: string;
    phoneNumber?: string;
    countryCode?: string;
    status: PaymentStatus;
    gateway: PaymentGateway;
    gatewayPaymentId?: string;
    gatewayCheckoutUrl?: string;
    gatewayRawResponse?: object;
    paidAmount?: number;
    paidCurrency?: string;
    webhookHistory: { timestamp: Date; status: PaymentStatus; providerData?: any }[];
    metadata?: Record<string, any>;
    createdAt: Date;
    updatedAt: Date;
    // Enriched fields
    userName?: string;
    userPhoneNumber?: string;
}

// Define structure for the service method response
interface AdminTransactionListResponse {
    transactions: EnrichedPaymentIntent[];
    pagination: {
        currentPage: number;
        totalPages: number;
        totalCount: number;
        limit: number;
    };
}

// Define structure for the account transaction service method response
interface AdminAccountTransactionListResponse {
    transactions: EnrichedAccountTransaction[]; // Use specific type
    pagination: {
        currentPage: number;
        totalPages: number;
        totalCount: number;
        limit: number;
    };
}

// Define enriched type for account transactions as a PLAIN interface
interface EnrichedAccountTransaction {
    // Explicitly list fields needed from the lean ITransaction object
    _id: Types.ObjectId;
    transactionId: string;
    userId: Types.ObjectId | string; // Keep union for mapping phase
    type: TransactionType;
    amount: number;
    currency: Currency;
    fee: number;
    status: TransactionStatus;
    description: string;
    metadata?: Record<string, any>;
    reference?: string;
    serviceProvider?: string;
    paymentMethod?: string;
    externalTransactionId?: string;
    createdAt: Date;
    updatedAt: Date;
    // Enriched fields added later
    userName?: string;
    userPhoneNumber?: string;
}

class PaymentService {
    constructor() {
        // Constructor is now empty or can be used for dependency injection
    }

    /**
     * Process a deposit for a user
     */
    async processDeposit(
        userId: string | Types.ObjectId,
        amount: number,
        currency: Currency,
        paymentDetails: {
            provider: string;
            transactionId: string;
            metadata?: Record<string, any>;
        },
        description: string
    ) {
        try {
            log.info(`Processing deposit of ${amount} ${currency} for user ${userId}`);

            // Create a transaction record
            const transaction = await transactionRepository.create({
                userId,
                type: TransactionType.DEPOSIT,
                amount,
                currency,
                description: description,
                paymentProvider: {
                    provider: paymentDetails.provider,
                    transactionId: paymentDetails.transactionId,
                    status: 'completed',
                    metadata: paymentDetails.metadata
                },
            });

            // Update transaction status to completed
            await transactionRepository.updateStatus(transaction.transactionId, TransactionStatus.COMPLETED);

            // Update user balance
            await userServiceClient.updateUserBalance(userId.toString(), amount);

            // Send notification
            await notificationService.sendTransactionNotification(
                userId.toString(),
                'deposit_completed',
                {
                    amount,
                    currency,
                    transactionId: transaction.transactionId
                }
            );

            return transaction;
        } catch (error) {
            log.error(`Error processing deposit: ${error}`);
            throw error;
        }
    }

    /**
     * Process an internally triggered withdrawal (e.g., commission payout failure reversal, fee)
     * Ensures transaction is logged and balance is updated.
     */
    async processInternalWithdrawal(
        userId: string | Types.ObjectId,
        amount: number, // Amount should be positive, function will negate for balance update
        currency: Currency,
        description: string,
        metadata?: Record<string, any>,
        ipAddress?: string, // Usually null for internal actions
        deviceInfo?: string // Usually null for internal actions
    ) {
        if (amount <= 0) {
            log.error(`Internal withdrawal amount must be positive. Received: ${amount}`);
            throw new Error('Withdrawal amount must be positive.');
        }
        const negativeAmount = -Math.abs(amount);

        try {
            log.info(`Processing internal withdrawal of ${amount} ${currency} for user ${userId}. Reason: ${description}`);

            // Optional: Check balance before proceeding (depends on use case - might be okay to go negative for corrections)
            // const userBalance = await userServiceClient.getBalance(userId.toString());
            // if (userBalance < amount) {
            //     log.warn(`User ${userId} has insufficient balance (${userBalance}) for internal withdrawal of ${amount}`);
            //     // Decide whether to throw or allow (e.g., for reversals)
            //     // throw new Error('Insufficient balance for internal withdrawal');
            // }

            // Create a transaction record
            const transaction = await transactionRepository.create({
                userId,
                type: TransactionType.WITHDRAWAL, // Log as standard withdrawal
                amount: negativeAmount, // Store the actual change
                currency,
                description: `Internal Withdrawal: ${description}`,
                metadata: {
                    ...metadata,
                    internalReason: description // Store reason separately if needed
                },
                ipAddress,
                deviceInfo
            });

            // Update transaction status to completed immediately
            await transactionRepository.updateStatus(transaction.transactionId, TransactionStatus.COMPLETED);

            // Update user balance (apply the negative amount)
            await userServiceClient.updateUserBalance(userId.toString(), negativeAmount);

            // Optional: Send notification (might not be needed for all internal withdrawals)
            // await notificationService.sendTransactionNotification(...);

            log.info(`Completed internal withdrawal for user ${userId}. Transaction ID: ${transaction.transactionId}`);
            return transaction;
        } catch (error) {
            log.error(`Error processing internal withdrawal for user ${userId}: ${error}`);
            throw error;
        }
    }

    /**
     * Initiate a withdrawal for a user
     */
    async initiateWithdrawal(
        userId: string | Types.ObjectId,
        amount: number,
        currency: Currency,
        withdrawalDetails: {
            method: string;
            accountInfo: Record<string, any>;
        },
        ipAddress?: string,
        deviceInfo?: string
    ) {
        try {
            log.info(`Initiating withdrawal of ${amount} ${currency} for user ${userId}`);

            // Check if user has sufficient balance
            const userBalance = await userServiceClient.getBalance(userId.toString());
            if (userBalance < amount) {
                throw new Error('Insufficient balance');
            }

            // Calculate fee (if any)
            const fee = this.calculateWithdrawalFee(amount, currency, withdrawalDetails.method);

            // Create a pending withdrawal
            const pending = await pendingRepository.create({
                userId,
                transactionType: TransactionType.WITHDRAWAL,
                amount,
                currency,
                verificationType: VerificationType.OTP,
                description: `Withdrawal of ${amount} ${currency}`,
                metadata: {
                    fee,
                    method: withdrawalDetails.method,
                    accountInfo: withdrawalDetails.accountInfo
                },
                ipAddress,
                deviceInfo
            });

            // Send OTP for verification
            await this.sendWithdrawalOTP(userId.toString(), pending.pendingId);

            return {
                pendingId: pending.pendingId,
                amount,
                fee,
                total: amount - fee,
                status: pending.status,
                expiresAt: pending.expiresAt
            };
        } catch (error) {
            log.error(`Error initiating withdrawal: ${error}`);
            throw error;
        }
    }

    /**
     * Verify and process a withdrawal
     */
    async verifyWithdrawal(pendingId: string, verificationCode: string) {
        try {
            log.info(`Verifying withdrawal ${pendingId}`);

            // Verify the OTP
            const { verified, pending } = await pendingRepository.verify(pendingId, verificationCode);

            if (!verified || !pending) {
                return { success: false, message: 'Invalid or expired verification code' };
            }

            // Get withdrawal details from pending record
            const { userId, amount, currency, metadata } = pending;
            const fee = metadata?.fee || 0;
            const finalAmount = amount - fee;

            // Create withdrawal transaction
            const transaction = await transactionRepository.create({
                userId,
                type: TransactionType.WITHDRAWAL,
                amount: finalAmount,
                fee,
                currency,
                description: `Withdrawal of ${finalAmount} ${currency}`,
                metadata: {
                    method: metadata?.method,
                    accountInfo: metadata?.accountInfo
                },
                ipAddress: pending.ipAddress,
                deviceInfo: pending.deviceInfo
            });

            // Update user balance
            await userServiceClient.updateUserBalance(userId.toString(), -amount);

            // Update transaction status (initially pending until external processing)
            await transactionRepository.updateStatus(transaction.transactionId, TransactionStatus.PENDING);

            // Send notification
            await notificationService.sendTransactionNotification(
                userId.toString(),
                'withdrawal_initiated',
                {
                    amount: finalAmount,
                    currency,
                    transactionId: transaction.transactionId
                }
            );

            // Now the withdrawal will be processed by a background job or admin approval

            return {
                success: true,
                transaction: {
                    transactionId: transaction.transactionId,
                    amount: finalAmount,
                    fee,
                    total: amount,
                    status: transaction.status
                }
            };
        } catch (error) {
            log.error(`Error verifying withdrawal: ${error}`);
            throw error;
        }
    }

    /**
     * Process a payment between users
     */
    async processPayment(
        fromUserId: string | Types.ObjectId,
        toUserId: string | Types.ObjectId,
        amount: number,
        currency: Currency,
        description: string,
        metadata?: Record<string, any>,
        ipAddress?: string,
        deviceInfo?: string
    ) {
        try {
            log.info(`Processing payment of ${amount} ${currency} from user ${fromUserId} to ${toUserId}`);

            // Check if sender has sufficient balance
            const senderBalance = await userServiceClient.getBalance(fromUserId.toString());
            if (senderBalance < amount) {
                throw new Error('Insufficient balance');
            }

            // Create outgoing transaction for sender
            const senderTransaction = await transactionRepository.create({
                userId: fromUserId,
                type: TransactionType.PAYMENT,
                amount: -amount,
                currency,
                description: `Payment to user: ${description}`,
                metadata: {
                    ...metadata,
                    recipientId: toUserId
                },
                ipAddress,
                deviceInfo
            });

            // Create incoming transaction for recipient
            const recipientTransaction = await transactionRepository.create({
                userId: toUserId,
                type: TransactionType.PAYMENT,
                amount,
                currency,
                description: `Payment from user: ${description}`,
                metadata: {
                    ...metadata,
                    senderId: fromUserId
                },
                relatedTransactions: [senderTransaction._id]
            });

            // Update related transactions for sender
            await transactionRepository.update(senderTransaction._id, {
                relatedTransactions: [recipientTransaction._id]
            });

            // Update both transactions to completed
            await transactionRepository.updateStatus(senderTransaction.transactionId, TransactionStatus.COMPLETED);
            await transactionRepository.updateStatus(recipientTransaction.transactionId, TransactionStatus.COMPLETED);

            // Update balances for both users
            await userServiceClient.updateUserBalance(fromUserId.toString(), -amount);
            await userServiceClient.updateUserBalance(toUserId.toString(), amount);

            // Send notifications to both users
            await notificationService.sendTransactionNotification(
                fromUserId.toString(),
                'payment_sent',
                {
                    amount,
                    currency,
                    transactionId: senderTransaction.transactionId,
                    recipientId: toUserId.toString()
                }
            );

            await notificationService.sendTransactionNotification(
                toUserId.toString(),
                'payment_received',
                {
                    amount,
                    currency,
                    transactionId: recipientTransaction.transactionId,
                    senderId: fromUserId.toString()
                }
            );

            return {
                senderTransaction,
                recipientTransaction
            };
        } catch (error) {
            log.error(`Error processing payment: ${error}`);
            throw error;
        }
    }

    /**
     * Get transaction history for a user
     */
    async getTransactionHistory(
        userId: string | Types.ObjectId,
        options: {
            type?: TransactionType;
            status?: TransactionStatus;
            startDate?: Date;
            endDate?: Date;
            limit?: number;
            skip?: number;
            sortBy?: string;
            sortOrder?: 'asc' | 'desc';
        } = {}
    ) {
        try {
            return await transactionRepository.findByUserId(userId, options);
        } catch (error) {
            log.error(`Error getting transaction history: ${error}`);
            throw error;
        }
    }

    /**
     * Get transaction statistics for a user
     */
    async getTransactionStats(userId: string | Types.ObjectId) {
        try {
            return await transactionRepository.getTransactionStats(userId);
        } catch (error) {
            log.error(`Error getting transaction stats: ${error}`);
            throw error;
        }
    }

    /**
     * Get a specific transaction by ID
     */
    async getTransaction(transactionId: string) {
        try {
            return await transactionRepository.findByTransactionId(transactionId);
        } catch (error) {
            log.error(`Error getting transaction: ${error}`);
            throw error;
        }
    }

    /**
     * Calculate withdrawal fee (can be customized based on business rules)
     */
    private calculateWithdrawalFee(amount: number, currency: Currency, method: string): number {
        // Simple example with flat percentage fee
        const feePercentage = 0.015; // 1.5%
        const fee = amount * feePercentage;

        // You might have different fee structures based on method, amount tier, or currency
        return fee;
    }

    /**
     * Send OTP for withdrawal verification
     */
    private async sendWithdrawalOTP(userId: string, pendingId: string) {
        try {
            // Get the pending transaction with verification code
            const pending = await pendingRepository.findByPendingId(pendingId);

            if (!pending || pending.verificationType !== VerificationType.OTP) {
                throw new Error('Invalid pending transaction or verification type');
            }

            // Send notification with OTP
            await notificationService.sendVerificationOTP(
                userId,
                'withdrawal_verification',
                {
                    amount: pending.amount,
                    currency: pending.currency,
                    pendingId
                }
            );

            log.info(`Sent withdrawal verification OTP for user ${userId}`);
        } catch (error) {
            log.error(`Error sending withdrawal OTP: ${error}`);
            throw error;
        }
    }

    /**
     * Create initial payment intent based on generic input.
     * FOR TESTING: Immediately marks the intent as SUCCEEDED.
     */
    public async createPaymentIntent(data: GenericPaymentIntentInput): Promise<IPaymentIntent> {

        // Validate required fields
        if (!data.userId || !data.amount || !data.currency || !data.paymentType) {
            log.error('Missing required fields for createPaymentIntent', data);
            throw new Error('Missing required fields (userId, amount, currency, paymentType) to create payment intent.');
        }
        if (data.amount <= 0) {
            log.error('Invalid amount for createPaymentIntent', { amount: data.amount });
            throw new Error('Payment amount must be positive.');
        }

        // Create the initial intent
        let paymentIntent = await paymentIntentRepository.create({
            userId: data.userId,
            amount: data.amount,
            currency: data.currency,
            paymentType: data.paymentType,
            metadata: data.metadata, // Store provided metadata
            status: PaymentStatus.PENDING_USER_INPUT, // Start as pending
            gateway: PaymentGateway.NONE // Initially no gateway
        });
        log.info(`Created initial PaymentIntent ${paymentIntent.sessionId} for user ${data.userId}, type: ${data.paymentType}`);

        // --- TESTING ONLY: Immediately mark as succeeded --- 
        log.warn(`TESTING MODE: Immediately marking PaymentIntent ${paymentIntent.sessionId} as SUCCEEDED.`);
        const updatedIntent = await paymentIntentRepository.updateBySessionId(paymentIntent.sessionId, {
            status: PaymentStatus.SUCCEEDED,
            gateway: PaymentGateway.TESTING, // Mark gateway as TESTING
            gatewayPaymentId: `test_${paymentIntent.sessionId}`, // Add a test gateway ID
            paidAmount: paymentIntent.amount, // Assume paid amount is the original amount
            paidCurrency: paymentIntent.currency // Assume paid currency is the original currency
        });

        if (!updatedIntent) {
            log.error(`TESTING MODE: Failed to update intent ${paymentIntent.sessionId} to SUCCEEDED. Aborting completion.`);
            // Throw an error because we couldn't complete the test flow
            throw new Error(`TESTING MODE Error: Failed to update intent ${paymentIntent.sessionId} to SUCCEEDED.`);
        } else {
            log.info(`PaymentIntent ${paymentIntent.sessionId} status updated to SUCCEEDED.`);
            // Trigger completion logic (which now only notifies originating service)
            // Run this asynchronously but don't wait for it to finish before returning
            this.handlePaymentCompletion(updatedIntent).catch(err => {
                log.error(`TESTING MODE: Error in background handlePaymentCompletion for ${updatedIntent.sessionId}:`, err);
            });
            paymentIntent = updatedIntent; // Use the updated intent for the response
        }
        // --- END TESTING ONLY ---

        // Fetch the latest state just in case, though updatedIntent should be correct
        const finalIntentState = await paymentIntentRepository.findBySessionId(paymentIntent.sessionId);
        return finalIntentState || paymentIntent; // Return latest state
    }

    /**
     * Get payment intent details by sessionId
     */
    public async getPaymentIntentDetails(sessionId: string): Promise<IPaymentIntent | null> {
        const paymentIntent = await paymentIntentRepository.findBySessionId(sessionId);

        if (!paymentIntent) {
            log.warn(`Payment intent not found for sessionId: ${sessionId}`);
            return null;
        }
        return paymentIntent;
    }

    /**
     * Placeholder function for currency conversion
     * TODO: Replace with actual API call or rate table logic
     */
    private async convertCurrency(amount: number, fromCurrency: string, toCurrency: string): Promise<number> {
        log.info(`Converting ${amount} ${fromCurrency} to ${toCurrency}`);
        if (fromCurrency === toCurrency) {
            return amount;
        }
        // --- Placeholder --- 
        // Replace with actual conversion logic (e.g., using an exchange rate API)
        // Example: Fetch rate from an API like exchangerate-api.com or openexchangerates.org
        // For now, use a fixed dummy rate for demonstration
        let rate = 1;
        if (fromCurrency === 'XOF' && toCurrency === 'XAF') rate = 1; // Often pegged 1:1
        if (fromCurrency === 'XAF' && toCurrency === 'XOF') rate = 1;
        if (fromCurrency === 'XOF' && toCurrency === 'KES') rate = 0.2; // DUMMY RATE
        if (fromCurrency === 'KES' && toCurrency === 'XOF') rate = 5; // DUMMY RATE

        if (rate === 1 && fromCurrency !== toCurrency) {
            log.warn(`No dummy conversion rate found for ${fromCurrency} -> ${toCurrency}. Using 1.`);
        }

        const convertedAmount = Math.ceil(amount * rate); // Use Math.ceil to avoid fractional cents/units
        log.info(`Converted amount: ${convertedAmount} ${toCurrency}`);
        return convertedAmount;
        // --- End Placeholder ---
    }

    /**
     * Handle Feexpay webhook notification
     */
    public async handleFeexpayWebhook(payload: any): Promise<void> {
        const { reference, amount, status, callback_info } = payload;
        const sessionId = callback_info?.sessionId;

        if (!reference || !sessionId) {
            log.warn('Received Feexpay webhook with missing reference or callback_info.sessionId', payload);
            throw new Error('Webhook payload missing required fields');
        }

        const paymentIntent = await paymentIntentRepository.findByGatewayPaymentId(reference, PaymentGateway.FEEXPAY);

        if (!paymentIntent) {
            log.error(`Payment intent not found for webhook session: ${sessionId}, reference: ${reference}`);
            throw new Error('Payment intent not found for webhook');
        }

        if (paymentIntent.status === PaymentStatus.SUCCEEDED || paymentIntent.status === PaymentStatus.FAILED) {
            log.warn(`Webhook received for already processed payment intent: ${sessionId}, Status: ${paymentIntent.status}`);
            return;
        }

        let newStatus: PaymentStatus = paymentIntent.status;
        if (status === 'SUCCESSFUL') {
            newStatus = PaymentStatus.SUCCEEDED;
        } else if (status === 'FAILED') {
            newStatus = PaymentStatus.FAILED;
        } else {
            newStatus = paymentIntent.status === PaymentStatus.PENDING_PROVIDER ? PaymentStatus.PROCESSING : paymentIntent.status;
        }

        let updatedIntent: IPaymentIntent | null = paymentIntent;
        if (newStatus !== paymentIntent.status) {
            updatedIntent = await paymentIntentRepository.addWebhookEvent(sessionId, newStatus, payload);
            log.info(`PaymentIntent ${sessionId} status updated to ${newStatus} via Feexpay webhook.`);
            if (!updatedIntent) {
                log.error(`Failed to update PaymentIntent ${sessionId} after webhook event. Cannot proceed.`);
                return;
            }
        }

        // Check if status is final and updatedIntent is not null
        if (updatedIntent && (updatedIntent.status === PaymentStatus.SUCCEEDED || updatedIntent.status === PaymentStatus.FAILED)) {
            await this.handlePaymentCompletion(updatedIntent);
        }
    }

    /**
     * Handle CinetPay webhook notification
     */
    public async handleCinetPayWebhook(payload: any): Promise<void> {
        const { cpm_trans_id, cpm_site_id, cpm_trans_status, cpm_payment_token } = payload;

        if (!cpm_trans_id || !cpm_site_id || !cpm_trans_status) {
            log.warn('Received CinetPay webhook with missing required fields', payload);
            throw new Error('Webhook payload missing required fields');
        }
        if (cpm_site_id !== config.cinetpay.siteId) {
            log.error(`CinetPay webhook site ID mismatch. Received: ${cpm_site_id}, Expected: ${config.cinetpay.siteId}`);
            throw new Error('Invalid site ID in webhook');
        }

        const paymentIntent = await paymentIntentRepository.findBySessionId(cpm_trans_id);

        if (!paymentIntent) {
            log.error(`Payment intent not found for CinetPay webhook: ${cpm_trans_id}`);
            throw new Error('Payment intent not found for webhook');
        }
        if (cpm_payment_token && paymentIntent.gatewayPaymentId && cpm_payment_token !== paymentIntent.gatewayPaymentId) {
            log.error(`CinetPay payment token mismatch for ${cpm_trans_id}`);
            throw new Error('Payment token mismatch');
        }
        if (paymentIntent.status === PaymentStatus.SUCCEEDED || paymentIntent.status === PaymentStatus.FAILED) {
            log.warn(`Webhook received for already processed payment intent: ${cpm_trans_id}, Status: ${paymentIntent.status}`);
            return;
        }

        let newStatus: PaymentStatus = paymentIntent.status;
        if (cpm_trans_status === 'ACCEPTED') {
            newStatus = PaymentStatus.SUCCEEDED;
        } else if (cpm_trans_status === 'REFUSED') {
            newStatus = PaymentStatus.FAILED;
        } else {
            newStatus = PaymentStatus.PROCESSING;
        }

        let updatedIntent: IPaymentIntent | null = paymentIntent;
        if (newStatus !== paymentIntent.status) {
            updatedIntent = await paymentIntentRepository.addWebhookEvent(cpm_trans_id, newStatus, payload);
            log.info(`PaymentIntent ${cpm_trans_id} status updated to ${newStatus} via CinetPay webhook.`);
            if (!updatedIntent) {
                log.error(`Failed to update PaymentIntent ${cpm_trans_id} after CinetPay webhook event. Cannot proceed.`);
                return;
            }
        }

        // Check if status is final and updatedIntent is not null
        if (updatedIntent && (updatedIntent.status === PaymentStatus.SUCCEEDED || updatedIntent.status === PaymentStatus.FAILED)) {
            await this.handlePaymentCompletion(updatedIntent);
        }
    }

    /**
     * Handles actions common to both successful and failed payment completions,
     * including notifying the originating service.
     */
    private async handlePaymentCompletion(paymentIntent: IPaymentIntent): Promise<void> {
        log.info(`Handling payment completion for PaymentIntent ${paymentIntent.sessionId}, Status: ${paymentIntent.status}`);
        try {
            // Notify originating service (do this regardless of commission outcome)
            await this.notifyOriginatingService(paymentIntent);

            // TODO: Add any other internal logic based on payment type/status here if needed

        } catch (error) {
            log.error(`Error during post-payment completion handling for PaymentIntent ${paymentIntent.sessionId}:`, error);
        }
    }

    /**
     * Notifies the originating service about the payment intent status update.
     */
    private async notifyOriginatingService(paymentIntent: IPaymentIntent): Promise<void> {
        const { sessionId, status, metadata } = paymentIntent;
        const originatingService = metadata?.originatingService;
        const callbackUrl = metadata?.callbackPath;

        if (!originatingService || !callbackUrl || typeof originatingService !== 'string' || typeof callbackUrl !== 'string') {
            log.warn(`Cannot notify originating service for PaymentIntent ${sessionId}: missing/invalid originatingService or callbackPath in metadata.`);
            return;
        }

        const callbackPayload = {
            sessionId,
            status,
            metadata
        };

        log.info(`Sending payment status callback to ${originatingService} at ${callbackUrl} for PaymentIntent ${sessionId}`);

        try {
            await axios.post(callbackUrl, callbackPayload, {
                headers: {
                    'Authorization': `Bearer ${config.services.serviceSecret}`,
                    'Content-Type': 'application/json',
                    'X-Service-Name': 'payment-service'
                },
                timeout: 5000
            });
            log.info(`Successfully sent callback notification to ${originatingService} for ${sessionId}.`);
        } catch (error: any) {
            log.error(`Failed to send callback notification to ${originatingService} for PaymentIntent ${sessionId}:`, {
                url: callbackUrl,
                error: error.response?.data || error.message,
                status: error.response?.status
            });
            // Consider adding retry logic or marking the callback as failed
        }
    }

    /**
     * Process payment details and initiate payment, including currency conversion
     */
    public async submitPaymentDetails(
        sessionId: string,
        details: {
            phoneNumber?: string; // Optional now at input
            countryCode: string;
            paymentCurrency: string;
            operator?: string; // Added optional operator field from frontend
        }
    ): Promise<IPaymentIntent> {
        const paymentIntent = await paymentIntentRepository.findBySessionId(sessionId);

        if (!paymentIntent) {
            throw new Error('Payment intent not found');
        }

        if (!paymentIntent.amount || !paymentIntent.currency) {
            log.error(`PaymentIntent ${sessionId} is missing amount/currency during submission.`);
            throw new Error('Payment intent is incomplete. Amount/Currency missing.');
        }

        // --- Currency Conversion --- 
        let finalAmount = paymentIntent.amount;
        const finalCurrency = details.paymentCurrency;

        if (paymentIntent.currency !== finalCurrency) {
            finalAmount = await this.convertCurrency(paymentIntent.amount, paymentIntent.currency, finalCurrency);
        } else {
            log.info(`Payment currency (${finalCurrency}) matches intent currency. No conversion needed.`);
        }

        // Select Gateway first
        const selectedGateway = this.selectGateway(details.countryCode);

        // Set up update data for the PaymentIntent document
        const updateData: UpdatePaymentIntentInput = { // Use the specific Update type
            countryCode: details.countryCode,
            gateway: selectedGateway,
            paidCurrency: finalCurrency, // Store the currency user chose to pay with
            paidAmount: finalAmount,    // Store the final amount after potential conversion
            // Keep other fields undefined for now, add conditionally below
        };

        // Validate if phone number/operator is required and present *after* selecting gateway
        if (selectedGateway === PaymentGateway.FEEXPAY) {
            if (!details.phoneNumber) {
                log.error(`Feexpay requires a phone number, but it was missing for session ${sessionId}.`);
                throw new Error('Phone number is required for the selected country.');
            }
            // Check if operator selection is required for this country
            const operatorsForCountry = this.getFeexpayOperatorsForCountry(details.countryCode);
            if (operatorsForCountry && operatorsForCountry.length > 1 && !details.operator) {
                log.error(`Feexpay requires an operator selection for country ${details.countryCode}, but it was missing.`);
                throw new Error('Operator selection is required for the selected country.');
            }
            // Add phone and operator to data if they exist (operator might be null if country has only 1)
            if (details.phoneNumber) updateData.phoneNumber = details.phoneNumber;
            if (details.operator) updateData.operator = details.operator;

        } else if (selectedGateway === PaymentGateway.CINETPAY) {
            // CinetPay might require phone/email later for card payments, but not for this initial API call
            // We specifically *don't* set phone/operator here, letting them remain undefined in updateData
            // updateData.phoneNumber = undefined; // No need, default is undefined
            // updateData.operator = undefined;   // No need, default is undefined
        }

        // Update the intent before initiating payment
        const updatedIntent = await paymentIntentRepository.updateBySessionId(sessionId, updateData);

        if (!updatedIntent) {
            // Use the specific fields from updateData for logging
            log.error(`Failed to update payment intent ${sessionId} with details:`, { country: updateData.countryCode, gateway: updateData.gateway });
            throw new Error('Failed to update payment intent before initiating payment.');
        }

        log.info(`Submitting payment for ${sessionId} via ${updatedIntent.gateway}. Final Amount: ${finalAmount} ${finalCurrency}`);

        // Initialize payment with the selected gateway
        let finalPaymentIntent: IPaymentIntent | null = null;

        try {
            if (updatedIntent.gateway === PaymentGateway.FEEXPAY) {
                finalPaymentIntent = await this.initiateFeexpayPayment(updatedIntent, finalAmount, finalCurrency, details.operator);
            } else if (updatedIntent.gateway === PaymentGateway.CINETPAY) {
                finalPaymentIntent = await this.initiateCinetPayPayment(updatedIntent, finalAmount, finalCurrency);
            } else {
                log.error(`Unsupported gateway selected: ${updatedIntent.gateway} for session ${sessionId}`);
                throw new Error('Unsupported country/gateway combination.');
            }

            if (!finalPaymentIntent) {
                // This case should ideally be handled within the specific initiate methods
                log.error(`Gateway initiation returned null for ${updatedIntent.gateway}, session ${sessionId}`);
                throw new Error('Failed to initiate payment with the selected gateway.');
            }

            return finalPaymentIntent;
        } catch (error) {
            log.error(`Error during payment initiation for session ${sessionId}:`, error);
            // If payment initiation fails, update the status to ERROR
            await paymentIntentRepository.updateBySessionId(sessionId, { status: PaymentStatus.ERROR });
            throw error; // Re-throw the original error for the controller
        }
    }

    /**
     * Reset payment intent status from ERROR to PENDING_USER_INPUT to allow retries
     */
    public async resetPaymentIntentStatus(sessionId: string): Promise<IPaymentIntent | null> {
        const paymentIntent = await paymentIntentRepository.findBySessionId(sessionId);

        if (!paymentIntent) {
            throw new Error('Payment intent not found');
        }

        if (paymentIntent.status !== PaymentStatus.ERROR) {
            log.warn(`Attempted to reset payment intent that is not in ERROR state: ${sessionId}, current status: ${paymentIntent.status}`);
            return paymentIntent;
        }

        const updatedIntent = await paymentIntentRepository.updateBySessionId(
            sessionId,
            { status: PaymentStatus.PENDING_USER_INPUT }
        );

        return updatedIntent;
    }

    private selectGateway(countryCode: string): PaymentGateway {
        // Define countries for each gateway
        const feexpayCountries = ['BJ', 'CI', 'SN', 'CG', 'TG']; // Removed CM
        const cinetpayCountries = ['CM', 'BF', 'GN', 'ML', 'NE']; // Keep CM here

        // Handle Cameroon (CM) - Prioritize CinetPay
        if (countryCode === 'CM') {
            log.info(`Country CM selected, defaulting to CINETPAY.`);
            return PaymentGateway.CINETPAY;
        }

        if (feexpayCountries.includes(countryCode)) {
            return PaymentGateway.FEEXPAY;
        } else if (cinetpayCountries.includes(countryCode)) {
            return PaymentGateway.CINETPAY;
        }

        log.error(`Unsupported country code for gateway selection: ${countryCode}`);
        throw new Error(`Unsupported country code: ${countryCode}`);
    }

    private getFeexpayOperatorsForCountry(countryCode: string): string[] | undefined {
        const feexpayOperators: Record<string, string[]> = {
            'BJ': ['mtn', 'moov', 'celtiis_bj'],
            'CI': ['moov_ci', 'mtn_ci', 'orange_ci', 'wave_ci'],
            'SN': ['orange_sn', 'free_sn'],
            'CG': ['mtn_cg'],
            'TG': ['togocom_tg', 'moov_tg'],
            // 'CM': ['mtn_cm', 'orange_cm'] // Cameroon handled by CinetPay now
        };
        return feexpayOperators[countryCode];
    }

    private async initiateFeexpayPayment(
        paymentIntent: IPaymentIntent,
        amount: number,
        currency: string, // Currency determined by frontend based on country 
        operator?: string // Operator selected by user on frontend if applicable
    ): Promise<IPaymentIntent> {

        let endpointOperator = operator;

        // Determine the operator if not provided explicitly
        if (!endpointOperator) {
            const countryOperators = this.getFeexpayOperatorsForCountry(paymentIntent.countryCode!);
            if (countryOperators && countryOperators.length === 1) {
                endpointOperator = countryOperators[0];
                log.info(`Only one Feexpay operator found for ${paymentIntent.countryCode}, using: ${endpointOperator}`);
            } else {
                // If multiple operators exist but none selected, we cannot proceed reliably.
                // The validation in submitPaymentDetails should prevent this case.
                log.error(`Feexpay operator ambiguity for country ${paymentIntent.countryCode}. Operator selection required but missing.`);
                throw new Error('Operator selection is required for Feexpay payment in this country.');
            }
        }

        // Construct the dynamic endpoint
        const endpoint = `/transactions/public/requesttopay/${endpointOperator}`;
        log.info(`Constructed Feexpay endpoint: ${endpoint}`);

        // Simple validation of the operator string format
        if (!endpointOperator || !/^[a-z0-9_]+$/i.test(endpointOperator)) {
            log.error(`Invalid Feexpay operator format determined or provided: ${endpointOperator}`);
            throw new Error('Invalid payment operator specified.');
        }

        // Ensure phone number exists on the intent (should be validated earlier, but double-check)
        if (!paymentIntent.phoneNumber) {
            throw new Error('Internal error: Phone number missing for Feexpay initiation.');
        }

        // Attempt to parse phone number as integer
        let phoneNumberAsInt: number | undefined;
        try {
            const cleanedPhone = paymentIntent.phoneNumber.replace(/\s+/g, '').replace('+', '');
            if (cleanedPhone && /^[0-9]+$/.test(cleanedPhone)) {
                phoneNumberAsInt = parseInt(cleanedPhone, 10);
            }
        } catch (parseError) {
            log.error(`Error parsing Feexpay phoneNumber ${paymentIntent.phoneNumber}: ${parseError}`);
        }

        if (phoneNumberAsInt === undefined) {
            log.error(`Could not parse Feexpay phoneNumber to integer: ${paymentIntent.phoneNumber}`);
            throw new Error('Invalid phone number format provided.');
        }

        // Log details before sending
        log.info(`Initiating Feexpay payment for sessionId: ${paymentIntent.sessionId}`);
        log.info(`Feexpay endpoint: ${endpoint}, amount: ${amount}, currency: ${currency}, phone: ${phoneNumberAsInt}`);
        log.info(`Feexpay config: baseUrl=${config.feexpay.baseUrl}, shopId=${config.feexpay.shopId}`);

        const requestBody = {
            shop: config.feexpay.shopId,
            amount: amount,
            phoneNumber: phoneNumberAsInt,
            description: "Subscription Payment", // Simplified
            // Removed currency, callback_info based on previous analysis
            // Optional firstName, lastName could be added if user data is available
        };

        log.info(`Feexpay request body: ${JSON.stringify(requestBody)}`);

        try {
            const response = await axios.post(
                `${config.feexpay.baseUrl}${endpoint}`, // Use dynamically constructed endpoint
                requestBody,
                {
                    headers: {
                        Authorization: `Bearer ${config.feexpay.apiKey}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            log.info(`Feexpay response status: ${response.status}`);
            log.info(`Feexpay response data: ${JSON.stringify(response.data)}`);

            // Update payment intent with gateway response data
            const updateData: Partial<IPaymentIntent> = {
                gatewayPaymentId: response.data.reference,
                gatewayCheckoutUrl: response.data.payment_url || undefined, // May not exist for request-to-pay
                status: PaymentStatus.PENDING_PROVIDER, // Assume pending until webhook confirms
                gatewayRawResponse: response.data
            };

            // Update using repository
            const updatedIntent = await paymentIntentRepository.updateBySessionId(
                paymentIntent.sessionId,
                updateData
            );

            if (!updatedIntent) {
                throw new Error('Failed to update payment intent after Feexpay initiation');
            }

            return updatedIntent;
        } catch (error: any) {
            log.error(`Feexpay payment initiation failed for sessionId: ${paymentIntent.sessionId}`);
            if (error.response) {
                log.error(`Feexpay API Error: status=${error.response.status}, data=${JSON.stringify(error.response.data)}`);
            } else if (error.request) {
                log.error(`Feexpay no response received: ${error.message}`);
            } else {
                log.error(`Feexpay request setup error: ${error.message}`);
            }
            // Don't set status to ERROR here; let submitPaymentDetails handle it
            throw new Error('Failed to initiate Feexpay payment');
        }
    }

    private async initiateLygosPayment(paymentIntent: IPaymentIntent, amount: number, currency: string): Promise<IPaymentIntent> {
        try {
            const response = await axios.post(
                `${config.lygos.baseUrl}/gateway`,
                {
                    amount: amount,
                    currency: currency,
                    shop_name: config.lygos.shopName,
                    order_id: paymentIntent.sessionId,
                    message: `${paymentIntent.subscriptionType} - ${paymentIntent.subscriptionPlan}`,
                    success_url: `${config.frontendUrl}/payment-success?sessionId=${paymentIntent.sessionId}`,
                    failure_url: `${config.frontendUrl}/payment-failure?sessionId=${paymentIntent.sessionId}`
                },
                {
                    headers: {
                        'api-key': config.lygos.apiKey,
                        'Content-Type': 'application/json'
                    }
                }
            );

            // Update payment intent with gateway response data
            const updateData = {
                gatewayPaymentId: response.data.id,
                gatewayCheckoutUrl: response.data.link,
                status: PaymentStatus.PENDING_PROVIDER,
                gatewayRawResponse: response.data
            };

            // Update using repository
            const updatedIntent = await paymentIntentRepository.updateBySessionId(
                paymentIntent.sessionId,
                updateData
            );

            if (!updatedIntent) {
                throw new Error('Failed to update payment intent after Lygos initiation');
            }

            return updatedIntent;
        } catch (error) {
            log.error('Lygos payment initiation failed:', error);
            throw new Error('Failed to initiate Lygos payment');
        }
    }

    private async initiateCinetPayPayment(paymentIntent: IPaymentIntent, amount: number, currency: string): Promise<IPaymentIntent> {
        try {
            log.info(`Initiating CinetPay payment for sessionId: ${paymentIntent.sessionId}, amount: ${amount} ${currency}`);

            // Log config
            log.info(`CinetPay config: baseUrl=${config.cinetpay.baseUrl}, siteId=${config.cinetpay.siteId}, env=${config.nodeEnv}`);

            // Transaction ID prefix
            const transactionId = config.nodeEnv === 'production'
                ? paymentIntent.sessionId
                : `TEST_${paymentIntent.sessionId}`;

            const requestBody = {
                apikey: config.cinetpay.apiKey,
                site_id: config.cinetpay.siteId,
                transaction_id: transactionId,
                amount: amount,
                currency: currency,
                description: `${paymentIntent.subscriptionType} - ${paymentIntent.subscriptionPlan}`,
                // Use actual user data if available, otherwise placeholders
                customer_name: paymentIntent.metadata?.customerName || `User-${paymentIntent.userId}` || "User SBC", // More specific default name
                customer_surname: paymentIntent.metadata?.customerSurname || "SBC",
                customer_email: paymentIntent.metadata?.customerEmail || "no-email@sbc.com", // Default valid email
                customer_phone_number: paymentIntent.phoneNumber || "", // Keep empty string for now unless error points here
                customer_address: paymentIntent.metadata?.customerAddress || "N/A", // Use N/A as fallback
                customer_city: paymentIntent.metadata?.customerCity || paymentIntent.countryCode || "Unknown", // Use countryCode, then Unknown
                customer_country: paymentIntent.countryCode, // Already required
                customer_state: paymentIntent.metadata?.customerState || paymentIntent.countryCode || "Unknown", // Use countryCode, then Unknown
                customer_zip_code: paymentIntent.metadata?.customerZipCode || "00000", // Use 00000 as fallback
                notify_url: `${'https://sniper-xvs9.onrender.com'}/api/payments/webhooks/cinetpay`,
                return_url: `${'https://sniper-xvs9.onrender.com'}/payment-result?sessionId=${paymentIntent.sessionId}`,
                channels: "ALL",
                metadata: JSON.stringify({ sessionId: paymentIntent.sessionId }),
                lang: 'en' // Or 'fr' based on preference
            };

            // Log request
            log.info(`CinetPay request: endpoint=${config.cinetpay.baseUrl}/payment, transaction_id=${transactionId}, amount=${amount}, currency=${currency}`);

            const response = await axios.post(
                `${config.cinetpay.baseUrl}/payment`,
                requestBody,
                {
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );

            log.info(`CinetPay response status: ${response.status}, response code: ${response.data?.code}`);

            if (response.data && response.data.code === '201') {
                const updateData = {
                    gatewayPaymentId: response.data.data.payment_token,
                    gatewayCheckoutUrl: response.data.data.payment_url,
                    status: PaymentStatus.PENDING_PROVIDER,
                    gatewayRawResponse: response.data
                };
                const updatedIntent = await paymentIntentRepository.updateBySessionId(
                    paymentIntent.sessionId,
                    updateData
                );
                if (!updatedIntent) {
                    throw new Error('Failed to update payment intent after CinetPay initiation');
                }
                log.info(`CinetPay payment initiated successfully for sessionId: ${paymentIntent.sessionId}`);
                return updatedIntent;
            } else {
                log.error(`CinetPay payment initiation failed: ${JSON.stringify(response.data)}`);
                throw new Error(`Failed to initiate CinetPay payment: ${response.data?.message || 'Unknown error'}`);
            }
        } catch (error: any) {
            if (error.response) {
                log.error(`CinetPay API error: status=${error.response.status}, data=${JSON.stringify(error.response.data)}`);
            } else if (error.request) {
                log.error(`CinetPay no response: ${error.message}`);
            } else {
                log.error(`CinetPay setup error: ${error.message}`);
            }
            throw new Error('Failed to initiate CinetPay payment');
        }
    }

    /**
     * [ADMIN] Retrieves a paginated list of all payment intents/transactions with filtering.
     * Enriches transaction data with basic user information.
     */
    async adminGetAllTransactions(
        filters: Record<string, any>,
        options: PaginationOptions
    ): Promise<AdminTransactionListResponse> {
        log.info('Service: Admin getting all transactions with filters/pagination');
        // Prepare the final DB query filters, separating non-DB filters like userSearchTerm
        const dbFilters: Record<string, any> = { ...filters };
        const userSearchTerm = dbFilters.userSearchTerm as string | undefined;
        delete dbFilters.userSearchTerm; // Remove from filters passed to DB query

        log.debug('DB Filters:', dbFilters);
        log.debug('User Search Term:', userSearchTerm);
        log.debug('Options:', options);

        try {
            // 1. Find matching user IDs if userSearchTerm is provided
            let matchingUserIds: string[] | null = null;
            if (userSearchTerm && userSearchTerm.trim() !== '') {
                log.debug(`Searching user service for term: ${userSearchTerm}`);
                try {
                    // Assuming findUserIdsBySearchTerm exists and works
                    matchingUserIds = await userServiceClient.findUserIdsBySearchTerm(userSearchTerm.trim());
                    if (matchingUserIds === null || matchingUserIds.length === 0) {
                        log.info(`No users found matching search term '${userSearchTerm}'. Returning empty results.`);
                        // If no users match, no transactions will match
                        return {
                            transactions: [],
                            pagination: { currentPage: options.page, totalPages: 0, totalCount: 0, limit: options.limit }
                        };
                    }
                    log.debug(`Found ${matchingUserIds.length} potential user IDs matching search.`);
                    // Add user IDs to the database query filters
                    dbFilters.userId = { $in: matchingUserIds.map(id => new Types.ObjectId(id)) };
                } catch (userSearchError) {
                    log.error(`Error searching users in user-service for term '${userSearchTerm}':`, userSearchError);
                    throw new AppError('Failed to search users to filter transactions.', 500);
                }
            }

            // 2. Fetch paginated transactions from the repository using dbFilters
            const { intents: transactions, totalCount } = await paymentIntentRepository.findAllWithFilters(
                dbFilters, // Use the potentially modified dbFilters
                options
            );

            log.debug(`Found ${transactions.length} transactions for page ${options.page}, total: ${totalCount}`);

            // Map lean objects to the EnrichedPaymentIntent type
            let baseTransactions: IPaymentIntent[] = transactions; // Type assertion if needed after repo fix

            // 3. Enrich with User Data (if transactions found)
            let enrichedTransactions: EnrichedPaymentIntent[] = baseTransactions.map(t => ({
                ...(t as any), // Map lean object, potentially cast to any if types clash heavily
                userName: undefined, // Initialize enriched fields
                userPhoneNumber: undefined
            }));

            if (enrichedTransactions.length > 0) {
                const userIds = [...new Set(enrichedTransactions.map(t => t.userId.toString()))];
                log.debug(`Fetching user details for ${userIds.length} unique users`);
                try {
                    const users = await userServiceClient.getUsersByIds(userIds);
                    const userMap = new Map<string, { name: string; phoneNumber?: string }>(); // Store name and phone
                    users.forEach((user: UserDetails) => {
                        if (user && user._id) {
                            // Store both name and phone number from UserDetails
                            userMap.set(user._id.toString(), {
                                name: user.name,
                                phoneNumber: user.phoneNumber !== undefined ? String(user.phoneNumber) : undefined
                            });
                        }
                    });
                    log.debug(`Received details for ${userMap.size} users.`);

                    // Add userName and userPhoneNumber to each transaction
                    enrichedTransactions = enrichedTransactions.map(t => {
                        const userDetails = userMap.get(t.userId.toString());
                        return {
                            ...t,
                            userName: userDetails?.name,
                            userPhoneNumber: userDetails?.phoneNumber // Assign phone number
                        };
                    });

                } catch (userServiceError) {
                    log.error('Error fetching user details from user-service:', userServiceError);
                    // Proceed without enrichment if user service fails
                }
            }

            // 4. Calculate pagination details
            const totalPages = Math.ceil(totalCount / options.limit);

            return {
                transactions: enrichedTransactions,
                pagination: {
                    currentPage: options.page,
                    totalPages: totalPages,
                    totalCount: totalCount,
                    limit: options.limit,
                },
            };

        } catch (error) {
            log.error('Error in adminGetAllTransactions service:', error);
            if (error instanceof AppError) {
                throw error;
            }
            throw new AppError('Failed to retrieve transactions list.', 500);
        }
    }

    /**
     * [ADMIN] Retrieves a paginated list of all account transactions with filtering.
     * Enriches transaction data with basic user information.
     */
    async adminGetAllAccountTransactions(
        filters: Record<string, any>,
        options: PaginationOptions
    ): Promise<AdminAccountTransactionListResponse> {
        log.info('Service: Admin getting all ACCOUNT transactions with filters/pagination');
        // Prepare the final DB query filters, separating non-DB filters
        const dbFilters: Record<string, any> = { ...filters };
        const userSearchTerm = dbFilters.userSearchTerm as string | undefined;
        delete dbFilters.userSearchTerm;

        log.debug('DB Filters (Account Tx):', dbFilters);
        log.debug('User Search Term (Account Tx):', userSearchTerm);
        log.debug('Options (Account Tx):', options);

        try {
            // 1. Find matching user IDs if userSearchTerm is provided
            let matchingUserIds: string[] | null = null;
            if (userSearchTerm && userSearchTerm.trim() !== '') {
                log.debug(`(Account Tx) Searching user service for term: ${userSearchTerm}`);
                try {
                    matchingUserIds = await userServiceClient.findUserIdsBySearchTerm(userSearchTerm.trim());
                    if (!matchingUserIds || matchingUserIds.length === 0) {
                        log.info(`(Account Tx) No users found matching '${userSearchTerm}'.`);
                        return { transactions: [], pagination: { currentPage: options.page, totalPages: 0, totalCount: 0, limit: options.limit } };
                    }
                    log.debug(`(Account Tx) Found ${matchingUserIds.length} potential user IDs.`);
                    dbFilters.userId = { $in: matchingUserIds.map(id => new Types.ObjectId(id)) };
                } catch (userSearchError) {
                    log.error(`(Account Tx) Error searching users:`, userSearchError);
                    throw new AppError('Failed to search users for account transactions.', 500);
                }
            }

            // 2. Fetch paginated transactions from the TRANSACTION repository
            const { transactions, totalCount } = await transactionRepository.findAllWithFilters(
                dbFilters,
                options
            );

            log.debug(`(Account Tx) Found ${transactions.length} transactions, total: ${totalCount}`);

            // 3. Enrich with User Data
            // Map lean objects (ITransaction) to EnrichedAccountTransaction
            let enrichedTransactions: EnrichedAccountTransaction[] = transactions.map(t => ({
                // Explicitly map *all required* fields from ITransaction
                _id: t._id,
                userId: t.userId, // Keep as ObjectId initially
                transactionId: t.transactionId,
                type: t.type,
                status: t.status,
                amount: t.amount,
                currency: t.currency, // Use currency enum value
                fee: t.fee,
                description: t.description,
                // Map newly added optional fields
                reference: t.reference,
                serviceProvider: t.serviceProvider,
                paymentMethod: t.paymentMethod,
                externalTransactionId: t.externalTransactionId,
                metadata: t.metadata,
                createdAt: t.createdAt,
                updatedAt: t.updatedAt,
                // userName and userPhoneNumber added below
                userName: undefined,
                userPhoneNumber: undefined
            }));

            if (enrichedTransactions.length > 0) {
                // Convert userId to string for set and map keys
                const userIds = [...new Set(enrichedTransactions.map(t => t.userId.toString()))];
                log.debug(`(Account Tx) Fetching user details for ${userIds.length} users.`);
                try {
                    const users = await userServiceClient.getUsersByIds(userIds);
                    const userMap = new Map<string, { name: string; phoneNumber?: string }>();
                    users.forEach((user: UserDetails) => {
                        if (user && user._id) {
                            userMap.set(user._id.toString(), {
                                name: user.name,
                                // Handle potential non-string phone numbers from user service
                                phoneNumber: user.phoneNumber !== undefined && user.phoneNumber !== null ? String(user.phoneNumber) : undefined
                            });
                        }
                    });
                    enrichedTransactions = enrichedTransactions.map(t => {
                        const userDetails = userMap.get(t.userId.toString());
                        return {
                            ...t,
                            userName: userDetails?.name,
                            userPhoneNumber: userDetails?.phoneNumber,
                            // Convert userId back to string for final output if needed, or keep as ObjectId
                            // userId: t.userId.toString(), // Optional: uncomment if API should return string ID
                        };
                    });
                } catch (userServiceError) {
                    log.error('(Account Tx) Error fetching user details:', userServiceError);
                    // Proceed without enrichment
                }
            }

            // 4. Calculate pagination details
            const totalPages = Math.ceil(totalCount / options.limit);

            return {
                transactions: enrichedTransactions,
                pagination: {
                    currentPage: options.page,
                    totalPages: totalPages,
                    totalCount: totalCount,
                    limit: options.limit,
                },
            };

        } catch (error) {
            log.error('Error in adminGetAllAccountTransactions service:', error);
            if (error instanceof AppError) throw error;
            throw new AppError('Failed to retrieve account transactions list.', 500);
        }
    }

    // --- NEW ADMIN STATS METHODS ---

    /**
     * [ADMIN] Get total amount for completed withdrawals.
     */
    async getTotalWithdrawalsAmount(): Promise<number> {
        log.info('Calculating total completed withdrawal amount');
        try {
            const result = await TransactionModel.aggregate([
                {
                    $match: {
                        type: TransactionType.WITHDRAWAL,
                        status: TransactionStatus.COMPLETED,
                        deleted: { $ne: true } // Exclude soft-deleted
                    }
                },
                {
                    $group: {
                        _id: null, // Group all matched documents
                        // Remember withdrawal amounts are stored negative, so sum and negate
                        totalAmount: { $sum: '$amount' }
                    }
                }
            ]).exec();

            // Result is an array, check if it's empty (no completed withdrawals)
            const total = result.length > 0 ? result[0].totalAmount : 0;
            // Negate the result because withdrawal amounts are stored negatively
            return Math.abs(total);
        } catch (error) {
            log.error('Error calculating total withdrawal amount:', error);
            throw new AppError('Failed to calculate total withdrawal amount', 500);
        }
    }

    /**
     * [ADMIN] Get total revenue from completed payments.
     */
    async getTotalRevenueAmount(): Promise<number> {
        log.info('Calculating total revenue from completed payments');
        try {
            const result = await TransactionModel.aggregate([
                {
                    $match: {
                        type: TransactionType.PAYMENT,
                        status: TransactionStatus.COMPLETED,
                        deleted: { $ne: true } // Exclude soft-deleted
                    }
                },
                {
                    $group: {
                        _id: null, // Group all matched documents
                        totalAmount: { $sum: '$amount' }
                    }
                }
            ]).exec();

            // Result is an array, check if it's empty
            return result.length > 0 ? result[0].totalAmount : 0;
        } catch (error) {
            log.error('Error calculating total revenue:', error);
            throw new AppError('Failed to calculate total revenue', 500);
        }
    }

    /**
     * [ADMIN] Get monthly revenue statistics from completed payments.
     * Returns data for the last N months.
     */
    async getMonthlyRevenueStats(months: number = 12): Promise<{ month: string; totalAmount: number }[]> {
        log.info(`Calculating monthly revenue stats for the last ${months} months`);
        const endDate = new Date();
        const startDate = new Date();
        startDate.setMonth(startDate.getMonth() - months);
        startDate.setDate(1);
        startDate.setHours(0, 0, 0, 0);

        try {
            const result = await TransactionModel.aggregate([
                {
                    $match: {
                        type: TransactionType.PAYMENT,
                        status: TransactionStatus.COMPLETED,
                        deleted: { $ne: true },
                        createdAt: { $gte: startDate, $lte: endDate }
                    }
                },
                {
                    $group: {
                        _id: { // Group by year and month
                            year: { $year: '$createdAt' },
                            month: { $month: '$createdAt' }
                        },
                        totalAmount: { $sum: '$amount' }
                    }
                },
                {
                    $sort: { // Sort by year then month
                        '_id.year': 1,
                        '_id.month': 1
                    }
                },
                {
                    $project: { // Format the output
                        _id: 0,
                        month: { $concat: [{ $toString: '$_id.year' }, '-', { $toString: '$_id.month' }] }, // YYYY-M format
                        totalAmount: 1
                    }
                }
            ]).exec();

            // Fill missing months with 0 if needed by frontend
            const monthlyDataMap = new Map<string, number>();
            let currentMonthDate = new Date(startDate);
            while (currentMonthDate <= endDate) {
                const monthKey = `${currentMonthDate.getFullYear()}-${currentMonthDate.getMonth() + 1}`;
                monthlyDataMap.set(monthKey, 0);
                currentMonthDate.setMonth(currentMonthDate.getMonth() + 1);
            }

            result.forEach(stat => {
                monthlyDataMap.set(stat.month, stat.totalAmount);
            });

            // Convert map back to sorted array format expected by frontend
            return Array.from(monthlyDataMap.entries()).map(([month, totalAmount]) => ({ month, totalAmount }));

        } catch (error) {
            log.error('Error calculating monthly revenue stats:', error);
            throw new AppError('Failed to calculate monthly revenue statistics', 500);
        }
    }

    /**
     * [ADMIN] Get monthly activity overview (counts of deposits, withdrawals, payments).
     * Returns data for the last N months.
     */
    async getMonthlyActivityOverviewStats(months: number = 12): Promise<any[]> { // Define a specific return type later if needed
        log.info(`Calculating monthly activity overview stats for the last ${months} months`);
        const endDate = new Date();
        const startDate = new Date();
        startDate.setMonth(startDate.getMonth() - months);
        startDate.setDate(1);
        startDate.setHours(0, 0, 0, 0);

        try {
            const result = await TransactionModel.aggregate([
                {
                    $match: {
                        type: { $in: [TransactionType.DEPOSIT, TransactionType.WITHDRAWAL, TransactionType.PAYMENT] },
                        status: TransactionStatus.COMPLETED, // Only count completed transactions? Adjust if needed
                        deleted: { $ne: true },
                        createdAt: { $gte: startDate, $lte: endDate }
                    }
                },
                {
                    $group: {
                        _id: { // Group by year, month, and type
                            year: { $year: '$createdAt' },
                            month: { $month: '$createdAt' },
                            type: '$type'
                        },
                        count: { $sum: 1 }
                    }
                },
                {
                    $group: { // Group again by month to pivot types into fields
                        _id: {
                            year: '$_id.year',
                            month: '$_id.month'
                        },
                        monthlyCounts: {
                            $push: { // Create an array of { type: ..., count: ... } for each month
                                k: '$_id.type',
                                v: '$count'
                            }
                        }
                    }
                },
                {
                    $addFields: { // Convert the array of k-v pairs into an object { DEPOSIT: count, WITHDRAWAL: count, ... }
                        countsByType: { $arrayToObject: '$monthlyCounts' }
                    }
                },
                {
                    $sort: { // Sort by year then month
                        '_id.year': 1,
                        '_id.month': 1
                    }
                },
                {
                    $project: { // Format the final output
                        _id: 0,
                        month: { $concat: [{ $toString: '$_id.year' }, '-', { $toString: '$_id.month' }] }, // YYYY-M format
                        deposits: { $ifNull: ['$countsByType.deposit', 0] }, // Use $ifNull for types that might be missing in a month
                        withdrawals: { $ifNull: ['$countsByType.withdrawal', 0] },
                        payments: { $ifNull: ['$countsByType.payment', 0] }
                    }
                }
            ]).exec();

            // Fill missing months with 0s if needed
            const activityMap = new Map<string, { month: string; deposits: number; withdrawals: number; payments: number }>();
            let currentMonthDate = new Date(startDate);
            while (currentMonthDate <= endDate) {
                const monthKey = `${currentMonthDate.getFullYear()}-${currentMonthDate.getMonth() + 1}`;
                activityMap.set(monthKey, { month: monthKey, deposits: 0, withdrawals: 0, payments: 0 });
                currentMonthDate.setMonth(currentMonthDate.getMonth() + 1);
            }

            result.forEach(stat => {
                if (activityMap.has(stat.month)) {
                    activityMap.set(stat.month, { // Update the entry for the month
                        month: stat.month,
                        deposits: stat.deposits,
                        withdrawals: stat.withdrawals,
                        payments: stat.payments
                    });
                }
            });

            // Convert map back to sorted array
            return Array.from(activityMap.values());

        } catch (error) {
            log.error('Error calculating monthly activity overview stats:', error);
            throw new AppError('Failed to calculate monthly activity overview statistics', 500);
        }
    }

    /**
     * [ADMIN/INTERNAL] Get total completed withdrawal amount for a specific user.
     * @param userId - The ID of the user.
     * @returns The total withdrawal amount (positive number).
     */
    async getUserTotalWithdrawalsAmount(userId: string): Promise<number> {
        log.info(`Service: Getting total completed withdrawals for user ${userId}`);
        try {
            // Validate userId (basic check, could add ObjectId validation if needed)
            if (!userId) {
                throw new AppError('User ID is required', 400);
            }
            // Convert string ID to ObjectId for the repository call
            const userObjectId = new Types.ObjectId(userId);
            const totalAmount = await transactionRepository.calculateTotalWithdrawalsForUser(userObjectId);
            return totalAmount;
        } catch (error: any) {
            log.error(`Error getting total withdrawals for user ${userId}:`, error);
            // If it's already an AppError, rethrow it, otherwise wrap it
            if (error instanceof AppError) {
                throw error;
            }
            // Use the specific error message from the repository if available
            throw new AppError(error.message || 'Failed to calculate user total withdrawal amount', 500);
        }
    }

    // --- END NEW ADMIN STATS METHODS ---
}

// Export singleton instance
const paymentService = new PaymentService();
export default paymentService; 