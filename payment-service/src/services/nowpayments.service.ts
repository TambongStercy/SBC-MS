import NowPaymentsApi from '@nowpaymentsio/nowpayments-api-js';
import axios from 'axios';
import config from '../config';
import logger from '../utils/logger';
import { PaymentStatus, PaymentGateway } from '../database/interfaces/IPaymentIntent';
import { Currency, TransactionStatus, TransactionType } from '../database/models/transaction.model';

const log = logger.getLogger('NOWPaymentsService');

export interface NOWPaymentCreateRequest {
    priceAmount?: number;
    priceCurrency?: string;
    payCurrency?: string;
    payAmount?: number;
    orderId?: string;
    orderDescription?: string;
    ipnCallbackUrl?: string;
    successUrl?: string;
    cancelUrl?: string;
}

export interface NOWPaymentResponse {
    paymentId: string;
    paymentStatus: string;
    payAddress?: string;
    payCurrency: string;
    priceAmount: number;
    priceCurrency: string;
    payAmount: number;
    actuallyPaid?: number;
    paymentUrl?: string;
    orderId?: string;
    outcomeAmount?: number;
    outcomeCurrency?: string;
    createdAt: string;
    updatedAt: string;
}

export interface NOWPaymentEstimate {
    estimatedAmount: number;
    currency: string;
    feeAmount?: number;
    networkFee?: number;
}

export interface NOWPayoutRequest {
    address: string;
    currency: string;
    amount: number;
    ipnCallbackUrl?: string;
    feePaidByUser?: boolean;
    extraId?: string;
}

export interface NOWPayoutResponse {
    id: string;
    address: string;
    currency: string;
    amount: string; // NOWPayments returns amount as string
    batch_withdrawal_id?: string;
    status: string;
    extra_id?: string | null;
    hash?: string | null;
    error?: string | null;
    is_request_payouts?: boolean;
    ipn_callback_url?: string | null;
    unique_external_id?: string | null;
    payout_description?: string | null;
    created_at?: string;
    requested_at?: string | null;
    updated_at?: string | null;
}

class NOWPaymentsService {
    private api: any;

    constructor() {
        if (!config.nowpayments.apiKey) {
            log.error('NOWPayments API key not configured');
            throw new Error('NOWPayments API key is required but not configured');
        }

        this.api = new NowPaymentsApi({
            apiKey: config.nowpayments.apiKey
        });
        if (config.nowpayments.sandbox) {
            this.api.base_url = 'https://api.sandbox.nowpayments.io/v1/';
        }

        log.info('NOWPayments service initialized', {
            sandbox: config.nowpayments.sandbox,
            hasApiKey: !!config.nowpayments.apiKey
        });
    }

    /**
     * Get available cryptocurrencies
     */
    async getAvailableCurrencies(): Promise<string[]> {
        try {
            const response = await this.api.getCurrencies();
            log.info('Retrieved available currencies', { count: response.currencies?.length });
            return response.currencies || [];
        } catch (error: any) {
            log.error('Error getting available currencies', { error: error.message });
            throw new Error('Failed to get available currencies');
        }
    }

