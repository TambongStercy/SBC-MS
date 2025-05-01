import axios, { AxiosInstance } from 'axios';
import config from '../../config';
import logger from '../../utils/logger';

const log = logger.getLogger('TombolaServiceClient');

// Define expected response structure for count
interface CountResponse {
    success: boolean;
    data?: { count: number };
    message?: string;
}

class TombolaServiceClient {
    private apiClient: AxiosInstance;
    private log = logger.getLogger('TombolaServiceClient');

    constructor() {
        const baseURL = config.services.tombolaService;
        if (!baseURL) {
            log.warn('Tombola Service URL is not configured. Tombola client will not function.');
        }
        this.apiClient = axios.create({
            baseURL: baseURL || undefined,
            timeout: 5000,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.services.serviceSecret}`,
                'X-Service-Name': 'user-service',
            },
        });
        log.info(`Tombola service client initialized. Base URL: ${baseURL || 'NOT SET'}`);
    }

    /**
     * Fetches the total count of tombola tickets for the current month.
     * Assumes endpoint: GET /api/stats/total-tickets/current-month
     */
    async getTotalTombolaTicketsCurrentMonth(): Promise<number> {
        const url = '/stats/total-tickets/current-month';
        if (!this.apiClient.defaults.baseURL) {
            log.warn('Cannot get total tombola tickets: Tombola Service URL not configured.');
            return 0; // Return 0 if service is not configured
        }

        this.log.info(`Sending request to ${this.apiClient.defaults.baseURL}${url}`);
        try {
            const response = await this.apiClient.get<CountResponse>(url);
            if (response.status === 200 && response.data?.success && typeof response.data.data?.count === 'number') {
                log.info(`Successfully fetched total tombola tickets for current month: ${response.data.data.count}`);
                return response.data.data.count;
            } else {
                log.warn('Tombola service responded with failure or unexpected structure for total tickets count.', {
                    status: response.status,
                    responseData: response.data
                });
                return 0;
            }
        } catch (error: any) {
            log.error(`Error calling tombola service ${url}: ${error.message}`);
            if (axios.isAxiosError(error)) {
                log.error('Tombola Service Error Response (getTotalTombolaTicketsCurrentMonth):', { status: error.response?.status, data: error.response?.data });
            }
            return 0;
        }
    }

    // Add other methods to interact with tombola-service as needed
}

export const tombolaService = new TombolaServiceClient(); 