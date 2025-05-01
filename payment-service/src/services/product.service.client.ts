import axios from 'axios';
import config from '../config'; // Assuming config holds the product service URL
import logger from '../utils/logger';
// Assuming a shared error structure or a simple error handling approach
// import { AppError } from '../utils/errors'; 

const log = logger.getLogger('ProductServiceClient');

class ProductServiceClient {
    private baseUrl: string;
    private serviceSecret: string;

    constructor() {
        this.baseUrl = config.services.productServiceUrl || '';
        this.serviceSecret = config.services.serviceSecret || '';
        if (!this.baseUrl || !this.serviceSecret) {
            log.error('Product Service URL or Service Secret is not configured!');
            throw new Error('Product service configuration missing.');
        }
    }

    /**
     * Notifies the Product Service about a payment status update for a flash sale fee.
     */
    async notifyFlashSalePaymentUpdate(paymentIntentId: string, status: 'succeeded' | 'failed'): Promise<boolean> {
        const url = `${this.baseUrl}/flash-sales/internal/update-payment-status`;
        log.info(`Calling Product Service: POST ${url} for intent ${paymentIntentId}, status: ${status}`);
        try {
            const response = await axios.post(
                url,
                { paymentIntentId: paymentIntentId, paymentStatus: status },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.serviceSecret}`,
                        'X-Service-Name': 'payment-service'
                    },
                    timeout: 5000
                }
            );

            if (response.status === 200) {
                log.info(`Product Service acknowledged payment update for intent ${paymentIntentId}`);
                return true;
            } else {
                log.warn(`Product Service returned status ${response.status} for payment update on intent ${paymentIntentId}`);
                return false;
            }
        } catch (error: any) {
            log.error(`Error calling Product Service notifyFlashSalePaymentUpdate for intent ${paymentIntentId}: ${error.message}`);
            if (axios.isAxiosError(error) && error.response) {
                log.error(`Product Service Response Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
            } else {
                log.error(`Error details: ${error}`);
            }
            // Don't throw, allow payment service to continue, just log the failure to notify.
            return false;
        }
    }
}

export const productServiceClient = new ProductServiceClient(); 