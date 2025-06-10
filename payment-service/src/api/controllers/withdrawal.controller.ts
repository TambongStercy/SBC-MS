import { Request, Response } from 'express';
// Removed cinetpayPayoutService import as paymentService will handle direct interaction
import paymentService from '../../services/payment.service'; // Import paymentService
import { userServiceClient, UserDetailsWithMomo } from '../../services/clients/user.service.client'; // Adjusted import for UserDetailsWithMomo
import logger from '../../utils/logger';
import { AppError } from '../../utils/errors'; // Import AppError for consistent error handling
import { Currency } from '../../database/models/transaction.model'; // Import Currency enum
import { countryCodeToDialingPrefix, momoOperatorToCinetpayPaymentMethod, momoOperatorToCountryCode } from '../../utils/operatorMaps'; // Import necessary maps
import { Types } from 'mongoose';


// Use the global Express.Request interface that's extended by auth middleware
type AuthenticatedRequest = Request & { user?: { userId: string; email: string; role: string } };

const log = logger.getLogger('WithdrawalController');

export class WithdrawalController {

    /**
     * Admin withdrawal for specific user (bypasses OTP, creates transaction directly)
     * Requires userId and amount, optionally allows override of recipient details
     */
    async initiateAdminUserWithdrawal(req: AuthenticatedRequest, res: Response) {
        log.info('Admin initiating user withdrawal request.');
        try {
            const adminId = req.user?.userId;
            if (!adminId) {
                return res.status(401).json({ success: false, message: 'Admin not authenticated' });
            }

            const { userId, amount, currency, method, accountInfo } = req.body;

            if (!userId || !amount || !currency || !method || !accountInfo) {
                return res.status(400).json({
                    success: false,
                    message: 'User ID, amount, currency, method, and account information are required.'
                });
            }
            if (amount <= 0) {
                return res.status(400).json({ success: false, message: 'Amount must be positive.' });
            }

            // Ensure accountInfo has necessary fields for the service layer
            if (!accountInfo.fullMomoNumber || !accountInfo.momoOperator || !accountInfo.countryCode) {
                return res.status(400).json({
                    success: false,
                    message: 'Account info must include fullMomoNumber, momoOperator, and countryCode.'
                });
            }

            const withdrawalResult = await paymentService.adminInitiateUserWithdrawal(
                userId,
                amount,
                { method, accountInfo },
                adminId,
                req.ip,
                req.get('User-Agent')
            );

            return res.status(200).json({
                success: true,
                message: withdrawalResult.message,
                transactionId: withdrawalResult.transactionId,
                amount: withdrawalResult.amount,
                fee: withdrawalResult.fee,
                total: withdrawalResult.total,
                status: withdrawalResult.status,
            });

        } catch (error: any) {
            log.error(`Error in initiateAdminUserWithdrawal: ${error.message}`, error);
            if (error instanceof AppError) {
                return res.status(error.statusCode).json({ success: false, message: error.message });
            }
            return res.status(500).json({
                success: false,
                message: 'Failed to initiate admin user withdrawal'
            });
        }
    }

