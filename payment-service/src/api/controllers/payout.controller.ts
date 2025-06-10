import { Request, Response } from 'express';
import { cinetpayPayoutService, PayoutRequest } from '../../services/cinetpay-payout.service';
import paymentService from '../../services/payment.service';
import logger from '../../utils/logger';
import { TransactionStatus } from '../../database/models/transaction.model';

// Use the global Express.Request interface that's extended by auth middleware
type AuthenticatedRequest = Request;

const log = logger.getLogger('PayoutController');

export class PayoutController {
    /**
     * Get supported countries for payouts
     * @route GET /api/payouts/countries
     */
    async getSupportedCountries(req: Request, res: Response): Promise<void> {
        try {
            const countries = cinetpayPayoutService.getSupportedCountries();

            res.status(200).json({
                success: true,
                data: countries
            });

        } catch (error: any) {
            log.error('Error getting supported countries:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get supported countries',
                error: error.message
            });
        }
    }

    /**
     * Get CinetPay account balance
     * @route GET /api/payouts/balance
     */
    async getBalance(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            log.info(`Admin ${req.user?.userId} requesting payout balance`);

            const balance = await cinetpayPayoutService.getBalance();

            res.status(200).json({
                success: true,
                data: balance
            });

        } catch (error: any) {
            log.error('Error getting payout balance:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get payout balance',
                error: error.message
            });
        }
    }

    /**
     * Initiate a payout to a user
     * @route POST /api/payouts/initiate
     */
    async initiatePayout(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            const {
                targetUserId,
                amount,
                phoneNumber,
                countryCode,
                recipientName,
                recipientEmail,
                paymentMethod,
                description
            } = req.body;

            // Validate required fields
            if (!targetUserId || !amount || !phoneNumber || !countryCode || !recipientName) {
                res.status(400).json({
                    success: false,
                    message: 'Missing required fields: targetUserId, amount, phoneNumber, countryCode, recipientName'
                });
                return;
            }

            // Validate amount
            if (typeof amount !== 'number' || amount <= 0) {
                res.status(400).json({
                    success: false,
                    message: 'Amount must be a positive number'
                });
                return;
            }

            log.info(`Admin ${req.user?.userId} initiating payout: ${amount} to ${phoneNumber} for user ${targetUserId}`);

            const payoutRequest: PayoutRequest = {
                userId: targetUserId,
                amount,
                phoneNumber,
                countryCode,
                recipientName,
                recipientEmail,
                paymentMethod,
                description
            };

            const result = await cinetpayPayoutService.initiatePayout(payoutRequest);

            if (result.success) {
                res.status(200).json({
                    success: true,
                    message: 'Payout initiated successfully',
                    data: result
                });
            } else {
                res.status(400).json({
                    success: false,
                    message: result.message,
                    data: result
                });
            }

        } catch (error: any) {
            log.error('Error initiating payout:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to initiate payout',
                error: error.message
            });
        }
    }

    /**
     * Check the status of a payout
     * @route GET /api/payouts/status/:transactionId
     */
    async checkPayoutStatus(req: Request, res: Response): Promise<void> {
        try {
            const { transactionId } = req.params;

            if (!transactionId) {
                res.status(400).json({
                    success: false,
                    message: 'Transaction ID is required'
                });
                return;
            }

            log.info(`Checking payout status for transaction: ${transactionId}`);

            const status = await cinetpayPayoutService.checkPayoutStatus(transactionId);

            if (status) {
                res.status(200).json({
                    success: true,
                    data: status
                });
            } else {
                res.status(404).json({
                    success: false,
                    message: 'Transaction not found'
                });
            }

        } catch (error: any) {
            log.error('Error checking payout status:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to check payout status',
                error: error.message
            });
        }
    }

    /**
     * Handle CinetPay webhook notifications for Payouts/Transfers.
     * @route POST /api/payouts/webhooks/cinetpay
     */
    async handleCinetPayWebhook(req: Request, res: Response): Promise<void> {
        try {
            log.info('Received CinetPay payout webhook notification');
            log.debug('Webhook payload:', req.body);

            // Process the raw webhook payload to extract key information
            const notification = cinetpayPayoutService.processWebhookNotification(req.body);

            log.info(`Payout status update received: CinetPay Client Tx ID: ${notification.transactionId} -> Status: ${notification.status}`);

            // Map CinetPay's status to our internal TransactionStatus enum
            let internalStatus: TransactionStatus;
            switch (notification.status) {
                case 'completed':
                    internalStatus = TransactionStatus.COMPLETED;
                    break;
                case 'failed':
                    internalStatus = TransactionStatus.FAILED;
                    break;
                case 'pending':
                case 'processing': // CinetPay status can be processing too
                default:
                    // If it's anything other than complete or failed, we consider it still processing
                    // For our webhook, we only process final statuses, so anything else would be a no-op or error.
                    log.warn(`Received non-final or unrecognized CinetPay payout status for Tx ID ${notification.transactionId}: ${notification.status}.`);
                    // We can choose to return 200 OK without further processing if we only care about final states.
                    res.status(200).json({
                        success: true,
                        message: 'Webhook processed, status not final or unrecognized',
                        status: notification.status
                    });
                    return;
            }

            // Call paymentService to process the confirmed payout status
            await paymentService.processConfirmedPayoutWebhook(
                notification.transactionId, // This is our internal transaction ID
                notification.comment || notification.status, // Use comment or status as providerStatusMessage
                req.body // Pass the full original payload for audit
            );

            res.status(200).json({
                success: true,
                message: 'Webhook processed successfully'
            });

        } catch (error: any) {
            log.error('Error processing CinetPay payout webhook:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to process webhook',
                error: error.message
            });
        }
    }

    /**
     * Test payout functionality (development only)
     * @route POST /api/payouts/test
     */
    async testPayout(req: AuthenticatedRequest, res: Response): Promise<void> {
        try {
            if (process.env.NODE_ENV === 'production') {
                res.status(403).json({
                    success: false,
                    message: 'Test endpoint not available in production'
                });
                return;
            }

            log.info(`Test payout requested by admin ${req.user?.userId}`);

            // Test with minimal amount to Cameroon (MTN)
            const testRequest: PayoutRequest = {
                userId: 'test_user',
                amount: 500, // Minimum amount for Cameroon
                phoneNumber: '650000000', // Test number
                countryCode: 'CM',
                recipientName: 'Test User',
                recipientEmail: 'test@sbc.com',
                paymentMethod: 'MTNCM',
                description: 'Test payout'
            };

            const result = await cinetpayPayoutService.initiatePayout(testRequest);

            res.status(200).json({
                success: true,
                message: 'Test payout completed',
                data: result
            });

        } catch (error: any) {
            log.error('Error in test payout:', error);
            res.status(500).json({
                success: false,
                message: 'Test payout failed',
                error: error.message
            });
        }
    }
}

// Export controller instance
export const payoutController = new PayoutController();
