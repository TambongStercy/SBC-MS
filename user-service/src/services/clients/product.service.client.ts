import axios, { AxiosInstance } from 'axios';
import config from '../../config';
import logger from '../../utils/logger';

const log = logger.getLogger('ProductServiceClient');

// Define expected response structure for count
interface CountResponse {
    success: boolean;
    data?: { count: number };
    message?: string;
}

class ProductServiceClient {
    private apiClient: AxiosInstance;
    private log = logger.getLogger('ProductServiceClient');

    constructor() {
        const baseURL = config.services.productService;
        if (!baseURL) {
            log.warn('Product Service URL is not configured. Product client will not function.');
        }
        this.apiClient = axios.create({
            baseURL: baseURL || undefined, // Set to undefined if not configured
            timeout: 5000,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.services.serviceSecret}`,
                'X-Service-Name': 'user-service',
            },
        });
        log.info(`Product service client initialized. Base URL: ${baseURL || 'NOT SET'}`);
    }

    /**
     * Fetches the total count of non-deleted products.
     * Assumes endpoint: GET /api/stats/total-products
     */
    async getTotalProducts(): Promise<number> {
        const url = '/stats/total-products';
        if (!this.apiClient.defaults.baseURL) {
            log.warn('Cannot get total products: Product Service URL not configured.');
            return 0; // Return 0 if service is not configured
        }

        this.log.info(`Sending request to ${this.apiClient.defaults.baseURL}${url}`);
        try {
            const response = await this.apiClient.get<CountResponse>(url);
            if (response.status === 200 && response.data?.success && typeof response.data.data?.count === 'number') {
                log.info(`Successfully fetched total products: ${response.data.data.count}`);
                return response.data.data.count;
            } else {
                log.warn('Product service responded with failure or unexpected structure for total count.', {
                    status: response.status,
                    responseData: response.data
                });
                return 0; // Return 0 on API error/unexpected response
            }
        } catch (error: any) {
            log.error(`Error calling product service ${url}: ${error.message}`);
            if (axios.isAxiosError(error)) {
                log.error('Product Service Error Response (getTotalProducts):', { status: error.response?.status, data: error.response?.data });
            }
            return 0; // Return 0 on communication error
        }
    }

    // Add other methods to interact with product-service as needed
}

export const productService = new ProductServiceClient(); 