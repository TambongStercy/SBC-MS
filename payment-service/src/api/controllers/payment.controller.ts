import { Request, Response, NextFunction } from 'express';
import paymentService from '../../services/payment.service';
import { IPaymentIntent, PaymentStatus } from '../../database/interfaces/IPaymentIntent';
import logger from '../../utils/logger';
import config from '../../config';
import { Currency } from '../../database/models/transaction.model';
import { AppError } from '../../utils/errors';

const log = logger.getLogger('PaymentController');

// Mapping of country codes to dialing codes (copied from payment.service.ts)
// Ideally, this would be in a shared utility file
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
};

export class PaymentController {
    constructor() {
        // Constructor is empty
    }

    /**
     * Render the custom payment page
     */
    public renderPaymentPage = async (req: Request, res: Response) => {
        const { sessionId } = req.params;
        let paymentIntent: IPaymentIntent | null = null;
        let errorMessage: string | undefined;

        try {
            paymentIntent = await paymentService.getPaymentIntentDetails(sessionId);

            if (!paymentIntent) {
                log.warn(`Payment intent not found for session ID: ${sessionId}`);
                // Render a generic error page or redirect
                return res.status(404).render('error', { message: 'Payment session not found.' });
            }

            // If status is ERROR, try to reset it to PENDING_USER_INPUT to allow re-entry
            if (paymentIntent.status === PaymentStatus.ERROR) {
                log.info(`PaymentIntent ${sessionId} is in ERROR status. Attempting to reset for user input.`);
                paymentIntent = await paymentService.resetPaymentIntentStatus(sessionId);
                // If reset successful, set a user-friendly error message to display on the form
                if (paymentIntent && paymentIntent.status === PaymentStatus.PENDING_USER_INPUT) {
                    errorMessage = 'An error occurred with your previous attempt. Please review your details and try again.';
                } else {
                    // If reset failed or not applicable, keep the original error status
                    log.error(`Failed to reset PaymentIntent ${sessionId} from ERROR status.`);
                    errorMessage = 'An unrecoverable error occurred with your payment. Please contact support.';
                }
            }

            const viewData = {
                sessionId: paymentIntent?.sessionId,
                amount: paymentIntent?.amount,
                currency: paymentIntent?.currency || 'XAF', // Default to XAF if not set
                paymentStatus: paymentIntent?.status,
                phoneNumber: paymentIntent?.phoneNumber,
                countryCode: paymentIntent?.countryCode,
                operator: paymentIntent?.operator,
                errorMessage: errorMessage,
                assetBasePath: '/api/payments/static', // Path to static assets
                // NEW: Add gateway and gatewayPaymentId
                gateway: paymentIntent?.gateway || '',
                gatewayPaymentId: paymentIntent?.gatewayPaymentId || '',
            };

            res.render('payment', viewData);
        } catch (error: any) {
            log.error(`Error rendering payment page for session ${sessionId}:`, error);
            res.status(500).render('error', { message: 'An internal server error occurred.', error: error.message });
        }
    };

