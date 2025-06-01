import { Request, Response } from 'express';
import { cinetpayPayoutService } from '../../services/cinetpay-payout.service';
import logger from '../../utils/logger';
import axios from 'axios';
import config from '../../config';

// Use the global Express.Request interface that's extended by auth middleware
type AuthenticatedRequest = Request;

const log = logger.getLogger('WithdrawalController');

export class WithdrawalController {
    /**
     * User withdrawal - only requires amount
     * Uses user's momoNumber and momoOperator from their profile
     */
    async initiateUserWithdrawal(req: AuthenticatedRequest, res: Response) {
        try {
            const { amount } = req.body;
            const userId = req.user?.userId;

            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'User authentication required'
                });
            }

            if (!amount || amount <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Valid withdrawal amount is required'
                });
            }

            log.info(`User ${userId} initiating withdrawal: ${amount}`);

            // Get user details from user service
            const userDetails = await this.getUserDetails(userId);
            if (!userDetails) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found'
                });
            }

            // Validate user has sufficient balance
            if (userDetails.balance < amount) {
                return res.status(400).json({
                    success: false,
                    message: `Insufficient balance. Available: ${userDetails.balance}, Requested: ${amount}`
                });
            }

            // Validate user has momo details
            if (!userDetails.momoNumber || !userDetails.momoOperator) {
                return res.status(400).json({
                    success: false,
                    message: 'Mobile money details not configured. Please update your profile with momoNumber and momoOperator.'
                });
            }

            // Extract country code from momoNumber
            const countryCode = this.extractCountryCode(userDetails.momoNumber);
            if (!countryCode) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid mobile money number format. Country code not detected.'
                });
            }

            // Extract phone number without country code
            const phoneNumber = this.extractPhoneNumber(userDetails.momoNumber, countryCode);

            // Initiate payout
            const payoutResult = await cinetpayPayoutService.initiatePayout({
                userId: userId,
                amount: amount,
                phoneNumber: phoneNumber,
                countryCode: countryCode,
                recipientName: userDetails.name,
                recipientEmail: userDetails.email,
                paymentMethod: this.mapOperatorToPaymentMethod(userDetails.momoOperator, countryCode),
                description: `User withdrawal - ${userDetails.name}`
            });

            if (payoutResult.success) {
                // Deduct amount from user balance
                await this.updateUserBalance(userId, -amount);

                log.info(`User withdrawal successful: ${payoutResult.transactionId}`);

                return res.status(200).json({
                    success: true,
                    message: 'Withdrawal initiated successfully',
                    data: {
                        transactionId: payoutResult.transactionId,
                        cinetpayTransactionId: payoutResult.cinetpayTransactionId,
                        amount: payoutResult.amount,
                        recipient: payoutResult.recipient,
                        status: payoutResult.status,
                        estimatedCompletion: payoutResult.estimatedCompletion
                    }
                });
            } else {
                return res.status(400).json({
                    success: false,
                    message: payoutResult.message,
                    error: 'Payout initiation failed'
                });
            }

        } catch (error: any) {
            log.error('User withdrawal failed:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error during withdrawal',
                error: error.message
            });
        }
    }

    /**
     * Admin withdrawal for specific user
     * Requires userId and amount, optionally allows override of recipient details
     */
    async initiateAdminUserWithdrawal(req: AuthenticatedRequest, res: Response) {
        try {
            const {
                userId,
                amount,
                phoneNumber: overridePhoneNumber,
                countryCode: overrideCountryCode,
                paymentMethod: overridePaymentMethod,
                recipientName: overrideRecipientName
            } = req.body;

            if (!req.user || req.user.role !== 'admin') {
                return res.status(403).json({
                    success: false,
                    message: 'Admin access required'
                });
            }

            if (!userId || !amount || amount <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Valid userId and amount are required'
                });
            }

            const isOverride = overridePhoneNumber || overrideCountryCode || overridePaymentMethod;

            log.info(`Admin ${req.user.userId} initiating ${isOverride ? 'override ' : ''}withdrawal for user ${userId}: ${amount}`);
            if (isOverride) {
                log.info(`Override details - Phone: ${overridePhoneNumber}, Country: ${overrideCountryCode}, Payment: ${overridePaymentMethod}`);
            }

            // Get user details
            const userDetails = await this.getUserDetails(userId);
            if (!userDetails) {
                return res.status(404).json({
                    success: false,
                    message: 'Target user not found'
                });
            }

            log.debug(`Retrieved user details for ${userId}:`, {
                name: userDetails.name,
                email: userDetails.email,
                balance: userDetails.balance,
                momoNumber: userDetails.momoNumber ? 'configured' : 'missing',
                momoOperator: userDetails.momoOperator ? 'configured' : 'missing'
            });

            // Validate user has sufficient balance
            if (userDetails.balance < amount) {
                return res.status(400).json({
                    success: false,
                    message: `User has insufficient balance. Available: ${userDetails.balance}, Requested: ${amount}`
                });
            }

            let phoneNumber, countryCode, paymentMethod, recipientName;

            if (isOverride) {
                // Use override parameters
                if (overridePhoneNumber && overrideCountryCode) {
                    phoneNumber = overridePhoneNumber;
                    countryCode = overrideCountryCode;
                    paymentMethod = overridePaymentMethod; // Can be undefined for auto-detection
                    recipientName = overrideRecipientName || userDetails.name;

                    log.info(`Using override recipient: +${this.getCountryPrefix(countryCode)}${phoneNumber}`);
                } else {
                    return res.status(400).json({
                        success: false,
                        message: 'When using override, both phoneNumber and countryCode are required'
                    });
                }
            } else {
                // Use user's stored momo details
                if (!userDetails.momoNumber || !userDetails.momoOperator) {
                    return res.status(400).json({
                        success: false,
                        message: 'User mobile money details not configured. Use override parameters or configure user momo details.'
                    });
                }

                // Extract country and phone details from user's momo
                countryCode = this.extractCountryCode(userDetails.momoNumber);
                if (!countryCode) {
                    return res.status(400).json({
                        success: false,
                        message: 'Invalid user mobile money number format. Use override parameters.'
                    });
                }

                phoneNumber = this.extractPhoneNumber(userDetails.momoNumber, countryCode);
                paymentMethod = this.mapOperatorToPaymentMethod(userDetails.momoOperator, countryCode);
                recipientName = userDetails.name;

                log.info(`Using user's momo details: +${this.getCountryPrefix(countryCode)}${phoneNumber}`);
            }

            // Initiate payout
            const payoutResult = await cinetpayPayoutService.initiatePayout({
                userId: userId,
                amount: amount,
                phoneNumber: phoneNumber,
                countryCode: countryCode,
                recipientName: recipientName,
                recipientEmail: userDetails.email,
                paymentMethod: paymentMethod,
                description: `Admin ${isOverride ? 'override ' : ''}withdrawal for ${userDetails.name} by ${req.user.email}${isOverride ? ` to +${this.getCountryPrefix(countryCode)}${phoneNumber}` : ''}`
            });

            if (payoutResult.success) {
                // Deduct amount from user balance
                await this.updateUserBalance(userId, -amount);

                log.info(`Admin withdrawal successful: ${payoutResult.transactionId}`);

                return res.status(200).json({
                    success: true,
                    message: `Admin ${isOverride ? 'override ' : ''}withdrawal initiated successfully`,
                    data: {
                        transactionId: payoutResult.transactionId,
                        cinetpayTransactionId: payoutResult.cinetpayTransactionId,
                        amount: payoutResult.amount,
                        recipient: payoutResult.recipient,
                        targetUser: {
                            id: userId,
                            name: userDetails.name,
                            email: userDetails.email
                        },
                        status: payoutResult.status,
                        estimatedCompletion: payoutResult.estimatedCompletion,
                        isOverride: isOverride,
                        overrideDetails: isOverride ? {
                            originalMomo: userDetails.momoNumber,
                            overrideRecipient: `+${this.getCountryPrefix(countryCode)}${phoneNumber}`,
                            reason: 'Admin override for problem resolution'
                        } : undefined
                    }
                });
            } else {
                return res.status(400).json({
                    success: false,
                    message: payoutResult.message,
                    error: 'Admin withdrawal failed'
                });
            }

        } catch (error: any) {
            log.error('Admin user withdrawal failed:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error during admin withdrawal',
                error: error.message
            });
        }
    }

    /**
     * Admin direct payout - no user account involved
     * Affects only API balance, not user balances
     */
    async initiateAdminDirectPayout(req: AuthenticatedRequest, res: Response) {
        try {
            const { amount, phoneNumber, countryCode, recipientName, recipientEmail, paymentMethod, description } = req.body;

            if (!req.user || req.user.role !== 'admin') {
                return res.status(403).json({
                    success: false,
                    message: 'Admin access required'
                });
            }

            if (!amount || !phoneNumber || !countryCode || !recipientName) {
                return res.status(400).json({
                    success: false,
                    message: 'Amount, phoneNumber, countryCode, and recipientName are required'
                });
            }

            log.info(`Admin ${req.user.userId} initiating direct payout: ${amount} to ${phoneNumber}`);

            // Initiate payout without userId (admin transaction)
            const payoutResult = await cinetpayPayoutService.initiatePayout({
                userId: `admin_${req.user.userId}`, // Special admin transaction ID
                amount: amount,
                phoneNumber: phoneNumber,
                countryCode: countryCode,
                recipientName: recipientName,
                recipientEmail: recipientEmail || `admin-payout@sbc.com`,
                paymentMethod: paymentMethod,
                description: description || `Admin direct payout by ${req.user.email}`
            });

            if (payoutResult.success) {
                log.info(`Admin direct payout successful: ${payoutResult.transactionId}`);

                return res.status(200).json({
                    success: true,
                    message: 'Admin direct payout initiated successfully',
                    data: {
                        transactionId: payoutResult.transactionId,
                        cinetpayTransactionId: payoutResult.cinetpayTransactionId,
                        amount: payoutResult.amount,
                        recipient: payoutResult.recipient,
                        status: payoutResult.status,
                        estimatedCompletion: payoutResult.estimatedCompletion,
                        note: 'This is a direct admin payout - no user balance affected'
                    }
                });
            } else {
                return res.status(400).json({
                    success: false,
                    message: payoutResult.message,
                    error: 'Admin direct payout failed'
                });
            }

        } catch (error: any) {
            log.error('Admin direct payout failed:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error during admin payout',
                error: error.message
            });
        }
    }

    /**
     * Get user details from user service
     */
    private async getUserDetails(userId: string): Promise<any> {
        try {
            // Use the batch-details endpoint with a single user ID
            const response = await axios.post(`${config.services.userServiceUrl}/users/internal/batch-details`,
                { userIds: [userId] },
                {
                    headers: {
                        'Authorization': `Bearer ${config.services.serviceSecret}`,
                        'X-Service-Name': 'payment-service',
                        'Content-Type': 'application/json'
                    }
                }
            );

            // The batch-details endpoint returns an array, so get the first user
            const users = response.data.data;
            if (users && users.length > 0) {
                return users[0];
            }

            log.warn(`User ${userId} not found in batch-details response`);
            return null;
        } catch (error: any) {
            log.error(`Failed to get user details for ${userId}:`, error.message);
            if (error.response) {
                log.error(`Response status: ${error.response.status}`);
                log.error(`Response data:`, error.response.data);
            }
            return null;
        }
    }

    /**
     * Update user balance
     */
    private async updateUserBalance(userId: string, amountChange: number): Promise<void> {
        try {
            await axios.post(`${config.services.userServiceUrl}/users/internal/${userId}/balance`,
                { amount: amountChange },
                {
                    headers: {
                        'Authorization': `Bearer ${config.services.serviceSecret}`,
                        'X-Service-Name': 'payment-service',
                        'Content-Type': 'application/json'
                    }
                }
            );
            log.info(`Updated user ${userId} balance by ${amountChange}`);
        } catch (error: any) {
            log.error(`Failed to update user balance for ${userId}:`, error.message);
            if (error.response) {
                log.error(`Balance update response status: ${error.response.status}`);
                log.error(`Balance update response data:`, error.response.data);
            }
            throw new Error('Failed to update user balance');
        }
    }

    /**
     * Get country prefix from country code
     */
    private getCountryPrefix(countryCode: string): string {
        const countryPrefixes: Record<string, string> = {
            'CI': '225', 'SN': '221', 'CM': '237', 'TG': '228',
            'BJ': '229', 'ML': '223', 'BF': '226', 'GN': '224', 'CD': '243'
        };
        return countryPrefixes[countryCode] || '';
    }

    /**
     * Extract country code from momoNumber
     */
    private extractCountryCode(momoNumber: string): string | null {
        const countryPrefixes: Record<string, string> = {
            '225': 'CI', // Côte d'Ivoire
            '221': 'SN', // Sénégal
            '237': 'CM', // Cameroun
            '228': 'TG', // Togo
            '229': 'BJ', // Benin
            '223': 'ML', // Mali
            '226': 'BF', // Burkina Faso
            '224': 'GN', // Guinea
            '243': 'CD', // Congo (RDC)
        };

        // Remove any non-digit characters
        const cleanNumber = momoNumber.replace(/\D/g, '');

        // Check for country prefixes
        for (const [prefix, code] of Object.entries(countryPrefixes)) {
            if (cleanNumber.startsWith(prefix)) {
                return code;
            }
        }

        return null;
    }

    /**
     * Extract phone number without country code
     */
    private extractPhoneNumber(momoNumber: string, countryCode: string): string {
        const countryPrefixes: Record<string, string> = {
            'CI': '225', 'SN': '221', 'CM': '237', 'TG': '228',
            'BJ': '229', 'ML': '223', 'BF': '226', 'GN': '224', 'CD': '243'
        };

        const prefix = countryPrefixes[countryCode];
        const cleanNumber = momoNumber.replace(/\D/g, '');

        if (prefix && cleanNumber.startsWith(prefix)) {
            return cleanNumber.substring(prefix.length);
        }

        return cleanNumber;
    }

    /**
     * Map momoOperator to CinetPay payment method
     */
    private mapOperatorToPaymentMethod(momoOperator: string, countryCode: string): string | undefined {
        const operatorMap: Record<string, Record<string, string>> = {
            'CM': {
                'MTN': 'MTNCM',
                'ORANGE': 'OMCM',
                'mtn': 'MTNCM',
                'orange': 'OMCM'
            },
            'CI': {
                'ORANGE': 'OM',
                'MTN': 'MOMO',
                'MOOV': 'FLOOZ',
                'WAVE': 'WAVECI',
                'orange': 'OM',
                'mtn': 'MOMO',
                'moov': 'FLOOZ',
                'wave': 'WAVECI'
            },
            'SN': {
                'ORANGE': 'OMSN',
                'FREE': 'FREESN',
                'WAVE': 'WAVESN',
                'orange': 'OMSN',
                'free': 'FREESN',
                'wave': 'WAVESN'
            }
        };

        const countryOperators = operatorMap[countryCode];
        if (countryOperators) {
            return countryOperators[momoOperator] || countryOperators[momoOperator.toLowerCase()];
        }

        return undefined; // Let CinetPay auto-detect
    }
}

export const withdrawalController = new WithdrawalController();
