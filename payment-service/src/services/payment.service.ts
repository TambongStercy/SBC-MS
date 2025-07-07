import { Types, Aggregate } from 'mongoose';
import transactionRepository, { CreateTransactionInput } from '../database/repositories/transaction.repository';
import paymentIntentRepository, { CreatePaymentIntentInput, UpdatePaymentIntentInput } from '../database/repositories/paymentIntent.repository';
import { TransactionStatus, TransactionType, Currency, ITransaction } from '../database/models/transaction.model';
import TransactionModel from '../database/models/transaction.model';
import { userServiceClient, UserDetails, UserDetailsWithMomo } from './clients/user.service.client';
import { productServiceClient } from './clients/product.service.client';
import notificationService, { DeliveryChannel } from './clients/notification.service.client';
import logger from '../utils/logger';
import axios from 'axios';
import { IPaymentIntent, PaymentStatus, PaymentGateway } from '../database/interfaces/IPaymentIntent';
import config from '../config'; // Import central config
import { AppError } from '../utils/errors'; // Corrected AppError import path
import { PaginationOptions } from '../types/pagination'; // Corrected Import Path
import { countryCodeToDialingPrefix, momoOperatorToCinetpayPaymentMethod, momoOperatorToCountryCode, getPrefixFromOperator, momoOperatorToCurrency } from '../utils/operatorMaps'; // NEW: Import all necessary maps and helper
import { cinetpayPayoutService, PayoutRequest as CinetPayPayoutRequest, PayoutResult as CinetPayPayoutResult, PayoutStatus as CinetPayPayoutStatus } from './cinetpay-payout.service'; // NEW: Import cinetpayPayoutService and PayoutRequest type
import { feexPayPayoutService, PayoutRequest as FeexPayPayoutRequest, PayoutResult as FeexPayPayoutResult, PayoutStatus as FeexPayPayoutStatus } from './feexpay-payout.service'; // NEW: Import feexPayPayoutService and its types

const host = 'https://sniperbuisnesscenter.com';

const log = logger.getLogger('PaymentService');

// Mapping of country codes to dialing codes
const countryDialingCodes: { [key: string]: string } = {
    'BJ': '229', // Benin
    'CI': '225', // Côte d'Ivoire
    'SN': '221', // Senegal
    'CG': '242', // Congo Brazzaville
    'TG': '228', // Togo
    'CM': '237', // Cameroon
    'BF': '226', // Burkina Faso
    'GN': '224', // Guinea
    'ML': '223', // Mali
    'NE': '227', // Niger
    'GA': '241', // Gabon
    'CD': '243', // DRC
    'KE': '254', // Kenya
    // Add other supported countries and their dialing codes
};

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

// Placeholder for TransactionServiceClient - this would be in a separate client file and properly implemented
// For now, this stub allows us to write the calling code in PaymentService.
const transactionServiceClient = {
    async processPayoutWebhookFeedback(
        internalTransactionId: string,
        finalStatus: TransactionStatus, // Use your internal status enum
        providerStatusMessage: string,  // e.g., CinetPay's cpm_error_message
        providerRawStatus: string,      // e.g., CinetPay's cpm_trans_status or equivalent
        providerName: 'cinetpay' | 'feexpay', // To identify the provider
        fullProviderPayload: any
    ): Promise<void> {
        log.info(`[TransactionServiceClient STUB] Forwarding payout webhook feedback for tx: ${internalTransactionId}, finalStatus: ${finalStatus}, provider: ${providerName}, message: "${providerStatusMessage}", rawStatus: "${providerRawStatus}"`);
        log.debug(`[TransactionServiceClient STUB] Full payload for ${internalTransactionId}:`, fullProviderPayload);
        // In a real scenario, this client would make an HTTP POST request
        // to an endpoint in the TransactionService, e.g., /internal/transactions/payout-webhook-feedback
        // await axios.post(`${config.transactionServiceBaseUrl}/internal/transactions/payout-webhook-feedback`, { ... });
        // Simulate async operation
        await new Promise(resolve => setTimeout(resolve, 50)); // Brief delay
        // In a real client, you'd handle responses and errors from TransactionService.
        log.info(`[TransactionServiceClient STUB] Successfully forwarded feedback for ${internalTransactionId}`);
    }
};
// End Placeholder

