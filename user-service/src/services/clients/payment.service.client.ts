import axios from 'axios';
import config from '../../config';
import logger from '../../utils/logger';
import { AxiosInstance } from 'axios';

const log = logger.getLogger('PaymentServiceClient');

// Define payload for creating an intent
interface CreateIntentPayload {
    userId: string;
    amount: number;
    currency: string;
    paymentType: string; // e.g., 'SUBSCRIPTION'
    metadata?: Record<string, any>; // e.g., { planId: '...', userId: '...' }
}

interface InternalTransactionPayload {
    userId: string;
    amount: number;
    currency: string;
    description: string;
    metadata?: Record<string, any>;
}

// Define expected successful response data from payment service
interface PaymentIntentData {
    sessionId: string;
    paymentPageUrl?: string;
    clientSecret?: string;
    paymentIntentId?: string;
}

interface InternalTransactionResponseData {
    transactionId: string;
    status: string;
}

// Define the full response structure
interface PaymentIntentResponse {
    success: boolean;
    data?: PaymentIntentData;
    message?: string;
}

interface CountResponse {
    success: boolean;
    data?: { count: number };
    message?: string;
}

// Define response for methods returning a single numeric value (e.g., total revenue)
interface ValueResponse {
    success: boolean;
    data?: { value: number };
    message?: string;
}

// Define response for methods returning an array (e.g., monthly data)
interface ArrayResponse<T = any> { // Default to any if structure unknown
    success: boolean;
    data?: T[];
    message?: string;
}

interface RecentTransaction {
    _id: string;
    transactionId: string;
    userId: string; // Might need user details populated depending on requirements
    type: string; // TransactionType enum
    amount: number;
    currency: string; // Currency enum
    status: string; // TransactionStatus enum
    description: string;
    createdAt: string; // Date string
    // Add other fields as needed by the dashboard UI
}

interface RecentTransactionsResponse {
    success: boolean;
    data?: RecentTransaction[];
    message?: string;
}

interface PaymentServiceResponse<T> {
    success: boolean;
    data?: T;
    message?: string;
}

class PaymentServiceClient {
    private apiClient: AxiosInstance;
    private log = logger.getLogger('PaymentServiceClient');

    constructor() {
        this.apiClient = axios.create({
            baseURL: config.services.paymentService, // Use URL from user-service config
            timeout: 5000, // Set a reasonable timeout
            headers: {
                'Content-Type': 'application/json',
                // Service-to-Service Authentication (using shared secret)
                'Authorization': `Bearer ${config.services.serviceSecret}`,
                'X-Service-Name': 'user-service', // Identify this service
            },
        });
    }

    /**
     * Calls the payment service to create a new payment intent.
     */
    async createIntent(payload: CreateIntentPayload): Promise<PaymentIntentData> {
        const url = '/payments/intents'; // Target the /payments endpoint
        this.log.info(`Sending create payment intent request to ${this.apiClient.defaults.baseURL}${url} for user ${payload.userId}`);
        this.log.debug('Create intent payload:', payload);
        try {
            const response = await this.apiClient.post<PaymentServiceResponse<PaymentIntentData>>(url, payload);
            if (response.status === 201 && response.data?.success && response.data.data?.sessionId) {
                this.log.info('Payment intent created successfully.', { sessionId: response.data.data.sessionId });
                return response.data.data; // Return only the nested data object
            } else {
                this.log.warn('Payment service responded with failure or unexpected structure for create intent.', {
                    status: response.status,
                    responseData: response.data
                });
                throw new Error(response.data?.message || 'Failed to create payment intent via payment service');
            }
        } catch (error: any) {
            this.log.error(`Error calling payment service ${url}: ${error.message}`);
            if (axios.isAxiosError(error)) {
                this.log.error('Payment Service Error Response (createIntent):', { status: error.response?.status, data: error.response?.data });
                throw new Error(error.response?.data?.message || 'Payment service communication error');
            }
            throw new Error('Payment service communication error');
        }
    }

