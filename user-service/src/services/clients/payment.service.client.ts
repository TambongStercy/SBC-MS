import axios from 'axios';
import config from '../../config';
import logger from '../../utils/logger';
import { AxiosInstance } from 'axios';
import { AppError } from '../../utils/errors';

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
    data?: number;
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

interface ApiResponse<T> {
    success: boolean;
    data: T;
    message?: string;
}

interface TotalTransactionsResponseData {
    totalTransactionCount: number; // Assuming this is the key name
}

interface MonthlyRevenueResponseData {
    month: string;
    totalAmount: number;
}

interface ActivityOverviewResponseData {
    month: string;
    deposits: number;
    withdrawals: number;
    payments: number;
}

class PaymentServiceClient {
    private apiClient: AxiosInstance;
    private log = logger.getLogger('PaymentServiceClient');

    constructor() {
        this.apiClient = axios.create({
            baseURL: config.services.paymentService,
            timeout: 15000, // Increased timeout to 15 seconds
            headers: {
                'Content-Type': 'application/json',
                'X-Internal-Service': 'user-service',
                'Authorization': `Bearer ${config.services.serviceSecret}` // Your internal service token
            },
        });
        this.log.info(`Payment service client initialized. Base URL: ${config.services.paymentService}`);
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
                throw new Error(error.response?.data?.message || 'Payment service communication error (createIntent)');
            }
            throw new Error('Payment service communication error (createIntent)');
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
                throw new Error(error.response?.data?.message || 'Payment service communication error (recordInternalDeposit)');
            }
            throw new Error('Payment service communication error (recordInternalDeposit)');
        }
    }

    /**
     * Fetches the total number of transactions from the payment service.
     * Calls endpoint: GET /api/internal/stats/transactions
     */
    async getTotalTransactions(): Promise<number> {
        this.log.info(`Sending request to ${this.apiClient.defaults.baseURL}/internal/stats/transactions`);
        try {
            // Expect ApiResponse with data: { totalTransactionCount: number }
            const response = await this.apiClient.get<ApiResponse<number>>('/internal/stats/transactions');
            if (response.data.success && typeof response.data.data === 'number') {
                this.log.info(`Successfully fetched total transactions: ${response.data.data}`);
                return response.data.data;
            } else {
                const errMsg = response.data.message || `Payment service responded with failure or unexpected structure for total transactions. Data: ${JSON.stringify(response.data.data)}`;
                this.log.warn(errMsg);
                throw new AppError(errMsg, response.status);
            }
        } catch (error: any) {
            this.log.error(`Error calling payment service /internal/stats/transactions: ${error.message}`, error);
            if (axios.isAxiosError(error) && error.response) {
                throw new AppError(`Failed to retrieve total transactions from payment service. Status: ${error.response.status}, Message: ${error.response.data?.message || 'Unknown error'}`, error.response.status);
            }
            throw new AppError(`Failed to retrieve total transactions from payment service.`, 500);
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
                this.log.info(`Successfully fetched ${response.data.data.length} recent transactions.`);
                return response.data.data;
            } else {
                this.log.warn('Payment service responded with failure or unexpected structure for recent transactions.', {
                    status: response.status,
                    responseData: response.data
                });
                return []; // Return empty array on API error/unexpected response
            }
        } catch (error: any) {
            this.log.error(`Error calling payment service ${url}: ${error.message}`);
            if (axios.isAxiosError(error)) {
                this.log.error('Payment Service Error Response (getRecentTransactions):', { status: error.response?.status, data: error.response?.data });
            }
            return []; // Return empty array on communication error
        }
    }

    /**
     * Fetches the total withdrawals amount from the payment service.
     * Calls endpoint: GET /api/internal/stats/total-withdrawals
     */
    async getTotalWithdrawals(): Promise<number> {
        this.log.info(`Sending request to ${this.apiClient.defaults.baseURL}/internal/stats/total-withdrawals`);
        try {
            // Expect ApiResponse with data: number
            const response = await this.apiClient.get<ApiResponse<number>>('/internal/stats/total-withdrawals');
            if (response.data.success && typeof response.data.data === 'number') {
                this.log.info(`Successfully fetched total withdrawals: ${response.data.data}`);
                return response.data.data;
            } else {
                const errMsg = response.data.message || `Payment service responded with failure or unexpected structure for total withdrawals. Data: ${JSON.stringify(response.data.data)}`;
                this.log.warn(errMsg);
                throw new AppError(errMsg, response.status);
            }
        } catch (error: any) {
            this.log.error(`Error calling payment service /internal/stats/total-withdrawals: ${error.message}`, error);
            if (axios.isAxiosError(error) && error.response) {
                throw new AppError(`Failed to retrieve total withdrawals from payment service. Status: ${error.response.status}, Message: ${error.response.data?.message || 'Unknown error'}`, error.response.status);
            }
            throw new AppError(`Failed to retrieve total withdrawals from payment service.`, 500);
        }
    }

    /**
     * Fetches the total revenue amount from the payment service.
     * Calls endpoint: GET /api/internal/stats/total-revenue
     */
    async getTotalRevenue(): Promise<number> {
        this.log.info(`Sending request to ${this.apiClient.defaults.baseURL}/internal/stats/total-revenue`);
        try {
            // Expect ApiResponse with data: number
            const response = await this.apiClient.get<ApiResponse<number>>('/internal/stats/total-revenue');
            if (response.data.success && typeof response.data.data === 'number') {
                this.log.info(`Successfully fetched total revenue: ${response.data.data}`);
                return response.data.data;
            } else {
                const errMsg = response.data.message || `Payment service responded with failure or unexpected structure for total revenue. Data: ${JSON.stringify(response.data.data)}`;
                this.log.warn(errMsg);
                throw new AppError(errMsg, response.status);
            }
        } catch (error: any) {
            this.log.error(`Error calling payment service /internal/stats/total-revenue: ${error.message}`, error);
            if (axios.isAxiosError(error) && error.response) {
                throw new AppError(`Failed to retrieve total revenue from payment service. Status: ${error.response.status}, Message: ${error.response.data?.message || 'Unknown error'}`, error.response.status);
            }
            throw new AppError(`Failed to retrieve total revenue from payment service.`, 500);
        }
    }

    /**
     * Fetches monthly revenue data from the payment service.
     * Calls endpoint: GET /api/internal/stats/monthly-revenue
     */
    async getMonthlyRevenue(): Promise<MonthlyRevenueResponseData[]> {
        this.log.info(`Sending request to ${this.apiClient.defaults.baseURL}/internal/stats/monthly-revenue`);
        try {
            // Expect ApiResponse with data: MonthlyRevenueResponseData[]
            const response = await this.apiClient.get<ApiResponse<MonthlyRevenueResponseData[]>>('/internal/stats/monthly-revenue');
            if (response.data.success && Array.isArray(response.data.data)) {
                this.log.info(`Successfully fetched monthly revenue data. Count: ${response.data.data.length}`);
                return response.data.data;
            } else {
                const errMsg = response.data.message || `Payment service responded with failure or unexpected structure for monthly revenue. Data: ${JSON.stringify(response.data.data)}`;
                this.log.warn(errMsg);
                throw new AppError(errMsg, response.status);
            }
        } catch (error: any) {
            this.log.error(`Error calling payment service /internal/stats/monthly-revenue: ${error.message}`, error);
            if (axios.isAxiosError(error) && error.response) {
                throw new AppError(`Failed to retrieve monthly revenue from payment service. Status: ${error.response.status}, Message: ${error.response.data?.message || 'Unknown error'}`, error.response.status);
            }
            throw new AppError(`Failed to retrieve monthly revenue from payment service.`, 500);
        }
    }

    /**
     * Fetches activity overview data from the payment service.
     * Calls endpoint: GET /api/internal/stats/activity-overview
     */
    async getActivityOverview(): Promise<ActivityOverviewResponseData[]> {
        this.log.info(`Sending request to ${this.apiClient.defaults.baseURL}/internal/stats/activity-overview`);
        try {
            // Expect ApiResponse with data: ActivityOverviewResponseData[]
            const response = await this.apiClient.get<ApiResponse<ActivityOverviewResponseData[]>>('/internal/stats/activity-overview');
            if (response.data.success && Array.isArray(response.data.data)) {
                this.log.info(`Successfully fetched activity overview data. Count: ${response.data.data.length}`);
                return response.data.data;
            } else {
                const errMsg = response.data.message || `Payment service responded with failure or unexpected structure for activity overview. Data: ${JSON.stringify(response.data.data)}`;
                this.log.warn(errMsg);
                throw new AppError(errMsg, response.status);
            }
        } catch (error: any) {
            this.log.error(`Error calling payment service /internal/stats/activity-overview: ${error.message}`, error);
            if (axios.isAxiosError(error) && error.response) {
                throw new AppError(`Failed to retrieve activity overview from payment service. Status: ${error.response.status}, Message: ${error.response.data?.message || 'Unknown error'}`, error.response.status);
            }
            throw new AppError(`Failed to retrieve activity overview from payment service.`, 500);
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
            const response = await this.apiClient.get<ApiResponse<{ value: number }>>(url); // Assuming same ValueResponse structure

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
                this.log.error(`Payment Service Error Response (getUserTotalWithdrawals User: ${userId}):`, { status: error.response?.status, data: error.response?.data });
            }
            return 0; // Return 0 on communication error
        }
    }

    // This method is called by settings-service to get admin balance from payment-service.
    async getAdminBalance(): Promise<number> {
        this.log.info(`Sending request to ${this.apiClient.defaults.baseURL}/internal/stats/admin-balance`);
        try {
            // Expect ApiResponse with data: number
            const response = await this.apiClient.get<ApiResponse<number>>('/internal/stats/admin-balance');
            if (response.data.success && typeof response.data.data === 'number') {
                this.log.info(`Successfully fetched admin balance: ${response.data.data}`);
                return response.data.data;
            } else {
                const errMsg = response.data.message || `Payment service responded with failure or unexpected structure for admin balance. Data: ${JSON.stringify(response.data.data)}`;
                this.log.warn(errMsg);
                throw new AppError(errMsg, response.status);
            }
        } catch (error: any) {
            this.log.error(`Error calling payment service /internal/stats/admin-balance: ${error.message}`, error);
            if (axios.isAxiosError(error) && error.response) {
                throw new AppError(`Failed to retrieve admin balance from payment service. Status: ${error.response.status}, Message: ${error.response.data?.message || 'Unknown error'}`, error.response.status);
            }
            throw new AppError(`Failed to retrieve admin balance from payment service.`, 500);
        }
    }
}

export const paymentService = new PaymentServiceClient(); 