// import { Types } from 'mongoose';
// import { userServiceClient, UserDetailsWithMomo } from './clients/user.service.client';
// import paymentService from './payment.service'; // Assuming paymentService is the default export
// import {
//     momoOperatorToCountryCode,
//     countryCodeToDialingPrefix,
//     momoOperatorToCinetpayPaymentMethod,
//     // Add FeexPay specific operator maps here if needed later
// } from '../utils/operatorMaps';
// import logger from '../utils/logger';
// import { AppError } from '../utils/errors';
// import { Currency, ITransaction, TransactionStatus, TransactionType } from '../database/models/transaction.model';
// import transactionRepository from '../database/repositories/transaction.repository';
// import pendingRepository from '../database/repositories/pending.repository';
// import { VerificationType, PendingStatus, IPending } from '../database/models/pending.model';

// const log = logger.getLogger('TransactionService');

// // --- Placeholder for WithdrawalRequest Model/Interface and Repository ---
// // This should align with your actual WithdrawalRequest model if it exists.
// export enum WithdrawalRequestStatus {
//     PENDING_VERIFICATION = 'PENDING_VERIFICATION',
//     PENDING_PROCESSING = 'PENDING_PROCESSING', // After OTP, before provider payout
//     PENDING_PROVIDER_CONFIRMATION = 'PENDING_PROVIDER_CONFIRMATION',
//     COMPLETED = 'COMPLETED',
//     FAILED = 'FAILED',
//     CANCELED = 'CANCELED',
// }

// export interface IWithdrawalRequest {
//     _id: Types.ObjectId;
//     userId: string | Types.ObjectId;
//     transactionId?: string | Types.ObjectId; // Link to the actual transaction record
//     amount: number; // Amount requested by user
//     currency: Currency;
//     momoNumber: string; // Full international number used for payout
//     momoOperator: string; // Operator slug
//     status: WithdrawalRequestStatus;
//     providerPayoutId?: string; // ID from CinetPay/FeexPay for the payout
//     failureReason?: string;
//     metadata?: Record<string, any>;
//     createdAt: Date;
//     updatedAt: Date;
// }

// // Placeholder repository (replace with your actual implementation)
// const withdrawalRequestRepository = {
//     findByTransactionId: async (transactionId: string): Promise<IWithdrawalRequest | null> => {
//         log.debug(`Placeholder: findByTransactionId called with ${transactionId}`);
//         // Simulate finding a request. In reality, query MongoDB.
//         // This would typically find based on the ID of the ITransaction record created for the withdrawal.
//         return null;
//     },
//     update: async (id: Types.ObjectId, updateData: Partial<IWithdrawalRequest>): Promise<IWithdrawalRequest | null> => {
//         log.debug(`Placeholder: update WithdrawalRequest ${id} with`, updateData);
//         // Simulate update. In reality, update MongoDB and return the updated document.
//         return { _id: id, ...updateData } as IWithdrawalRequest; // Very basic mock
//     },
//     // Add other necessary methods like create, findById, etc.
//     create: async (data: Partial<IWithdrawalRequest>): Promise<IWithdrawalRequest> => {
//         log.debug('Placeholder: Creating withdrawal request', data);
//         // @ts-ignore
//         return { _id: new Types.ObjectId(), ...data, createdAt: new Date(), updatedAt: new Date() } as IWithdrawalRequest;
//     }
// };
// // --- End Placeholder ---

// class TransactionService {
//     constructor() {
//         // Dependencies can be injected here if needed
//     }

//     /**
//      * Initiates the actual payout to the user's MoMo account via the selected gateway.
//      * This is called after a withdrawal request has been verified (e.g., OTP).
//      */
//     public async initiateWithdrawalPayout(withdrawalTransactionId: string): Promise<void> {
//         log.info(`Initiating withdrawal payout for transaction ID: ${withdrawalTransactionId}`);

//         const withdrawalTransaction = await transactionRepository.findByTransactionId(withdrawalTransactionId);
//         if (!withdrawalTransaction || withdrawalTransaction.type !== TransactionType.WITHDRAWAL) {
//             log.error(`Withdrawal transaction not found or not a withdrawal type: ${withdrawalTransactionId}`);
//             throw new AppError('Invalid withdrawal transaction reference.', 404);
//         }