    /**
 * Get estimated crypto amount for a given fiat amount
 */
    async getEstimatePrice(amount: number, currencyFrom: string, currencyTo?: string): Promise<NOWPaymentEstimate> {
        try {
            const fromCurrency = currencyFrom.toUpperCase();
            const toCurrency = (currencyTo || 'BTC').toUpperCase();

            // Check if we need to convert from unsupported currency to USD first
            let finalAmount = amount;
            let finalFromCurrency = fromCurrency;

            // Currencies not directly supported by NOWPayments
            const unsupportedCurrencies = ['XAF', 'XOF', 'GNF', 'CDF', 'KES'];

            if (unsupportedCurrencies.includes(fromCurrency)) {
                log.info(`Converting ${fromCurrency} to USD for NOWPayments compatibility`);

                // Simple conversion rates (you might want to use a real-time rate API)
                const conversionRates: { [key: string]: number } = {
                    'XAF': 0.0016,  // 1 XAF ≈ 0.0016 USD
                    'XOF': 0.0016,  // 1 XOF ≈ 0.0016 USD  
                    'GNF': 0.00012, // 1 GNF ≈ 0.00012 USD
                    'CDF': 0.0004,  // 1 CDF ≈ 0.0004 USD
                    'KES': 0.0067   // 1 KES ≈ 0.0067 USD
                };

                const rate = conversionRates[fromCurrency];
                if (!rate) {
                    throw new Error(`Conversion rate not available for ${fromCurrency}`);
                }

                finalAmount = amount * rate;
                finalFromCurrency = 'USD';

                log.info(`Converted ${amount} ${fromCurrency} to ${finalAmount} USD (rate: ${rate})`);
            }

            // If converting from USD to a USD-pegged stablecoin, bypass the API call and assume 1:1
            const usdStablecoins = ['USDTSOL', 'USDTBSC'];
            if (finalFromCurrency === 'USD' && usdStablecoins.includes(toCurrency)) {
                log.info(`Bypassing NOWPayments estimate for USD -> ${toCurrency} pair. Assuming 1:1 rate.`);
                return {
                    estimatedAmount: finalAmount, // The amount in USD
                    currency: toCurrency,
                    feeAmount: 0, // For an estimate, we can assume 0 fee
                    networkFee: 0,
                };
            }

            const params: any = {
                amount: finalAmount,
                currency_from: finalFromCurrency,
                currency_to: toCurrency
            };

            log.info('NOWPayments getEstimatePrice request:', params);

            const response = await this.api.getEstimatePrice(params);

            log.info('NOWPayments getEstimatePrice response:', response);

            // Check if response has the expected structure
            if (!response || typeof response.estimated_amount === 'undefined') {
                log.warn('NOWPayments estimate response missing expected fields:', response);
                throw new Error('Invalid response from NOWPayments API - missing estimated_amount');
            }

            return {
                estimatedAmount: response.estimated_amount || 0,
                currency: response.currency_to || toCurrency,
                feeAmount: response.fee_amount || 0,
                networkFee: response.network_fee || 0
            };
        } catch (error: any) {
            log.error('Error getting price estimate', {
                error: error.message,
                amount,
                currencyFrom,
                currencyTo,
                stack: error.stack
            });

            // Provide more specific error messages
            if (error.message.includes('401') || error.message.includes('authentication')) {
                throw new Error('NOWPayments API authentication failed. Please check your API key.');
            } else if (error.message.includes('400')) {
                throw new Error(`Invalid currency pair: ${currencyFrom} to ${currencyTo}. Please check if both currencies are supported.`);
            } else {
                throw new Error(`Failed to get price estimate: ${error.message}`);
            }
        }
    }