    /**
     * Admin direct payout - no user account balance involved.
     * Logs a transaction and initiates external payout.
     */
    async initiateAdminDirectPayout(req: AuthenticatedRequest, res: Response) {
        log.info('Admin initiating direct payout request.');
        try {
            const adminId = req.user?.userId;
            if (!adminId) {
                return res.status(401).json({ success: false, message: 'Admin not authenticated' });
            }

            const { amount, currency, recipientDetails, description } = req.body;

            if (!amount || !currency || !recipientDetails || !description) {
                return res.status(400).json({
                    success: false,
                    message: 'Amount, currency, recipient details, and description are required.'
                });
            }
            if (amount <= 0) {
                return res.status(400).json({ success: false, message: 'Amount must be positive.' });
            }
            if (!recipientDetails.phoneNumber || !recipientDetails.countryCode || !recipientDetails.recipientName) {
                return res.status(400).json({
                    success: false,
                    message: 'Recipient details must include phoneNumber, countryCode, and recipientName.'
                });
            }

            const payoutResult = await paymentService.adminInitiateDirectPayout(
                amount,
                recipientDetails,
                adminId,
                description,
                req.ip,
                req.get('User-Agent')
            );

            return res.status(200).json({
                success: true,
                message: payoutResult.message,
                transactionId: payoutResult.transactionId,
                cinetpayTransactionId: payoutResult.cinetpayTransactionId,
                amount: payoutResult.amount,
                recipient: payoutResult.recipient,
                status: payoutResult.status,
                estimatedCompletion: payoutResult.estimatedCompletion,
            });

        } catch (error: any) {
            log.error(`Error in initiateAdminDirectPayout: ${error.message}`, error);
            if (error instanceof AppError) {
                return res.status(error.statusCode).json({ success: false, message: error.message });
            }
            return res.status(500).json({
                success: false,
                message: 'Failed to initiate admin direct payout'
            });
        }
    }

    // Removed private helper methods getUserDetails and updateUserBalance as they are now handled by paymentService.

    /**
     * Get country prefix from country code (utility method, still useful here)
     */
    private getCountryPrefix(countryCode: string): string {
        // This mapping should ideally be centralized or fetched from a config
        const prefixes: { [key: string]: string } = {
            'CM': '237', // Cameroon
            'CI': '225', // Côte d'Ivoire
            'SN': '221', // Senegal
            'TG': '228', // Togo
            'BJ': '229', // Benin
            'ML': '223', // Mali
            'BF': '226', // Burkina Faso
            'GN': '224', // Guinea
            'CD': '243', // Congo (RDC)
        };
        return prefixes[countryCode] || '';
    }

    /**
     * Extract country code from momoNumber (utility method, still useful here for initial parsing/validation in controller)
     */
    private extractCountryCode(momoNumber: string): string | null {
        // This is a simplified example, in a real system you'd use a more robust library
        // to determine country code from a phone number, or rely on user input.
        const knownPrefixes: { [key: string]: string } = {
            '237': 'CM', // Cameroon
            '225': 'CI', // Côte d'Ivoire
            '221': 'SN', // Senegal
            '228': 'TG', // Togo
            '229': 'BJ', // Benin
            '223': 'ML', // Mali
            '226': 'BF', // Burkina Faso
            '224': 'GN', // Guinea
            '243': 'CD', // Congo (RDC)
        };

        for (const prefix in knownPrefixes) {
            if (momoNumber.startsWith(prefix)) {
                return knownPrefixes[prefix];
            }
        }
        return null;
    }

    /**
     * Extract phone number without country code (utility method, kept for consistency if needed, though paymentService handles full number parsing)
     */
    private extractPhoneNumber(momoNumber: string, countryCode: string): string {
        const prefix = this.getCountryPrefix(countryCode);
        if (momoNumber.startsWith(prefix)) {
            return momoNumber.substring(prefix.length);
        }
        return momoNumber; // Return as is if prefix not found or applicable
    }

    /**
     * Map momoOperator to CinetPay payment method (utility method, kept for consistency if needed, though paymentService handles full mapping)
     */
    private mapOperatorToPaymentMethod(momoOperator: string, countryCode: string): string | undefined {
        // This mapping needs to be precise based on CinetPay's requirements
        // Example for CM:
        if (countryCode === 'CM') {
            if (momoOperator.toLowerCase().includes('mtn')) return 'MTN_MOMO_CMR';
            if (momoOperator.toLowerCase().includes('orange')) return 'ORANGE_MONEY_CMR';
        }
        // Add other country-specific mappings here
        return undefined; // Or throw an error if no mapping is found
    }
}

export const withdrawalController = new WithdrawalController();
