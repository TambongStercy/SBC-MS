import axios from 'axios';
import config from '../../config';
import logger from '../../utils/logger';
import { AppError } from '../../utils/errors'; // Assuming AppError will be created

const log = logger.getLogger('PaymentServiceClient');

// Define payload for creating an intent
interface CreateIntentPayload {
    userId: string;
    amount: number;
    currency: string;
    paymentType: string;
    metadata?: Record<string, any>;
}

// Define expected response from payment service
interface PaymentIntentResponse {
    success: boolean;
    data?: {
        sessionId: string;
        paymentPageUrl?: string;
        clientSecret?: string;
        paymentIntentId?: string; // Include this if payment service sends it
    };
    message?: string;
}

const paymentServiceClient = axios.create({
    baseURL: config.services.paymentService || 'http://localhost:3003/api',
    timeout: 5000, // Set a reasonable timeout
    headers: {
        'Content-Type': 'application/json',
        // --- Service-to-Service Authentication --- 
        // Option 1: API Key (Add SERVICE_API_KEY to .env)
        // 'X-API-Key': config.apiKey, 

        // Option 2: Service-specific JWT (Requires a mechanism to generate/manage these)
        'Authorization': `Bearer ${config.services.serviceSecret}`,
        'X-Service-Name': 'tombola-service',
        // Remove unused option based on your chosen strategy
        // Ensure the receiving service (payment-service) has corresponding verification middleware
    },
});

/**
 * Calls the payment service to create a new payment intent.
 */
const createIntent = async (payload: CreateIntentPayload): Promise<PaymentIntentResponse['data'] & { paymentIntentId?: string } | null> => {
    const url = '/payments/intents';
    log.info(`Sending create payment intent request to ${paymentServiceClient.defaults.baseURL}${url}`);
    log.debug('Create intent payload:', payload);
    try {
        const response = await paymentServiceClient.post<PaymentIntentResponse>(url, payload);

        if (response.status === 201 && response.data?.success && response.data.data?.sessionId) {
            log.info('Payment intent created successfully by Payment Service.', {
                sessionId: response.data.data.sessionId,
                paymentIntentId: response.data.data.paymentIntentId // Log if exists
            });
            // Return the nested data object, potentially adding paymentIntentId if it exists
            return {
                ...response.data.data,
                paymentIntentId: response.data.data.paymentIntentId
            };
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
        // Re-throw AppError or generic error
        throw new AppError('Payment service communication error', 500);
    }
};

export const paymentService = {
    createIntent,
}; 