//         if (withdrawalTransaction.status !== TransactionStatus.PENDING) {
//             log.warn(`Withdrawal transaction ${withdrawalTransactionId} is not in PENDING state (current: ${withdrawalTransaction.status}). Payout might have already been attempted or processed.`);
//             // Decide if to proceed or throw error. For now, we'll proceed but this might need adjustment.
//             // throw new AppError('Withdrawal is not in a state eligible for payout.', 400);
//         }

//         // Attempt to find an existing withdrawal request linked to this transaction.
//         // Or, if your flow creates the WithdrawalRequest record earlier, you'd fetch it directly.
//         let withdrawalRequest = await withdrawalRequestRepository.findByTransactionId(withdrawalTransactionId);

//         if (!withdrawalRequest) {
//             log.warn(`No existing WithdrawalRequest found for transaction ${withdrawalTransactionId}. This might be an issue if it should have been created earlier.`);
//             // If the WithdrawalRequest is meant to be created *here* or if this is the first time we process it for payout,
//             // we might need to create it or ensure necessary data is on the transaction.metadata.
//             // For this example, we'll assume the critical payout details are on the transaction or its metadata.
//             // This part highly depends on your application's specific flow for creating WithdrawalRequest records.
//         }

//         const userId = withdrawalTransaction.userId.toString();
//         const userDetails = await userServiceClient.getUserDetailsWithMomo(userId);

//         if (!userDetails) {
//             log.error(`User details not found for user ID: ${userId}. Cannot proceed with payout.`);
//             await transactionRepository.update(withdrawalTransactionId, { status: TransactionStatus.FAILED, metadata: { failureReason: 'User details not found for payout' } });
//             if (withdrawalRequest) {
//                 await withdrawalRequestRepository.update(withdrawalRequest._id, { status: WithdrawalRequestStatus.FAILED, failureReason: 'User details not found' });
//             }
//             throw new AppError('User details not found for payout.', 404);
//         }

//         if (!userDetails.momoNumber || !userDetails.momoOperator) {
//             log.error(`User ${userId} is missing momoNumber or momoOperator. Cannot proceed with payout.`);
//             await transactionRepository.update(withdrawalTransactionId, { status: TransactionStatus.FAILED, metadata: { failureReason: 'User missing MoMo details' } });
//             if (withdrawalRequest) {
//                 await withdrawalRequestRepository.update(withdrawalRequest._id, { status: WithdrawalRequestStatus.FAILED, failureReason: 'User missing MoMo details' });
//             }
//             throw new AppError('User is missing Mobile Money details for payout.', 400);
//         }

//         const { momoNumber, momoOperator, name: userName, email: userEmail } = userDetails;
//         const amountToPayout = Math.abs(withdrawalTransaction.amount); // Ensure positive amount
//         const currency = withdrawalTransaction.currency;

//         const countryCode = momoOperatorToCountryCode[momoOperator];
//         if (!countryCode) {
//             log.error(`Could not determine country code for momoOperator: ${momoOperator} (User: ${userId})`);
//             await transactionRepository.update(withdrawalTransactionId, { status: TransactionStatus.FAILED, metadata: { failureReason: 'Invalid MoMo operator configuration' } });
//             if (withdrawalRequest) {
//                 await withdrawalRequestRepository.update(withdrawalRequest._id, { status: WithdrawalRequestStatus.FAILED, failureReason: 'Invalid MoMo operator configuration' });
//             }
//             throw new AppError('Invalid MoMo operator configuration for payout.', 500);
//         }

//         const dialingPrefix = countryCodeToDialingPrefix[countryCode];
//         if (!dialingPrefix) {
//             log.error(`Could not determine dialing prefix for country code: ${countryCode} (User: ${userId})`);
//             await transactionRepository.update(withdrawalTransactionId, { status: TransactionStatus.FAILED, metadata: { failureReason: 'Invalid country configuration for MoMo operator' } });
//             if (withdrawalRequest) {
//                 await withdrawalRequestRepository.update(withdrawalRequest._id, { status: WithdrawalRequestStatus.FAILED, failureReason: 'Invalid country configuration for MoMo operator' });
//             }
//             throw new AppError('Invalid country configuration for MoMo operator payout.', 500);
//         }