    /**
     * Records an internal deposit transaction via the payment service.
     * Used for commission payouts, refunds, etc.
     */
    async recordInternalDeposit(payload: InternalTransactionPayload): Promise<InternalTransactionResponseData> {
        const url = '/internal/deposit'; // Target the /internal endpoint
        this.log.info(`Sending record internal deposit request to ${this.apiClient.defaults.baseURL}${url} for user ${payload.userId}`);
        this.log.debug('Record internal deposit payload:', payload);
        try {
            const response = await this.apiClient.post<PaymentServiceResponse<InternalTransactionResponseData>>(url, payload);
            if (response.status === 201 && response.data?.success && response.data.data?.transactionId) {
                this.log.info('Internal deposit recorded successfully.', { transactionId: response.data.data.transactionId });
                return response.data.data;
            } else {
                this.log.warn('Payment service responded with failure or unexpected structure for record internal deposit.', {
                    status: response.status,
                    responseData: response.data
                });
                throw new Error(response.data?.message || 'Failed to record internal deposit via payment service');
            }
        } catch (error: any) {
            this.log.error(`Error calling payment service ${url}: ${error.message}`);
            if (axios.isAxiosError(error)) {
                this.log.error('Payment Service Error Response (recordInternalDeposit):', { status: error.response?.status, data: error.response?.data });
                throw new Error(error.response?.data?.message || 'Payment service communication error');
            }
            throw new Error('Payment service communication error');
        }
    }

    /**
     * Fetches the total count of transactions.
     * Assumes endpoint: GET /api/stats/total-transactions
     */
    async getTotalTransactions(): Promise<number> {
        const url = '/internal/stats/transactions';
        this.log.info(`Sending request to ${this.apiClient.defaults.baseURL}${url}`);
        try {
            const response = await this.apiClient.get<CountResponse>(url);
            if (response.status === 200 && response.data?.success && typeof response.data.data?.count === 'number') {
                log.info(`Successfully fetched total transactions: ${response.data.data.count}`);
                return response.data.data.count;
            } else {
                log.warn('Payment service responded with failure or unexpected structure for total transaction count.', {
                    status: response.status,
                    responseData: response.data
                });
                return 0; // Return 0 on API error/unexpected response
            }
        } catch (error: any) {
            log.error(`Error calling payment service ${url}: ${error.message}`);
            if (axios.isAxiosError(error)) {
                log.error('Payment Service Error Response (getTotalTransactions):', { status: error.response?.status, data: error.response?.data });
            }
            return 0; // Return 0 on communication error
        }
    }

    /**
     * Fetches the most recent transactions.
     * Assumes endpoint: GET /api/transactions/recent?limit={limit}
     */
    async getRecentTransactions(limit: number = 5): Promise<RecentTransaction[]> {
        const url = `/transactions/recent?limit=${limit}`;
        this.log.info(`Sending request to ${this.apiClient.defaults.baseURL}${url}`);
        try {
            const response = await this.apiClient.get<RecentTransactionsResponse>(url);
            if (response.status === 200 && response.data?.success && Array.isArray(response.data.data)) {
                log.info(`Successfully fetched ${response.data.data.length} recent transactions.`);
                return response.data.data;
            } else {
                log.warn('Payment service responded with failure or unexpected structure for recent transactions.', {
                    status: response.status,
                    responseData: response.data
                });
                return []; // Return empty array on API error/unexpected response
            }
        } catch (error: any) {
            log.error(`Error calling payment service ${url}: ${error.message}`);
            if (axios.isAxiosError(error)) {
                log.error('Payment Service Error Response (getRecentTransactions):', { status: error.response?.status, data: error.response?.data });
            }
            return []; // Return empty array on communication error
        }
    }

    /**
     * Fetches the total withdrawal amount from the payment service.
     * Calls endpoint: GET /api/payments/internal/stats/total-withdrawals
     */
    async getTotalWithdrawals(): Promise<number> {
        const url = '/internal/stats/total-withdrawals';
        this.log.info(`Sending request to ${this.apiClient.defaults.baseURL}${url}`);
        try {
            const response = await this.apiClient.get<ValueResponse>(url);
            if (response.status === 200 && response.data?.success && typeof response.data.data?.value === 'number') {
                this.log.info(`Successfully fetched total withdrawals: ${response.data.data.value}`);
                return response.data.data.value;
            } else {
                this.log.warn('Payment service responded with failure or unexpected structure for total withdrawal amount.', {
                    status: response.status,
                    responseData: response.data
                });
                return 0; // Return 0 on API error/unexpected response
            }
        } catch (error: any) {
            this.log.error(`Error calling payment service ${url}: ${error.message}`);
            if (axios.isAxiosError(error)) {
                this.log.error('Payment Service Error Response (getTotalWithdrawals):', { status: error.response?.status, data: error.response?.data });
            }
            return 0; // Return 0 on communication error
        }
    }

