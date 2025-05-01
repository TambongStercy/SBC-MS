import axios from 'axios';
import apiClient from '../api/apiClient';
import { PaginationOptions } from './common'; // Assuming common types are here
import { Currency, TransactionStatus, TransactionType } from '../types/enums'; // Corrected Import Path

const log = {
    info: (...args: any[]) => console.log('[API-AccountTx]', ...args),
    warn: (...args: any[]) => console.warn('[API-AccountTx]', ...args),
    error: (...args: any[]) => console.error('[API-AccountTx]', ...args),
    debug: (...args: any[]) => console.debug('[API-AccountTx]', ...args),
};

// Interface matching EnrichedAccountTransaction from payment-service
export interface AccountTransaction {
    _id: string; // Mongoose ObjectId converted to string
    transactionId: string;
    userId: string; // Mongoose ObjectId converted to string
    type: TransactionType;
    amount: number;
    currency: Currency;
    fee: number;
    status: TransactionStatus;
    description: string;
    metadata?: Record<string, any>;
    reference?: string;
    serviceProvider?: string;
    paymentMethod?: string;
    externalTransactionId?: string;
    createdAt: string; // Dates as ISO strings
    updatedAt: string; // Dates as ISO strings
    // Enriched fields
    userName?: string;
    userPhoneNumber?: string;
}

// API Response Interface
interface AccountTransactionListResponse {
    data: AccountTransaction[];
    pagination: {
        currentPage: number;
        totalPages: number;
        totalCount: number;
        limit: number;
    };
    success: boolean;
    message?: string;
}

// Filter Type Definition
export interface AccountTransactionFilters extends Partial<PaginationOptions> {
    userSearchTerm?: string;
    status?: TransactionStatus | ''; // Allow empty string for 'all'
    type?: TransactionType | '';     // Allow empty string for 'all'
    startDate?: string; // ISO string or YYYY-MM-DD
    endDate?: string;   // ISO string or YYYY-MM-DD
    minAmount?: number | string; // Allow string for input binding
    maxAmount?: number | string; // Allow string for input binding
    currency?: Currency | '';     // Allow empty string for 'all'
}

// Fetch all account transactions based on filters
export const getAccountTransactions = async (
    filters: AccountTransactionFilters = {}
): Promise<AccountTransactionListResponse> => {
    // Default page and limit if not provided in filters
    const params: Record<string, any> = {
        page: filters.page || 1,
        limit: filters.limit || 20,
        sortBy: filters.sortBy || 'createdAt',
        sortOrder: filters.sortOrder || 'desc',
        userSearchTerm: filters.userSearchTerm || undefined,
        status: filters.status || undefined,
        type: filters.type || undefined,
        startDate: filters.startDate || undefined,
        endDate: filters.endDate || undefined,
        minAmount: filters.minAmount || undefined,
        maxAmount: filters.maxAmount || undefined,
        currency: filters.currency || undefined,
    };

    // Remove undefined/empty properties so they aren't sent as empty query params
    Object.keys(params).forEach(key => {
        if (params[key] === undefined || params[key] === '') {
            delete params[key];
        }
    });

    log.debug("Calling getAccountTransactions with params:", params);
    try {
        // Target the correct admin endpoint in payment-service
        const response = await apiClient.get<AccountTransactionListResponse>('/transactions/admin', { params });
        log.debug("Received response:", response.data);
        // Assuming backend response format is { success: true, data: [...], pagination: {...} }
        if (response.data?.success) {
            return response.data;
        } else {
            throw new Error(response.data?.message || 'Failed to fetch account transactions: Invalid response structure');
        }
    } catch (error) {
        log.error('API Error getting account transactions:', error);
        if (axios.isAxiosError(error) && error.response) {
            throw new Error(error.response.data?.message || 'Failed to fetch account transactions');
        } else if (error instanceof Error) {
            throw error; // Rethrow known errors
        }
        throw new Error('Failed to fetch account transactions due to an unknown error.');
    }
}; 