import axios, { AxiosInstance } from 'axios';
import config from '../../config';
import logger from '../../utils/logger';
import { AppError } from '../../utils/errors';

const log = logger.getLogger('PaymentServiceClient');

// Define expected payload for creating an intent
interface CreateIntentPayload {
    userId: string;
    amount: number;
    currency: string;
    paymentType: string;
    metadata?: Record<string, any>;
}

// Define expected response structure (simplified, adjust as needed)
interface PaymentIntentResponse {
    success: boolean;
    data?: {
        sessionId: string;
        paymentPageUrl?: string; // Optional depending on flow
        clientSecret?: string;
    };
    message?: string;
}

interface InternalTransactionPayload {
    userId: string;
    amount: number;
    currency: string;
    description: string;
    metadata?: Record<string, any>;
}

interface InternalTransactionResponseData {
    transactionId: string;
    status: string;
}

interface PaymentServiceResponse<T> {
    success: boolean;
    data?: T;
    message?: string;
}

class PaymentServiceClient {
    private apiClient: AxiosInstance;

    constructor() {
        if (!config.services.paymentService) {
            log.error('Payment Service URL is not configured.');
            throw new Error('Payment Service URL is not configured.');
        }
        this.apiClient = axios.create({
            baseURL: config.services.paymentService || 'http://localhost:3003/api',
            timeout: 10000, // Increased timeout for potentially slower payment operations
            headers: {
                'Content-Type': 'application/json',
                // Use the shared secret for service-to-service auth
                'Authorization': `Bearer ${config.services.serviceSecret}`,
                'X-Service-Name': 'advertising-service' // Identify the calling service
            },
        });
        log.info(`Payment Service Client initialized for URL: ${config.services.paymentService}`);
    }

    /**
     * Creates a payment intent via the payment service.
     * Sends the generic payload.
     */
    async createIntent(payload: CreateIntentPayload): Promise<PaymentIntentResponse['data'] | null> {
        const url = '/payment/intents';
        log.info(`Sending create payment intent request to ${this.apiClient.defaults.baseURL}${url}`);
        log.debug('Create intent payload:', payload);
        try {
            const response = await this.apiClient.post<PaymentIntentResponse>(url, payload);

            if (response.status === 201 && response.data?.success && response.data.data?.sessionId) {
                log.info('Payment intent created successfully by Payment Service.', { sessionId: response.data.data.sessionId });
                return response.data.data; // Return the nested data object
            } else {
                log.warn('Payment service responded with failure or unexpected status for create intent.', {
                    status: response.status,
                    responseData: response.data
                });
                throw new AppError(response.data?.message || 'Failed to create payment intent via payment service', response.status);
            }
        } catch (error: any) {
            log.error(`Error calling payment service ${url}: ${error.message}`);
            if (axios.isAxiosError(error)) {
                log.error('Payment Service Error Response (createIntent):', { status: error.response?.status, data: error.response?.data });
                throw new AppError(error.response?.data?.message || 'Payment service communication error', error.response?.status || 500);
            }
            throw new AppError('Payment service communication error', 500);
        }
    }

    /**
     * Records an internal deposit transaction via the payment service.
     * Used for commission payouts.
     */
    async recordInternalDeposit(payload: InternalTransactionPayload): Promise<InternalTransactionResponseData | null> {
        const url = '/internal/deposit'; // Target the /internal endpoint
        log.info(`Sending record internal deposit request to ${this.apiClient.defaults.baseURL}${url} for user ${payload.userId}`);
        log.debug('Record internal deposit payload:', payload);
        try {
            const response = await this.apiClient.post<PaymentServiceResponse<InternalTransactionResponseData>>(url, payload);
            if (response.status === 201 && response.data?.success && response.data.data?.transactionId) {
                log.info('Internal deposit recorded successfully.', { transactionId: response.data.data.transactionId });
                return response.data.data;
            } else {
                log.warn('Payment service responded with failure or unexpected structure for record internal deposit.', {
                    status: response.status,
                    responseData: response.data
                });
                // Throw specific error message from payment service if available
                throw new AppError(response.data?.message || 'Failed to record internal deposit via payment service', response.status || 500);
            }
        } catch (error: any) {
            log.error(`Error calling payment service ${url}: ${error.message}`);
            if (axios.isAxiosError(error)) {
                log.error('Payment Service Error Response (recordInternalDeposit):', { status: error.response?.status, data: error.response?.data });
                throw new AppError(error.response?.data?.message || 'Payment service communication error', error.response?.status || 500);
            }
            throw new AppError('Payment service communication error', 500);
        }
    }

    // Add other methods if needed (e.g., checkStatus)
}

// Export a singleton instance
export const paymentService = new PaymentServiceClient();