class PaymentService {
    private cinetpayTransferToken: string | null = null;
    private cinetpayTokenExpiresAt: Date | null = null;

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
            status?: string; // Optional: status from payment provider
            metadata?: Record<string, any>;
        },
        description: string
    ) {
        let userEmail: string | undefined;
        let userName: string | undefined; // Added for notification
        try {
            log.info(`Processing deposit of ${amount} ${currency} for user ${userId}`);

            // Fetch user details to get email and name *before* proceeding with transaction
            try {
                const userDetails = await userServiceClient.getUserDetails(userId.toString());
                if (!userDetails?.email) {
                    log.warn(`Could not find email for user ${userId}. Deposit processed, but notification cannot be sent.`);
                } else {
                    userEmail = userDetails.email;
                    userName = userDetails.name; // Get user's name
                    log.debug(`Found email ${userEmail} and name ${userName} for user ${userId}`);
                }
            } catch (userError: any) {
                log.error(`Failed to fetch user details for ${userId} during deposit: ${userError.message}`);
                log.warn(`Continuing deposit for ${userId} despite failing to fetch user details for notification.`);
            }

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
                    status: paymentDetails.status || 'completed', // Use status from paymentDetails or default
                    metadata: paymentDetails.metadata
                },
            });

            // Update transaction status to completed
            await transactionRepository.updateStatus(transaction.transactionId, TransactionStatus.COMPLETED);

            // Update user balance
            await userServiceClient.updateUserBalance(userId.toString(), amount);

            // Send notification only if email was found
            if (userEmail) {
                const notificationSent = await notificationService.sendTransactionSuccessEmail({
                    email: userEmail,
                    name: userName || 'Customer', // Use fetched name or default
                    transactionType: 'deposit',
                    transactionId: transaction.transactionId,
                    amount,
                    currency,
                    date: transaction.createdAt.toISOString()
                });
                if (!notificationSent) {
                    log.warn(`Failed to send deposit notification email to ${userEmail} for transaction ${transaction.transactionId}`);
                }
            } else {
                log.warn(`Skipping deposit notification for transaction ${transaction.transactionId} as user email was not available.`);
            }

            return transaction;
        } catch (error: any) {
            log.error(`Error processing deposit: ${error.message}`, error);
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
     * Initiate a withdrawal for a user.
     * The 'amount' in the request is considered the NET amount the user wants to receive
     * in the TARGET CURRENCY (derived from their MoMo operator).
     * Implements soft lock and daily limits.
     * User's balance is debited in XAF upon successful external payout.
     */
    public async initiateWithdrawal(
        userId: string | Types.ObjectId,
        netAmountDesired: number, // Renamed 'amount' to 'netAmountDesired' for clarity (this is in the target currency)
        // Removed `currency` from input, as it will be derived from momoOperator
        ipAddress?: string,
        deviceInfo?: string
    ) {
        log.info(`Initiating withdrawal request for user ${userId}: NET ${netAmountDesired} (target currency will be derived)`);

        // --- Daily Withdrawal Limit Check ---
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0); // Start of today in UTC
        const tomorrow = new Date(today);
        tomorrow.setUTCDate(today.getUTCDate() + 1); // Start of tomorrow in UTC

        const dailyWithdrawalsCount = await TransactionModel.countDocuments({
            userId: new Types.ObjectId(userId.toString()),
            type: TransactionType.WITHDRAWAL,
            status: { $in: [TransactionStatus.COMPLETED, TransactionStatus.PENDING, TransactionStatus.PROCESSING, TransactionStatus.PENDING_OTP_VERIFICATION] },
            createdAt: { $gte: today, $lt: tomorrow }
        });

        if (dailyWithdrawalsCount >= 3) {
            log.warn(`User ${userId} has reached daily withdrawal limit (${dailyWithdrawalsCount} withdrawals today).`);
            throw new AppError('You have reached your daily limit of 3 withdrawals. Please try again tomorrow.', 429); // 429 Too Many Requests
        }
        // --- End Daily Withdrawal Limit Check ---

        // --- Soft Lock / Check for existing PENDING_OTP_VERIFICATION, PENDING, or PROCESSING withdrawal ---
        const existingActiveWithdrawal = await transactionRepository.findOneByFilters({
            userId: new Types.ObjectId(userId.toString()),
            type: TransactionType.WITHDRAWAL,
            status: { $in: [TransactionStatus.PENDING_OTP_VERIFICATION, TransactionStatus.PENDING, TransactionStatus.PROCESSING] },
        });

        if (existingActiveWithdrawal) {
            log.warn(`User ${userId} has an existing active withdrawal (Tx ID: ${existingActiveWithdrawal.transactionId}, Status: ${existingActiveWithdrawal.status}).`);

            let message = `You have an ongoing withdrawal request (ID: ${existingActiveWithdrawal.transactionId}) that is currently ${existingActiveWithdrawal.status.replace(/_/g, ' ')}. Please complete or cancel it before initiating a new one.`;
            let otpExpiresAt = existingActiveWithdrawal.verificationExpiry; // Default to existing expiry

            // If the existing withdrawal is still awaiting OTP, re-send it and update expiry
            if (existingActiveWithdrawal.status === TransactionStatus.PENDING_OTP_VERIFICATION) {
                log.info(`Re-sending OTP for existing PENDING_OTP_VERIFICATION withdrawal (Tx ID: ${existingActiveWithdrawal.transactionId}).`);
                const { verificationExpiry } = await this.sendWithdrawalOTP(existingActiveWithdrawal.transactionId);
                otpExpiresAt = verificationExpiry; // Use the new expiry from re-send
                message += " An OTP has been re-sent to your registered contact for this existing request.";
            }

            return {
                transactionId: existingActiveWithdrawal.transactionId,
                amount: existingActiveWithdrawal.amount, // This is the gross amount stored in XAF
                fee: existingActiveWithdrawal.fee, // Fee stored in XAF
                // total: This should ideally represent the net amount in the *payout* currency.
                // Assuming `netAmountRequested` in metadata stores this.
                total: existingActiveWithdrawal.metadata?.netAmountRequested, // Net amount in target currency
                status: existingActiveWithdrawal.status,
                expiresAt: otpExpiresAt,
                message: message
            };
        }
        // --- End Soft Lock ---
        try {
            // Fetch user's MoMo details from user-service
            const userMomoDetails = await userServiceClient.getUserDetailsWithMomo(userId.toString());

            // Check for essential MoMo details
            if (!userMomoDetails || !userMomoDetails.momoNumber || !userMomoDetails.momoOperator) {
                log.error(`User ${userId} has no registered Mobile Money number or operator for withdrawal.`);
                throw new AppError('Your account does not have registered Mobile Money details for withdrawals. Please update your profile.', 400);
            }

            const fullMomoNumber = userMomoDetails.momoNumber;
            const momoOperator = userMomoDetails.momoOperator;

            // NEW: Derive countryCode and TARGET CURRENCY from momoOperator using the utility maps
            const countryCode = momoOperatorToCountryCode[momoOperator];
            const targetPayoutCurrency = momoOperatorToCurrency[momoOperator] as Currency; // Determine payout currency

            if (!countryCode) {
                log.error(`No country code found for momoOperator: ${momoOperator}. User ID: ${userId}`);
                throw new AppError(`Unsupported Mobile Money operator: ${momoOperator} or missing country mapping for it. Please contact support.`, 400);
            }
            if (!targetPayoutCurrency) {
                log.error(`No target payout currency found for momoOperator: ${momoOperator}. User ID: ${userId}`);
                throw new AppError(`Unsupported Mobile Money operator: ${momoOperator} or missing currency mapping for it. Please contact support.`, 400);
            }

            // Determine which payout service to use based on country code using the same logic as payments
            let payoutService;
            let payoutNotificationUrl: string;
            let providerName: 'CinetPay' | 'FeexPay';

            // Use the same gateway selection logic as payments
            const selectedGateway = this.selectGateway(countryCode);

            if (selectedGateway === PaymentGateway.CINETPAY) {
                payoutService = cinetpayPayoutService;
                providerName = 'CinetPay';
                payoutNotificationUrl = `${config.selfBaseUrl}/api/payouts/webhooks/cinetpay}`;
                log.info(`Using CinetPay for payout to ${countryCode} based on gateway selection.`);
            } else if (selectedGateway === PaymentGateway.FEEXPAY) {
                // For countries that use FeexPay
                payoutService = feexPayPayoutService;
                providerName = 'FeexPay';
                payoutNotificationUrl = `${config.selfBaseUrl}/api/payouts/webhooks/feexpay}`; // Assuming a FeexPay webhook endpoint
                log.info(`Using FeexPay for payout to ${countryCode} based on gateway selection.`);
            } else {
                log.error(`Unsupported gateway selected for withdrawal: ${selectedGateway} for country ${countryCode}`);
                throw new AppError(`Unsupported country for withdrawals: ${countryCode}`, 400);
            }

            // Derive the specific payment method slug for CinetPay OR ensure it's not explicitly passed to FeexPay
            let methodForFeeCalculation: string;
            if (providerName === 'CinetPay') {
                const cinetpayMethod = momoOperatorToCinetpayPaymentMethod[momoOperator];
                if (!cinetpayMethod) {
                    log.error(`No CinetPay payment method found for operator ${momoOperator} in country ${countryCode}. User ID: ${userId}`);
                    throw new AppError(`Unsupported Mobile Money operator: ${momoOperator} for withdrawal.`, 400);
                }
                methodForFeeCalculation = cinetpayMethod;
            } else {
                // For FeexPay, we might not use a 'method' string for fee calculation, or use a generic one
                methodForFeeCalculation = momoOperator; // Use the momoOperator directly for fee calculation
            }

            // Construct withdrawalDetails object internally
            const withdrawalDetails = {
                method: methodForFeeCalculation, // Use for fee calculation
                accountInfo: {
                    fullMomoNumber: fullMomoNumber,
                    momoOperator: momoOperator,
                    countryCode: countryCode,
                }
            };

            let grossAmountToDebitInXAF: number;
            let feeInXAF: number;

            // Perform currency conversion if target payout currency is not XAF
            if (targetPayoutCurrency !== Currency.XAF) {
                log.info(`Converting NET amount from ${targetPayoutCurrency} to XAF for balance debit.`);
                const netAmountInXAF = await this.convertCurrency(netAmountDesired, targetPayoutCurrency, Currency.XAF);
                feeInXAF = this.calculateWithdrawalFee(netAmountInXAF, Currency.XAF, withdrawalDetails.method);
                grossAmountToDebitInXAF = netAmountInXAF + feeInXAF;
                log.info(`Converted NET ${netAmountDesired} ${targetPayoutCurrency} to ${netAmountInXAF} XAF. Calculated fee: ${feeInXAF} XAF. Gross debit: ${grossAmountToDebitInXAF} XAF.`);
            } else {
                // If target currency is XAF, no conversion needed for initial calculation
                feeInXAF = this.calculateWithdrawalFee(netAmountDesired, Currency.XAF, withdrawalDetails.method);
                grossAmountToDebitInXAF = netAmountDesired + feeInXAF;
                log.info(`Target currency is XAF. Calculated fee: ${feeInXAF} XAF. Gross debit: ${grossAmountToDebitInXAF} XAF.`);
            }

            // Check if user has sufficient balance (important to do upfront) against the GROSS amount in XAF
            const userBalance = await userServiceClient.getBalance(userId.toString());
            if (userBalance < grossAmountToDebitInXAF) {
                throw new AppError('Insufficient balance', 400);
            }

            const withdrawalTransaction = await transactionRepository.create({
                userId: new Types.ObjectId(userId.toString()), // Ensure ObjectId
                type: TransactionType.WITHDRAWAL,
                amount: grossAmountToDebitInXAF, // Store the GROSS amount in XAF that will be debited
                fee: feeInXAF, // Fee stored in XAF
                currency: Currency.XAF, // Transaction currency is always XAF for balance debits
                status: TransactionStatus.PENDING_OTP_VERIFICATION,
                description: `Demande de retrait pour NET ${netAmountDesired} ${targetPayoutCurrency}. Débit brut: ${grossAmountToDebitInXAF} FCFA.`,
                metadata: {
                    method: withdrawalDetails.method,
                    accountInfo: withdrawalDetails.accountInfo, // Store derived account info
                    netAmountRequested: netAmountDesired, // Store the net amount explicitly in its original currency
                    payoutCurrency: targetPayoutCurrency, // Store the target payout currency
                    selectedPayoutService: providerName // Store which service was selected
                },
                ipAddress,
                deviceInfo
            });

            // Send OTP for verification, linking it to the newly created transaction
            const { verificationCode, verificationExpiry } = await this.sendWithdrawalOTP(withdrawalTransaction.transactionId);

            // Update the transaction with OTP details
            const updatedTransaction = await transactionRepository.update(
                withdrawalTransaction._id,
                {
                    verificationCode,
                    verificationExpiry
                }
            );

            if (!updatedTransaction) {
                log.error(`Failed to update transaction ${withdrawalTransaction.transactionId} with OTP details after creation.`);
                throw new AppError('Failed to process withdrawal request.', 500);
            }

            return {
                transactionId: updatedTransaction.transactionId,
                amount: updatedTransaction.amount, // This is the gross amount debited in XAF
                fee: updatedTransaction.fee, // Fee in XAF
                total: netAmountDesired, // Display the NET amount the user requested (in target payout currency)
                status: updatedTransaction.status,
                expiresAt: updatedTransaction.verificationExpiry,
                message: "Withdrawal initiation successful. Please check your registered contact for an OTP."
            };
        } catch (error: any) {
            log.error(`Error initiating withdrawal for user ${userId}: ${error.message}`, error);
            if (error instanceof AppError) {
                throw error;
            }
            throw new AppError(`Failed to initiate withdrawal: ${error.message}`, 500);
        }
    }

    /**
     * Verify and process a withdrawal.
     * Now operates directly on the Transaction model.
     * Removed balance debit here.
     */
    async verifyWithdrawal(transactionId: string, verificationCode: string) {
        log.info(`Verifying withdrawal transaction ${transactionId}`);

        try {
            const transaction = await transactionRepository.findByTransactionId(transactionId, { select: '+verificationCode +verificationExpiry' });

            if (!transaction) {
                throw new AppError('Withdrawal transaction not found.', 404);
            }

            if (transaction.type !== TransactionType.WITHDRAWAL) {
                throw new AppError('Transaction is not a withdrawal type.', 400);
            }

            if (transaction.status !== TransactionStatus.PENDING_OTP_VERIFICATION) {
                log.warn(`Transaction ${transactionId} is not in PENDING_OTP_VERIFICATION status. Current status: ${transaction.status}`);
                throw new AppError(`Withdrawal transaction is not awaiting OTP verification. Current status: ${transaction.status}.`, 400);
            }

            // Check OTP and expiry
            if (!transaction.verificationCode || !transaction.verificationExpiry) {
                log.error(`Transaction ${transactionId} missing OTP details for verification.`);
                throw new AppError('Internal error: Missing OTP details for verification.', 500);
            }

            if (transaction.verificationExpiry < new Date()) {
                // OTP Expired
                await transactionRepository.updateStatus(transactionId, TransactionStatus.FAILED, { failureReason: 'OTP Expired' });
                throw new AppError('Verification code expired. Please re-initiate withdrawal.', 400);
            }

            if (transaction.verificationCode !== verificationCode) {
                // Invalid OTP
                throw new AppError('Invalid verification code.', 400);
            }

            // OTP is valid and not expired. Proceed with processing.
            log.info(`OTP for transaction ${transactionId} verified successfully.`);

            // Get withdrawal details from transaction metadata
            const { userId, amount, fee, currency, metadata } = transaction; // amount here is already in XAF

            // Update transaction status to PENDING (ready for external payout)
            // Clear OTP fields now that verification is complete
            const updatedTransaction = await transactionRepository.update(transaction._id, {
                status: TransactionStatus.PENDING, // Now PENDING, awaiting external payout success
                verificationCode: undefined,
                verificationExpiry: undefined,
                metadata: {
                    ...(metadata || {}),
                    statusDetails: 'OTP verified, external payout initiated (pending provider confirmation)' // Updated message
                }
            });

            if (!updatedTransaction) {
                log.error(`Failed to update transaction ${transactionId} status to PENDING after OTP verification.`);
                throw new AppError('Failed to finalize withdrawal verification.', 500);
            }

            // Fetch user details for notification
            let userEmail: string | undefined;
            let userName: string | undefined;
            try {
                const userDetails = await userServiceClient.getUserDetails(userId.toString());
                if (!userDetails?.email) {
                    log.warn(`Could not find email for user ${userId} for withdrawal notification.`);
                } else {
                    userEmail = userDetails.email;
                    userName = userDetails.name;
                }
            } catch (userError: any) {
                log.error(`Failed to fetch user details for ${userId} during withdrawal verification for notification: ${userError.message}`);
                log.warn(`Continuing withdrawal processing for ${userId} despite failing to fetch user details.`);
            }

            // Get net amount for notification from metadata
            const netAmountForPayout = updatedTransaction.metadata?.netAmountRequested;
            const targetPayoutCurrency = updatedTransaction.metadata?.payoutCurrency as Currency;
            const selectedPayoutService = updatedTransaction.metadata?.selectedPayoutService as 'CinetPay' | 'FeexPay';

            if (netAmountForPayout === undefined || targetPayoutCurrency === undefined || !selectedPayoutService) {
                log.error(`Transaction ${updatedTransaction.transactionId} missing netAmountRequested, payoutCurrency or selectedPayoutService in metadata. Cannot initiate external payout.`);
                await transactionRepository.update(updatedTransaction._id, {
                    status: TransactionStatus.FAILED,
                    metadata: {
                        ...(updatedTransaction.metadata || {}),
                        failureReason: 'Missing net amount, payout currency or service info for external payout.',
                        statusDetails: 'Payout could not be initiated due to incomplete amount/currency/service info in transaction record.'
                    }
                });
                throw new AppError('Incomplete transaction details for payout. Cannot proceed.', 500);
            }


            // Send initial notification (user's balance is not yet debited, but transaction is "in progress")
            if (userEmail) {
                await notificationService.sendTransactionSuccessEmail({ // Maybe a specific "Withdrawal Initiated" email
                    email: userEmail,
                    name: userName || 'Customer',
                    transactionType: 'withdrawal_initiated', // More accurate type
                    transactionId: updatedTransaction.transactionId,
                    amount: netAmountForPayout, // Send net amount in its target currency for notification
                    currency: targetPayoutCurrency, // Send target currency for notification
                    date: updatedTransaction.createdAt.toISOString()
                });
                log.info(`Initial notification sent for withdrawal transaction ${transactionId}.`);
            } else {
                log.warn(`Skipping initial withdrawal notification for transaction ${transactionId} as user email was not available.`);
            }

            // CRITICAL - Trigger the actual asynchronous payout process.
            log.info(`Triggering asynchronous payout process for transaction ${updatedTransaction.transactionId}.`);

            // Extract required details for payout service from transaction metadata
            const withdrawalAccountInfo = updatedTransaction.metadata?.accountInfo as { fullMomoNumber: string; momoOperator: string; countryCode: string; };
            if (!withdrawalAccountInfo || !withdrawalAccountInfo.fullMomoNumber || !withdrawalAccountInfo.momoOperator || !withdrawalAccountInfo.countryCode) {
                log.error(`Transaction ${updatedTransaction.transactionId} missing complete account info in metadata for payout.`);
                await transactionRepository.update(updatedTransaction._id, {
                    status: TransactionStatus.FAILED,
                    metadata: {
                        ...(updatedTransaction.metadata || {}),
                        failureReason: 'Missing or incomplete account details for external payout.',
                        statusDetails: 'Payout could not be initiated due to incomplete MoMo info in transaction record.'
                    }
                });
                throw new AppError('Incomplete Mobile Money details in transaction record. Cannot proceed with payout.', 500);
            }

            const dialingPrefix = countryCodeToDialingPrefix[withdrawalAccountInfo.countryCode];
            if (!dialingPrefix) {
                log.error(`Could not derive dialing prefix for country code ${withdrawalAccountInfo.countryCode} (from transaction metadata) for transaction ${updatedTransaction.transactionId}.`);
                await transactionRepository.update(updatedTransaction._id, {
                    status: TransactionStatus.FAILED,
                    metadata: {
                        ...(updatedTransaction.metadata || {}),
                        failureReason: 'Invalid country dialing prefix configuration derived from transaction record. Cannot proceed with payout.',
                        statusDetails: 'Payout could not be initiated due to invalid country configuration.'
                    }
                });
                throw new AppError('Invalid country configuration for Mobile Money payout. Cannot proceed.', 500);
            }

            // Format phone number: remove prefix if already present and any non-digits
            const nationalPhoneNumber = withdrawalAccountInfo.fullMomoNumber.replace(/\D/g, '').startsWith(dialingPrefix)
                ? withdrawalAccountInfo.fullMomoNumber.replace(/\D/g, '').substring(dialingPrefix.length)
                : withdrawalAccountInfo.fullMomoNumber.replace(/\D/g, '');

            let payoutPromise: Promise<CinetPayPayoutResult | FeexPayPayoutResult>;

            if (selectedPayoutService === 'CinetPay') {
                const cinetpayPaymentMethod = momoOperatorToCinetpayPaymentMethod[withdrawalAccountInfo.momoOperator];
                payoutPromise = cinetpayPayoutService.initiatePayout({
                    userId: updatedTransaction.userId.toString(),
                    amount: netAmountForPayout,
                    phoneNumber: nationalPhoneNumber,
                    countryCode: withdrawalAccountInfo.countryCode,
                    recipientName: userName || 'SBC User',
                    recipientEmail: userEmail || `${updatedTransaction.userId}@sbc.com`,
                    // paymentMethod: cinetpayPaymentMethod, // Removed as per auto-detection strategy
                    description: `User Withdrawal for Transaction ${updatedTransaction.transactionId}`,
                    client_transaction_id: updatedTransaction.transactionId,
                    notifyUrl: `${config.selfBaseUrl}/api/payouts/webhooks/cinetpay}`
                });
            } else if (selectedPayoutService === 'FeexPay') {
                payoutPromise = feexPayPayoutService.initiatePayout({
                    userId: updatedTransaction.userId.toString(),
                    amount: netAmountForPayout,
                    phoneNumber: nationalPhoneNumber, // FeexPay may require national or full, depends on endpoint
                    countryCode: withdrawalAccountInfo.countryCode,
                    momoOperator: withdrawalAccountInfo.momoOperator, // FeexPay uses this to pick endpoint
                    recipientName: userName || 'SBC User',
                    recipientEmail: userEmail || `${updatedTransaction.userId}@sbc.com`,
                    description: `User Withdrawal for Transaction ${updatedTransaction.transactionId}`,
                    client_transaction_id: updatedTransaction.transactionId,
                    notifyUrl: `${config.selfBaseUrl}/api/payouts/webhooks/feexpay}` // Assuming FeexPay webhook
                });
            } else {
                log.error(`Unknown payout service selected for transaction ${updatedTransaction.transactionId}: ${selectedPayoutService}`);
                throw new AppError('Unknown payout service configured. Cannot proceed.', 500);
            }


            payoutPromise.then(payoutRes => {
                let providerTxId: string | undefined;
                let finalProviderName: string | undefined;
                let payoutMessage: string | undefined;

                if (selectedPayoutService === 'CinetPay') {
                    const cinetpayRes = payoutRes as CinetPayPayoutResult; // Cast to CinetPay's result type
                    providerTxId = cinetpayRes.cinetpayTransactionId;
                    finalProviderName = 'CinetPay';
                    payoutMessage = cinetpayRes.message;
                } else if (selectedPayoutService === 'FeexPay') {
                    const feexpayRes = payoutRes as FeexPayPayoutResult; // Cast to FeexPay's result type
                    providerTxId = feexpayRes.feexpayReference;
                    finalProviderName = 'FeexPay';
                    payoutMessage = feexpayRes.message;
                }

                if (payoutRes.success) {
                    log.info(`${finalProviderName} payout initiated for transaction ${updatedTransaction.transactionId}. Provider Tx ID: ${providerTxId}`);
                    transactionRepository.update(updatedTransaction._id, {
                        externalTransactionId: providerTxId,
                        serviceProvider: finalProviderName,
                        status: TransactionStatus.PROCESSING,
                        metadata: {
                            ...(updatedTransaction.metadata || {}),
                            payoutInitiationStatus: payoutRes.status,
                            payoutMessage: payoutMessage,
                            providerSpecificId: (payoutRes as any).lot // Store CinetPay specific lot ID if available, or client_transaction_id
                        }
                    }).catch(err => log.error(`Failed to update transaction ${updatedTransaction.transactionId} with ${finalProviderName} payout details:`, err));
                } else {
                    log.error(`${finalProviderName} payout initiation failed for transaction ${updatedTransaction.transactionId}: ${payoutMessage}`);
                    transactionRepository.update(updatedTransaction._id, {
                        status: TransactionStatus.FAILED,
                        metadata: {
                            ...(updatedTransaction.metadata || {}),
                            failureReason: `External payout initiation failed: ${payoutMessage}`,
                            payoutError: payoutMessage
                        }
                    }).catch(err => log.error(`Failed to update transaction ${updatedTransaction.transactionId} status to FAILED after payout failure:`, err));
                    if (userEmail) {
                        notificationService.sendTransactionFailureEmail({
                            email: userEmail,
                            name: userName || 'Customer',
                            transactionType: 'withdrawal',
                            transactionId: updatedTransaction.transactionId,
                            amount: netAmountForPayout,
                            currency: targetPayoutCurrency,
                            date: new Date().toISOString(),
                            reason: payoutMessage
                        }).catch(err => log.error(`Failed to send failure notification for transaction ${updatedTransaction.transactionId}:`, err));
                    }
                }
            }).catch(err => {
                log.error(`Unhandled error during payout initiation for transaction ${updatedTransaction.transactionId}:`, err);
                transactionRepository.update(updatedTransaction._id, {
                    status: TransactionStatus.FAILED,
                    metadata: {
                        ...(updatedTransaction.metadata || {}),
                        failureReason: `Internal payout system error during initiation: ${err.message}`
                    }
                }).catch(err => log.error(`Failed to update transaction ${updatedTransaction.transactionId} status to FAILED after system error:`, err));
                if (userEmail) {
                    notificationService.sendTransactionFailureEmail({
                        email: userEmail,
                        name: userName || 'Customer',
                        transactionId: updatedTransaction.transactionId,
                        transactionType: 'withdrawal',
                        amount: netAmountForPayout,
                        currency: targetPayoutCurrency,
                        date: new Date().toISOString(),
                        reason: `System error during payout initiation: ${err.message}`
                    }).catch(err => log.error(`Failed to send failure notification for transaction ${updatedTransaction.transactionId}:`, err));
                }
            });

            return {
                success: true,
                transaction: {
                    transactionId: updatedTransaction.transactionId,
                    amount: updatedTransaction.amount, // Gross amount in XAF
                    fee: updatedTransaction.fee, // Fee in XAF
                    total: netAmountForPayout, // Net amount in target payout currency
                    status: updatedTransaction.status,
                    message: "Withdrawal verified. Your payout is now being processed."
                }
            };
        } catch (error: any) {
            log.error(`Error verifying withdrawal transaction ${transactionId}: ${error.message}`, error);
            if (error instanceof AppError) {
                throw error;
            }
            throw new AppError(`Failed to verify withdrawal: ${error.message}`, 500);
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
                throw new AppError('Insufficient balance', 400); // Use AppError
            }

            // Fetch sender details for notification
            let senderEmail: string | undefined;
            let senderName: string | undefined;
            try {
                const senderDetails = await userServiceClient.getUserDetails(fromUserId.toString());
                senderEmail = senderDetails?.email;
                senderName = senderDetails?.name;
            } catch (error: any) {
                log.warn(`Could not fetch sender details for ${fromUserId} for payment notification: ${error.message}`);
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

            // Fetch recipient details for notification
            let recipientEmail: string | undefined;
            let recipientName: string | undefined;
            try {
                const recipientDetails = await userServiceClient.getUserDetails(toUserId.toString());
                recipientEmail = recipientDetails?.email;
                recipientName = recipientDetails?.name;
            } catch (error: any) {
                log.warn(`Could not fetch recipient details for ${toUserId} for payment notification: ${error.message}`);
            }

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
            if (senderEmail) {
                await notificationService.sendTransactionSuccessEmail({
                    email: senderEmail,
                    name: senderName || 'Customer',
                    transactionType: 'payment_sent', // Specific type for sender
                    transactionId: senderTransaction.transactionId,
                    amount,
                    currency,
                    date: senderTransaction.createdAt.toISOString()
                });
            } else {
                log.warn(`Skipping sender notification for payment ${senderTransaction.transactionId} as email was not available.`);
            }

            if (recipientEmail) {
                await notificationService.sendTransactionSuccessEmail({
                    email: recipientEmail,
                    name: recipientName || 'Customer',
                    transactionType: 'payment_received', // Specific type for recipient
                    transactionId: recipientTransaction.transactionId,
                    amount,
                    currency,
                    date: recipientTransaction.createdAt.toISOString()
                });
            } else {
                log.warn(`Skipping recipient notification for payment ${recipientTransaction.transactionId} as email was not available.`);
            }


            return {
                senderTransaction,
                recipientTransaction
            };
        } catch (error: any) {
            log.error(`Error processing payment: ${error.message}`, error);
            if (error instanceof AppError) {
                throw error;
            }
            throw new AppError(`Failed to process payment: ${error.message}`, 500);
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
            page?: number;
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
     * Calculate withdrawal fee.
     * The fee is calculated as a percentage of the NET amount in the specified currency.
     * Note: This fee is calculated in the currency *of the transaction record*, which is XAF.
     */
    private calculateWithdrawalFee(netAmount: number, currency: Currency, method: string): number {
        // Assume fee calculation is always on XAF amount for now,
        // and that conversion to XAF already happened before this call.
        // If different fee structures exist per currency, this would need to change.
        if (currency !== Currency.XAF) {
            log.warn(`calculateWithdrawalFee called with non-XAF currency (${currency}). Assuming amount is equivalent XAF for fee calculation.`);
            // Potentially throw an error or handle conversion if this function is meant for diverse currencies.
        }

        const feePercentage = 0.025; // 2.5%
        const fee = netAmount * feePercentage;
        return parseFloat(fee.toFixed(2));
    }

    /**
     * Send OTP for withdrawal verification.
     * Now directly updates the Transaction record with OTP details.
     */
    private async sendWithdrawalOTP(transactionId: string): Promise<{ verificationCode: string; verificationExpiry: Date }> {
        log.info(`Generating and sending OTP for withdrawal transaction: ${transactionId}`);
        const transaction = await transactionRepository.findByTransactionId(transactionId, { select: '+verificationCode +verificationExpiry' });

        if (!transaction) {
            log.error(`Transaction ${transactionId} not found for OTP generation.`);
            throw new AppError('Transaction not found.', 404);
        }

        // Generate OTP
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit OTP
        const otpExpiry = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes from now

        // Update transaction with OTP details
        await transactionRepository.update(transaction._id, {
            verificationCode: otpCode,
            verificationExpiry: otpExpiry
        });

        // Fetch user details for notification
        let userEmail: string | undefined;
        let userName: string | undefined;
        try {
            const userDetails = await userServiceClient.getUserDetails(transaction.userId.toString());
            if (!userDetails?.email) {
                log.warn(`Could not find email for user ${transaction.userId} for OTP notification.`);
            } else {
                userEmail = userDetails.email;
                userName = userDetails.name;
            }
        } catch (userError: any) {
            log.error(`Failed to fetch user details for ${transaction.userId} during OTP generation for notification: ${userError.message}`);
            log.warn(`Continuing OTP generation for ${transaction.userId} despite failing to fetch user details.`);
        }

        // Get net amount for notification from metadata
        const netAmountForNotification = transaction.metadata?.netAmountRequested;
        const targetPayoutCurrency = transaction.metadata?.payoutCurrency;

        // Send notification with OTP (e.g., via SMS or email)
        if (userEmail && netAmountForNotification !== undefined && targetPayoutCurrency !== undefined) {
            await notificationService.sendVerificationOTP(
                {
                    userId: transaction.userId.toString(),
                    recipient: userEmail,
                    channel: DeliveryChannel.EMAIL,
                    code: otpCode,
                    expireMinutes: 10,
                    isRegistration: false,
                    userName: userName || 'Customer',
                    purpose: 'withdrawal_verification',
                    // Pass the net amount for notification as that's what the user expects to receive
                    description: `Withdrawal verification code for ${netAmountForNotification} ${targetPayoutCurrency} for transaction ${transaction.transactionId}.`,
                }
            );
        } else {
            log.warn(`Skipping OTP notification for transaction ${transactionId} as user email, net amount or payout currency was not available.`);
        }

        log.info(`OTP (code: ${otpCode}) generated and sent for transaction ${transactionId}. Expires at ${otpExpiry.toISOString()}`);
        return { verificationCode: otpCode, verificationExpiry: otpExpiry };
    }

    /**
     * [NEW] Allows a user to cancel a pending withdrawal request.
     * This applies only to withdrawals in PENDING_OTP_VERIFICATION status.
     * Once verified and balance is debited, cancellation means refund.
     */
    async cancelWithdrawal(userId: string | Types.ObjectId, transactionId: string): Promise<void> {
        log.info(`Attempting to cancel withdrawal transaction ${transactionId} for user ${userId}.`);

        const transaction = await transactionRepository.findByTransactionId(transactionId);

        if (!transaction) {
            throw new AppError('Withdrawal transaction not found.', 404);
        }

        if (transaction.userId.toString() !== userId.toString()) {
            throw new AppError('Access denied: You can only cancel your own withdrawals.', 403);
        }

        if (transaction.type !== TransactionType.WITHDRAWAL) {
            throw new AppError('This transaction is not a withdrawal and cannot be cancelled this way.', 400);
        }

        // Only allow cancellation if in PENDING_OTP_VERIFICATION status
        if (transaction.status === TransactionStatus.PENDING_OTP_VERIFICATION) {
            await transactionRepository.update(transaction._id, {
                status: TransactionStatus.CANCELLED,
                verificationCode: undefined,
                verificationExpiry: undefined,
                metadata: {
                    ...(transaction.metadata || {}),
                    cancellationReason: 'User cancelled OTP verification'
                }
            });
            log.info(`Withdrawal transaction ${transactionId} for user ${userId} successfully cancelled (OTP stage).`);

            // No balance refund needed here as balance is only debited *after* OTP verification.
        } else {
            log.warn(`Withdrawal transaction ${transactionId} cannot be cancelled at its current status: ${transaction.status}.`);
            throw new AppError(`Withdrawal cannot be cancelled. It is currently in "${transaction.status}" status.`, 400);
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

        // // --- TESTING ONLY: Immediately mark as succeeded --- 
        // log.warn(`TESTING MODE: Immediately marking PaymentIntent ${paymentIntent.sessionId} as SUCCEEDED.`);
        // const updatedIntent = await paymentIntentRepository.updateBySessionId(paymentIntent.sessionId, {
        //     status: PaymentStatus.SUCCEEDED,
        //     gateway: PaymentGateway.TESTING, // Mark gateway as TESTING
        //     gatewayPaymentId: `test_${paymentIntent.sessionId}`, // Add a test gateway ID
        //     paidAmount: paymentIntent.amount, // Assume paid amount is the original amount
        //     paidCurrency: paymentIntent.currency // Assume paid currency is the original currency
        // });

        // if (!updatedIntent) {
        //     log.error(`TESTING MODE: Failed to update intent ${paymentIntent.sessionId} to SUCCEEDED. Aborting completion.`);
        //     // Throw an error because we couldn't complete the test flow
        //     throw new Error(`TESTING MODE Error: Failed to update intent ${paymentIntent.sessionId} to SUCCEEDED.`);
        // } else {
        //     log.info(`PaymentIntent ${paymentIntent.sessionId} status updated to SUCCEEDED.`);
        //     // Trigger completion logic (which now only notifies originating service)
        //     // Run this asynchronously but don't wait for it to finish before returning
        //     this.handlePaymentCompletion(updatedIntent).catch(err => {
        //         log.error(`TESTING MODE: Error in background handlePaymentCompletion for ${updatedIntent.sessionId}:`, err);
        //     });
        //     paymentIntent = updatedIntent; // Use the updated intent for the response
        // }
        // // --- END TESTING ONLY ---

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

        // Handle CFA Franc currencies (XAF and XOF) as equivalent with 1:1 rate
        const cfaFrancs = ['XAF', 'XOF'];
        if (cfaFrancs.includes(fromCurrency.toUpperCase()) && cfaFrancs.includes(toCurrency.toUpperCase())) {
            log.info(`Converting between CFA francs (${fromCurrency} -> ${toCurrency}): Using 1:1 rate`);
            return amount; // No conversion needed for CFA francs
        }

        const fromCurrencyLower = fromCurrency.toLowerCase();
        const toCurrencyLower = toCurrency.toLowerCase();

        const primaryUrl = `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${fromCurrencyLower}.json`;
        const fallbackUrl = `https://latest.currency-api.pages.dev/v1/currencies/${fromCurrencyLower}.json`;
        let exchangeRate: number | undefined = undefined;

        try {
            log.debug(`Attempting to fetch exchange rates from: ${primaryUrl}`);
            const response = await axios.get(primaryUrl, { timeout: 5000 });
            if (response.data && response.data[fromCurrencyLower] && response.data[fromCurrencyLower][toCurrencyLower]) {
                exchangeRate = response.data[fromCurrencyLower][toCurrencyLower];
                log.info(`Fetched rate from primary URL: 1 ${fromCurrency} = ${exchangeRate} ${toCurrency}`);
            } else {
                log.warn(`Rate for ${fromCurrency} -> ${toCurrency} not found in primary response.`, response.data);
            }
        } catch (error: any) {
            log.warn(`Failed to fetch from primary URL (${primaryUrl}): ${error.message}. Trying fallback.`);
            try {
                log.debug(`Attempting to fetch exchange rates from fallback: ${fallbackUrl}`);
                const fallbackResponse = await axios.get(fallbackUrl, { timeout: 5000 });
                if (fallbackResponse.data && fallbackResponse.data[fromCurrencyLower] && fallbackResponse.data[fromCurrencyLower][toCurrencyLower]) {
                    exchangeRate = fallbackResponse.data[fromCurrencyLower][toCurrencyLower];
                    log.info(`Fetched rate from fallback URL: 1 ${fromCurrency} = ${exchangeRate} ${toCurrency}`);
                } else {
                    log.warn(`Rate for ${fromCurrency} -> ${toCurrency} not found in fallback response.`, fallbackResponse.data);
                }
            } catch (fallbackError: any) {
                log.error(`Failed to fetch from fallback URL (${fallbackUrl}): ${fallbackError.message}.`);
            }
        }

        if (exchangeRate === undefined) {
            log.warn(`Could not fetch exchange rate for ${fromCurrency} -> ${toCurrency}. Defaulting to 1:1.`);
            // Fallback to 1:1 conversion if API fails
            let rate = 1;
            // For CFA francs, ensure 1:1 conversion
            if (cfaFrancs.includes(fromCurrency.toUpperCase()) && cfaFrancs.includes(toCurrency.toUpperCase())) {
                rate = 1;
                log.info(`CFA franc fallback: Using 1:1 rate for ${fromCurrency} -> ${toCurrency}`);
            }
            const convertedAmount = Math.round(amount * rate); // Use Math.round instead of Math.ceil
            log.info(`Converted amount (using fallback rate): ${convertedAmount} ${toCurrency}`);
            return convertedAmount;
        }

        const convertedAmount = Math.round(amount * exchangeRate); // Use Math.round instead of Math.ceil
        log.info(`Converted amount (using API rate): ${convertedAmount} ${toCurrency}`);
        return convertedAmount;
    }

    /**
     * Handle Feexpay webhook notification
     */
    public async handleFeexpayWebhook(payload: any): Promise<void> {
        const { reference, status, callback_info } = payload;
        const { sessionId } = callback_info || {};

        if (!reference) {
            if (sessionId) {
                log.warn(`Received Feexpay webhook with missing reference but with sessionId: ${sessionId}.`);
            } else {
                log.warn('Received Feexpay webhook with missing reference and no sessionId in callback_info. Ignoring webhook.', payload);
                throw new Error('Webhook payload missing required reference field');
            }
        }

        // Find the payment intent using ONLY the reference (which is Feexpay's ID) or sessionId if provided
        const paymentIntent = reference ? await paymentIntentRepository.findByGatewayPaymentId(reference, PaymentGateway.FEEXPAY) : await paymentIntentRepository.findBySessionId(sessionId);

        if (!paymentIntent) {
            // Use reference in the log message as sessionId might not be available
            log.error(`Payment intent not found for Feexpay webhook reference: ${reference}`);
            throw new Error('Payment intent not found for Feexpay webhook');
        }

        // Log the sessionId found from the intent for context
        log.info(`Found PaymentIntent ${paymentIntent.sessionId} for Feexpay reference ${reference}`);

        if (paymentIntent.status === PaymentStatus.SUCCEEDED || paymentIntent.status === PaymentStatus.FAILED) {
            log.warn(`Webhook received for already processed payment intent: ${paymentIntent.sessionId}, Status: ${paymentIntent.status}`);
            return;
        }

        let newStatus: PaymentStatus = paymentIntent.status;
        if (status === 'SUCCESSFUL') {
            newStatus = PaymentStatus.SUCCEEDED;
        } else if (status === 'FAILED') {
            newStatus = PaymentStatus.FAILED;
        } else {
            // If status is not SUCCESSFUL or FAILED, update internal status based on current state
            // PENDING_PROVIDER -> PROCESSING, otherwise keep current (e.g., might be PROCESSING already)
            newStatus = paymentIntent.status === PaymentStatus.PENDING_PROVIDER ? PaymentStatus.PROCESSING : paymentIntent.status;
            log.info(`Received non-final Feexpay status: ${status}. Setting internal status to ${newStatus} for ${paymentIntent.sessionId}`);
        }

        let updatedIntent: IPaymentIntent | null = paymentIntent;
        if (newStatus !== paymentIntent.status) {
            // Use the sessionId from the fetched paymentIntent
            updatedIntent = await paymentIntentRepository.addWebhookEvent(paymentIntent.sessionId, newStatus, payload);
            log.info(`PaymentIntent ${paymentIntent.sessionId} status updated to ${newStatus} via Feexpay webhook.`);
            if (!updatedIntent) {
                log.error(`Failed to update PaymentIntent ${paymentIntent.sessionId} after webhook event. Cannot proceed.`);
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
        const { cpm_trans_id, cpm_site_id, cpm_error_message, cpm_payment_token, cpm_amount, cpm_currency } = payload;

        if (!cpm_trans_id || !cpm_site_id || !cpm_error_message) {
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

        // Log amount comparison for fee analysis
        if (cpm_amount && paymentIntent.paidAmount) {
            const expectedAmount = paymentIntent.paidAmount;
            const receivedAmount = parseFloat(cpm_amount);
            const feeDifference = expectedAmount - receivedAmount;
            const feePercentage = ((feeDifference / expectedAmount) * 100).toFixed(2);

            log.info(`CinetPay Fee Analysis for ${cpm_trans_id}:`);
            log.info(`Expected Amount: ${expectedAmount} ${cpm_currency || paymentIntent.paidCurrency}`);
            log.info(`Received Amount: ${receivedAmount} ${cpm_currency || paymentIntent.paidCurrency}`);
            log.info(`Fee Deducted: ${feeDifference} (${feePercentage}%)`);
        }

        let newStatus: PaymentStatus = paymentIntent.status;
        if (cpm_error_message === 'SUCCES') {
            newStatus = PaymentStatus.SUCCEEDED;
        } else if (cpm_error_message === 'TRANSACTION_CANCEL') {
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
            phoneNumber?: string; // National format from user
            countryCode: string;
            paymentCurrency: string;
            operator?: string;
            otp?: string; // Added for Orange Senegal OTP
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

        // --- Construct Full Phone Number ---
        let fullPhoneNumber: string | undefined = details.phoneNumber;
        if (details.countryCode && details.phoneNumber) {
            const dialingCode = countryDialingCodes[details.countryCode];
            if (dialingCode) {
                // Remove ALL non-digit characters from the national number part
                const nationalNumber = details.phoneNumber.replace(/\D/g, '');
                fullPhoneNumber = dialingCode + nationalNumber;
                log.info(`Constructed full phone number for ${details.countryCode}: ${fullPhoneNumber} from national: ${details.phoneNumber}`);
            } else {
                log.warn(`No dialing code found for country: ${details.countryCode}. Using phone number as is: ${details.phoneNumber}`);
                // fullPhoneNumber remains details.phoneNumber in this case
            }
        } else {
            log.info('Phone number or country code not provided for full phone number construction.');
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
            phoneNumber: fullPhoneNumber, // Store the full international phone number
            // Keep other fields undefined for now, add conditionally below
        };

        // Validate if phone number/operator is required and present *after* selecting gateway
        if (selectedGateway === PaymentGateway.FEEXPAY) {
            if (!updateData.phoneNumber) { // Check the potentially modified fullPhoneNumber
                log.error(`Feexpay requires a phone number, but it was missing or could not be constructed for session ${sessionId}.`);
                throw new Error('Phone number is required for the selected country.');
            }
            // Check if operator selection is required for this country
            const operatorsForCountry = this.getFeexpayOperatorsForCountry(details.countryCode);
            if (operatorsForCountry && operatorsForCountry.length > 1 && !details.operator) {
                log.error(`Feexpay requires an operator selection for country ${details.countryCode}, but it was missing.`);
                throw new Error('Operator selection is required for the selected country.');
            }
            // Add phone and operator to data if they exist (operator might be null if country has only 1)
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
                finalPaymentIntent = await this.initiateFeexpayPayment(updatedIntent, finalAmount, finalCurrency, details.operator, details.otp);
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
        // Countries that use CinetPay
        const cinetpaySupportedCountries = [
            'BF', // Burkina Faso
            'ML', // Mali
            'NE', // Niger
            'BJ', // Bénin
            'CI', // Côte d'Ivoire
            'CM', // Cameroun
            'SN'  // Sénégal
        ];

        if (cinetpaySupportedCountries.includes(countryCode)) {
            log.info(`Country ${countryCode} selected, using CINETPAY.`);
            return PaymentGateway.CINETPAY;
        } else {
            // List of remaining countries that should use FeexPay
            const feexpaySupportedCountries = ['CG', 'GN', 'GA', 'CD', 'KE', 'TG']; // Added Togo
            if (feexpaySupportedCountries.includes(countryCode)) {
                log.info(`Country ${countryCode} selected, using FEEXPAY.`);
                return PaymentGateway.FEEXPAY;
            }
        }

        log.error(`Unsupported country code for gateway selection: ${countryCode}`);
        throw new Error(`Unsupported country code: ${countryCode}. Payments for this country are not currently enabled.`);
    }

    private getFeexpayOperatorsForCountry(countryCode: string): string[] | undefined {
        const feexpayOperators: Record<string, string[]> = {
            'BJ': ['mtn', 'moov', 'celtiis_bj'],
            'CI': ['moov_ci', 'mtn_ci', 'orange_ci', 'wave_ci'],
            'SN': ['orange_sn', 'free_sn'],
            'CG': ['mtn_cg'],
            'TG': ['togocom_tg', 'moov_tg'],
            'BF': ['moov_bf', 'orange_bf'], // Added Burkina Faso
            // 'CM': ['mtn_cm', 'orange_cm'] // Cameroon handled by CinetPay now
        };
        return feexpayOperators[countryCode];
    }

    private async initiateFeexpayPayment(
        paymentIntent: IPaymentIntent,
        amount: number,
        currency: string, // Currency determined by frontend based on country 
        operator?: string, // Operator selected by user on frontend if applicable
        otp?: string // Added for Orange Senegal OTP
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
            log.error(`Error parsing FeexPay phoneNumber ${paymentIntent.phoneNumber}: ${parseError}`);
        }

        if (phoneNumberAsInt === undefined) {
            log.error(`Could not parse FeexPay phoneNumber to integer: ${paymentIntent.phoneNumber}`);
            throw new Error('Invalid phone number format provided.');
        }

        // Log details before sending
        log.info(`Initiating FeexPay payment for sessionId: ${paymentIntent.sessionId}`);
        log.info(`FeexPay endpoint: ${endpoint}, amount: ${amount}, currency: ${currency}, phone: ${phoneNumberAsInt}`);
        log.info(`FeexPay config: baseUrl=${config.feexpay.baseUrl}, shopId=${config.feexpay.shopId}`);

        const userDetails = await userServiceClient.getUserDetails(paymentIntent.userId);

        const requestBody: {
            shop: string;
            amount: number;
            phoneNumber: number;
            description: string;
            firstName: string;
            lastName: string;
            callback_info: any;
            otp?: string; // Added optional otp property
        } = {
            shop: config.feexpay.shopId,
            amount: amount,
            phoneNumber: phoneNumberAsInt,
            description: `Subscription Payment for user ${paymentIntent.userId}`, // Simplified
            firstName: userDetails?.name || "User",
            lastName: userDetails?.phoneNumber?.toString() || "SBC",
            callback_info: {
                sessionId: paymentIntent.sessionId,
                userId: paymentIntent.userId,
                userName: userDetails?.name || "User",
                userPhoneNumber: userDetails?.phoneNumber?.toString() || "SBC",
                userEmail: userDetails?.email || "no-email@sbc.com",
                userCountry: userDetails?.country || "N/A",
                userCity: userDetails?.city || "Unknown",
            },
            // Removed currency, callback_info based on previous analysis
            // Optional firstName, lastName could be added if user data is available
        };

        // Add OTP to request body if operator is orange_sn and OTP is provided
        if (endpointOperator === 'orange_sn' && otp) {
            requestBody.otp = otp;
            log.info(`Orange SN: Added OTP to FeexPay request body.`);
        } else if (endpointOperator === 'orange_sn' && !otp) {
            log.error(`FeexPay operator is orange_sn but OTP is missing for session ${paymentIntent.sessionId}.`);
            // This case should ideally be prevented by client-side validation requiring OTP for orange_sn
            throw new Error('OTP is required for Orange Senegal payments.');
        }

        log.info(`FeexPay request body: ${JSON.stringify(requestBody)}`);

        try {
            // TEMPORARY DEBUG LOGGING - REMOVE AFTER VERIFICATION
            log.info(`[DEBUG] Using FeexPay API Key: "${config.feexpay.apiKey}"`);
            const authHeader = `Bearer ${config.feexpay.apiKey}`;
            log.info(`[DEBUG] Constructed FeexPay Authorization Header: "${authHeader}"`);
            // END TEMPORARY DEBUG LOGGING

            const response = await axios.post(
                `${config.feexpay.baseUrl}${endpoint}`, // Use dynamically constructed endpoint
                requestBody,
                {
                    headers: {
                        Authorization: authHeader,
                        'Content-Type': 'application/json'
                    }
                }
            );

            log.info(`FeexPay response status: ${response.status}`);
            log.info(`FeexPay response data: ${JSON.stringify(response.data)}`);

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
                throw new Error('Failed to update payment intent after FeexPay initiation');
            }

            return updatedIntent;
        } catch (error: any) {
            log.error(`FeexPay payment initiation failed for sessionId: ${paymentIntent.sessionId}`);
            if (error.response) {
                log.error(`FeexPay API Error: status=${error.response.status}, data=${JSON.stringify(error.response.data)}`);
            } else if (error.request) {
                log.error(`FeexPay no response received: ${error.message}`);
            } else {
                log.error(`FeexPay request setup error: ${error.message}`);
            }
            // Don't set status to ERROR here; let submitPaymentDetails handle it
            throw new Error('Failed to initiate FeexPay payment');
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

            // Calculate total amount including 3.5% processing fee
            // User pays: originalAmount + 3.5% fee, Merchant receives: ~originalAmount after CinetPay deducts fees
            const processingFeePercentage = 0.035; // 3.5%
            const totalAmountWithFees = Math.round(amount * (1 + processingFeePercentage));

            log.info(`CinetPay fee calculation: Original=${amount} ${currency}, With 3.5% fee=${totalAmountWithFees} ${currency}`);

            const requestBody = {
                apikey: config.cinetpay.apiKey,
                site_id: config.cinetpay.siteId,
                transaction_id: transactionId,
                amount: totalAmountWithFees, // Send amount + 3.5% fee
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
                notify_url: `${host}/api/payments/webhooks/cinetpay`,
                return_url: `${host}`,
                channels: "ALL",
                metadata: JSON.stringify({ sessionId: paymentIntent.sessionId }),
                lang: 'en', // Or 'fr' based on preference
                invoice_data: {
                    "Subscription": `${paymentIntent.subscriptionType}`,
                    "Plan": `${paymentIntent.subscriptionPlan}`,
                    "Processing Fee": `${Math.round(amount * processingFeePercentage)} ${currency}`
                }
            };

            // Log request
            log.info(`CinetPay request: endpoint=${config.cinetpay.baseUrl}/payment, transaction_id=${transactionId}, amount=${totalAmountWithFees}, currency=${currency}`);

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
     * Updated to handle data inconsistencies and provide accurate calculations.
     */
    async getTotalWithdrawalsAmount(): Promise<number> {
        log.info('Calculating total completed withdrawal amount with improved accuracy');
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
                    $project: {
                        // Normalize amounts: withdrawals should be negative, but handle edge cases
                        normalizedAmount: {
                            $cond: {
                                if: { $gt: ['$amount', 0] },
                                then: { $multiply: ['$amount', -1] }, // Convert positive to negative
                                else: '$amount' // Keep negative as is
                            }
                        },
                        amount: 1,
                        transactionId: 1,
                        createdAt: 1
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalAmount: { $sum: '$normalizedAmount' },
                        count: { $sum: 1 },
                        positiveAmounts: {
                            $sum: {
                                $cond: {
                                    if: { $gt: ['$amount', 0] },
                                    then: 1,
                                    else: 0
                                }
                            }
                        }
                    }
                }
            ]).exec();

            if (result.length === 0) {
                log.info('No completed withdrawals found');
                return 0;
            }

            const data = result[0];
            const total = Math.abs(data.totalAmount); // Take absolute value since withdrawals should be negative
            const count = data.count;
            const positiveAmountCount = data.positiveAmounts;

            log.info(`Total withdrawal calculation: ${count} transactions, ${total} F total`);

            if (positiveAmountCount > 0) {
                log.warn(`Found ${positiveAmountCount} withdrawal transactions with positive amounts. These may indicate data issues.`);
            }

            // Additional validation: check if result seems unreasonable
            if (total > 100000000) { // > 100M F seems unreasonable
                log.warn(`Total withdrawal amount (${total} F) seems unusually high. This may indicate data issues.`);

                // Get a sample of large transactions for investigation
                const largeTxs = await TransactionModel.find({
                    type: TransactionType.WITHDRAWAL,
                    status: TransactionStatus.COMPLETED,
                    deleted: { $ne: true },
                    $or: [
                        { amount: { $gt: 1000000 } },
                        { amount: { $lt: -1000000 } }
                    ]
                }).select('transactionId amount createdAt').limit(5).lean();

                if (largeTxs.length > 0) {
                    log.warn(`Sample large withdrawal transactions:`, largeTxs.map(tx => ({
                        id: tx.transactionId,
                        amount: tx.amount,
                        date: tx.createdAt
                    })));
                }
            }

            return total;
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

    // --- NEW CINTPAY TRANSFER/PAYOUT METHODS ---

    /**
     * Fetches or refreshes the CinetPay transfer API authentication token.
     * Token is valid for 5 minutes.
     */
    private async getCinetpayTransferAuthToken(): Promise<string> {
        if (this.cinetpayTransferToken && this.cinetpayTokenExpiresAt && this.cinetpayTokenExpiresAt > new Date(Date.now() + 60 * 1000)) { // Check if token exists and valid for at least 1 more minute
            log.info('Using cached CinetPay transfer token.');
            return this.cinetpayTransferToken;
        }

        log.info('Requesting new CinetPay transfer token...');
        try {
            const params = new URLSearchParams();
            params.append('apikey', config.cinetpay.apiKey); // Use main apikey for transfer token too as per CinetPay setup
            params.append('password', config.cinetpay.apiPassword); // API Password set in CinetPay dashboard for transfers

            const response = await axios.post(
                `${config.cinetpay.transferBaseUrl}/auth/login`, // Corrected: Use transferBaseUrl
                params,
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                    // lang: 'fr' // Optional: if you want responses in French, CinetPay API might support lang query param
                }
            );

            if (response.data && response.data.code === 0 && response.data.data && response.data.data.token) {
                this.cinetpayTransferToken = response.data.data.token;
                this.cinetpayTokenExpiresAt = new Date(Date.now() + 4 * 60 * 1000); // Set expiry to 4 mins to be safe
                log.info('Successfully obtained CinetPay transfer token.');
                return this.cinetpayTransferToken!;
            } else {
                log.error('Failed to get CinetPay transfer token', response.data);
                throw new AppError(`Failed to authenticate with CinetPay for transfers: ${response.data?.message || 'Unknown error'}`, response.data?.code || 500);
            }
        } catch (error: any) {
            log.error('Error requesting CinetPay transfer token:', error.response?.data || error.message);
            throw new AppError(`Error during CinetPay transfer authentication: ${error.response?.data?.message || error.message}`, error.response?.status || 500);
        }
    }

    /**
     * Adds a contact to CinetPay. This might be a prerequisite for transfers to new numbers.
     * Refer to CinetPay documentation for specifics on whether this is always needed.
     */
    private async addCinetpayContact(
        token: string,
        contactDetails: {
            prefix: string; // e.g., "225"
            phone: string; // national number, e.g., "01020304"
            name: string; // User's first name
            surname: string; // User's last name
            email: string;
        }
    ): Promise<boolean> {
        log.info(`Attempting to add/verify CinetPay contact: ${contactDetails.prefix}${contactDetails.phone}`);
        log.info('Contact details received:', contactDetails);
        try {
            const contactDataArray = [{
                prefix: contactDetails.prefix,
                phone: contactDetails.phone,
                name: contactDetails.name,
                surname: contactDetails.surname,
                email: contactDetails.email,
            }];

            log.info('Contact data array for CinetPay:', contactDataArray);
            const params = new URLSearchParams();
            params.append('data', JSON.stringify(contactDataArray));

            log.info('URLSearchParams before sending:', params.toString());

            const response = await axios.post(
                `${config.cinetpay.transferBaseUrl}/transfer/contact?token=${token}&lang=en`,
                params, // URLSearchParams object as the request body
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                }
            );

            if (response.data && response.data.code === 0 && response.data.data && response.data.data.length > 0) {
                log.info(`CinetPay contact processed for ${contactDetails.prefix}${contactDetails.phone}. Response:`, response.data.data[0]);
                if (response.data.data[0].status === 'INVALID_PHONE_NUMBER') {
                    log.warn(`Cinetpay says: Invalid phone number for contact ${contactDetails.prefix}${contactDetails.phone}`);
                    return false;
                }
                return true;
            } else {
                log.warn(`Failed to add/verify CinetPay contact for ${contactDetails.prefix}${contactDetails.phone}. Response:`, response.data);
                return false;
            }
        } catch (error: any) {
            log.error(`Error adding CinetPay contact ${contactDetails.prefix}${contactDetails.phone}:`, error.response?.data || error.message);
            return false;
        }
    }

    /**
     * Processes a single CinetPay money transfer (payout).
     * Requires prior authentication (token) and potentially adding contact.
     */
    public async processCinetpayTransfer(
        transferDetails: {
            transactionId: string; // Our internal transaction ID for reference
            prefix: string;      // Country dialing code, e.g., "237"
            phone: string;       // National phone number, e.g., "676746210"
            amount: number;      // Amount to transfer (must be integer, multiple of 5)
            currency: string;    // e.g., "XAF"
            firstName: string;
            lastName: string;
            email: string;
            paymentMethod?: string; // Specific CinetPay payment method like "MTN_MOMO_CMR"
            notifyUrl?: string;  // Webhook URL for CinetPay to send status updates
        }
    ): Promise<{ success: boolean; providerTransactionId?: string; lot?: string; message?: string; error?: any }> {
        log.info(`Initiating CinetPay transfer for clientTxId: ${transferDetails.transactionId} to ${transferDetails.prefix}${transferDetails.phone}, Amount: ${transferDetails.amount} ${transferDetails.currency}`);

        // 1. Validate Amount (integer, multiple of 5)
        if (!Number.isInteger(transferDetails.amount) || transferDetails.amount % 5 !== 0) {
            const message = `CinetPay transfer amount must be an integer and a multiple of 5. Received: ${transferDetails.amount}`;
            log.error(message);
            return { success: false, message, error: { code: 'INVALID_AMOUNT_FORMAT' } };
        }

        try {
            const token = await this.getCinetpayTransferAuthToken();

            // 2. Add/Verify contact (CinetPay API docs state this is a prerequisite)
            const contactAddedOrVerified = await this.addCinetpayContact(token, {
                prefix: transferDetails.prefix,
                phone: transferDetails.phone,
                name: transferDetails.firstName,
                surname: transferDetails.lastName,
                email: transferDetails.email
            });

            if (!contactAddedOrVerified) {
                // Log this, but CinetPay might still process it if contact existed OR if the error was in our request format to add contact.
                // However, if Cinetpay explicitly said invalid phone, we should stop.
                log.warn(`CinetPay contact add/verify step indicates failure for ${transferDetails.prefix}${transferDetails.phone}. Transfer might fail.`);
                // Depending on strictness, could return failure here:
                // return { success: false, message: 'Failed to add or verify CinetPay contact before transfer.', error: { code: 'CONTACT_SETUP_FAILED'}}; 
            }

            // 3. Prepare Transfer Data for x-www-form-urlencoded
            const transferRequestParams = new URLSearchParams();
            transferRequestParams.append('token', token);
            transferRequestParams.append('cpm_trans_id', transferDetails.transactionId.substring(0, 20)); // Max 20 chars
            transferRequestParams.append('cpm_phone_prefixe', transferDetails.prefix);
            transferRequestParams.append('cpm_cel_phone_num', transferDetails.phone);
            transferRequestParams.append('cpm_amount', String(transferDetails.amount));
            transferRequestParams.append('cpm_currency', transferDetails.currency.toUpperCase());
            transferRequestParams.append('cpm_payment_config', transferDetails.paymentMethod ? transferDetails.paymentMethod.toUpperCase() : 'MOBILEMONEY');
            transferRequestParams.append('cpm_designation', `Retrait SBC ${transferDetails.transactionId}`.substring(0, 100));
            transferRequestParams.append('notify_url', transferDetails.notifyUrl || `${config.paymentServiceBaseUrl}/api/payments/webhooks/cinetpay/transfer-status`);
            // As per CinetPay docs for /transfer/money/send/contact, 'data' is not used here.
            // The parameters are sent directly in the x-www-form-urlencoded body.

            log.info('Sending CinetPay transfer money request with params:', Object.fromEntries(transferRequestParams));

            // 4. Make the Transfer API Call
            const response = await axios.post(
                `${config.cinetpay.transferBaseUrl}/transfer/money/send/contact`,
                transferRequestParams,
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                }
            );

            log.info('CinetPay transfer money response:', response.data);

            // 5. Handle Response
            if (response.data && response.data.code === 0 && response.data.data) {
                const responseData = response.data.data;
                let details;
                // The /transfer/money/send/contact endpoint returns an array of objects, even for a single contact transfer.
                if (Array.isArray(responseData) && responseData.length > 0) {
                    details = responseData[0];
                } else {
                    log.error(`CinetPay transfer response data.data format unexpected (expected array for /send/contact) for ${transferDetails.transactionId}`, response.data);
                    return { success: false, message: 'CinetPay transfer response data format error.', error: response.data };
                }

                // treatment_status for single contact could be NEW, PROCESSING, etc.
                if (details && (details.treatment_status === 'NEW' || details.treatment_status === 'PROCESSING')) {
                    log.info(`CinetPay transfer successfully submitted for ${transferDetails.transactionId}. Lot: ${details.lot}, Provider Tx ID (client_transaction_id): ${details.client_transaction_id}, Status: ${details.treatment_status}`);
                    return {
                        success: true,
                        providerTransactionId: details.client_transaction_id,
                        lot: details.lot,
                        message: `Transfer submitted. Status: ${details.treatment_status}`
                    };
                } else {
                    log.warn(`CinetPay transfer for ${transferDetails.transactionId} submitted but status is not NEW/PROCESSING: ${details?.treatment_status || 'Unknown'}. Message: ${response.data.message}`, details);
                    return {
                        success: false,
                        message: `CinetPay transfer status: ${details?.treatment_status || response.data.message}`,
                        providerTransactionId: details?.client_transaction_id,
                        lot: details?.lot,
                        error: response.data
                    };
                }
            } else if (response.data && response.data.code === 604) { // Insufficient Balance
                log.error(`CinetPay transfer for ${transferDetails.transactionId} failed: Insufficient balance.`, response.data);
                return { success: false, message: response.data.message || 'Insufficient balance for CinetPay transfer.', error: response.data };
            } else {
                log.error(`CinetPay transfer for ${transferDetails.transactionId} failed. Code: ${response.data?.code}, Message: ${response.data?.message}`, response.data);
                return { success: false, message: response.data?.message || 'CinetPay transfer failed.', error: response.data };
            }

        } catch (error: any) {
            log.error(`Critical error during CinetPay transfer for ${transferDetails.transactionId}:`, error.response?.data || error.message);
            return {
                success: false,
                message: `CinetPay transfer system error: ${error.response?.data?.message || error.message}`,
                error: error.response?.data || { code: 'SYSTEM_ERROR', message: error.message }
            };
        }
    }

    // Placeholder for FeexPay Payout (details depend on FeexPay's Payout API)
    public async processFeexpayPayout(
        internalTransactionId: string,
        fullInternationalPhoneNumber: string, // e.g., "237676746210"
        operatorSlug: string,           // e.g., "mtn_cmr" or "togocom_tg"
        amount: number,
        currency: string // e.g., "XAF" or "XOF"
    ): Promise<{ success: boolean; providerTransactionId?: string; message?: string; error?: any }> {
        log.info(`Processing FeexPay payout for transaction ${internalTransactionId}: ${amount} ${currency} to ${fullInternationalPhoneNumber} via ${operatorSlug}`);

        try {
            // Parse the phone number to get country code and national number
            const phoneMatch = fullInternationalPhoneNumber.match(/^(\d{3})(\d+)$/);
            if (!phoneMatch) {
                throw new Error(`Invalid phone number format: ${fullInternationalPhoneNumber}`);
            }

            const dialingCode = phoneMatch[1]; // e.g., "228"
            const nationalPhoneNumber = phoneMatch[2]; // e.g., "12345678"

            // Map dialing code to country code
            const countryCodeMap: Record<string, string> = {
                '228': 'TG', // Togo
                '225': 'CI', // Côte d'Ivoire
                '221': 'SN', // Senegal
                '242': 'CG', // Congo
                '224': 'GN', // Guinea
                '241': 'GA', // Gabon
                '243': 'CD', // DRC
                '254': 'KE', // Kenya
            };

            const countryCode = countryCodeMap[dialingCode];
            if (!countryCode) {
                throw new Error(`Unsupported country for FeexPay payout. Dialing code: ${dialingCode}`);
            }

            log.info(`Detected country: ${countryCode} for FeexPay payout`);

            // Prepare the payout request
            const payoutRequest: FeexPayPayoutRequest = {
                userId: internalTransactionId, // Use transaction ID as user identifier for this context
                amount: amount,
                phoneNumber: nationalPhoneNumber, // FeexPay expects national format
                countryCode: countryCode,
                momoOperator: operatorSlug,
                description: `Withdrawal payout for transaction ${internalTransactionId}`,
                client_transaction_id: internalTransactionId,
                notifyUrl: `${config.selfBaseUrl}/api/payouts/webhooks/feexpay`
            };

            log.info(`Initiating FeexPay payout with request:`, {
                ...payoutRequest,
                phoneNumber: '***' + payoutRequest.phoneNumber.slice(-4) // Hide phone number in logs
            });

            // Call the FeexPay payout service
            const result = await feexPayPayoutService.initiatePayout(payoutRequest);

            log.info(`FeexPay payout result for ${internalTransactionId}:`, {
                success: result.success,
                status: result.status,
                message: result.message,
                feexpayReference: result.feexpayReference
            });

            return {
                success: result.success,
                providerTransactionId: result.feexpayReference,
                message: result.message,
                error: result.success ? undefined : result.error
            };

        } catch (error: any) {
            log.error(`Error in FeexPay payout for transaction ${internalTransactionId}:`, error);
            return {
                success: false,
                message: `FeexPay payout failed: ${error.message}`,
                error: error
            };
        }
    }

    /**
     * Processes incoming webhook notifications for CinetPay Transfer (Payout) status changes.
     * This method will be called by the PaymentController when a webhook is received.
     */
    public async processCinetpayTransferStatusWebhook(payload: any): Promise<void> {
        log.info('Processing CinetPay Transfer Status Webhook. Raw Payload:', payload);

        if (!payload) {
            log.warn('Received empty payload for CinetPay Transfer Webhook.');
            throw new AppError('Empty webhook payload received from CinetPay.', 400);
        }

        // Essential fields from CinetPay Transfer Webhook documentation
        const internalTransactionId = payload.cpm_trans_id;
        const siteId = payload.cpm_site_id;
        const cinetpayErrorMessage = payload.cpm_error_message; // e.g., "SUCCES", "ECHEC"
        const cinetpayTransactionStatus = payload.cpm_trans_status; // e.g., "ACCEPTED", "REFUSED", "PENDING"
        // Other potentially useful fields: cpm_amount, cpm_currency, payment_method, cel_phone_num

        if (!internalTransactionId) {
            log.error('CinetPay Transfer Webhook: Missing cpm_trans_id in payload.', payload);
            throw new AppError('Missing transaction identifier (cpm_trans_id) in CinetPay transfer webhook.', 400);
        }

        if (!siteId) {
            log.warn('CinetPay Transfer Webhook: Missing cpm_site_id in payload. Proceeding with caution.', payload);
            // Depending on security policy, you might throw an error here.
            // throw new AppError('Missing site identifier (cpm_site_id) in CinetPay transfer webhook.', 400);
        } else if (siteId !== config.cinetpay.siteId) {
            log.error(`CinetPay Transfer Webhook: Site ID mismatch. Expected ${config.cinetpay.siteId}, Received ${siteId}. Payload:`, payload);
            throw new AppError(`Invalid Site ID in CinetPay transfer webhook. Expected ${config.cinetpay.siteId}.`, 400);
        }

        log.info(`Webhook details: internalTxId=${internalTransactionId}, siteId=${siteId}, errorMessage="${cinetpayErrorMessage}", txStatus="${cinetpayTransactionStatus}"`);

        // Determine the final status of the transaction
        let finalStatus: TransactionStatus;
        if (cinetpayTransactionStatus === 'ACCEPTED' || cinetpayErrorMessage === 'SUCCES') {
            finalStatus = TransactionStatus.COMPLETED;
            log.info(`Mapped CinetPay status (${cinetpayTransactionStatus}/${cinetpayErrorMessage}) to COMPLETED for tx: ${internalTransactionId}`);
        } else {
            finalStatus = TransactionStatus.FAILED;
            log.info(`Mapped CinetPay status (${cinetpayTransactionStatus}/${cinetpayErrorMessage}) to FAILED for tx: ${internalTransactionId}`);
        }

        try {
            // Forward the processed information to TransactionService via a client
            // This client and its method `processPayoutWebhookFeedback` would need to be properly implemented.
            await transactionServiceClient.processPayoutWebhookFeedback(
                internalTransactionId,
                finalStatus,
                cinetpayErrorMessage || 'N/A', // Provider's textual status/message
                cinetpayTransactionStatus || 'N/A', // Provider's raw status code/text
                'cinetpay',
                payload // Pass the full payload for TransactionService to have all details
            );
            log.info(`Successfully processed and forwarded CinetPay transfer webhook for internalTxId: ${internalTransactionId}`);
        } catch (error: any) {
            log.error(`Error forwarding CinetPay transfer webhook feedback for ${internalTransactionId} to TransactionService:`, error.message);
            // Decide on error handling:
            // - Re-throw to have the webhook potentially retried by CinetPay (if they retry on 5xx).
            // - Or, log and absorb if retries are not desired or if the error is from TransactionService communication.
            throw new AppError(`Failed to communicate payout status to internal services for ${internalTransactionId}. Error: ${error.message}`, 500);
        }

        // The controller that calls this method will send the HTTP 200 OK response to CinetPay.
    }

    // --- END NEW CINTPAY TRANSFER/PAYOUT METHODS ---

    // --- NEW ADMIN TRANSFER/PAYOUT METHODS ---

    /**
     * [ADMIN] Initiates a withdrawal for a user, bypassing OTP verification.
     * The 'amount' in the request is considered the NET amount the user wants to receive
     * in the TARGET CURRENCY (derived from their MoMo operator).
     * This affects the user's internal balance.
     */
    public async adminInitiateUserWithdrawal(
        targetUserId: string | Types.ObjectId,
        netAmountDesired: number, // Renamed 'amount' to 'netAmountDesired' for clarity (this is in the target currency)
        // Removed `currency` from input, as it will be derived from momoOperator
        withdrawalDetails: {
            method: string; // e.g., 'MTNCM', 'OM'
            accountInfo: { // Details to store about the recipient
                fullMomoNumber: string; // Full international or national number from user's profile
                momoOperator: string;   // Operator slug from user's profile
                countryCode: string;    // Country code from user's profile (CM, CI, etc.)
                recipientName?: string;
                recipientEmail?: string;
            };
        },
        adminId: string, // ID of the admin performing the action
        ipAddress?: string,
        deviceInfo?: string
    ) {
        log.info(`Admin ${adminId} initiating direct withdrawal for user ${targetUserId}: NET ${netAmountDesired} (target currency will be derived)`);

        try {
            // Fetch user's details for current balance and for notification
            const userDetails = await userServiceClient.getUserDetails(targetUserId.toString());
            if (!userDetails) {
                throw new AppError('Target user not found for withdrawal.', 404);
            }

            // NEW: Derive TARGET CURRENCY from momoOperator for admin-initiated user withdrawal
            const targetPayoutCurrency = momoOperatorToCurrency[withdrawalDetails.accountInfo.momoOperator] as Currency;
            if (!targetPayoutCurrency) {
                log.error(`No target payout currency found for momoOperator: ${withdrawalDetails.accountInfo.momoOperator}. User ID: ${targetUserId}`);
                throw new AppError(`Unsupported Mobile Money operator: ${withdrawalDetails.accountInfo.momoOperator} or missing currency mapping for it. Please contact support.`, 400);
            }

            let grossAmountToDebitInXAF: number;
            let feeInXAF: number;

            // Perform currency conversion if target payout currency is not XAF
            if (targetPayoutCurrency !== Currency.XAF) {
                log.info(`Converting NET amount from ${targetPayoutCurrency} to XAF for balance debit (Admin User Withdrawal).`);
                const netAmountInXAF = await this.convertCurrency(netAmountDesired, targetPayoutCurrency, Currency.XAF);
                feeInXAF = this.calculateWithdrawalFee(netAmountInXAF, Currency.XAF, withdrawalDetails.method);
                grossAmountToDebitInXAF = netAmountInXAF + feeInXAF;
                log.info(`Converted NET ${netAmountDesired} ${targetPayoutCurrency} to ${netAmountInXAF} XAF. Calculated fee: ${feeInXAF} XAF. Gross debit: ${grossAmountToDebitInXAF} XAF.`);
            } else {
                // If target currency is XAF, no conversion needed for initial calculation
                feeInXAF = this.calculateWithdrawalFee(netAmountDesired, Currency.XAF, withdrawalDetails.method);
                grossAmountToDebitInXAF = netAmountDesired + feeInXAF;
                log.info(`Target currency is XAF. Calculated fee: ${feeInXAF} XAF. Gross debit: ${grossAmountToDebitInXAF} XAF.`);
            }

            const userBalance = await userServiceClient.getBalance(targetUserId.toString());
            if (userBalance && userBalance < grossAmountToDebitInXAF) {
                throw new AppError('Insufficient balance for this user.', 400);
            }

            // Create a transaction record directly in PENDING status (no OTP verification needed for admin)
            const withdrawalTransaction = await transactionRepository.create({
                userId: new Types.ObjectId(targetUserId.toString()),
                type: TransactionType.WITHDRAWAL,
                amount: grossAmountToDebitInXAF, // Store the GROSS amount in XAF that will be debited
                fee: feeInXAF, // Fee stored in XAF
                currency: Currency.XAF, // Transaction currency is always XAF for balance debits
                status: TransactionStatus.PENDING, // Directly move to pending (awaiting external payout)
                description: `Admin-initiated withdrawal for ${userDetails.name}: NET ${netAmountDesired} ${targetPayoutCurrency}. Gross debit: ${grossAmountToDebitInXAF} XAF.`,
                metadata: {
                    method: withdrawalDetails.method,
                    accountInfo: withdrawalDetails.accountInfo,
                    initiatedByAdminId: adminId,
                    adminAction: true,
                    statusDetails: 'Admin-initiated, awaiting external payout',
                    netAmountRequested: netAmountDesired, // Store the net amount explicitly in its original currency
                    payoutCurrency: targetPayoutCurrency, // Store the target payout currency
                    selectedPayoutService: undefined, // Will be set below
                },
                ipAddress,
                deviceInfo
            });

            // Trigger the actual asynchronous payout process
            log.info(`Triggering asynchronous payout process for admin-initiated transaction ${withdrawalTransaction.transactionId}.`);

            const dialingPrefix = countryCodeToDialingPrefix[withdrawalDetails.accountInfo.countryCode];
            if (!dialingPrefix) {
                log.error(`Could not derive dialing prefix for country code ${withdrawalDetails.accountInfo.countryCode} for admin-initiated transaction ${withdrawalTransaction.transactionId}.`);
                await transactionRepository.update(withdrawalTransaction._id, {
                    status: TransactionStatus.FAILED,
                    metadata: {
                        ...(withdrawalTransaction.metadata || {}),
                        failureReason: 'Invalid country dialing prefix configuration for external payout.',
                        statusDetails: 'Payout could not be initiated due to invalid country configuration.'
                    }
                });
                throw new AppError('Invalid country configuration for Mobile Money payout. Cannot proceed.', 500);
            }

            const nationalPhoneNumber = withdrawalDetails.accountInfo.fullMomoNumber.replace(/\D/g, '').startsWith(dialingPrefix)
                ? withdrawalDetails.accountInfo.fullMomoNumber.replace(/\D/g, '').substring(dialingPrefix.length)
                : withdrawalDetails.accountInfo.fullMomoNumber.replace(/\D/g, '');

            let payoutService;
            let payoutNotificationUrl: string;
            let providerName: 'CinetPay' | 'FeexPay';

            // Use the same gateway selection logic as payments
            const selectedGateway = this.selectGateway(withdrawalDetails.accountInfo.countryCode);

            if (selectedGateway === PaymentGateway.CINETPAY) {
                payoutService = cinetpayPayoutService;
                providerName = 'CinetPay';
                payoutNotificationUrl = `${config.selfBaseUrl}/api/payouts/webhooks/cinetpay}`;
                log.info(`Using CinetPay for admin payout to ${withdrawalDetails.accountInfo.countryCode} based on gateway selection.`);
            } else if (selectedGateway === PaymentGateway.FEEXPAY) {
                // For countries that use FeexPay
                payoutService = feexPayPayoutService;
                providerName = 'FeexPay';
                payoutNotificationUrl = `${config.selfBaseUrl}/api/payouts/webhooks/feexpay}`;
                log.info(`Using FeexPay for admin payout to ${withdrawalDetails.accountInfo.countryCode} based on gateway selection.`);
            } else {
                log.error(`Unsupported gateway selected for admin withdrawal: ${selectedGateway} for country ${withdrawalDetails.accountInfo.countryCode}`);
                throw new AppError(`Unsupported country for admin withdrawals: ${withdrawalDetails.accountInfo.countryCode}`, 400);
            }

            // Update the transaction with the selected providerName
            await transactionRepository.update(withdrawalTransaction._id, {
                metadata: {
                    ...(withdrawalTransaction.metadata || {}),
                    selectedPayoutService: providerName
                }
            });

            let payoutPromise: Promise<CinetPayPayoutResult | FeexPayPayoutResult>;

            if (providerName === 'CinetPay') {
                const cinetpayPaymentMethod = momoOperatorToCinetpayPaymentMethod[withdrawalDetails.accountInfo.momoOperator];
                payoutPromise = (payoutService as typeof cinetpayPayoutService).initiatePayout({
                    userId: targetUserId.toString(),
                    amount: netAmountDesired, // Pass the NET amount in TARGET payout currency
                    phoneNumber: nationalPhoneNumber,
                    countryCode: withdrawalDetails.accountInfo.countryCode,
                    recipientName: withdrawalDetails.accountInfo.recipientName || userDetails.name || 'SBC User',
                    recipientEmail: withdrawalDetails.accountInfo.recipientEmail || userDetails.email || `${targetUserId}@sbc.com`,
                    description: `Admin-initiated withdrawal for ${userDetails.name} (Tx: ${withdrawalTransaction.transactionId})`,
                    client_transaction_id: withdrawalTransaction.transactionId, // Pass our internal transaction ID to CinetPay
                    notifyUrl: payoutNotificationUrl
                });
            } else if (providerName === 'FeexPay') {
                payoutPromise = (payoutService as typeof feexPayPayoutService).initiatePayout({
                    userId: targetUserId.toString(),
                    amount: netAmountDesired,
                    phoneNumber: nationalPhoneNumber, // FeexPay may require national or full, depends on endpoint
                    countryCode: withdrawalDetails.accountInfo.countryCode,
                    momoOperator: withdrawalDetails.accountInfo.momoOperator, // FeexPay uses this to pick endpoint
                    recipientName: withdrawalDetails.accountInfo.recipientName || userDetails.name || 'SBC User',
                    recipientEmail: withdrawalDetails.accountInfo.recipientEmail || userDetails.email || `${targetUserId}@sbc.com`,
                    description: `Admin-initiated withdrawal for ${userDetails.name} (Tx: ${withdrawalTransaction.transactionId})`,
                    client_transaction_id: withdrawalTransaction.transactionId,
                    notifyUrl: payoutNotificationUrl
                });
            } else {
                log.error(`Unknown payout service selected for admin-initiated transaction ${withdrawalTransaction.transactionId}: ${providerName}`);
                throw new AppError('Unknown payout service configured for admin. Cannot proceed.', 500);
            }

            payoutPromise.then(payoutRes => {
                let providerTxId: string | undefined;
                let finalProviderName: 'CinetPay' | 'FeexPay' | undefined;
                let payoutMessage: string | undefined;

                if (providerName === 'CinetPay') {
                    const cinetpayRes = payoutRes as CinetPayPayoutResult; // Cast to CinetPay's result type
                    providerTxId = cinetpayRes.cinetpayTransactionId;
                    finalProviderName = 'CinetPay';
                    payoutMessage = cinetpayRes.message;
                } else if (providerName === 'FeexPay') {
                    const feexpayRes = payoutRes as FeexPayPayoutResult; // Cast to FeexPay's result type
                    providerTxId = feexpayRes.feexpayReference;
                    finalProviderName = 'FeexPay';
                    payoutMessage = feexpayRes.message;
                }

                if (payoutRes.success) {
                    log.info(`${finalProviderName} payout initiated for admin-Tx ${withdrawalTransaction.transactionId}. Provider Tx ID: ${providerTxId}`);
                    transactionRepository.update(withdrawalTransaction._id, {
                        externalTransactionId: providerTxId,
                        serviceProvider: finalProviderName,
                        status: TransactionStatus.PROCESSING, // Mark as processing externally
                        metadata: {
                            ...(withdrawalTransaction.metadata || {}),
                            payoutInitiationStatus: payoutRes.status,
                            payoutMessage: payoutMessage,
                            // Store provider specific lot/reference if available
                            providerSpecificRef: (payoutRes as any).lot || (payoutRes as any).feexpayReference
                        }
                    }).catch(err => log.error(`Failed to update admin-Tx ${withdrawalTransaction.transactionId} with ${finalProviderName} payout details:`, err));
                } else {
                    log.error(`${finalProviderName} payout initiation failed for admin-Tx ${withdrawalTransaction.transactionId}: ${payoutMessage}`);
                    // Mark transaction as failed, no refund needed as balance wasn't debited.
                    transactionRepository.update(withdrawalTransaction._id, {
                        status: TransactionStatus.FAILED,
                        metadata: {
                            ...(withdrawalTransaction.metadata || {}),
                            failureReason: `External payout failed (Admin): ${payoutMessage}`,
                            payoutError: payoutMessage
                        }
                    }).catch(err => log.error(`Failed to update admin-Tx ${withdrawalTransaction.transactionId} status to FAILED after payout failure:`, err));
                    // Send notification for failed payout initiation
                    if (userDetails?.email) {
                        notificationService.sendTransactionFailureEmail({
                            email: userDetails.email,
                            name: userDetails.name || 'Customer',
                            transactionId: withdrawalTransaction.transactionId,
                            transactionType: 'withdrawal',
                            amount: netAmountDesired, // Net amount for notification
                            currency: targetPayoutCurrency, // Target currency for notification
                            date: new Date().toISOString(),
                            reason: payoutMessage
                        }).catch(err => log.error(`Failed to send failure notification for admin-Tx ${withdrawalTransaction.transactionId}:`, err));
                    }
                }
            })
                .catch(err => {
                    log.error(`Unhandled error during payout for admin-Tx ${withdrawalTransaction.transactionId}:`, err);
                    transactionRepository.update(withdrawalTransaction._id, {
                        status: TransactionStatus.FAILED,
                        metadata: {
                            ...(withdrawalTransaction.metadata || {}),
                            failureReason: `Internal payout system error (Admin): ${err.message}`
                        }
                    }).catch(err => log.error(`Failed to update admin-Tx ${withdrawalTransaction.transactionId} status to FAILED after system error:`, err));
                    // Send notification for system error during payout initiation
                    if (userDetails?.email) {
                        notificationService.sendTransactionFailureEmail({
                            email: userDetails.email,
                            name: userDetails.name || 'Customer',
                            transactionId: withdrawalTransaction.transactionId,
                            transactionType: 'withdrawal',
                            amount: netAmountDesired, // Net amount for notification
                            currency: targetPayoutCurrency, // Target currency for notification
                            date: new Date().toISOString(),
                            reason: `System error during payout initiation (Admin): ${err.message}`
                        }).catch(err => log.error(`Failed to send failure notification for admin-Tx ${withdrawalTransaction.transactionId}:`, err));
                    }
                });

            // Return details of the created transaction
            return {
                transactionId: withdrawalTransaction.transactionId,
                amount: withdrawalTransaction.amount, // Gross amount in XAF
                fee: withdrawalTransaction.fee, // Fee in XAF
                total: netAmountDesired, // Net amount in target payout currency
                status: withdrawalTransaction.status,
                message: "Admin-initiated withdrawal successfully processed and payout initiated."
            };

        } catch (error: any) {
            log.error(`Error in adminInitiateUserWithdrawal for user ${targetUserId}: ${error.message}`, error);
            if (error instanceof AppError) {
                throw error;
            }
            throw new AppError(`Failed to process admin-initiated withdrawal: ${error.message}`, 500);
        }
    }

    /**
     * [ADMIN] Initiates a direct payout not associated with an existing user balance.
     * The 'amount' in the request is considered the NET amount the recipient should receive
     * in the TARGET CURRENCY (provided in recipientDetails).
     * This affects the CinetPay API balance directly, and logs a transaction for audit.
     */
    public async adminInitiateDirectPayout(
        netAmountDesired: number, // Renamed 'amount' to 'netAmountDesired' for clarity (this is in the target currency)
        // Removed `currency` from input, as it's now in recipientDetails.
        recipientDetails: {
            phoneNumber: string;
            countryCode: string;
            recipientName: string;
            recipientEmail?: string;
            paymentMethod?: string;
            // NEW: Add currency here, as it's a direct payout not tied to user's momoOperator
            currency: Currency; // Required: The target currency for the payout
        },
        adminId: string, // ID of the admin performing the action
        description: string,
        ipAddress?: string,
        deviceInfo?: string
    ) {
        log.info(`Admin ${adminId} initiating direct payout: NET ${netAmountDesired} ${recipientDetails.currency} to ${recipientDetails.phoneNumber}`);

        try {
            const targetPayoutCurrency = recipientDetails.currency; // Use currency from recipientDetails

            let grossAmountToDebitInXAF: number;
            let feeInXAF: number;

            // Perform currency conversion if target payout currency is not XAF
            if (targetPayoutCurrency !== Currency.XAF) {
                log.info(`Converting NET amount from ${targetPayoutCurrency} to XAF for direct payout debit.`);
                const netAmountInXAF = await this.convertCurrency(netAmountDesired, targetPayoutCurrency, Currency.XAF);
                feeInXAF = this.calculateWithdrawalFee(netAmountInXAF, Currency.XAF, recipientDetails.paymentMethod || 'UNKNOWN');
                grossAmountToDebitInXAF = netAmountInXAF + feeInXAF;
                log.info(`Converted NET ${netAmountDesired} ${targetPayoutCurrency} to ${netAmountInXAF} XAF. Calculated fee: ${feeInXAF} XAF. Gross debit: ${grossAmountToDebitInXAF} XAF.`);
            } else {
                // If target currency is XAF, no conversion needed for initial calculation
                feeInXAF = this.calculateWithdrawalFee(netAmountDesired, Currency.XAF, recipientDetails.paymentMethod || 'UNKNOWN');
                grossAmountToDebitInXAF = netAmountDesired + feeInXAF;
                log.info(`Target currency is XAF. Calculated fee: ${feeInXAF} XAF. Gross debit: ${grossAmountToDebitInXAF} XAF.`);
            }

            // Create a transaction record for auditing the direct payout
            const directPayoutTransaction = await transactionRepository.create({
                userId: new Types.ObjectId(adminId), // Link to the admin performing the action for audit
                type: TransactionType.WITHDRAWAL, // Treat as a system-initiated withdrawal for now
                amount: grossAmountToDebitInXAF, // Store the GROSS amount in XAF that will be debited from CinetPay
                currency: Currency.XAF, // Transaction currency is always XAF for balance debits
                fee: feeInXAF, // Store the calculated fee in XAF
                status: TransactionStatus.PROCESSING, // It's immediately processing externally
                description: `Admin-initiated direct payout: ${description}. NET: ${netAmountDesired} ${targetPayoutCurrency}. Gross: ${grossAmountToDebitInXAF} XAF.`,
                metadata: {
                    recipientPhoneNumber: recipientDetails.phoneNumber,
                    recipientCountryCode: recipientDetails.countryCode,
                    recipientName: recipientDetails.recipientName,
                    recipientEmail: recipientDetails.recipientEmail,
                    paymentMethod: recipientDetails.paymentMethod,
                    initiatedByAdminId: adminId,
                    adminDirectPayout: true,
                    netAmountRequested: netAmountDesired, // Store the net amount explicitly in its original currency
                    payoutCurrency: targetPayoutCurrency, // Store the target payout currency
                },
                ipAddress,
                deviceInfo
            });

            // Trigger the actual external payout via CinetPayPayoutService
            const dialingPrefix = countryCodeToDialingPrefix[recipientDetails.countryCode];
            if (!dialingPrefix) {
                log.error(`Could not derive dialing prefix for country code ${recipientDetails.countryCode} for admin direct payout transaction ${directPayoutTransaction.transactionId}.`);
                await transactionRepository.update(directPayoutTransaction._id, {
                    status: TransactionStatus.FAILED,
                    metadata: {
                        ...(directPayoutTransaction.metadata || {}),
                        failureReason: 'Invalid country dialing prefix configuration for external payout.',
                        statusDetails: 'Payout could not be initiated due to invalid country configuration.'
                    }
                });
                throw new AppError('Invalid country configuration for Mobile Money payout. Cannot proceed.', 500);
            }

            const nationalPhoneNumber = recipientDetails.phoneNumber.replace(/\D/g, '').startsWith(dialingPrefix)
                ? recipientDetails.phoneNumber.replace(/\D/g, '').substring(dialingPrefix.length)
                : recipientDetails.phoneNumber.replace(/\D/g, '');

            // Use the same gateway selection logic as other withdrawal methods
            const selectedGateway = this.selectGateway(recipientDetails.countryCode);
            let payoutResult: any;

            if (selectedGateway === PaymentGateway.CINETPAY) {
                log.info(`Using CinetPay for admin direct payout to ${recipientDetails.countryCode} based on gateway selection.`);
                payoutResult = await cinetpayPayoutService.initiatePayout({
                    userId: adminId, // Use admin's ID as userId for CinetPay's internal tracking
                    amount: netAmountDesired, // Pass the NET amount in TARGET payout currency
                    phoneNumber: nationalPhoneNumber,
                    countryCode: recipientDetails.countryCode,
                    recipientName: recipientDetails.recipientName,
                    recipientEmail: recipientDetails.recipientEmail || `${adminId}@sbc.com`,
                    paymentMethod: recipientDetails.paymentMethod,
                    description: description,
                    client_transaction_id: directPayoutTransaction.transactionId, // Use our internal transaction ID
                    notifyUrl: `${config.selfBaseUrl}/api/payouts/webhooks/cinetpay}` // Use the dedicated payout webhook
                });
            } else if (selectedGateway === PaymentGateway.FEEXPAY) {
                log.info(`Using FeexPay for admin direct payout to ${recipientDetails.countryCode} based on gateway selection.`);
                const fullInternationalPhoneNumber = `${dialingPrefix}${nationalPhoneNumber}`;
                payoutResult = await this.processFeexpayPayout(
                    directPayoutTransaction.transactionId,
                    fullInternationalPhoneNumber,
                    recipientDetails.paymentMethod || 'default', // Use provided payment method or default
                    netAmountDesired,
                    recipientDetails.currency
                );
                // Convert FeexPay result format to match CinetPay format for consistency
                payoutResult = {
                    success: payoutResult.success,
                    cinetpayTransactionId: payoutResult.providerTransactionId, // Map to common field
                    transactionId: directPayoutTransaction.transactionId,
                    message: payoutResult.message,
                    status: payoutResult.success ? 'processing' : 'failed'
                };
            } else {
                log.error(`Unsupported gateway selected for admin direct payout: ${selectedGateway} for country ${recipientDetails.countryCode}`);
                throw new AppError(`Unsupported country for admin direct payouts: ${recipientDetails.countryCode}`, 400);
            }

            // Update the internal transaction status based on CinetPay's immediate response
            let finalStatusForAudit: TransactionStatus;
            let failureReason: string | undefined;

            if (payoutResult.success) {
                finalStatusForAudit = TransactionStatus.PENDING; // External provider initiated, awaiting webhook
                // Link the CinetPay transaction ID to our internal one
                await transactionRepository.update(directPayoutTransaction._id, {
                    externalTransactionId: payoutResult.cinetpayTransactionId,
                    serviceProvider: 'CinetPay',
                    // paymentMethod: recipientDetails.paymentMethod, // Removed as per auto-detection strategy
                    status: TransactionStatus.PROCESSING, // Mark as processing externally
                    metadata: {
                        ...(directPayoutTransaction.metadata || {}),
                        payoutInitiationStatus: payoutResult.status, // e.g., 'pending', 'processing'
                        payoutMessage: payoutResult.message,
                        cinetpayLot: payoutResult.transactionId // CinetPay's client_transaction_id or internal lot
                    }
                });
            } else {
                finalStatusForAudit = TransactionStatus.FAILED;
                failureReason = payoutResult.message;
                await transactionRepository.update(directPayoutTransaction._id, {
                    status: TransactionStatus.FAILED,
                    metadata: {
                        ...(directPayoutTransaction.metadata || {}),
                        payoutInitiationStatus: payoutResult.status, // e.g., 'failed'
                        payoutMessage: payoutResult.message,
                        payoutError: payoutResult.message
                    }
                });
            }

            // We return the immediate result of the payout initiation
            return {
                transactionId: directPayoutTransaction.transactionId,
                cinetpayTransactionId: payoutResult.cinetpayTransactionId,
                amount: netAmountDesired, // Return the net amount in TARGET payout currency
                recipient: recipientDetails.phoneNumber,
                status: finalStatusForAudit,
                message: payoutResult.message || (payoutResult.success ? 'Direct payout initiated successfully.' : 'Direct payout initiation failed.'),
                estimatedCompletion: payoutResult.estimatedCompletion,
                success: payoutResult.success,
                error: payoutResult.message,
                failureReason: failureReason
            };

        } catch (error: any) {
            log.error(`Error in adminInitiateDirectPayout for admin ${adminId}: ${error.message}`, error);
            if (error instanceof AppError) {
                throw error;
            }
            throw new AppError(`Failed to process admin direct payout: ${error.message}`, 500);
        }
    }

    /**
     * Processes incoming webhook notifications for CinetPay Transfer (Payout) status changes.
     * This method is called by the PayoutController when a webhook is received.
     * It updates the internal transaction status and debits user balance on success.
     *
     * IMPORTANT: This method now includes a server-to-server validation step.
     */
    public async processConfirmedPayoutWebhook(
        internalTransactionId: string, // This is our client_transaction_id (cpm_trans_id from webhook)
        providerStatusMessage: string, // CinetPay's cpm_error_message from webhook
        fullProviderPayload: any // The raw webhook payload
    ): Promise<void> {
        log.info(`Processing CinetPay Payout Webhook for internal transaction: ${internalTransactionId}.`);
        log.debug('Raw Webhook Payload:', fullProviderPayload);

        const transaction = await transactionRepository.findByTransactionId(internalTransactionId);

        if (!transaction) {
            log.error(`Payout webhook: Transaction ${internalTransactionId} not found in DB. Cannot process.`);
            throw new AppError('Internal transaction not found for webhook processing.', 404);
        }

        if (transaction.type !== TransactionType.WITHDRAWAL) {
            log.warn(`Payout webhook: Transaction ${internalTransactionId} is not a withdrawal. Skipping balance update but updating status.`);
        }

        // Prevent processing if already completed/failed
        if (transaction.status === TransactionStatus.COMPLETED || transaction.status === TransactionStatus.FAILED) {
            log.warn(`Payout webhook: Transaction ${internalTransactionId} already in final status (${transaction.status}). Skipping update.`);
            return;
        }

        const isFromJob = fullProviderPayload?.fromJob === true;
        let cinetpayTransactionId: string | undefined;

        if (isFromJob) {
            cinetpayTransactionId = transaction.externalTransactionId;
            log.info(`Reconciliation job: Using externalTransactionId from DB: ${cinetpayTransactionId}`);
        } else {
            cinetpayTransactionId = fullProviderPayload.transaction_id;
        }

        if (!cinetpayTransactionId) {
            const errorMsg = isFromJob
                ? `Reconciliation job: Missing 'externalTransactionId' on transaction record ${internalTransactionId}. Cannot verify.`
                : `CinetPay Payout Webhook: Missing CinetPay's 'transaction_id' in payload for internalTxId ${internalTransactionId}. Cannot verify.`;
            log.error(errorMsg);
            throw new AppError(errorMsg, 400);
        }

        let verifiedPayoutStatus: CinetPayPayoutStatus | null = null; // Declare outside try block
        try {
            // CRITICAL: Perform server-to-server validation with CinetPay's API
            log.info(`Verifying CinetPay Payout status for CinetPay Tx ID: ${cinetpayTransactionId} (Internal Tx ID: ${internalTransactionId})`);
            verifiedPayoutStatus = await cinetpayPayoutService.checkPayoutStatus(internalTransactionId);

            if (!verifiedPayoutStatus) {
                log.error(`CinetPay Payout Webhook: No status found from CinetPay API for Tx ID: ${cinetpayTransactionId}. Marking internal transaction ${internalTransactionId} as FAILED due to verification failure.`);
                throw new AppError('Failed to verify payout status with CinetPay API. Transaction will be marked as failed.', 500);
            }

            log.info(`Verified CinetPay Payout Status for ${cinetpayTransactionId}: ${verifiedPayoutStatus.status}`);

            // Compare webhook status with API-confirmed status (optional but good for auditing/debugging)
            const webhookStatus = cinetpayPayoutService.processWebhookNotification(fullProviderPayload).status;
            if (webhookStatus !== verifiedPayoutStatus.status) {
                log.warn(`CinetPay Payout Webhook: Status mismatch for ${internalTransactionId}. Webhook: ${webhookStatus}, API: ${verifiedPayoutStatus.status}. Proceeding with API-confirmed status.`);
            }

        } catch (apiError: any) {
            // If the API verification fails (e.g., timeout), we DO NOT mark the transaction as FAILED.
            // We log the error and re-throw it. The background job will catch this and retry later.
            // The transaction status remains 'PROCESSING'.
            log.error(`Error during CinetPay API verification for ${internalTransactionId}: ${apiError.message}. The transaction status will NOT be changed, and the check will be retried.`, apiError);

            // Re-throw the error to be caught by the calling job. This prevents any further
            // processing in this method and signals the job that this particular check failed.
            throw new AppError(`Payout status verification failed for ${internalTransactionId}. The check will be retried.`, 503); // 503 is appropriate for a temporary failure.
        }

        // Determine final status based on the *API-confirmed* status
        let finalStatus: TransactionStatus;
        switch (verifiedPayoutStatus.status) {
            case 'completed':
                finalStatus = TransactionStatus.COMPLETED;
                break;
            case 'failed':
                finalStatus = TransactionStatus.FAILED;
                break;
            case 'processing':
            case 'pending':
            default:
                // If CinetPay API says it's still pending/processing, we keep our internal status as such.
                // We shouldn't receive 'pending'/'processing' on a final webhook, but handle defensively.
                log.warn(`Webhook received for non-final API status (${verifiedPayoutStatus.status}). Keeping transaction as PROCESSING.`);
                finalStatus = TransactionStatus.PROCESSING; // Or whatever represents "in progress"
                break;
        }

        // The gross amount debited from the user's balance is stored in the transaction in XAF
        const grossAmountToDebitInXAF = Math.abs(transaction.amount);
        // The net amount and target currency for notification are in metadata
        const netAmountForNotification = transaction.metadata?.netAmountRequested || (grossAmountToDebitInXAF - (transaction.fee || 0));
        const targetCurrencyForNotification = transaction.metadata?.payoutCurrency || transaction.currency;


        let updateStatus: TransactionStatus = finalStatus;
        let updateMetadata: Record<string, any> = {
            ...(transaction.metadata || {}),
            providerWebhookStatus: finalStatus, // Reflects the *API-confirmed* status mapped to our enum
            providerWebhookMessage: verifiedPayoutStatus?.comment || providerStatusMessage, // Use API comment, fallback to webhook message
            providerRawWebhookData: fullProviderPayload, // Still store full raw data for audit
            cinetpayApiStatus: verifiedPayoutStatus?.status, // Store the exact API status
            cinetpayApiComment: verifiedPayoutStatus?.comment, // Store API comment
            cinetpayOperator: verifiedPayoutStatus?.operator, // Store operator from API
        };

        const providerName = 'CinetPay'; // This webhook is specifically for CinetPay

        if (finalStatus === TransactionStatus.COMPLETED) {
            log.info(`Payout for transaction ${internalTransactionId} is COMPLETED. Debiting user balance.`);
            try {
                // Debit user's balance ONLY IF it's a successful withdrawal and has not been debited yet.
                await userServiceClient.updateUserBalance(transaction.userId.toString(), -grossAmountToDebitInXAF);
                log.info(`User ${transaction.userId.toString()} balance debited by ${grossAmountToDebitInXAF} XAF for completed withdrawal ${internalTransactionId}.`);

            } catch (balanceError: any) {
                // DO NOT change the transaction status to FAILED. The payout was successful.
                // This is a critical internal error that needs to be resolved separately.
                log.error(`CRITICAL: The payout for transaction ${internalTransactionId} was SUCCESSFUL with the provider, but failed to debit the user's balance. Manual intervention required.`, balanceError);

                // Add metadata to flag the issue without changing the transaction's final status.
                updateMetadata.internalFailureReason = `Balance debit failed after provider success: ${balanceError.message}`;
                updateMetadata.balanceUpdateFailed = true; // Add a specific flag for this issue.

                // NOTE: updateStatus is NOT changed here. It remains COMPLETED.
            }
        } else if (finalStatus === TransactionStatus.FAILED) {
            log.warn(`Payout for transaction ${internalTransactionId} is FAILED. No balance debit/refund needed.`);
            updateMetadata.failureReason = `External payout failed: ${verifiedPayoutStatus?.comment || providerStatusMessage}`;

            // Send failure notification (only if it's a regular user withdrawal)
            // For admin-initiated direct payouts, the admin might get a different notification or none.
            if (transaction.metadata?.adminAction !== true) { // If it's a user's withdrawal (not admin-initiated user withdrawal or direct payout)
                const userDetails = await userServiceClient.getUserDetails(transaction.userId.toString());
                if (userDetails?.email) {
                    await notificationService.sendTransactionFailureEmail({
                        email: userDetails.email,
                        name: userDetails.name || 'Customer',
                        transactionId: transaction.transactionId,
                        transactionType: 'withdrawal',
                        amount: netAmountForNotification,
                        currency: targetCurrencyForNotification,
                        date: new Date().toISOString(),
                        reason: verifiedPayoutStatus?.comment || providerStatusMessage || 'External payout failed.'
                    });
                    log.info(`Failure notification sent for transaction ${internalTransactionId}.`);
                }
            } else {
                log.info(`Skipping user failure notification for admin-initiated transaction ${internalTransactionId}.`);
                // Optionally notify admin here about the direct payout failure
            }
        }

        // Update the transaction record with the final status and metadata
        await transactionRepository.update(transaction._id, {
            status: updateStatus,
            metadata: updateMetadata
        });
        log.info(`Transaction ${internalTransactionId} status updated to ${updateStatus} based on webhook.`);
    }

    // This new or modified method would fetch the total count
    async getTotalTransactionsCount(): Promise<number> {
        // Call a method in your transaction repository to get the count
        const count = await transactionRepository.countAllTransactions(); // New method in repository
        return count;
    }

    /**
     * Check the status of a FeexPay transaction using its gatewayPaymentId (FeexPay's reference).
     * This method fetches the latest status from FeexPay and updates the internal PaymentIntent.
     * @param gatewayPaymentId The transaction reference ID provided by FeexPay.
     * @returns The updated PaymentIntent object.
     * @throws AppError if the payment intent is not found, or if the FeexPay API call fails.
     */
    public async checkFeexpayTransactionStatus(gatewayPaymentId: string): Promise<IPaymentIntent> {
        log.info(`Checking FeexPay transaction status for gatewayPaymentId: ${gatewayPaymentId}`);

        const paymentIntent = await paymentIntentRepository.findByGatewayPaymentId(gatewayPaymentId, PaymentGateway.FEEXPAY);

        if (!paymentIntent) {
            throw new AppError('Payment intent not found for this FeexPay reference.', 404);
        }

        // If status is already final, no need to call FeexPay
        if (paymentIntent.status === PaymentStatus.SUCCEEDED || paymentIntent.status === PaymentStatus.FAILED) {
            log.info(`PaymentIntent ${paymentIntent.sessionId} is already in final status: ${paymentIntent.status}. Returning current state.`);
            return paymentIntent;
        }

        try {
            const response = await axios.get(
                `${config.feexpay.baseUrl}/transactions/public/single/status/${gatewayPaymentId}`,
                {
                    headers: {
                        Authorization: `Bearer ${config.feexpay.apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000 // Add a timeout for the external API call
                }
            );

            const feexpayResponse = response.data;
            log.info(`FeexPay status response for ${gatewayPaymentId}:`, feexpayResponse);

            let newStatus: PaymentStatus = paymentIntent.status; // Default to current status
            const feexpayStatus = feexpayResponse.status;

            if (feexpayStatus === 'SUCCESSFUL') {
                newStatus = PaymentStatus.SUCCEEDED;
            } else if (feexpayStatus === 'FAILED') {
                newStatus = PaymentStatus.FAILED;
            } else {
                // If FeexPay status is still intermediate (e.g., "PENDING" or other intermediate states)
                // We update our status to PROCESSING if it was PENDING_PROVIDER, or keep it as is.
                newStatus = paymentIntent.status === PaymentStatus.PENDING_PROVIDER ? PaymentStatus.PROCESSING : paymentIntent.status;
                log.info(`FeexPay status is intermediate (${feexpayStatus}). Keeping internal status as ${newStatus} for ${paymentIntent.sessionId}`);
            }

            let updatedIntent: IPaymentIntent | null = paymentIntent;
            if (newStatus !== paymentIntent.status) {
                updatedIntent = await paymentIntentRepository.addWebhookEvent(
                    paymentIntent.sessionId,
                    newStatus,
                    feexpayResponse // Store the full FeexPay response
                );
                if (!updatedIntent) {
                    log.error(`Failed to update PaymentIntent ${paymentIntent.sessionId} after FeexPay status check.`);
                    throw new AppError('Failed to update payment intent status.', 500);
                }
                log.info(`PaymentIntent ${paymentIntent.sessionId} status updated to ${newStatus} via FeexPay status check.`);

                // If the status became final (SUCCEEDED or FAILED), trigger completion logic
                if (updatedIntent.status === PaymentStatus.SUCCEEDED || updatedIntent.status === PaymentStatus.FAILED) {
                    await this.handlePaymentCompletion(updatedIntent);
                }
            }
            return updatedIntent || paymentIntent; // Return the updated intent or original if no status change
        } catch (error: any) {
            log.error(`Error checking FeexPay status for ${gatewayPaymentId}:`, error.response?.data || error.message);
            // If API call fails, update status to ERROR and log the error for debugging
            await paymentIntentRepository.updateBySessionId(paymentIntent.sessionId, {
                status: PaymentStatus.ERROR,
                metadata: {
                    ...(paymentIntent.metadata || {}), // Preserve existing metadata
                    feexpayStatusCheckError: error.response?.data || error.message // Add specific error info
                }
            });
            throw new AppError('Failed to retrieve or update FeexPay transaction status.', error.response?.status || 500);
        }
    }

    /**
     * Check the status of a FeexPay transaction for a given PaymentIntent sessionId.
     * This method fetches the latest status from FeexPay and updates the internal PaymentIntent.
     * It includes checks to ensure the intent is eligible for external status querying.
     * @param sessionId The internal session ID of the PaymentIntent.
     * @returns The updated PaymentIntent object.
     * @throws AppError if the payment intent is not found, not a FeexPay transaction,
     *         missing gatewayPaymentId, or if the FeexPay API call fails.
     */
    public async getAndProcessFeexpayStatusBySessionId(sessionId: string): Promise<IPaymentIntent> {
        log.info(`Attempting to get and process FeexPay status for sessionId: ${sessionId}`);

        const paymentIntent = await paymentIntentRepository.findBySessionId(sessionId);

        if (!paymentIntent) {
            throw new AppError('Payment intent not found.', 404);
        }

        // 1. Check if the payment intent is a FeexPay transaction
        if (paymentIntent.gateway !== PaymentGateway.FEEXPAY) {
            log.warn(`PaymentIntent ${sessionId} is not a FeexPay transaction (gateway: ${paymentIntent.gateway}).`);
            throw new AppError(`This payment intent is not associated with FeexPay. Current gateway: ${paymentIntent.gateway}.`, 400);
        }

        // 2. Check if it has a gatewayPaymentId
        if (!paymentIntent.gatewayPaymentId) {
            log.warn(`PaymentIntent ${sessionId} (FeexPay) is missing gatewayPaymentId. Status: ${paymentIntent.status}`);
            throw new AppError('FeexPay transaction ID not found for this payment intent. Payment may not have been initiated externally yet.', 400);
        }

        // 3. Check if current status allows querying (not PENDING_USER_INPUT, SUCCEEDED, or FAILED)
        if (paymentIntent.status === PaymentStatus.PENDING_USER_INPUT) {
            log.warn(`PaymentIntent ${sessionId} is PENDING_USER_INPUT. External status check is not applicable.`);
            throw new AppError('This payment is awaiting your input. Please proceed with payment initiation first.', 400);
        }

        if (paymentIntent.status === PaymentStatus.SUCCEEDED || paymentIntent.status === PaymentStatus.FAILED) {
            const userSub = await userServiceClient.getUserActiveSubscriptions(paymentIntent.userId);
            if (userSub.length === 0 && paymentIntent.status === PaymentStatus.SUCCEEDED) {
                paymentIntent.status = PaymentStatus.PENDING_PROVIDER;
                log.info(`User ${paymentIntent.userId} has no active subscription. Continueing in order to active user account and share commission.`);
                log.warn('This might be a user who has not yet activated their account. We will continue to share commission with his god parent.');
            } else {
                log.info(`User ${paymentIntent.userId} has an active subscription. Updating payment intent status to SUCCEEDED.`);
                await paymentIntentRepository.updateBySessionId(paymentIntent.sessionId, {
                    status: PaymentStatus.SUCCEEDED
                });
                log.info(`PaymentIntent ${sessionId} is already in final status: ${paymentIntent.status}. Returning current state.`);
                return paymentIntent;
            }
        }

        const feexpayReference = paymentIntent.gatewayPaymentId;

        try {
            log.info(`Calling FeexPay API for status check for reference: ${feexpayReference}`);
            const response = await axios.get(
                `${config.feexpay.baseUrl}/transactions/public/single/status/${feexpayReference}`,
                {
                    headers: {
                        Authorization: `Bearer ${config.feexpay.apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 180000 // Increased timeout to 3 minutes (180,000 milliseconds)
                }
            );

            const feexpayResponse = response.data;
            log.info(`FeexPay status response for ${feexpayReference}:`, feexpayResponse);

            let newStatus: PaymentStatus = paymentIntent.status; // Default to current status
            const feexpayStatus = feexpayResponse.status;

            if (feexpayStatus === 'SUCCESSFUL') {
                newStatus = PaymentStatus.SUCCEEDED;
            } else if (feexpayStatus === 'FAILED') {
                newStatus = PaymentStatus.FAILED;
            } else {
                // If FeexPay status is still intermediate (e.g., "PENDING" or other intermediate states)
                // We update our status to PROCESSING if it was PENDING_PROVIDER, or keep it as is.
                newStatus = paymentIntent.status === PaymentStatus.PENDING_PROVIDER ? PaymentStatus.PROCESSING : paymentIntent.status;
                log.info(`FeexPay status is intermediate (${feexpayStatus}). Keeping internal status as ${newStatus} for ${paymentIntent.sessionId}`);
            }

            let updatedIntent: IPaymentIntent | null = paymentIntent;
            if (newStatus !== paymentIntent.status) {
                updatedIntent = await paymentIntentRepository.addWebhookEvent(
                    paymentIntent.sessionId,
                    newStatus,
                    feexpayResponse // Store the full FeexPay response
                );
                if (!updatedIntent) {
                    log.error(`Failed to update PaymentIntent ${paymentIntent.sessionId} after FeexPay status check.`);
                    throw new AppError('Failed to update payment intent status internally.', 500);
                }
                log.info(`PaymentIntent ${paymentIntent.sessionId} status updated to ${newStatus} via FeexPay status check.`);

                // If the status became final (SUCCEEDED or FAILED), trigger completion logic
                if (updatedIntent.status === PaymentStatus.SUCCEEDED || updatedIntent.status === PaymentStatus.FAILED) {
                    await this.handlePaymentCompletion(updatedIntent);
                }
            }
            return updatedIntent || paymentIntent; // Return the updated intent or original if no status change
        } catch (error: any) {
            log.error(`Error checking FeexPay status for ${feexpayReference} (session ${sessionId}):`, error.response?.data || error.message);
            // If API call fails, update status to ERROR and log the error for debugging
            await paymentIntentRepository.updateBySessionId(paymentIntent.sessionId, {
                status: PaymentStatus.ERROR,
                metadata: {
                    ...(paymentIntent.metadata || {}), // Preserve existing metadata
                    feexpayStatusCheckError: error.response?.data || error.message // Add specific error info
                }
            });
            throw new AppError('Failed to retrieve or update FeexPay transaction status. Please try again later.', error.response?.status || 500);
        }
    }

    /**
     * [ADMIN] Finds FeexPay payment intents for a given user that are stuck in
     * intermediate or error states (PENDING_PROVIDER, PROCESSING, ERROR) and
     * re-requests their status from FeexPay to update their internal state.
     * @param userId The ID of the user whose payment intents to reprocess.
     * @returns A summary of the reprocessing attempt for each relevant payment intent.
     */
    public async reprocessFeexpayPendingStatusByUserId(userId: string): Promise<{ sessionId: string; status: PaymentStatus; message: string; }[]> {
        log.info(`Admin request: Reprocessing FeexPay payment statuses for user: ${userId}`);

        const results: { sessionId: string; status: PaymentStatus; message: string; }[] = [];

        try {
            // 1. Find all relevant payment intents for the user
            const paymentIntentsToReprocess = await paymentIntentRepository.findAllWithFilters(
                {
                    userId: userId,
                    gateway: PaymentGateway.FEEXPAY,
                    gatewayPaymentId: { $exists: true, $ne: null }, // Must have a gatewayPaymentId
                    status: { $in: [PaymentStatus.PENDING_PROVIDER, PaymentStatus.PROCESSING, PaymentStatus.ERROR] }
                },
                { limit: 1000, page: 1 } // Added page: 1
            );

            if (paymentIntentsToReprocess.intents.length === 0) {
                log.info(`No FeexPay payment intents found for user ${userId} in PENDING_PROVIDER, PROCESSING, or ERROR status.`);
                return []; // Return an empty array if no eligible intents are found
            }

            log.info(`Found ${paymentIntentsToReprocess.intents.length} FeexPay payment intents for user ${userId} to reprocess.`);

            // Define a priority for sorting statuses
            const statusPriority: Record<PaymentStatus, number> = {
                [PaymentStatus.PENDING_PROVIDER]: 1,
                [PaymentStatus.ERROR]: 2,
                [PaymentStatus.PROCESSING]: 3,
                // Other statuses not in the filter can be given a high number if they somehow appear
                [PaymentStatus.SUCCEEDED]: 99,
                [PaymentStatus.FAILED]: 99,
                [PaymentStatus.PENDING_USER_INPUT]: 99,
                [PaymentStatus.CANCELED]: 99,
                [PaymentStatus.REQUIRES_ACTION]: 99
            };

            // Sort the intents based on the defined priority and then by creation date
            paymentIntentsToReprocess.intents.sort((a, b) => {
                const priorityA = statusPriority[a.status];
                const priorityB = statusPriority[b.status];

                if (priorityA !== priorityB) {
                    return priorityA - priorityB;
                }
                // If priorities are the same, sort by oldest first (createdAt ascending)
                return a.createdAt.getTime() - b.createdAt.getTime();
            });

            // 2. Iterate and re-process each payment intent
            for (const intent of paymentIntentsToReprocess.intents) {
                try {
                    const updatedIntent = await this.getAndProcessFeexpayStatusBySessionId(intent.sessionId);
                    results.push({
                        sessionId: updatedIntent.sessionId,
                        status: updatedIntent.status,
                        message: `Reprocessing successful. New status: ${updatedIntent.status}.`
                    });
                    // Stop loop if a successful payment is found
                    if (updatedIntent.status === PaymentStatus.SUCCEEDED) {
                        log.info(`Reprocessing for user ${userId} stopped early as a SUCCEEDED payment intent was found: ${updatedIntent.sessionId}`);
                        break;
                    }
                } catch (error: any) {
                    log.error(`Failed to reprocess FeexPay payment for sessionId ${intent.sessionId}: ${error.message}`, error);
                    results.push({
                        sessionId: intent.sessionId,
                        status: intent.status, // Keep original status if reprocessing failed
                        message: `Reprocessing failed: ${error.message || 'Unknown error'}.`
                    });
                }
            }
        } catch (error: any) {
            log.error(`Error in reprocessFeexpayPendingStatusByUserId for user ${userId}: ${error.message}`, error);
            throw new AppError(`Failed to reprocess FeexPay payments: ${error.message}`, 500);
        }

        return results;
    }

    /**
     * Processes incoming webhook notifications for FeexPay Payout status changes.
     * This method is called by the PayoutController when a webhook is received.
     * It updates the internal transaction status and debits user balance on success.
     */
    public async processFeexPayPayoutWebhook(payload: any): Promise<void> {
        log.info('Processing FeexPay Payout Webhook via PaymentService.');

        // Use the FeexPayPayoutService to parse and validate the payload first
        const notification = feexPayPayoutService.processWebhookNotification(payload);

        const {
            transactionId: internalTransactionId,
            feexpayReference,
            status: providerStatus, // This is our internal mapped status ('completed', 'failed', etc.)
            comment: providerMessage
        } = notification;

        log.info(`Webhook details from service: internalTxId=${internalTransactionId}, feexpayRef=${feexpayReference}, status="${providerStatus}"`);

        const transaction = await transactionRepository.findByTransactionId(internalTransactionId);

        if (!transaction) {
            log.error(`Payout webhook: Transaction ${internalTransactionId} not found in DB. Cannot process.`);
            throw new AppError('Internal transaction not found for webhook processing.', 404);
        }

        if (transaction.type !== TransactionType.WITHDRAWAL) {
            log.warn(`Payout webhook: Transaction ${internalTransactionId} is not a withdrawal. Skipping balance update but updating status.`);
        }

        // Prevent processing if already completed/failed
        if (transaction.status === TransactionStatus.COMPLETED || transaction.status === TransactionStatus.FAILED) {
            log.warn(`Payout webhook: Transaction ${internalTransactionId} already in final status (${transaction.status}). Skipping update.`);
            return;
        }

        // The status from feexPayPayoutService is already mapped to our internal 'completed'/'failed' etc.
        let finalStatus: TransactionStatus;
        if (providerStatus === 'completed') {
            finalStatus = TransactionStatus.COMPLETED;
        } else if (providerStatus === 'failed') {
            finalStatus = TransactionStatus.FAILED;
        } else {
            log.warn(`Received non-final FeexPay payout status for Tx ID ${internalTransactionId}: ${providerStatus}. Ignoring.`);
            return; // Only process final states
        }


        const grossAmountToDebitInXAF = Math.abs(transaction.amount);
        const netAmountForNotification = transaction.metadata?.netAmountRequested || (grossAmountToDebitInXAF - (transaction.fee || 0));
        const targetCurrencyForNotification = transaction.metadata?.payoutCurrency || transaction.currency;

        let updateStatus: TransactionStatus = finalStatus;
        let updateMetadata: Record<string, any> = {
            ...(transaction.metadata || {}),
            providerWebhookStatus: providerStatus,
            providerWebhookMessage: providerMessage,
            providerRawWebhookData: payload,
        };

        if (finalStatus === TransactionStatus.COMPLETED) {
            log.info(`Payout for transaction ${internalTransactionId} is COMPLETED. Debiting user balance.`);
            try {
                // Debit user's balance ONLY IF it's a successful withdrawal.
                await userServiceClient.updateUserBalance(transaction.userId.toString(), -grossAmountToDebitInXAF);
                log.info(`User ${transaction.userId.toString()} balance debited by ${grossAmountToDebitInXAF} XAF for completed withdrawal ${internalTransactionId}.`);

                const userDetails = await userServiceClient.getUserDetails(transaction.userId.toString());
                if (userDetails?.email) {
                    await notificationService.sendTransactionSuccessEmail({
                        email: userDetails.email,
                        name: userDetails.name || 'Customer',
                        transactionType: 'withdrawal',
                        transactionId: transaction.transactionId,
                        amount: netAmountForNotification,
                        currency: targetCurrencyForNotification,
                        date: new Date().toISOString(),
                    });
                    log.info(`Success notification sent for transaction ${internalTransactionId}.`);
                }
            } catch (balanceError: any) {
                log.error(`CRITICAL: Failed to debit user balance for completed payout ${internalTransactionId}: ${balanceError.message}. Marking transaction as FAILED.`, balanceError);
                updateStatus = TransactionStatus.FAILED;
                updateMetadata.internalFailureReason = `Balance debit failed after provider success: ${balanceError.message}`;
            }
        } else if (finalStatus === TransactionStatus.FAILED) {
            log.warn(`Payout for transaction ${internalTransactionId} is FAILED. No balance debit needed.`);
            updateMetadata.failureReason = `External payout failed: ${providerMessage}`;

            if (transaction.metadata?.adminAction !== true) {
                const userDetails = await userServiceClient.getUserDetails(transaction.userId.toString());
                if (userDetails?.email) {
                    await notificationService.sendTransactionFailureEmail({
                        email: userDetails.email,
                        name: userDetails.name || 'Customer',
                        transactionId: transaction.transactionId,
                        transactionType: 'withdrawal',
                        amount: netAmountForNotification,
                        currency: targetCurrencyForNotification,
                        date: new Date().toISOString(),
                        reason: providerMessage || 'External payout failed.'
                    });
                    log.info(`Failure notification sent for transaction ${internalTransactionId}.`);
                }
            }
        }

        // Update the transaction record with the final status and metadata
        await transactionRepository.update(transaction._id, {
            status: updateStatus,
            serviceProvider: transaction.serviceProvider || 'FeexPay', // Set provider if not already set
            externalTransactionId: transaction.externalTransactionId || feexpayReference,
            metadata: updateMetadata
        });
        log.info(`Transaction ${internalTransactionId} status updated to ${updateStatus} based on FeexPay webhook.`);
    }
}

// Export singleton instance
const paymentService = new PaymentService();
export default paymentService; 