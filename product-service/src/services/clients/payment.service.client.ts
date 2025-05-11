import axios from 'axios';
import config from '../../config'; // Assuming config holds the payment service URL
import logger from '../../utils/logger';
import { AppError } from '../../utils/errors';

const log = logger.getLogger('PaymentServiceClient');

interface PaymentIntentInput {
    userId: string;
    paymentType: 'SUBSCRIPTION' | 'FLASH_SALE_FEE' | string; // Add more types as needed
    amount: number;
    currency: string;
    // Subscription specific (optional)
    subscriptionType?: string;
    subscriptionPlan?: string;
    // Metadata (optional)
    metadata?: Record<string, any>;
}

interface PaymentIntentResponse {
    data: {
        sessionId: string;
        id?: string;
        _id?: string;
        checkoutUrl?: string;
        status: string;
        // Add other fields within the nested 'data' object if needed
    };
    success?: boolean; // Add other top-level fields if they exist
    message?: string;
}

class PaymentServiceClient {
    private baseUrl: string;
    private serviceSecret: string;

    constructor() {
        this.baseUrl = config.services.paymentService; // e.g., http://localhost:3003/api
        this.serviceSecret = config.services.serviceSecret; // Shared secret for service-to-service auth
        if (!this.baseUrl || !this.serviceSecret) {
            log.error('Payment Service URL or Service Secret is not configured!');
            // Throw an error during startup if config is missing
            throw new Error('Payment service configuration missing.');
        }
    }

    /**
     * Creates a payment intent in the Payment Service.
     */
    async createIntent(data: PaymentIntentInput): Promise<PaymentIntentResponse | null> {
        const url = `${this.baseUrl}/payments/intents`;
        log.info(`Calling Payment Service: POST ${url}`);
        try {
            const response = await axios.post<PaymentIntentResponse>(
                url,
                data,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        // Add service-to-service authentication header
                        'Authorization': `Bearer ${this.serviceSecret}`,
                        'X-Service-Name': 'product-service'
                    },
                    timeout: 5000 // Set a reasonable timeout
                }
            );

            if (response.status === 200 || response.status === 201) {
                const data = response.data.data;
                // Try to extract the ID using common field names
                const paymentId = data?.sessionId || data?.id || data?._id;
                if (!paymentId) {
                    log.warn('Payment Service response successful, but could not find session/intent ID (checked sessionId, id, _id)', response.data);
                    // Decide how to handle - return null or throw? Returning null for now.
                    return null;
                }
                log.info(`Payment intent created successfully via Payment Service. ID: ${paymentId}`);
                // Ensure the returned object also uses a consistent ID field if needed by the caller,
                // or adjust the caller (flashsale.service) to handle potential differences.
                // For now, let's assume the PaymentIntentResponse structure is flexible or the caller handles it.
                // return { ...response.data, sessionId: paymentId }; // Return response, ensuring sessionId is populated
                return response.data; // Return the original response object which matches the interface
            } else {
                log.warn(`Payment Service returned non-success status ${response.status} for createIntent`);
                return null;
            }
        } catch (error: any) {
            log.error(`Error calling Payment Service createIntent: ${error.message}`);
            if (axios.isAxiosError(error) && error.response) {
                log.error(`Payment Service Response Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
                // Re-throw specific error based on payment service response if needed
                throw new AppError(error.response.data?.message || 'Payment service request failed', error.response.status);
            } else {
                throw new AppError('Failed to connect to payment service', 503); // Service Unavailable
            }
        }
    }

    // Add other methods to interact with payment service if needed (e.g., get status)
}

export const paymentServiceClient = new PaymentServiceClient(); 