    /**
     * Create a crypto payment
     */
    async createPayment(request: NOWPaymentCreateRequest): Promise<NOWPaymentResponse> {
        const MAX_RETRIES = 3;
        const INITIAL_DELAY_MS = 1000;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const paymentData: any = {
                    order_id: request.orderId,
                    order_description: request.orderDescription || 'SBC Payment',
                    ipn_callback_url: request.ipnCallbackUrl,
                    success_url: request.successUrl,
                    cancel_url: request.cancelUrl
                };

                // NOWPayments API requires price_amount even when pay_amount is specified.
                if (request.priceAmount && request.priceCurrency) {
                    paymentData.price_amount = request.priceAmount;
                    paymentData.price_currency = request.priceCurrency.toUpperCase();
                } else {
                    // If priceAmount is not provided, we cannot proceed.
                    throw new Error('priceAmount and priceCurrency are required for NOWPayments.');
                }

                // If payAmount is provided (for stablecoins), include it as well.
                if (request.payAmount && request.payCurrency) {
                    paymentData.pay_amount = request.payAmount;
                    paymentData.pay_currency = request.payCurrency.toUpperCase();
                    log.info(`Sending both pay_amount and price_amount for stablecoin payment.`);
                } else if (request.payCurrency) {
                    // For non-stablecoins, just specify the currency to pay in.
                    paymentData.pay_currency = request.payCurrency.toUpperCase();
                    log.info(`Sending price_amount and letting NOWPayments determine pay_amount.`);
                }


                log.info(`Creating NOWPayments payment (Attempt ${attempt}/${MAX_RETRIES})`, paymentData);

                const response = await this.api.createPayment(paymentData);

                // CRITICAL: Log the raw response for debugging
                log.info('NOWPayments raw API response:', {
                    response: response,
                    responseType: typeof response,
                    responseKeys: response ? Object.keys(response) : 'null/undefined'
                });

                // Validate the response has required fields
                if (!response) {
                    log.error('NOWPayments API returned null/undefined response');
                    throw new Error('NOWPayments API returned empty response');
                }

                if (typeof response !== 'object') {
                    log.error('NOWPayments API returned non-object response:', typeof response);
                    throw new Error('NOWPayments API returned invalid response format');
                }

                // Check for error in response
                if (response.error || response.message) {
                    log.error('NOWPayments API returned error response:', {
                        error: response.error,
                        message: response.message,
                        response: response
                    });
                    throw new Error(`NOWPayments API error: ${response.message || response.error || 'Unknown error'}`);
                }

                // Validate required fields exist
                const requiredFields = ['payment_id'];
                const missingFields = requiredFields.filter(field => !response[field]);

                if (missingFields.length > 0) {
                    log.error('NOWPayments response missing required fields:', {
                        missingFields,
                        receivedFields: Object.keys(response),
                        response: response
                    });
                    throw new Error(`NOWPayments response missing required fields: ${missingFields.join(', ')}`);
                }

                // Log successful response mapping
                log.info('✅ NOWPayments response mapping:', {
                    payment_id: response.payment_id,
                    pay_address: response.pay_address,
                    pay_currency: response.pay_currency,
                    pay_amount: response.pay_amount,
                    payment_status: response.payment_status
                });

                // If successful, return immediately from the loop
                return {
                    paymentId: response.payment_id,
                    paymentStatus: response.payment_status,
                    payAddress: response.pay_address,
                    payCurrency: response.pay_currency,
                    priceAmount: response.price_amount,
                    priceCurrency: response.price_currency,
                    payAmount: response.pay_amount,
                    actuallyPaid: response.actually_paid,
                    paymentUrl: response.payment_url,
                    orderId: response.order_id,
                    outcomeAmount: response.outcome_amount,
                    outcomeCurrency: response.outcome_currency,
                    createdAt: response.created_at,
                    updatedAt: response.updated_at
                };

            } catch (error: any) {
                log.error(`Error creating NOWPayments payment on attempt ${attempt}`, {
                    error: error.message,
                    request,
                    stack: error.stack,
                    code: error.code
                });

                // Check for network-related errors that are eligible for retry
                const isNetworkError = ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(error.code) ||
                    error.message.includes('getaddrinfo') ||
                    error.message.includes('timeout');

                if (isNetworkError && attempt < MAX_RETRIES) {
                    const delay = INITIAL_DELAY_MS * Math.pow(2, attempt - 1);
                    log.info(`Network error detected. Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue; // Go to the next iteration of the loop
                }

                // If it's not a retryable network error or the last attempt, handle and throw the error
                if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN' || error.message.includes('getaddrinfo')) {
                    log.error('NOWPayments DNS resolution failed - network connectivity issue', {
                        error: error.message
                    });
                    throw new Error(`Failed to create payment: Network connectivity issue. Unable to reach NOWPayments API.`);
                } else if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET') {
                    log.error('NOWPayments connection refused or reset', {
                        error: error.message
                    });
                    throw new Error(`Failed to create payment: Connection to NOWPayments API was refused or reset.`);
                } else if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
                    log.error('NOWPayments request timeout', {
                        error: error.message
                    });
                    throw new Error(`Failed to create payment: Request to NOWPayments API timed out.`);
                } else if (error.message && (error.message.includes('Crypto amount') && error.message.includes('is less than minimal'))) {
                    log.error(`NOWPayments API error: ${error.message}`, { response: error.response });
                    throw new Error(`The requested payment amount is below the minimum required for ${request.payCurrency}. Please try a larger amount.`);
                }
                else if (error.response && error.response.data && error.response.data.message) {
                    // Handle structured API errors from NOWPayments
                    const errorMessage = error.response.data.message;
                    log.error(`NOWPayments API returned error: ${errorMessage}`, { response: error.response.data });
                    throw new Error(`NOWPayments error: ${errorMessage}`);
                }
                else if (error.response && error.response.status) {
                    // Handle generic HTTP errors
                    const status = error.response.status;
                    const responseData = error.response.data;

                    log.error('NOWPayments HTTP error response', {
                        status,
                        responseData,
                        request
                    });

                    if (status === 401) {
                        throw new Error(`Failed to create payment: Invalid NOWPayments API key or authentication failed.`);
                    } else if (status === 400) {
                        throw new Error(`Failed to create payment: Invalid payment parameters - ${responseData?.message || 'Bad request'}`);
                    } else if (status === 429) {
                        throw new Error(`Failed to create payment: Too many requests to NOWPayments API. Please try again later.`);
                    } else if (status >= 500) {
                        throw new Error(`Failed to create payment: NOWPayments API server error (${status}). Please try again later.`);
                    } else {
                        throw new Error(`Failed to create payment: HTTP ${status} - ${responseData?.message || error.message}`);
                    }
                } else {
                    // Fallback for other types of errors
                    throw new Error(`Failed to create payment: ${error.message}`);
                }
            }
        }
        // This line should be unreachable if the logic is correct, but it satisfies TypeScript's need for a return path.
        throw new Error('Failed to create payment after multiple retries.');
    }

    /**
     * Get payment status
     */
    async getPaymentStatus(paymentId: string): Promise<NOWPaymentResponse> {
        try {
            const response = await this.api.getPaymentStatus({ payment_id: paymentId });

            return {
                paymentId: response.payment_id,
                paymentStatus: response.payment_status,
                payAddress: response.pay_address,
                payCurrency: response.pay_currency,
                priceAmount: response.price_amount,
                priceCurrency: response.price_currency,
                payAmount: response.pay_amount,
                actuallyPaid: response.actually_paid,
                paymentUrl: response.payment_url,
                orderId: response.order_id,
                outcomeAmount: response.outcome_amount,
                outcomeCurrency: response.outcome_currency,
                createdAt: response.created_at,
                updatedAt: response.updated_at
            };
        } catch (error: any) {
            log.error('Error getting payment status', { error: error.message, paymentId });
            throw new Error('Failed to get payment status');
        }
    }

    /**
     * Authenticate with NOWPayments mass payouts API to get Bearer token
     */
    private async authenticateMassPayouts(): Promise<string> {
        const baseUrl = config.nowpayments.sandbox
            ? 'https://api.sandbox.nowpayments.io/v1'
            : 'https://api.nowpayments.io/v1';

        try {
            log.info('Authenticating with NOWPayments mass payouts API...');

            // For mass payouts, we need email/password credentials
            // Since we only have API key, we'll use the regular API for now
            // This is a limitation - mass payouts require separate credentials
            if (!config.nowpayments.email || !config.nowpayments.password) {
                throw new Error('NOWPayments mass payouts requires NOWPAYMENTS_EMAIL and NOWPAYMENTS_PASSWORD environment variables');
            }

            const authResponse = await axios.post(`${baseUrl}/auth`, {
                email: config.nowpayments.email,
                password: config.nowpayments.password
            }, {
                headers: {
                    'x-api-key': config.nowpayments.apiKey,
                    'Content-Type': 'application/json'
                }
            });

            const token = authResponse.data.token;
            if (!token) {
                throw new Error('No token received from authentication');
            }

            log.info('Successfully authenticated with NOWPayments mass payouts API');
            return token;

        } catch (error: any) {
            log.error('NOWPayments mass payouts authentication failed:', {
                error: error.message,
                status: error.response?.status,
                data: error.response?.data
            });
            throw new Error(`Failed to authenticate with NOWPayments: ${error.message}`);
        }
    }

    /**
     * Create a crypto payout (mass payout)
     */
    async createPayout(request: NOWPayoutRequest): Promise<NOWPayoutResponse> {
        if (!config.nowpayments.apiKey) {
            throw new Error('Payout API not configured. Please check NOWPAYMENTS_API_KEY');
        }

        const maxRetries = config.nowpayments.maxRetries;
        let lastError: any;

        const baseUrl = config.nowpayments.sandbox
            ? 'https://api.sandbox.nowpayments.io/v1'
            : 'https://api.nowpayments.io/v1';

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // Get authentication token for mass payouts
                const token = await this.authenticateMassPayouts();

                const payoutData = {
                    ipn_callback_url: request.ipnCallbackUrl,
                    withdrawals: [{
                        address: request.address,
                        currency: request.currency.toLowerCase(),
                        amount: request.amount,
                        extra_id: request.extraId,
                        ipn_callback_url: request.ipnCallbackUrl
                    }]
                };

                log.info(`Creating NOWPayments payout (attempt ${attempt}/${maxRetries})`, payoutData);

                const response = await Promise.race([
                    axios.post(`${baseUrl}/payout`, payoutData, {
                        headers: {
                            'x-api-key': config.nowpayments.apiKey,
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        timeout: config.nowpayments.timeoutMs
                    }),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Request timeout')), config.nowpayments.timeoutMs)
                    )
                ]) as any;

                const responseData = response.data;
                const withdrawal = responseData.withdrawals?.[0];

                if (!withdrawal) {
                    throw new Error('No withdrawal response received');
                }

                log.info(`NOWPayments payout created successfully on attempt ${attempt}`, {
                    withdrawalId: withdrawal.withdrawal_id,
                    status: withdrawal.status
                });

                return {
                    id: withdrawal.id,
                    address: withdrawal.address,
                    currency: withdrawal.currency,
                    amount: withdrawal.amount.toString(), // Ensure amount is string
                    batch_withdrawal_id: responseData.batch_withdrawal_id,
                    status: withdrawal.status,
                    extra_id: withdrawal.extra_id,
                    hash: withdrawal.hash,
                    error: withdrawal.error,
                    is_request_payouts: withdrawal.is_request_payouts || false,
                    ipn_callback_url: withdrawal.ipn_callback_url,
                    unique_external_id: withdrawal.unique_external_id,
                    payout_description: withdrawal.payout_description,
                    created_at: withdrawal.created_at,
                    requested_at: withdrawal.requested_at,
                    updated_at: withdrawal.updated_at
                };

            } catch (error: any) {
                lastError = error;
                log.warn(`NOWPayments payout attempt ${attempt} failed:`, {
                    error: error.message,
                    status: error.response?.status,
                    data: error.response?.data,
                    request
                });

                // Check if error is retryable
                const isNetworkError = ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(error.code) ||
                    error.message.includes('getaddrinfo') ||
                    error.message.includes('timeout') ||
                    error.message.includes('Request timeout');

                const isServerError = error.response?.status >= 500;
                const isRateLimited = error.response?.status === 429;

                if ((isNetworkError || isServerError || isRateLimited) && attempt < maxRetries) {
                    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // Max 10s delay
                    log.info(`Retrying NOWPayments payout in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }

                // If not retryable or last attempt, break
                break;
            }
        }

