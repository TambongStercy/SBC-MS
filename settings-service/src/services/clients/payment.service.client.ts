import axios from 'axios';
import config from '../../config'; // Assuming config is available
import logger from '../../utils/logger';
import { AppError } from '../../utils/errors'; // Assuming AppError definition

const log = logger.getLogger('PaymentServiceClient(for Settings)');

interface ApiResponse<T> {
    success: boolean;
    data: T;
    message?: string;
}

class PaymentServiceClient {
    private apiClient = axios.create({
        baseURL: config.services.paymentService, // e.g., 'http://localhost:3003/api'
        timeout: 10000, // 10 seconds timeout for settings-service to payment-service calls
        headers: {
            'Content-Type': 'application/json',
            'X-Internal-Service': 'settings-service',
            // Add internal service-to-service authentication if needed
            'Authorization': `Bearer ${config.services.serviceSecret}`
        }
    });

    constructor() {
        log.info(`Payment service client initialized. Base URL: ${config.services.paymentService}`);
    }

    async getAdminBalance(): Promise<number> {
        log.info(`Sending request to ${this.apiClient.defaults.baseURL}/internal/stats/admin-balance`);
        try {
            const response = await this.apiClient.get<ApiResponse<number>>('/internal/stats/admin-balance');
            if (response.data.success) {
                log.info(`Successfully fetched admin balance: ${response.data.data}`);
                return response.data.data;
            } else {
                log.warn(`Payment service responded with failure for admin balance: ${response.data.message}`);
                throw new AppError(response.data.message || 'Failed to fetch admin balance.', response.status);
            }
        } catch (error: any) {
            log.error(`Error calling payment service /internal/stats/admin-balance: ${error.message}`, error);
            throw new AppError(`Failed to retrieve admin balance from payment service. (Service might be unavailable or endpoint incorrect)`, error.response?.status || 500);
        }
    }
}

export default new PaymentServiceClient();