//         // Ensure momoNumber is in national format for some providers or full international for others.
//         // The userModel should ideally store the full international number or national + country code.
//         // For CinetPay, they require prefix + national number separately.
//         let nationalMomoNumber = momoNumber;
//         if (momoNumber.startsWith(dialingPrefix)) {
//             nationalMomoNumber = momoNumber.substring(dialingPrefix.length);
//         }

//         // Update WithdrawalRequest status to PENDING_PROVIDER_CONFIRMATION
//         if (withdrawalRequest) {
//             withdrawalRequest = await withdrawalRequestRepository.update(withdrawalRequest._id, {
//                 status: WithdrawalRequestStatus.PENDING_PROVIDER_CONFIRMATION,
//                 momoNumber: momoNumber, // Store the number used for payout
//                 momoOperator: momoOperator // Store the operator used
//             });
//         } else {
//             // If no withdrawalRequest existed, we might create one here or rely on Transaction metadata
//             log.warn(`No IWithdrawalRequest object to update status to PENDING_PROVIDER_CONFIRMATION for tx: ${withdrawalTransactionId}`);
//             // Consider creating a WithdrawalRequest record here if it's central to tracking payouts
//             withdrawalRequest = await withdrawalRequestRepository.create({
//                 userId,
//                 transactionId: withdrawalTransaction._id,
//                 amount: amountToPayout,
//                 currency,
//                 momoNumber,
//                 momoOperator,
//                 status: WithdrawalRequestStatus.PENDING_PROVIDER_CONFIRMATION,
//                 metadata: { initiatedBy: 'TransactionService.initiateWithdrawalPayout' }
//             });
//         }
//         // Also update the main transaction status to reflect it's being processed by provider
//         await transactionRepository.update(withdrawalTransactionId, {
//             status: TransactionStatus.PROCESSING,
//             metadata: { ...(withdrawalTransaction?.metadata || {}), statusDetails: 'Payout initiated with provider' }
//         });

//         try {
//             let payoutResult: { success: boolean; providerTransactionId?: string; error?: any; message?: string };

//             // TODO: Implement actual FeexPay payout logic based on their API
//             const isCinetpayCountry = countryCode === 'CM'; // Example: CinetPay only for Cameroon payouts
//             // Or use a more robust mapping like momoOperatorToCinetpayPaymentMethod[momoOperator]

//             if (momoOperatorToCinetpayPaymentMethod[momoOperator] && isCinetpayCountry) {
//                 log.info(`Processing payout for ${userId} via CinetPay. Amount: ${amountToPayout} ${currency} to ${momoNumber} (${momoOperator})`);
//                 const cinetpayPaymentMethod = momoOperatorToCinetpayPaymentMethod[momoOperator];

//                 payoutResult = await paymentService.processCinetpayTransfer({
//                     transactionId: withdrawalTransactionId, // Link to our internal transaction
//                     prefix: dialingPrefix,
//                     phone: nationalMomoNumber,
//                     amount: amountToPayout,
//                     currency: currency, // CinetPay transfer API might have currency constraints
//                     firstName: userName?.split(' ')[0] || 'SBC User',
//                     lastName: userName?.split(' ').slice(1).join(' ') || 'SBC',
//                     email: userEmail || `${userId}@sbc.com`.toLowerCase(),
//                     paymentMethod: cinetpayPaymentMethod,
//                     // notifyUrl: // We'll need a dedicated webhook for transfer status
//                 });
//             } else {
//                 // Assume FeexPay or other provider for other countries/operators
//                 log.info(`Processing payout for ${userId} via FeexPay (placeholder). Amount: ${amountToPayout} ${currency} to ${momoNumber} (${momoOperator})`);
//                 // payoutResult = await paymentService.processFeexpayPayout(
//                 //     withdrawalTransactionId, 
//                 //     momoNumber, // FeexPay might want full international number
//                 //     momoOperator, // FeexPay operator slug
//                 //     amountToPayout, 
//                 //     currency
//                 // );
//                 // For now, simulate success for non-CinetPay as FeexPay Payout is not yet defined
//                 log.warn('FeexPay payout is not implemented yet. Simulating success for now.');
//                 payoutResult = { success: true, providerTransactionId: `feex_sim_${Date.now()}` };
//             }

   //             if (payoutResult.success) {