        // All attempts failed
        log.error('All NOWPayments payout attempts failed', { error: lastError.message, request });

        if (lastError.response?.data?.message) {
            throw new Error(`Failed to create payout: ${lastError.response.data.message}`);
        } else if (lastError.response?.status === 401) {
            throw new Error('Failed to create payout: Invalid NOWPayments credentials or authentication failed. Please check NOWPAYMENTS_EMAIL and NOWPAYMENTS_PASSWORD');
        } else if (lastError.response?.status === 400) {
            throw new Error(`Failed to create payout: Invalid payout parameters - ${lastError.response?.data?.message || 'Bad request'}`);
        } else if (lastError.code === 'ENOTFOUND' || lastError.code === 'EAI_AGAIN') {
            throw new Error('Failed to create payout: Network connectivity issue with NOWPayments API');
        } else if (lastError.message.includes('timeout')) {
            throw new Error('Failed to create payout: Request timeout to NOWPayments API');
        } else {
            throw new Error(`Failed to create payout: ${lastError.message}`);
        }
    }

    /**
     * Get payout status
     */
    async getPayoutStatus(withdrawalId: string): Promise<NOWPayoutResponse> {
        if (!config.nowpayments.apiKey) {
            throw new Error('Payout API not configured');
        }

        const maxRetries = Math.max(config.nowpayments.maxRetries - 1, 1); // Fewer retries for status checks
        let lastError: any;

        const baseUrl = config.nowpayments.sandbox
            ? 'https://api.sandbox.nowpayments.io/v1'
            : 'https://api.nowpayments.io/v1';

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // Get authentication token for payout status
                const token = await this.authenticateMassPayouts();

                log.debug(`Getting NOWPayments payout status (attempt ${attempt}/${maxRetries})`, { withdrawalId });

                const response = await Promise.race([
                    axios.get(`${baseUrl}/payout/${withdrawalId}`, {
                        headers: {
                            'x-api-key': config.nowpayments.apiKey,
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        timeout: config.nowpayments.timeoutMs
                    }),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Request timeout')), config.nowpayments.timeoutMs)
                    )
                ]) as any;

                // NOWPayments API returns an array with a single payout object
                log.info(`Raw NOWPayments API response for payout ${withdrawalId}:`, {
                    responseType: Array.isArray(response.data) ? 'array' : typeof response.data,
                    responseData: response.data,
                    dataLength: Array.isArray(response.data) ? response.data.length : 'not_array'
                });

                let batchData = Array.isArray(response.data) ? response.data[0] : response.data;

                if (!batchData) {
                    throw new Error(`No batch data found for withdrawal ID: ${withdrawalId}`);
                }

                // The actual payout data is in the withdrawals array
                const payoutData = batchData.withdrawals?.find((w: any) => w.id === withdrawalId);

                if (!payoutData) {
                    throw new Error(`No payout found with ID ${withdrawalId} in batch ${batchData.id}`);
                }

                log.info(`NOWPayments payout status retrieved successfully on attempt ${attempt}`, {
                    withdrawalId,
                    batchId: batchData.id,
                    payoutStatus: payoutData.status,
                    payoutAmount: payoutData.amount,
                    payoutError: payoutData.error,
                    payoutHash: payoutData.hash
                });

                // Use the actual payout data, not the batch data
                const responseData = payoutData;

                return {
                    id: responseData.id,
                    address: responseData.address,
                    currency: responseData.currency,
                    amount: responseData.amount ? responseData.amount.toString() : '0', // Safe toString with fallback
                    batch_withdrawal_id: responseData.batch_withdrawal_id,
                    status: responseData.status,
                    extra_id: responseData.extra_id,
                    hash: responseData.hash,
                    error: responseData.error,
                    is_request_payouts: responseData.is_request_payouts || false,
                    ipn_callback_url: responseData.ipn_callback_url,
                    unique_external_id: responseData.unique_external_id,
                    payout_description: responseData.payout_description,
                    created_at: responseData.created_at,
                    requested_at: responseData.requested_at,
                    updated_at: responseData.updated_at
                };

            } catch (error: any) {
                lastError = error;
                log.warn(`NOWPayments payout status check attempt ${attempt} failed:`, {
                    error: error.message,
                    status: error.response?.status,
                    data: error.response?.data,
                    withdrawalId
                });

                // Check if error is retryable
                const isNetworkError = ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(error.code) ||
                    error.message.includes('getaddrinfo') ||
                    error.message.includes('timeout') ||
                    error.message.includes('Request timeout');

                const isServerError = error.response?.status >= 500;
                const isRateLimited = error.response?.status === 429;

                if ((isNetworkError || isServerError || isRateLimited) && attempt < maxRetries) {
                    const delay = Math.min(1000 * attempt, 5000); // Max 5s delay for status checks
                    log.debug(`Retrying NOWPayments payout status check in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }

                // If not retryable or last attempt, break
                break;
            }
        }

        // All attempts failed
        log.error('All NOWPayments payout status check attempts failed', { error: lastError.message, withdrawalId });

        if (lastError.response?.status === 404) {
            throw new Error(`Payout not found: ${withdrawalId}`);
        } else if (lastError.response?.data?.message) {
            throw new Error(`Failed to get payout status: ${lastError.response.data.message}`);
        } else if (lastError.response?.status === 401) {
            throw new Error('Failed to get payout status: Invalid NOWPayments API key or authentication failed');
        } else if (lastError.code === 'ENOTFOUND' || lastError.code === 'EAI_AGAIN') {
            throw new Error('Failed to get payout status: Network connectivity issue with NOWPayments API');
        } else if (lastError.message.includes('timeout')) {
            throw new Error('Failed to get payout status: Request timeout to NOWPayments API');
        } else {
            throw new Error(`Failed to get payout status: ${lastError.message}`);
        }
    }

    /**
     * Map NOWPayments status to internal PaymentStatus
     */
    mapStatusToInternal(nowPaymentsStatus: string): PaymentStatus {
        const statusMap: { [key: string]: PaymentStatus } = {
            'waiting': PaymentStatus.WAITING_FOR_CRYPTO_DEPOSIT,
            'confirming': PaymentStatus.PROCESSING,
            'confirmed': PaymentStatus.CONFIRMED,
            'sending': PaymentStatus.PROCESSING,
            'partially_paid': PaymentStatus.PARTIALLY_PAID,
            'finished': PaymentStatus.SUCCEEDED,
            'failed': PaymentStatus.FAILED,
            'refunded': PaymentStatus.FAILED,
            'expired': PaymentStatus.EXPIRED
        };

        return statusMap[nowPaymentsStatus] || PaymentStatus.PENDING_PROVIDER;
    }

    /**
     * Map NOWPayments payout status to TransactionStatus
     */
    mapPayoutStatusToInternal(nowPaymentsStatus: string): TransactionStatus {
        const statusMap: { [key: string]: TransactionStatus } = {
            // NOWPayments payout-specific statuses (from API documentation)
            'creating': TransactionStatus.PROCESSING,
            'processing': TransactionStatus.PROCESSING,
            'sending': TransactionStatus.PROCESSING,
            'finished': TransactionStatus.COMPLETED,
            'failed': TransactionStatus.FAILED,
            'rejected': TransactionStatus.FAILED,

            // Legacy statuses (keep for backward compatibility)
            'waiting': TransactionStatus.PENDING,
            'confirming': TransactionStatus.PROCESSING,
            'confirmed': TransactionStatus.PROCESSING,
            'partially_paid': TransactionStatus.PROCESSING,
            'refunded': TransactionStatus.REFUNDED,
            'expired': TransactionStatus.FAILED
        };

        if (!nowPaymentsStatus) {
            log.warn('NOWPayments status is undefined or null, defaulting to PENDING');
            return TransactionStatus.PENDING;
        }
        return statusMap[nowPaymentsStatus.toLowerCase()] || TransactionStatus.PENDING;
    }

    /**
     * Verify webhook signature
     */
    verifyWebhookSignature(payload: string, signature: string): boolean {
        try {
            const crypto = require('crypto');
            const expectedSignature = crypto
                .createHmac('sha512', config.nowpayments.ipnSecret)
                .update(payload)
                .digest('hex');

            return crypto.timingSafeEqual(
                Buffer.from(signature, 'hex'),
                Buffer.from(expectedSignature, 'hex')
            );
        } catch (error: any) {
            log.error('Error verifying webhook signature', { error: error.message });
            return false;
        }
    }

    /**
     * Check if a currency is a cryptocurrency
     */
    isCryptoCurrency(currency: string): boolean {
        const cryptoCurrencies = [
            'BTC', 'LTC', 'XRP', 'TRX',
            'USDTSOL', 'USDTBSC', 'BNBBSC'
        ];
        return cryptoCurrencies.includes(currency.toUpperCase());
    }

    /**
     * Get minimum payment amount for a currency pair
     */
    async getMinimumPaymentAmount(currencyFrom: string, currencyTo: string): Promise<number> {
        try {
            const response = await this.api.getMinimumPaymentAmount({
                currency_from: currencyFrom.toUpperCase(),
                currency_to: currencyTo.toUpperCase()
            });

            return response.min_amount || 0;
        } catch (error: any) {
            log.error('Error getting minimum payment amount', { error: error.message, currencyFrom, currencyTo });
            return 0;
        }
    }

    /**
     * Test API connection and get available currencies
     */
    async testConnection(): Promise<{ connected: boolean; currencies?: string[]; error?: string }> {
        try {
            log.info('Testing NOWPayments API connection...');

            // Try to get available currencies as a connection test
            const response = await this.api.getCurrencies();

            log.info('NOWPayments API connection successful', {
                currenciesCount: response?.currencies?.length || 0
            });

            return {
                connected: true,
                currencies: response.currencies || []
            };
        } catch (error: any) {
            log.error('NOWPayments API connection failed', { error: error.message });

            return {
                connected: false,
                error: error.message
            };
        }
    }

    /**
     * Check NOWPayments balance for a specific currency
     */
    async getBalance(): Promise<{ [currency: string]: { amount: number; pendingAmount: number } }> {
        if (!config.nowpayments.apiKey) {
            throw new Error('NOWPayments API not configured');
        }

        const maxRetries = Math.max(config.nowpayments.maxRetries, 1);
        let lastError: any;

        const baseUrl = config.nowpayments.sandbox
            ? 'https://api.sandbox.nowpayments.io/v1'
            : 'https://api.nowpayments.io/v1';

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // Get authentication token for balance check
                const token = await this.authenticateMassPayouts();

                log.debug(`Getting NOWPayments balance (attempt ${attempt}/${maxRetries})`);

                const response = await Promise.race([
                    axios.get(`${baseUrl}/balance`, {
                        headers: {
                            'x-api-key': config.nowpayments.apiKey,
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        timeout: config.nowpayments.timeoutMs
                    }),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Request timeout')), config.nowpayments.timeoutMs)
                    )
                ]) as any;

                const balanceData = response.data;

                log.debug(`NOWPayments balance retrieved successfully on attempt ${attempt}`, {
                    currencies: Object.keys(balanceData)
                });

                return balanceData;

            } catch (error: any) {
                lastError = error;
                log.warn(`NOWPayments balance check attempt ${attempt} failed:`, {
                    error: error.message,
                    status: error.response?.status,
                    data: error.response?.data
                });

                // Check if we should retry
                if (attempt < maxRetries) {
                    const retryableStatusCodes = [500, 502, 503, 504, 429];
                    const retryableErrors = ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET'];

                    if (
                        (error.response && retryableStatusCodes.includes(error.response.status)) ||
                        (error.code && retryableErrors.includes(error.code)) ||
                        error.message.includes('timeout')
                    ) {
                        // Wait before retry with exponential backoff
                        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
                        log.debug(`Retrying NOWPayments balance check in ${delay}ms...`);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        continue;
                    }
                }

                // If not retryable or last attempt, break
                break;
            }
        }

        // All attempts failed
        log.error('All NOWPayments balance check attempts failed', { error: lastError.message });

        if (lastError.response?.status === 401) {
            throw new Error('Failed to get NOWPayments balance: Invalid API key or authentication failed');
        } else if (lastError.code === 'ENOTFOUND' || lastError.code === 'EAI_AGAIN') {
            throw new Error('Failed to get NOWPayments balance: Network connectivity issue');
        } else if (lastError.message.includes('timeout')) {
            throw new Error('Failed to get NOWPayments balance: Request timeout');
        } else {
            throw new Error(`Failed to get NOWPayments balance: ${lastError.message}`);
        }
    }

    /**
     * Check if there's sufficient balance for a crypto withdrawal
     */
    async checkSufficientBalance(currency: string, amount: number): Promise<{ sufficient: boolean; available: number; pending: number }> {
        try {
            const balances = await this.getBalance();
            const currencyLower = currency.toLowerCase();

            const currencyBalance = balances[currencyLower];

            if (!currencyBalance) {
                log.warn(`Currency ${currency} not found in NOWPayments balance`);
                return {
                    sufficient: false,
                    available: 0,
                    pending: 0
                };
            }

            const available = currencyBalance.amount;
            const pending = currencyBalance.pendingAmount;
            const sufficient = available >= amount;

            log.info(`NOWPayments balance check for ${currency}:`, {
                requested: amount,
                available,
                pending,
                sufficient
            });

            return {
                sufficient,
                available,
                pending
            };

        } catch (error: any) {
            log.error(`Error checking NOWPayments balance for ${currency}:`, error);
            throw error;
        }
    }
}

export default new NOWPaymentsService(); 