    /**
     * Fetches the total revenue amount from the payment service.
     * Calls endpoint: GET /api/internal/stats/total-revenue
     */
    async getTotalRevenue(): Promise<number> {
        const url = '/internal/stats/total-revenue';
        this.log.info(`Sending request to ${this.apiClient.defaults.baseURL}${url}`);
        try {
            const response = await this.apiClient.get<ValueResponse>(url);
            if (response.status === 200 && response.data?.success && typeof response.data.data?.value === 'number') {
                this.log.info(`Successfully fetched total revenue: ${response.data.data.value}`);
                return response.data.data.value;
            } else {
                this.log.warn('Payment service responded with failure or unexpected structure for total revenue amount.', {
                    status: response.status,
                    responseData: response.data
                });
                return 0; // Return 0 on API error/unexpected response
            }
        } catch (error: any) {
            this.log.error(`Error calling payment service ${url}: ${error.message}`);
            if (axios.isAxiosError(error)) {
                this.log.error('Payment Service Error Response (getTotalRevenue):', { status: error.response?.status, data: error.response?.data });
            }
            return 0; // Return 0 on communication error
        }
    }

    /**
     * Fetches monthly revenue data from the payment service.
     * Calls endpoint: GET /api/internal/stats/monthly-revenue
     */
    async getMonthlyRevenue(): Promise<any[]> {
        const url = '/internal/stats/monthly-revenue';
        this.log.info(`Sending request to ${this.apiClient.defaults.baseURL}${url}`);
        try {
            const response = await this.apiClient.get<ArrayResponse>(url);
            if (response.status === 200 && response.data?.success && Array.isArray(response.data.data)) {
                this.log.info(`Successfully fetched monthly revenue data. Count: ${response.data.data.length}`);
                return response.data.data;
            } else {
                this.log.warn('Payment service responded with failure or unexpected structure for monthly revenue data.', {
                    status: response.status,
                    responseData: response.data
                });
                return []; // Return empty array on API error/unexpected response
            }
        } catch (error: any) {
            this.log.error(`Error calling payment service ${url}: ${error.message}`);
            if (axios.isAxiosError(error)) {
                this.log.error('Payment Service Error Response (getMonthlyRevenue):', { status: error.response?.status, data: error.response?.data });
            }
            return []; // Return empty array on communication error
        }
    }

    /**
     * Fetches activity overview data from the payment service.
     * Calls endpoint: GET /api/internal/stats/activity-overview
     */
    async getActivityOverview(): Promise<any[]> {
        const url = '/internal/stats/activity-overview';
        this.log.info(`Sending request to ${this.apiClient.defaults.baseURL}${url}`);
        try {
            const response = await this.apiClient.get<ArrayResponse>(url);
            if (response.status === 200 && response.data?.success && Array.isArray(response.data.data)) {
                this.log.info(`Successfully fetched activity overview data. Count: ${response.data.data.length}`);
                return response.data.data;
            } else {
                this.log.warn('Payment service responded with failure or unexpected structure for activity overview data.', {
                    status: response.status,
                    responseData: response.data
                });
                return []; // Return empty array on API error/unexpected response
            }
        } catch (error: any) {
            this.log.error(`Error calling payment service ${url}: ${error.message}`);
            if (axios.isAxiosError(error)) {
                this.log.error('Payment Service Error Response (getActivityOverview):', { status: error.response?.status, data: error.response?.data });
            }
            return []; // Return empty array on communication error
        }
    }

    /**
     * Fetches the total withdrawal amount for a specific user from the payment service.
     * Calls endpoint: GET /api/internal/stats/user/:userId/total-withdrawals
     * @param userId The ID of the user.
     * @returns The total withdrawal amount (positive number). Returns 0 on error.
     */
    async getUserTotalWithdrawals(userId: string): Promise<number> {
        const url = `/internal/stats/user/${userId}/total-withdrawals`;
        this.log.info(`Sending request to ${this.apiClient.defaults.baseURL}${url}`);
        try {
            const response = await this.apiClient.get<ValueResponse>(url); // Assuming same ValueResponse structure
            if (response.status === 200 && response.data?.success && typeof response.data.data?.value === 'number') {
                this.log.info(`Successfully fetched total withdrawals for user ${userId}: ${response.data.data.value}`);
                return response.data.data.value;
            } else {
                this.log.warn(`Payment service responded with failure or unexpected structure for user total withdrawals (${userId}).`, {
                    status: response.status,
                    responseData: response.data?.data?.value
                });
                return 0; // Return 0 on API error/unexpected response
            }
        } catch (error: any) {
            this.log.error(`Error calling payment service ${url} for user ${userId}: ${error.message}`);
            if (axios.isAxiosError(error)) {
                this.log.error('Payment Service Error Response (getUserTotalWithdrawals):', { status: error.response?.status, data: error.response?.data });
            }
            return 0; // Return 0 on communication error
        }
    }
}

export const paymentService = new PaymentServiceClient(); 