//                 log.info(`Payout successfully initiated with provider for transaction ${withdrawalTransactionId}. Provider ID: ${payoutResult.providerTransactionId}`);
//                 // Status remains PENDING_PROVIDER_CONFIRMATION until webhook confirms final status
//                 if (withdrawalRequest) {
//                     await withdrawalRequestRepository.update(withdrawalRequest._id, {
//                         providerPayoutId: payoutResult.providerTransactionId,
//                         // Status remains PENDING_PROVIDER_CONFIRMATION
//                     });
//                 }
//                 // The main transaction (ITransaction) remains PROCESSING or PENDING_PROVIDER_CONFIRMATION
//                 await transactionRepository.update(withdrawalTransaction._id, {
//                     externalTransactionId: payoutResult.providerTransactionId,
//                     serviceProvider: isCinetpayCountry ? 'CinetPay' : 'FeexPay',
//                     paymentMethod: momoOperator,
//                     metadata: {
//                         ...(withdrawalTransaction.metadata || {}),
//                         providerPayoutStatus: 'INITIATED',
//                         providerMessage: payoutResult.message
//                     }
//                 })

//             } else {
//                 log.error(`Provider payout initiation failed for transaction ${withdrawalTransactionId}: ${payoutResult.message || 'Unknown provider error'}`, payoutResult.error);
//                 await transactionRepository.update(withdrawalTransactionId, {
//                     status: TransactionStatus.FAILED,
//                     metadata: { failureReason: `Provider payout failed: ${payoutResult.message || 'Unknown error'}`, providerError: payoutResult.error }
//                 });
//                 if (withdrawalRequest) {
//                     await withdrawalRequestRepository.update(withdrawalRequest._id, {
//                         status: WithdrawalRequestStatus.FAILED,
//                         failureReason: `Provider payout failed: ${payoutResult.message || 'Unknown error'}`
//                     });
//                 }
//             }
//         } catch (error: any) {
//             log.error(`Critical error during payout initiation for transaction ${withdrawalTransactionId}:`, error);
//             // Set transaction to FAILED
//             await transactionRepository.update(withdrawalTransactionId, {
//                 status: TransactionStatus.FAILED,
//                 metadata: { failureReason: `Payout system error: ${error.message}` }
//             });
//             if (withdrawalRequest) {
//                 await withdrawalRequestRepository.update(withdrawalRequest._id, {
//                     status: WithdrawalRequestStatus.FAILED,
//                     failureReason: `Payout system error: ${error.message}`
//                 });
//             }
//             // Re-throw the error so the caller (e.g., job queue) knows it failed
//             throw new AppError(`Critical error processing payout: ${error.message}`, 500);
//         }
//     }

//     // ... other transaction related methods like requestWithdrawal, verifyWithdrawalOTP etc. ...
//     // For example:
//     public async requestWithdrawal(
//         userId: string,
//         amount: number,
//         currency: Currency,
//         momoAccountNumber: string, // User provides their number, could be national or international
//         momoOperatorSlug: string,
//         ipAddress?: string,
//         deviceInfo?: string
//     ): Promise<{ pendingId: string, transactionId: string }> {
//         log.info(`Withdrawal request received for user ${userId}: ${amount} ${currency} to ${momoOperatorSlug} ${momoAccountNumber}`);

//         // 1. Validate user, balance, withdrawal limits (calls to UserService)
//         const userDetails = await userServiceClient.getUserDetailsWithMomo(userId);
//         if (!userDetails) throw new AppError('User not found', 404);
//         // TODO: Add momoNumber and momoOperator to userDetails from user-service if not already there or use input directly
//         // For now, we assume the input momoAccountNumber and momoOperatorSlug are what the user selected/confirmed.

//         const balance = await userServiceClient.getBalance(userId);
//         if (balance < amount) throw new AppError('Insufficient balance', 400);

//         // const limitCheck = await userServiceClient.checkWithdrawalLimits(userId, amount);
//         // if (!limitCheck.allowed) throw new AppError(limitCheck.reason || 'Withdrawal limit exceeded', 400);

