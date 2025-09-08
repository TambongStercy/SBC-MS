import paymentService from '../../services/payment.service';
import { Request, Response, NextFunction } from 'express';
import { IPaymentIntent, PaymentStatus } from '../../database/interfaces/IPaymentIntent';
import logger from '../../utils/logger';
import config from '../../config';
import { Currency } from '../../database/models/transaction.model';
import { AppError } from '../../utils/errors';
import QRCode from 'qrcode';
import { paymentIntentRepository } from '../../database/repositories/paymentIntent.repository';

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
        let cryptoQrCodeBase64: string | undefined;

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

            // Generate QR code for crypto payments if needed
            if (
                paymentIntent &&
                (paymentIntent.status === PaymentStatus.WAITING_FOR_CRYPTO_DEPOSIT || paymentIntent.status === PaymentStatus.PARTIALLY_PAID) &&
                paymentIntent.cryptoAddress &&
                paymentIntent.payCurrency
            ) {
                // Calculate the amount for QR code (remaining amount for partial payments)
                let qrAmount = paymentIntent.payAmount;
                if (paymentIntent.status === PaymentStatus.PARTIALLY_PAID && paymentIntent.paidAmount) {
                    const remainingAmount = parseFloat(paymentIntent.payAmount) - parseFloat(paymentIntent.paidAmount);
                    qrAmount = remainingAmount.toFixed(6);
                    log.info(`Generating QR code for partial payment - Remaining amount: ${qrAmount} ${paymentIntent.payCurrency}`);
                }

                // Include amount and currency in the crypto URI for QR code
                const cryptoUri = `${paymentIntent.payCurrency.toLowerCase()}:${paymentIntent.cryptoAddress}?amount=${qrAmount}`;
                try {
                    let qr = await QRCode.toDataURL(cryptoUri, { type: 'image/png' });
                    if (qr.startsWith('data:image/png;base64,')) {
                        qr = qr.replace('data:image/png;base64,', '');
                    }
                    cryptoQrCodeBase64 = qr;
                } catch (err) {
                    log.error('Failed to generate QR code for payment page', err);
                }
            }

            const viewData = {
                sessionId: paymentIntent ? paymentIntent.sessionId : sessionId, // Ensure sessionId is always passed
                amount: paymentIntent ? paymentIntent.amount : undefined,
                currency: paymentIntent ? (paymentIntent.currency || 'XAF') : 'XAF',
                paymentStatus: paymentIntent ? paymentIntent.status : undefined,
                phoneNumber: paymentIntent ? paymentIntent.phoneNumber : undefined,
                // Don't pass "CRYPTO" as country code - it's not a real country
                countryCode: paymentIntent && paymentIntent.countryCode === 'CRYPTO' ? undefined : (paymentIntent ? paymentIntent.countryCode : undefined),
                operator: paymentIntent ? paymentIntent.operator : undefined,
                errorMessage: errorMessage,
                assetBasePath: '/api/payments/static', // Path to static assets
                // NEW: Add gateway and gatewayPaymentId
                gateway: paymentIntent ? (paymentIntent.gateway || '') : '',
                gatewayPaymentId: paymentIntent ? (paymentIntent.gatewayPaymentId || '') : '',
                // NEW: Add crypto payment specific fields
                cryptoAddress: paymentIntent ? paymentIntent.cryptoAddress : undefined,
                payAmount: paymentIntent ? paymentIntent.payAmount : undefined,
                payCurrency: paymentIntent ? paymentIntent.payCurrency : undefined,
                isCryptoPayment: paymentIntent ? paymentIntent.gateway === 'nowpayments' : false,
                paymentType: paymentIntent ? paymentIntent.paymentType : undefined,
                subscriptionType: paymentIntent ? paymentIntent.subscriptionType : undefined,
                subscriptionPlan: paymentIntent ? paymentIntent.subscriptionPlan : undefined,
                // NEW: Add partial payment tracking fields
                paidAmount: paymentIntent ? paymentIntent.paidAmount : undefined,
                paidCurrency: paymentIntent ? paymentIntent.paidCurrency : undefined,
                cryptoQrCodeBase64 // <-- inject QR code for EJS
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
            if (!paymentCurrency) {
                return res.status(400).json({ success: false, message: 'Missing required field: paymentCurrency' });
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
     * Handle NOWPayments webhook notifications for crypto payments
     */
    public handleNowPaymentsWebhook = async (req: Request, res: Response) => {
        try {
            const payload = req.body;
            const signature = req.headers['x-nowpayments-sig'] as string;

            log.info(`Received NOWPayments webhook for order: ${payload?.order_id}, payment: ${payload?.payment_id}`);

            if (!payload.payment_id || !payload.order_id) {
                log.warn('NOWPayments webhook missing required fields');
                return res.status(400).json({
                    success: false,
                    message: 'Missing required fields (payment_id, order_id)'
                });
            }

            await paymentService.handleNowPaymentsWebhook(payload, signature);
            log.info(`Successfully processed NOWPayments webhook for order: ${payload.order_id}`);

            res.status(200).json({ success: true });
        } catch (error: any) {
            log.error('Error processing NOWPayments webhook:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'NOWPayments webhook processing failed'
            });
        }
    };

    /**
     * Handle NOWPayments payout webhook notifications
     */
    public handleNowPaymentsPayoutWebhook = async (req: Request, res: Response) => {
        try {
            const payload = req.body;
            const signature = req.headers['x-nowpayments-sig'] as string;

            log.info(`Received NOWPayments payout webhook for withdrawal: ${payload?.withdrawal_id || payload?.id}`);

            if (!payload.id || !payload.status) {
                log.warn('NOWPayments payout webhook missing required fields');
                return res.status(400).json({
                    success: false,
                    message: 'Missing required fields (id, status)'
                });
            }

            await paymentService.handleNowPaymentsPayoutWebhook(payload, signature);
            log.info(`Successfully processed NOWPayments payout webhook for withdrawal: ${payload.withdrawal_id || payload.id}`);

            res.status(200).json({ success: true });
        } catch (error: any) {
            log.error('Error processing NOWPayments payout webhook:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'NOWPayments payout webhook processing failed'
            });
        }
    };

    /**
     * Get available cryptocurrencies
     */
    public getAvailableCryptoCurrencies = async (req: Request, res: Response) => {
        try {
            const currencies = await paymentService.getAvailableCryptoCurrencies();
            res.status(200).json({
                success: true,
                data: { currencies }
            });
        } catch (error: any) {
            log.error('Error getting available crypto currencies:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Failed to get available cryptocurrencies'
            });
        }
    };

    /**
     * Get crypto payment estimate
     */
    public getCryptoPaymentEstimate = async (req: Request, res: Response) => {
        try {
            const { amount, fromCurrency, toCurrency } = req.query;

            if (!amount || !fromCurrency || !toCurrency) {
                return res.status(400).json({
                    success: false,
                    message: 'Missing required fields: amount, fromCurrency, toCurrency'
                });
            }

            log.info(`Getting crypto estimate: ${amount} ${fromCurrency} -> ${toCurrency}`);

            const estimate = await paymentService.getCryptoPaymentEstimate(
                parseFloat(amount as string),
                fromCurrency as string,
                toCurrency as string
            );

            log.info(`Crypto estimate result:`, estimate);

            res.status(200).json({
                success: true,
                data: estimate
            });
        } catch (error: any) {
            log.error('Error getting crypto payment estimate:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Failed to get payment estimate'
            });
        }
    };

    /**
     * Create crypto payout (user withdrawal from USD balance)
     */
    public createCryptoPayout = async (req: Request, res: Response) => {
        try {
            const { amount, cryptoCurrency, cryptoAddress, description } = req.body;

            // Get userId from authenticated request
            const userId = (req as any).user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
            }

            if (!amount || !cryptoCurrency || !cryptoAddress) {
                return res.status(400).json({
                    success: false,
                    message: 'Missing required fields: amount, cryptoCurrency, cryptoAddress'
                });
            }

            if (typeof amount !== 'number' || amount <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid amount: must be a positive number'
                });
            }

            // Minimum $15 check
            if (amount < 15) {
                return res.status(400).json({
                    success: false,
                    message: 'Minimum withdrawal amount is $15 USD'
                });
            }

            const ipAddress = req.ip;
            const deviceInfo = req.headers['user-agent'] || 'unknown';

            const result = await paymentService.createCryptoPayout(
                userId,
                amount,
                cryptoCurrency,
                cryptoAddress,
                description || 'Crypto withdrawal',
                ipAddress,
                deviceInfo
            );

            res.status(200).json(result);
        } catch (error: any) {
            log.error('Error creating crypto payout:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Failed to create crypto payout'
            });
        }
    };

    /**
     * Debug NOWPayments connection
     */
    public debugNowPayments = async (req: Request, res: Response) => {
        try {
            log.info('Testing NOWPayments API connection...');

            const testResult = await paymentService.testNowPaymentsConnection();

            res.status(200).json({
                success: true,
                data: testResult
            });
        } catch (error: any) {
            log.error('Error testing NOWPayments connection:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Failed to test NOWPayments connection'
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
     * [ADMIN] Get Total Deposits
     * @route GET /api/payments/admin/stats/total-deposits
     * @access Admin
     */
    public adminGetTotalDeposits = async (req: Request, res: Response, next: NextFunction): Promise<Response | void> => {
        log.info('Admin request: Get total deposits');
        try {
            const totalDeposits = await paymentService.getTotalDepositsAmount();
            return res.status(200).json({ success: true, data: totalDeposits });
        } catch (error) {
            log.error('Error in adminGetTotalDeposits:', error);
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

    /**
     * Get crypto estimate for payment
     */
    public getCryptoEstimate = async (req: Request, res: Response) => {
        try {
            const { amount, currency, cryptoCurrency } = req.body;

            if (!amount || !currency || !cryptoCurrency) {
                return res.status(400).json({
                    success: false,
                    message: 'Amount, currency, and cryptoCurrency are required'
                });
            }

            log.info(`Getting crypto estimate: ${amount} ${currency} -> ${cryptoCurrency}`);

            const estimate = await paymentService.getCryptoPaymentEstimate(
                parseFloat(amount as string),
                currency as string,
                cryptoCurrency as string
            );

            log.info(`Crypto estimate result:`, estimate);

            res.status(200).json({
                success: true,
                data: estimate
            });

        } catch (error: any) {
            log.error(`Error getting crypto estimate: ${error.message}`, error);
            res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    };

    /**
     * Create crypto payment intent
     */
    public createCryptoPayment = async (req: Request, res: Response) => {
        try {
            const { amount, cryptoCurrency, cryptoAddress, description } = req.body; // Add amount, cryptoAddress, description

            // Get userId from authenticated request
            const userId = (req as any).user?.id; // Assuming authentication middleware attaches user
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
            }

            if (!amount || !cryptoCurrency || !cryptoAddress) {
                return res.status(400).json({
                    success: false,
                    message: 'Missing required fields: amount, cryptoCurrency, cryptoAddress'
                });
            }

            if (typeof amount !== 'number' || amount <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid amount: must be a positive number'
                });
            }

            // Minimum $15 check (as per current payment.controller.ts logic)
            if (amount < 15) {
                return res.status(400).json({
                    success: false,
                    message: 'Minimum withdrawal amount is $15 USD'
                });
            }

            const ipAddress = req.ip;
            const deviceInfo = req.headers['user-agent'] || 'unknown';

            const result = await paymentService.createCryptoPayout(
                userId,
                amount,
                cryptoCurrency,
                cryptoAddress,
                description || 'Crypto withdrawal',
                ipAddress,
                deviceInfo
            );

            if (!result.success) {
                return res.status(400).json({
                    success: false,
                    message: result.message
                });
            }

            res.json({
                success: true,
                message: result.message, // Include message from service
                data: {
                    transactionId: result.transactionId,
                    payoutId: result.payoutId,
                    status: result.status,
                    amount: result.amount, // Return amount from service
                    currency: 'USD' // Assuming USD for crypto payouts
                }
            });

        } catch (error: any) {
            log.error(`Error creating crypto payout: ${error.message}`, error);
            res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    };

    /**
     * Get payment status
     */
    public getPaymentStatus = async (req: Request, res: Response) => {
        try {
            const { sessionId } = req.params;

            const paymentIntent = await paymentService.getPaymentIntentDetails(sessionId);

            if (!paymentIntent) {
                return res.status(404).json({
                    success: false,
                    message: 'Payment not found'
                });
            }

            res.json({
                success: true,
                status: paymentIntent.status,
                sessionId: paymentIntent.sessionId
            });

        } catch (error: any) {
            log.error(`Error getting payment status: ${error.message}`, error);
            res.status(500).json({
                success: false,
                message: 'Internal server error'
            });
        }
    };

    /**
     * [ADMIN] Manually create a payment intent for recovery purposes
     * @route POST /api/admin/payments/create-manual-intent
     * @access Admin
     */
    public createManualPaymentIntent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const {
                userId,
                amount,
                currency,
                paymentType = 'SUBSCRIPTION',
                provider = 'cinetpay',
                externalReference,
                metadata = {},
                autoMarkSucceeded = true,
                triggerWebhook = true,
                adminNote
            } = req.body;

            // Validation - Messages en français
            if (!userId) {
                res.status(400).json({
                    success: false,
                    message: 'ID utilisateur requis'
                });
                return;
            }

            if (!amount || amount <= 0) {
                res.status(400).json({
                    success: false,
                    message: 'Montant valide et positif requis'
                });
                return;
            }

            if (!['cinetpay', 'feexpay', 'nowpayments'].includes(provider)) {
                res.status(400).json({
                    success: false,
                    message: 'Fournisseur invalide. Doit être cinetpay, feexpay, ou nowpayments'
                });
                return;
            }

            // Déterminer la devise basée sur le fournisseur
            const finalCurrency = provider === 'nowpayments' ? 'USD' : 'XAF';
            if (currency && currency !== finalCurrency) {
                res.status(400).json({
                    success: false,
                    message: `Devise incompatible. ${provider} utilise ${finalCurrency} mais ${currency} a été fourni`
                });
                return;
            }

            log.info(`Admin créant une intention de paiement manuelle pour l'utilisateur ${userId}`, {
                amount,
                currency: finalCurrency,
                paymentType,
                provider,
                externalReference,
                adminNote
            });

            // Fetch user information from user service including subscription info
            let userInfo = null;
            try {
                const userServiceUrl = config.services.userServiceUrl || 'http://localhost:3001/api';
                
                // Fetch user profile information
                const userResponse = await fetch(`${userServiceUrl}/users/${userId}`, {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        'service-secret': config.services.serviceSecret || 'fallback-secret'
                    }
                });

                // Fetch user active subscriptions
                const subscriptionResponse = await fetch(`${userServiceUrl}/users/internal/${userId}/active-subscriptions`, {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        'service-secret': config.services.serviceSecret || 'fallback-secret'
                    }
                });

                if (userResponse.ok) {
                    const userData = await userResponse.json() as any;
                    if (userData.success && userData.data) {
                        userInfo = {
                            name: userData.data.name,
                            email: userData.data.email,
                            activeSubscriptions: []
                        };

                        // Add subscription information if available
                        if (subscriptionResponse.ok) {
                            const subscriptionData = await subscriptionResponse.json() as any;
                            if (subscriptionData.success && subscriptionData.data) {
                                userInfo.activeSubscriptions = subscriptionData.data;
                            }
                        }

                        log.info(`Informations utilisateur récupérées pour ${userId}: ${userInfo.name} (${userInfo.email}) avec ${userInfo.activeSubscriptions.length} abonnement(s) actif(s)`);
                    }
                } else {
                    log.warn(`Impossible de récupérer les informations utilisateur pour ${userId}: ${userResponse.status}`);
                }
            } catch (userFetchError: any) {
                log.warn(`Erreur lors de la récupération des informations utilisateur pour ${userId}:`, userFetchError.message);
            }

            // Create the payment intent with proper webhook metadata
            const paymentIntent = await paymentService.createPaymentIntent({
                userId,
                amount,
                currency: finalCurrency,
                paymentType,
                metadata: {
                    // Core subscription metadata (matches normal payment intent structure)
                    userId: userId,
                    planId: metadata.subscriptionType || 'CLASSIQUE',
                    planName: metadata.subscriptionType === 'CLASSIQUE' ? 'Abonnement Classique' : 
                              metadata.subscriptionType === 'CIBLE' ? 'Abonnement Ciblé' : 
                              metadata.subscriptionType === 'UPGRADE' ? 'Upgrade to Ciblé' : 'Abonnement Classique',
                    planType: metadata.subscriptionType || 'CLASSIQUE',
                    isUpgrade: metadata.subscriptionType === 'UPGRADE',
                    
                    // Service communication metadata
                    originatingService: 'user-service',
                    callbackPath: `${config.services.userServiceUrl || 'http://localhost:3001/api'}/subscriptions/webhooks/payment-confirmation`,
                    
                    // Additional metadata for admin tracking
                    ...metadata,
                    isManualAdmin: true,
                    adminNote: adminNote || 'Récupération manuelle par admin',
                    createdBy: 'admin',
                    externalReference
                }
            });

            let finalIntent = paymentIntent;

            // If auto-mark as succeeded is enabled
            if (autoMarkSucceeded) {
                log.info(`Marquage automatique de l'intention de paiement ${paymentIntent.sessionId} comme réussie`);
                
                // Update the intent with provider information and mark as succeeded
                const updateData: any = {
                    status: PaymentStatus.SUCCEEDED,
                    gateway: provider === 'cinetpay' ? 'cinetpay' : 
                             provider === 'feexpay' ? 'feexpay' :
                             provider === 'nowpayments' ? 'nowpayments' : 'testing',
                    paidAmount: amount,
                    paidCurrency: finalCurrency
                };

                if (externalReference) {
                    updateData.gatewayPaymentId = externalReference;
                }

                // Use the payment intent repository to update the status directly
                finalIntent = await paymentIntentRepository.updateBySessionId(
                    paymentIntent.sessionId,
                    updateData
                ) as IPaymentIntent;

                if (!finalIntent) {
                    log.error(`Échec de mise à jour de l'intention de paiement ${paymentIntent.sessionId} vers réussie`);
                    throw new Error('Échec de mise à jour du statut de l\'intention de paiement');
                }

                // Déclencher le traitement de finalisation du paiement si activé (gère les abonnements, commissions, etc.)
                if (triggerWebhook && finalIntent.status === PaymentStatus.SUCCEEDED) {
                    try {
                        log.info(`Déclenchement du traitement de finalisation de paiement pour l'intention manuelle ${paymentIntent.sessionId}`);
                        
                        // Utiliser la méthode handlePaymentCompletion existante qui traite les abonnements, commissions, etc.
                        await (paymentService as any).handlePaymentCompletion(finalIntent);

                        log.info(`Traitement de finalisation de paiement réussi pour l'intention manuelle ${paymentIntent.sessionId}`);
                    } catch (completionError: any) {
                        log.error(`Erreur lors du traitement de finalisation de paiement pour l'intention manuelle ${paymentIntent.sessionId}:`, completionError);
                        // Ne pas faire échouer toute la requête si le traitement de finalisation échoue
                    }
                }
            }

            res.status(201).json({
                success: true,
                message: 'Intention de paiement manuelle créée avec succès',
                data: {
                    sessionId: finalIntent.sessionId,
                    userId: finalIntent.userId,
                    userName: userInfo?.name,
                    userEmail: userInfo?.email,
                    userActiveSubscriptions: userInfo?.activeSubscriptions || [],
                    amount: finalIntent.amount,
                    currency: finalIntent.currency,
                    status: finalIntent.status,
                    gateway: finalIntent.gateway,
                    gatewayPaymentId: finalIntent.gatewayPaymentId,
                    paymentType: finalIntent.paymentType,
                    metadata: finalIntent.metadata,
                    createdAt: finalIntent.createdAt,
                    isManualAdmin: true,
                    webhookTriggered: autoMarkSucceeded && triggerWebhook,
                    subscriptionProcessing: {
                        subscriptionType: metadata.subscriptionType,
                        subscriptionPlan: metadata.subscriptionPlan,
                        webhookConfigured: !!(finalIntent.metadata?.originatingService && finalIntent.metadata?.callbackPath)
                    }
                }
            });

        } catch (error: any) {
            log.error('Erreur lors de la création de l\'intention de paiement manuelle:', error);
            next(error);
        }
    };

    /**
     * [ADMIN] Search for existing payment intent by session ID or gateway payment ID
     * @route GET /api/admin/payments/search-payment-intent/:reference
     * @access Admin
     */
    public searchPaymentIntent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { reference } = req.params;

            if (!reference) {
                res.status(400).json({
                    success: false,
                    message: 'Référence (Session ID ou Gateway Payment ID) requise'
                });
                return;
            }

            log.info(`Admin recherchant l'intention de paiement avec la référence: ${reference}`);

            // Search by session ID first, then by gateway payment ID
            let paymentIntent = await paymentIntentRepository.findBySessionId(reference);
            
            if (!paymentIntent) {
                // Try searching by gateway payment ID across all gateways
                const gateways: any[] = ['cinetpay', 'feexpay', 'nowpayments', 'testing'];
                for (const gateway of gateways) {
                    paymentIntent = await paymentIntentRepository.findByGatewayPaymentId(reference, gateway);
                    if (paymentIntent) break;
                }
            }

            if (!paymentIntent) {
                res.status(404).json({
                    success: false,
                    message: 'Intention de paiement non trouvée avec cette référence'
                });
                return;
            }

            log.info(`Intention de paiement trouvée: ${paymentIntent.sessionId}, statut: ${paymentIntent.status}`);

            // Fetch user information from user service including subscription info
            let userInfo = null;
            try {
                const userServiceUrl = config.services.userServiceUrl || 'http://localhost:3001/api';
                
                // Fetch user profile information
                const userResponse = await fetch(`${userServiceUrl}/users/${paymentIntent.userId}`, {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        'service-secret': config.services.serviceSecret || 'fallback-secret'
                    }
                });

                // Fetch user active subscriptions
                const subscriptionResponse = await fetch(`${userServiceUrl}/users/internal/${paymentIntent.userId}/active-subscriptions`, {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        'service-secret': config.services.serviceSecret || 'fallback-secret'
                    }
                });

                if (userResponse.ok) {
                    const userData = await userResponse.json() as any;
                    if (userData.success && userData.data) {
                        userInfo = {
                            name: userData.data.name,
                            email: userData.data.email,
                            activeSubscriptions: []
                        };

                        // Add subscription information if available
                        if (subscriptionResponse.ok) {
                            const subscriptionData = await subscriptionResponse.json() as any;
                            if (subscriptionData.success && subscriptionData.data) {
                                userInfo.activeSubscriptions = subscriptionData.data;
                            }
                        }

                        log.info(`Informations utilisateur récupérées pour ${paymentIntent.userId}: ${userInfo.name} (${userInfo.email}) avec ${userInfo.activeSubscriptions.length} abonnement(s) actif(s)`);
                    }
                } else {
                    log.warn(`Impossible de récupérer les informations utilisateur pour ${paymentIntent.userId}: ${userResponse.status}`);
                }
            } catch (userFetchError: any) {
                log.warn(`Erreur lors de la récupération des informations utilisateur pour ${paymentIntent.userId}:`, userFetchError.message);
            }

            res.status(200).json({
                success: true,
                message: 'Intention de paiement trouvée',
                data: {
                    sessionId: paymentIntent.sessionId,
                    userId: paymentIntent.userId,
                    userName: userInfo?.name,
                    userEmail: userInfo?.email,
                    userActiveSubscriptions: userInfo?.activeSubscriptions || [],
                    amount: paymentIntent.amount,
                    currency: paymentIntent.currency,
                    status: paymentIntent.status,
                    gateway: paymentIntent.gateway,
                    gatewayPaymentId: paymentIntent.gatewayPaymentId,
                    createdAt: paymentIntent.createdAt,
                    metadata: paymentIntent.metadata,
                    canRecover: paymentIntent.status !== PaymentStatus.SUCCEEDED
                }
            });

        } catch (error: any) {
            log.error('Erreur lors de la recherche d\'intention de paiement:', error);
            next(error);
        }
    };

    /**
     * [ADMIN] Recover existing payment intent by marking as succeeded and triggering webhooks
     * @route POST /api/admin/payments/recover-payment-intent
     * @access Admin
     */
    public recoverExistingPaymentIntent = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { sessionId, adminNote } = req.body;

            if (!sessionId) {
                res.status(400).json({
                    success: false,
                    message: 'Session ID requis'
                });
                return;
            }

            log.info(`Admin récupérant l'intention de paiement: ${sessionId}`, { adminNote });

            // Find the existing payment intent
            const existingIntent = await paymentIntentRepository.findBySessionId(sessionId);
            
            if (!existingIntent) {
                res.status(404).json({
                    success: false,
                    message: 'Intention de paiement non trouvée avec ce Session ID'
                });
                return;
            }

            // Check if already succeeded
            if (existingIntent.status === PaymentStatus.SUCCEEDED) {
                res.status(400).json({
                    success: false,
                    message: 'Cette intention de paiement a déjà été marquée comme réussie'
                });
                return;
            }

            log.info(`Intention de paiement trouvée: ${existingIntent.sessionId}, statut actuel: ${existingIntent.status}`);

            // Update to succeeded status
            const updateData = {
                status: PaymentStatus.SUCCEEDED,
                paidAmount: existingIntent.amount,
                paidCurrency: existingIntent.currency,
                metadata: {
                    ...existingIntent.metadata,
                    recoveredBy: 'admin',
                    recoveryDate: new Date().toISOString(),
                    recoveryNote: adminNote || `Récupération admin de l'intention ${sessionId}`,
                    originalStatus: existingIntent.status
                }
            };

            const updatedIntent = await paymentIntentRepository.updateBySessionId(sessionId, updateData);

            if (!updatedIntent) {
                log.error(`Échec de mise à jour de l'intention de paiement ${sessionId} vers réussie`);
                throw new Error('Échec de mise à jour du statut de l\'intention de paiement');
            }

            log.info(`Intention de paiement ${sessionId} mise à jour avec succès vers SUCCEEDED`);

            // Trigger webhook processing
            try {
                log.info(`Déclenchement du traitement de finalisation pour l'intention récupérée ${sessionId}`);
                await (paymentService as any).handlePaymentCompletion(updatedIntent);
                log.info(`Traitement de finalisation réussi pour l'intention récupérée ${sessionId}`);
            } catch (completionError: any) {
                log.error(`Erreur lors du traitement de finalisation pour l'intention récupérée ${sessionId}:`, completionError);
                // Don't fail the entire request
            }

            res.status(200).json({
                success: true,
                message: 'Intention de paiement récupérée avec succès',
                data: {
                    sessionId: updatedIntent.sessionId,
                    userId: updatedIntent.userId,
                    amount: updatedIntent.amount,
                    currency: updatedIntent.currency,
                    status: updatedIntent.status,
                    gateway: updatedIntent.gateway,
                    paymentType: updatedIntent.paymentType,
                    metadata: updatedIntent.metadata,
                    createdAt: updatedIntent.createdAt,
                    isRecovered: true,
                    webhookTriggered: true,
                    subscriptionProcessing: {
                        subscriptionType: updatedIntent.metadata?.subscriptionType || updatedIntent.metadata?.planId,
                        subscriptionPlan: updatedIntent.metadata?.subscriptionPlan || updatedIntent.metadata?.planName,
                        webhookConfigured: !!(updatedIntent.metadata?.originatingService && updatedIntent.metadata?.callbackPath)
                    }
                }
            });

        } catch (error: any) {
            log.error('Erreur lors de la récupération de l\'intention de paiement:', error);
            next(error);
        }
    };
}

// Export singleton instance
export const paymentController = new PaymentController();