    /**
     * Create a new payment intent based on generic input
     * Expects: { userId, amount, currency, paymentType, metadata? }
     */
    public createPaymentIntent = async (req: Request, res: Response) => {
        try {
            // Extract generic details from body
            const { userId, amount, currency, paymentType, metadata } = req.body;

            // Basic check for required fields (service layer does more robust validation)
            if (!userId || !amount || !currency || !paymentType) {
                return res.status(400).json({ success: false, message: 'Missing required fields: userId, amount, currency, paymentType' });
            }

            const paymentIntent = await paymentService.createPaymentIntent({
                userId,
                amount,
                currency,
                paymentType,
                metadata
            });

            // No payment page needed in testing mode
            // const paymentPageUrl = `${config.paymentServiceBaseUrl}/api/payments/page/${paymentIntent.sessionId}`;

            res.status(201).json({
                success: true,
                data: {
                    sessionId: paymentIntent.sessionId,
                    clientSecret: typeof paymentIntent.gatewayRawResponse === 'object' && paymentIntent.gatewayRawResponse !== null && 'client_secret' in paymentIntent.gatewayRawResponse ? paymentIntent.gatewayRawResponse.client_secret : undefined
                }
            });
        } catch (error: any) {
            log.error('Error creating payment intent:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Failed to create payment intent'
            });
        }
    };

    /**
     * Submit payment details and initiate payment with selected provider
     */
    public submitPaymentDetails = async (req: Request, res: Response) => {
        try {
            const { sessionId } = req.params;
            // Expect phone, country, and paymentCurrency
            const { phoneNumber, countryCode, paymentCurrency, operator } = req.body;

            console.log(req.body)

            // Validation is handled by middleware, but basic check here is okay too
            if (!countryCode || !paymentCurrency) {
                return res.status(400).json({ success: false, message: 'Missing required fields: phoneNumber, countryCode, paymentCurrency' });
            }

            const paymentIntent = await paymentService.submitPaymentDetails(
                sessionId,
                // Pass all necessary details
                { phoneNumber, countryCode, paymentCurrency, operator }
            );

            res.status(200).json({
                success: true,
                data: {
                    sessionId: paymentIntent.sessionId,
                    gatewayCheckoutUrl: paymentIntent.gatewayCheckoutUrl,
                    status: paymentIntent.status
                }
            });
        } catch (error: any) {
            log.error('Error submitting payment details:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Failed to process payment details'
            });
        }
    };

    /**
     * Get current payment status
     */
    public getPaymentStatus = async (req: Request, res: Response) => {
        try {
            const { sessionId } = req.params;
            const paymentIntent = await paymentService.getPaymentIntentDetails(sessionId);
            res.status(200).json({ success: true, data: paymentIntent?.status });
        } catch (error) {
            log.error('Error getting payment status:', error);
            res.status(500).json({ success: false, message: 'Failed to get payment status' });
        }
    };

    /**
     * Handle Feexpay webhook notifications
     */
    public handleFeexpayWebhook = async (req: Request, res: Response) => {
        try {
            const payload = req.body;
            const authHeader = req.headers.authorization;

            console.log('payload: ', payload)

            log.info(`Received Feexpay webhook for reference: ${payload?.reference}`);
            log.info('Feexpay webhook payload:', payload);
            log.info(`Feexpay webhook auth header: ${authHeader}`);

            if (!this.verifyFeexpayWebhookAuth(authHeader)) {
                log.warn('Feexpay webhook authorization failed.');
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            log.info('Feexpay webhook authorization successful.');
            await paymentService.handleFeexpayWebhook(payload);
            log.info(`Successfully processed Feexpay webhook for reference: ${payload?.reference}`);

            res.status(200).json({ success: true });
        } catch (error: any) {
            log.error('Error processing Feexpay webhook:', error);
            // Log specific error message if available
            res.status(500).json({ success: false, message: error.message || 'Webhook processing failed' });
            // Returning 500 might cause Feexpay to retry, which could be desirable if the error is temporary.
            // Alternatively, return 200 as before if you don't want retries for failed processing.
            // res.status(200).json({ success: true }); // Original behavior
        }
    };

    private verifyFeexpayWebhookAuth(authHeader: string | undefined): boolean {
        if (!config.feexpay.webhookSecret) {
            log.warn('FEEXPAY_WEBHOOK_SECRET is not set. Skipping Auth verification.');
            return true;
        }
        if (!authHeader) {
            log.warn('Feexpay webhook missing Authorization header.');
            return false;
        }

        // Accept Bearer token
        if (authHeader.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];
            if (token === config.feexpay.webhookSecret) {
                return true;
            } else {
                log.warn('Feexpay webhook Bearer token mismatch.');
                return false;
            }
        }

        // Accept Basic Auth
        if (authHeader.startsWith('Basic ')) {
            const encodedCredentials = authHeader.split(' ')[1];
            const expectedEncoded = Buffer.from(config.feexpay.webhookSecret).toString('base64');
            if (encodedCredentials === expectedEncoded) {
                return true;
            } else {
                log.warn('Feexpay webhook Basic Auth credentials mismatch.');
                // Avoid logging secrets or encoded secrets in production
                return false;
            }
        }

        log.warn('Feexpay webhook Authorization header format not recognized.');
        return false;
    }

    /**
     * Handle CinetPay webhook notifications
     */
    public handleCinetPayWebhook = async (req: Request, res: Response) => {
        try {
            const payload = req.body;

            log.info(`Received CinetPay webhook with transaction ID: ${payload?.cpm_trans_id}`);
            // console.log('CinetPay webhook payload:', payload);

            if (!payload.cpm_trans_id) {
                log.warn('CinetPay webhook missing transaction ID');
                return res.status(400).json({
                    success: false,
                    message: 'Missing transaction ID'
                });
            }

            await paymentService.handleCinetPayWebhook(payload);
            log.info(`Successfully processed CinetPay webhook for transaction ID: ${payload.cpm_trans_id}`);

            res.status(200).json({ success: true });
        } catch (error: any) {
            log.error('Error processing CinetPay webhook:', error);
            res.status(500).json({ success: false, message: error.message || 'Webhook processing failed' });
        }
    };

    /**
     * Handle CinetPay Transfer (Payout) webhook notifications
     */
    public handleCinetpayTransferWebhook = async (req: Request, res: Response) => {
        try {
            const payload = req.body;
            log.info('Received CinetPay Transfer (Payout) webhook:', payload);

            // TODO: Add signature verification if CinetPay provides one for transfer webhooks

            await paymentService.processCinetpayTransferStatusWebhook(payload);
            log.info('Successfully acknowledged CinetPay Transfer webhook.');
            res.status(200).json({ success: true, message: 'Webhook received' });
        } catch (error: any) {
            log.error('Error processing CinetPay Transfer webhook:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'CinetPay Transfer webhook processing failed'
            });
        }
    };

    /**
     * [INTERNAL] Record an internal deposit transaction
     * @route POST /api/internal/deposit
     */
    public recordInternalDeposit = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { userId, amount, currency, description, metadata } = req.body;
            if (!userId || !amount || !currency || !description) {
                res.status(400).json({ success: false, message: 'Missing required fields: userId, amount, currency, description' });
                return;
            }
            if (typeof amount !== 'number' || amount <= 0) {
                res.status(400).json({ success: false, message: 'Invalid amount: must be a positive number' });
                return;
            }
            if (!Object.values(Currency).includes(currency as Currency)) {
                res.status(400).json({ success: false, message: 'Invalid currency code' });
                return;
            }
            const transaction = await paymentService.processDeposit(
                userId,
                amount,
                currency as Currency,
                {
                    provider: 'internal',
                    transactionId: `internal_${Date.now()}`,
                    metadata: metadata
                },
                description
            );
            res.status(201).json({
                success: true,
                message: 'Internal deposit recorded successfully',
                data: {
                    transactionId: transaction.transactionId,
                    status: transaction.status
                }
            });
        } catch (error: any) {
            log.error('Error recording internal deposit:', error);
            next(error);
        }
    };

    /**
     * [INTERNAL] Record an internal withdrawal transaction
     * @route POST /api/internal/withdrawal
     */
    public recordInternalWithdrawal = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { userId, amount, currency, description, metadata } = req.body;
            if (!userId || !amount || !currency || !description) {
                res.status(400).json({ success: false, message: 'Missing required fields: userId, amount, currency, description' });
                return;
            }
            if (typeof amount !== 'number' || amount <= 0) {
                res.status(400).json({ success: false, message: 'Invalid amount: must be a positive number' });
                return;
            }
            if (!Object.values(Currency).includes(currency as Currency)) {
                res.status(400).json({ success: false, message: 'Invalid currency code' });
                return;
            }
            const transaction = await paymentService.processInternalWithdrawal(
                userId,
                amount,
                currency as Currency,
                description,
                metadata
            );
            res.status(201).json({
                success: true,
                message: 'Internal withdrawal recorded successfully',
                data: {
                    transactionId: transaction.transactionId,
                    status: transaction.status
                }
            });
        } catch (error: any) {
            log.error('Error recording internal withdrawal:', error);
            next(error);
        }
    };

    /**
     * [ADMIN] List all payment transactions/intents with filtering and pagination.
     * @route GET /api/payments/admin/transactions
     * @access Admin
     */
    async adminListTransactions(req: Request, res: Response): Promise<Response> {
        log.info('Admin request: List all payment transactions');
        try {
            // Extract query parameters for filtering and pagination
            const {
                page = '1',
                limit = '20',
                status,
                userSearchTerm,
                startDate,
                endDate,
                minAmount,
                maxAmount,
                currency,
                sortBy = 'createdAt',
                sortOrder = 'desc'
            } = req.query as { [key: string]: string };

            // Construct filter object
            const filters: Record<string, any> = {};
            if (status) filters.status = status;
            if (userSearchTerm) filters.userSearchTerm = userSearchTerm;

            // Adjusted Date Range Handling
            if (startDate) {
                try {
                    const start = new Date(startDate); // Parses YYYY-MM-DD as local midnight
                    start.setHours(0, 0, 0, 0); // Ensure it's the very beginning of the day (local)
                    // Mongoose will handle conversion to UTC if needed for DB comparison
                    filters.createdAt = { ...filters.createdAt, $gte: start };
                } catch (e) { log.warn('Invalid start date format received:', startDate); }
            }
            if (endDate) {
                try {
                    const end = new Date(endDate); // Parses YYYY-MM-DD as local midnight
                    end.setHours(23, 59, 59, 999); // Set to the very end of the selected day (local)
                    // Using $lte with the end of the day includes the entire day
                    filters.createdAt = { ...filters.createdAt, $lte: end };
                } catch (e) { log.warn('Invalid end date format received:', endDate); }
            }

            if (currency) filters.currency = currency;

            // Amount range filter
            const min = parseFloat(minAmount);
            const max = parseFloat(maxAmount);
            if (!isNaN(min) || !isNaN(max)) {
                filters.amount = {};
                if (!isNaN(min)) filters.amount.$gte = min;
                if (!isNaN(max)) filters.amount.$lte = max;
            }
            // Add more filters as needed

            // Construct pagination options
            const options = {
                page: parseInt(page, 10),
                limit: parseInt(limit, 10),
                sortBy: sortBy,
                sortOrder: sortOrder as 'asc' | 'desc'
            };

            // Validate pagination
            if (isNaN(options.page) || options.page < 1) options.page = 1;
            if (isNaN(options.limit) || options.limit < 1) options.limit = 20;
            if (options.limit > 100) options.limit = 100; // Max limit

            log.debug('Admin list transactions - Filters:', filters);
            log.debug('Admin list transactions - Options:', options);

            // Call the service layer method
            const result = await paymentService.adminGetAllTransactions(filters, options);

            return res.status(200).json({
                success: true,
                message: 'Transactions retrieved successfully',
                data: result.transactions,
                pagination: result.pagination
            });

        } catch (error) {
            log.error('Error in adminListTransactions:', error);
            if (error instanceof AppError) {
                return res.status(error.statusCode).json({ success: false, message: error.message });
            }
            return res.status(500).json({ success: false, message: 'Failed to retrieve transactions' });
        }
    }

    // --- NEW STATS METHODS (STUBS) ---

    /**
     * [ADMIN] Get Total Withdrawals
     * @route GET /api/payments/admin/stats/total-withdrawals
     * @access Admin
     */
    public adminGetTotalWithdrawals = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
        log.info('Admin request: Get total withdrawals');
        try {
            const totalWithdrawals = await paymentService.getTotalWithdrawalsAmount();
            return res.status(200).json({ success: true, data: totalWithdrawals });
        } catch (error) {
            log.error('Error in adminGetTotalWithdrawals:', error);
            next(error);
        }
    }

    /**
     * [ADMIN] Get Total Revenue
     * @route GET /api/payments/admin/stats/total-revenue
     * @access Admin
     */
    public adminGetTotalRevenue = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
        log.info('Admin request: Get total revenue');
        // Requires clarification on what constitutes revenue
        try {
            const totalRevenue = await paymentService.getTotalRevenueAmount();
            return res.status(200).json({ success: true, data: totalRevenue });
        } catch (error) {
            log.error('Error in adminGetTotalRevenue:', error);
            next(error);
        }
    }

    /**
     * [ADMIN] Get Monthly Revenue
     * @route GET /api/payments/admin/stats/monthly-revenue
     * @access Admin
     */
    public adminGetMonthlyRevenue = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
        log.info('Admin request: Get monthly revenue');
        // Requires clarification on what constitutes revenue
        try {
            const monthlyRevenue = await paymentService.getMonthlyRevenueStats(); // Defaulting to 12 months
            return res.status(200).json({ success: true, data: monthlyRevenue });
        } catch (error) {
            log.error('Error in adminGetMonthlyRevenue:', error);
            next(error);
        }
    }

    /**
     * [ADMIN] Get Activity Overview
     * @route GET /api/payments/admin/stats/activity-overview
     * @access Admin
     */
    public adminGetActivityOverview = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
        log.info('Admin request: Get activity overview');
        // Requires clarification on what data is needed for overview
        try {
            const activityOverview = await paymentService.getMonthlyActivityOverviewStats(); // Defaulting to 12 months
            return res.status(200).json({ success: true, data: activityOverview });
        } catch (error) {
            log.error('Error in adminGetActivityOverview:', error);
            next(error);
        }
    }

    /**
     * [INTERNAL] Get Total Withdrawals for a specific user
     * @route GET /api/internal/stats/user/:userId/total-withdrawals
     * @access Internal Service Request
     */
    public getUserTotalWithdrawals = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
        const { userId } = req.params;
        log.info(`Internal request: Get total withdrawals for user ${userId}`);
        try {
            if (!userId) {
                return res.status(400).json({ success: false, message: 'User ID parameter is required.' });
            }
            const totalWithdrawals = await paymentService.getUserTotalWithdrawalsAmount(userId);

            return res.status(200).json({ success: true, data: { userId: userId, value: totalWithdrawals } });
        } catch (error: any) {
            log.error(`Error in getUserTotalWithdrawals controller for user ${userId}:`, error);
            next(error); // Pass error to the central error handler
        }
    }

    /**
     * [ADMIN] Get Total Transactions Count
     * @route GET /api/payments/admin/stats/transactions
     * @access Admin
     */
    public adminGetTotalTransactionsCount = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
        log.info('Admin request: Get total transactions count');
        try {
            const totalTransactions = await paymentService.getTotalTransactionsCount();
            return res.status(200).json({ success: true, data: totalTransactions, message: 'Total transactions count retrieved successfully.' });
        } catch (error) {
            log.error('Error in adminGetTotalTransactionsCount:', error);
            next(error);
        }
    }

    // --- END NEW STATS METHODS ---

    /**
     * [USER-FACING] Requests the latest status of a specific FeexPay transaction
     * using the payment intent's sessionId.
     * @route GET /api/payments/intents/:sessionId/feexpay-status
     * @access Public (intended for users to check their own transaction status)
     */
    public getUserFeexpayStatus = async (req: Request, res: Response) => {
        try {
            const { sessionId } = req.params;

            if (!sessionId) {
                return res.status(400).json({
                    success: false,
                    message: 'Payment intent session ID is required.'
                });
            }

            // Call the service method to get and process the FeexPay status
            const paymentIntent = await paymentService.getAndProcessFeexpayStatusBySessionId(sessionId);

            return res.status(200).json({
                success: true,
                message: 'FeexPay transaction status retrieved and payment intent updated.',
                data: {
                    sessionId: paymentIntent.sessionId,
                    status: paymentIntent.status,
                    gatewayPaymentId: paymentIntent.gatewayPaymentId,
                    amount: paymentIntent.amount,
                    currency: paymentIntent.currency,
                    updatedAt: paymentIntent.updatedAt,
                    // You can include more fields from paymentIntent as needed
                }
            });

        } catch (error: any) {
            log.error(`Error checking FeexPay status for session ${req.params.sessionId}: ${error.message}`, error);
            const statusCode = error.statusCode || 500;
            return res.status(statusCode).json({
                success: false,
                message: error.message || 'An unexpected error occurred while checking FeexPay status.',
                // Only expose stack in development for debugging
                error: process.env.NODE_ENV === 'development' ? error.stack : undefined
            });
        }
    }

    /**
     * [ADMIN] Reprocesses FeexPay payment statuses for a specific user.
     * Looks for payment intents that are PENDING_PROVIDER, PROCESSING, or ERROR and re-checks their status.
     * @route POST /api/payments/admin/reprocess-feexpay-payments/user/:userId
     * @access Admin
     */
    public adminReprocessFeexpayUserPayments = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
        const { userId } = req.params;
        log.info(`Admin request: Reprocessing FeexPay user payments for userId: ${userId}`);

        try {
            if (!userId) {
                return res.status(400).json({ success: false, message: 'User ID parameter is required.' });
            }

            const results = await paymentService.reprocessFeexpayPendingStatusByUserId(userId);

            return res.status(200).json({
                success: true,
                message: 'FeexPay payment reprocessing initiated. See results for details.',
                data: results
            });
        } catch (error: any) {
            log.error(`Error in adminReprocessFeexpayUserPayments for user ${userId}:`, error);
            next(error); // Pass error to central error handler
        }
    }
}

// Export singleton instance
export const paymentController = new PaymentController();