//         // 2. Create Pending record for OTP verification
//         //    The `momoAccountNumber` and `momoOperatorSlug` from user input will be stored here.
//         const pendingWithdrawal = await pendingRepository.create({
//             userId,
//             transactionType: TransactionType.WITHDRAWAL,
//             amount,
//             currency,
//             verificationType: VerificationType.OTP, // Or other method
//             description: `Withdrawal request: ${amount} ${currency} to ${momoOperatorSlug}`,
//             metadata: {
//                 momoAccountNumber, // Store the number provided by user
//                 momoOperatorSlug,  // Store operator selected by user
//                 // Store fee calculation if applicable here
//             },
//             ipAddress,
//             deviceInfo
//         });

//         // 3. Send OTP to user (via NotificationService)
//         // await notificationService.sendOtp(userId, pendingWithdrawal.verificationCode, 'withdrawal');
//         log.info(`OTP (simulated: ${pendingWithdrawal.verificationCode}) sent for withdrawal pendingId: ${pendingWithdrawal.pendingId}`);

//         // 4. Create the main Transaction record in PENDING_OTP_VERIFICATION state
//         const transaction = await transactionRepository.create({
//             userId,
//             type: TransactionType.WITHDRAWAL,
//             amount: -amount, // Store as negative for accounting
//             currency,
//             status: TransactionStatus.PENDING_OTP_VERIFICATION, // New status
//             description: `Withdrawal: ${amount} ${currency} to ${momoOperatorSlug} ${momoAccountNumber}`,
//             pendingId: pendingWithdrawal.pendingId, // Link to pending record
//             metadata: {
//                 momoOperator: momoOperatorSlug,
//                 momoTarget: momoAccountNumber,
//                 // Any other relevant info
//             },
//             ipAddress,
//             deviceInfo,
//         });

//         log.info(`Withdrawal transaction ${transaction.transactionId} created, pending OTP verification.`);
//         return { pendingId: pendingWithdrawal.pendingId, transactionId: transaction.transactionId };
//     }

//     public async verifyWithdrawalOtp(
//         transactionId: string,
//         otpCode: string
//     ): Promise<boolean> {
//         log.info(`Verifying OTP for withdrawal transaction: ${transactionId}`);
//         const transaction = await transactionRepository.findByTransactionId(transactionId);
//         if (!transaction || !transaction.pendingId) {
//             throw new AppError('Transaction not found or not eligible for OTP verification', 404);
//         }
//         if (transaction.status !== TransactionStatus.PENDING_OTP_VERIFICATION) {
//             throw new AppError('Transaction not in OTP verification state', 400);
//         }

//         const { verified, pending } = await pendingRepository.verify(transaction.pendingId.toString(), otpCode);
//         if (!verified || !pending) {
//             await transactionRepository.update(transactionId, { status: TransactionStatus.FAILED, metadata: { ...(transaction?.metadata || {}), failureReason: 'OTP verification failed' } });
//             log.warn(`OTP verification failed for transaction ${transactionId}`);
//             return false;
//         }

//         // OTP is valid, update transaction status to PENDING (ready for payout processing)
//         await transactionRepository.update(transactionId, { status: TransactionStatus.PENDING, metadata: { ...(transaction?.metadata || {}), statusDetails: 'OTP verified, awaiting payout' } });

//         // Ensure pending is not null and is an object with _id before calling toString()
//         if (pending && typeof pending === 'object' && '_id' in pending) {
//             await pendingRepository.updateStatus(((pending as any)._id as Types.ObjectId).toString(), PendingStatus.VERIFIED);
//         } else {
//             // This case should ideally not be reached if the previous check (!pending) is effective
//             // and if pendingRepository.verify returns a correctly structured object.
//             log.error(`Transaction ${transactionId}: pending object is not as expected after OTP verification.`, pending);
//             // Potentially mark the transaction as failed or requiring investigation
//             await transactionRepository.update(transactionId, { status: TransactionStatus.FAILED, metadata: { ...(transaction?.metadata || {}), failureReason: 'Internal error: Pending data inconsistent after OTP verification' } });
//             return false; // Or throw an error
//         }

//         log.info(`OTP verified for transaction ${transactionId}. Status updated to PENDING.`);

//         // Trigger the actual payout initiation (can be asynchronous)
//         this.initiateWithdrawalPayout(transactionId).catch(err => {
//             log.error(`Error in background initiateWithdrawalPayout for ${transactionId} after OTP verification:`, err);
//             // The error is already handled and status set to FAILED within initiateWithdrawalPayout
//         });

//         return true;
//     }

// }

// export const transactionService = new TransactionService();
// export default transactionService; 