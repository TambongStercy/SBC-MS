import apiClient from '../api/apiClient';
import { AxiosError } from 'axios';
import { AdminUserListResponse, listUsers, AdminUserListFilters, AdminUserData } from './adminUserApi'; // Import listUsers and types

// --- Enums & Interfaces (match backend models/interfaces) ---

// Matches PaymentStatus enum/type in payment-service
export enum PaymentStatus {
    PENDING_USER_INPUT = 'PENDING_USER_INPUT',
    PENDING_PROVIDER = 'PENDING_PROVIDER',
    PROCESSING = 'PROCESSING',
    SUCCEEDED = 'SUCCEEDED',
    FAILED = 'FAILED',
    CANCELED = 'CANCELED',
    EXPIRED = 'EXPIRED',
    ERROR = 'ERROR',
    REQUIRES_ACTION = 'REQUIRES_ACTION',
    REFUNDED = 'REFUNDED'
}

// Matches PaymentGateway enum/type in payment-service
export enum PaymentGateway {
    NONE = 'none',
    FEEXPAY = 'feexpay',
    CINETPAY = 'cinetpay',
    LYGOS = 'lygos',
    NOWPAYMENTS = 'nowpayments',
    TESTING = 'testing'
}

// Matches IPaymentIntent interface in payment-service (or the enriched version)
export interface PaymentIntent {
    _id: string; // Assuming _id is present
    sessionId: string;
    userId: string;
    userName?: string; // Added by enrichment
    userPhoneNumber?: string;
    paymentType?: string;
    subscriptionType?: string;
    subscriptionPlan?: string;
    amount?: number;
    currency?: string;
    status: PaymentStatus;
    gateway: PaymentGateway;
    gatewayPaymentId?: string;
    paidAmount?: number;
    paidCurrency?: string;
    payAmount?: number; // For crypto payments (NOWPayments)
    payCurrency?: string; // For crypto payments (NOWPayments)
    phoneNumber?: string;
    countryCode?: string;
    operator?: string;
    metadata?: Record<string, any>;
    webhookHistory?: Array<{ timestamp: string; status: PaymentStatus; providerData?: any }>;
    createdAt: string; // Dates will be strings
    updatedAt: string;
    // Add other relevant fields returned by the backend endpoint
}

// Common Pagination interface (can be moved to a shared types file later)
export interface Pagination {
    currentPage: number;
    totalPages: number;
    totalCount: number;
    limit: number;
}

// Expected structure of the API response for the admin list endpoint
interface AdminTransactionListResponse {
    success: boolean;
    message?: string;
    data: PaymentIntent[];
    pagination: Pagination;
}

// Filtering options for the API request
export interface TransactionFilters {
    page?: number;
    limit?: number;
    status?: PaymentStatus | string;
    userSearchTerm?: string;
    startDate?: string; // ISO date string
    endDate?: string;   // ISO date string
    minAmount?: number | string;
    maxAmount?: number | string;
    currency?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
}

// --- API Function --- 

/**
 * Fetches a list of all payment transactions/intents for admin view.
 * @param filters - Filtering and pagination options.
 */
export const listAdminTransactions = async (
    filters: TransactionFilters = {}
): Promise<AdminTransactionListResponse> => {
    try {
        // Clean up filters: remove undefined values
        const cleanedFilters = Object.entries(filters)
            .filter(([, value]) => value !== undefined && value !== '')
            .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {});

        console.log('[API Call] listAdminTransactions with filters:', cleanedFilters);
        const response = await apiClient.get<AdminTransactionListResponse>('/payments/admin/transactions', {
            params: cleanedFilters
        });

        // Assuming the backend response structure matches AdminTransactionListResponse
        // { success: true, data: [...], pagination: {...} }
        if (response.data && response.data.success) {
            return response.data;
        } else {
            throw new Error(response.data?.message || 'Failed to fetch transactions: Invalid API response structure');
        }

    } catch (error) {
        console.error('[API Error] listAdminTransactions:', error);
        if (error instanceof AxiosError && error.response) {
            // Use message from backend error response if available
            const backendMessage = error.response.data?.message;
            throw new Error(backendMessage || `Failed to fetch transactions: ${error.message}`);
        } else if (error instanceof Error) {
            // Use message from Error object
            throw new Error(`Failed to fetch transactions: ${error.message}`);
        }
        throw new Error('Failed to fetch transactions due to an unknown error.');
    }
};

export interface ReprocessFeexpayResult {
    sessionId: string;
    status: string; // Use string for display, actual enum is PaymentStatus
    message: string;
}

/**
 * [ADMIN] Calls the backend endpoint to reprocess FeexPay payment statuses for a specific user.
 * @param userId The ID of the user whose payment intents to reprocess.
 * @returns A promise resolving to an array of reprocessing results.
 */
export const reprocessFeexpayPaymentsForUser = async (userId: string): Promise<ReprocessFeexpayResult[]> => {
    try {
        const response = await apiClient.post(`/payments/admin/reprocess-feexpay-payments/user/${userId}`);
        return response.data.data as ReprocessFeexpayResult[];
    } catch (error) {
        console.error(`Error reprocessing FeexPay payments for user ${userId}:`, error);
        throw new Error(`Failed to reprocess payments.`);
    }
};

/**
 * [ADMIN] Searches for users based on a search term, reusing the existing adminUserApi listUsers function.
 * This function is specifically for the Fix FeexPay Payments page to select a user.
 * @param searchTerm The search query (name, email, phone number).
 * @returns A promise resolving to an array of AdminUserData.
 */
export const searchUsersForFeexPayFix = async (searchTerm: string): Promise<AdminUserData[]> => {
    try {
        const filters: AdminUserListFilters = searchTerm ? { search: searchTerm } : {};
        const pagination = { page: 1, limit: 20 }; // Always fetch first page with a reasonable limit for search
        const response: AdminUserListResponse = await listUsers(filters, pagination);
        return response.data || [];
    } catch (error) {
        console.error('Error searching users for FeexPay fix:', error);
        throw new Error('Failed to search users.');
    }
};

// Interface for manual payment intent creation
export interface ManualPaymentIntentRequest {
    userId: string;
    amount: number;
    currency?: string;
    paymentType?: string;
    provider?: 'cinetpay' | 'feexpay' | 'nowpayments';
    externalReference?: string;
    metadata?: Record<string, any>;
    autoMarkSucceeded?: boolean;
    triggerWebhook?: boolean;
    adminNote?: string;
}

// Response interface for manual payment intent creation
export interface ManualPaymentIntentResponse {
    success: boolean;
    message: string;
    data: {
        sessionId: string;
        userId: string;
        amount: number;
        currency: string;
        status: PaymentStatus;
        gateway: PaymentGateway;
        paymentType: string;
        metadata: Record<string, any>;
        createdAt: string;
        isManualAdmin: boolean;
        webhookTriggered: boolean;
        subscriptionProcessing: {
            subscriptionType: string;
            subscriptionPlan: string;
            webhookConfigured: boolean;
        };
    };
}

/**
 * [ADMIN] Manually create a payment intent for recovery purposes
 * @param requestData The manual payment intent creation data
 * @returns A promise resolving to the created payment intent details
 */
export const createManualPaymentIntent = async (
    requestData: ManualPaymentIntentRequest
): Promise<ManualPaymentIntentResponse> => {
    try {
        console.log('[API Call] createManualPaymentIntent with data:', requestData);
        const response = await apiClient.post<ManualPaymentIntentResponse>(
            '/payments/admin/create-manual-intent',
            requestData
        );

        if (response.data && response.data.success) {
            console.log('[API Succès] Intention de paiement manuelle créée:', response.data.data.sessionId);
            return response.data;
        } else {
            throw new Error(response.data?.message || 'Échec de création de l\'intention de paiement manuelle: Structure de réponse API invalide');
        }

    } catch (error) {
        console.error('[API Erreur] createManualPaymentIntent:', error);
        if (error instanceof AxiosError && error.response) {
            // Utiliser le message de la réponse d'erreur du backend si disponible
            const backendMessage = error.response.data?.message;
            throw new Error(backendMessage || `Échec de création de l'intention de paiement manuelle: ${error.message}`);
        } else if (error instanceof Error) {
            // Utiliser le message de l'objet Error
            throw new Error(`Échec de création de l'intention de paiement manuelle: ${error.message}`);
        }
        throw new Error('Échec de création de l\'intention de paiement manuelle en raison d\'une erreur inconnue.');
    }
};

/**
 * [ADMIN] Search for existing payment intent by session ID or gateway payment ID
 * @param reference The session ID or gateway payment ID to search for
 * @returns A promise resolving to the found payment intent
 */
export const searchPaymentIntent = async (reference: string): Promise<{ success: boolean; data?: any; message?: string }> => {
    try {
        console.log('[API Call] searchPaymentIntent with reference:', reference);
        const response = await apiClient.get(`/payments/admin/search-payment-intent/${encodeURIComponent(reference)}`);

        if (response.data && response.data.success) {
            console.log('[API Succès] Intention de paiement trouvée:', response.data.data.sessionId);
            return response.data;
        } else {
            return { success: false, message: response.data?.message || 'Intention de paiement non trouvée' };
        }

    } catch (error) {
        console.error('[API Erreur] searchPaymentIntent:', error);
        if (error instanceof AxiosError && error.response) {
            const backendMessage = error.response.data?.message;
            return { success: false, message: backendMessage || `Erreur de recherche: ${error.message}` };
        } else if (error instanceof Error) {
            return { success: false, message: `Erreur de recherche: ${error.message}` };
        }
        return { success: false, message: 'Erreur de recherche inconnue.' };
    }
};

/**
 * [ADMIN] Recover existing payment intent by marking it as succeeded and triggering webhooks
 * @param sessionId The session ID of the payment intent to recover
 * @param adminNote Optional admin note for the recovery
 * @returns A promise resolving to the recovery result
 */
export const recoverExistingPaymentIntent = async (
    sessionId: string, 
    adminNote?: string
): Promise<ManualPaymentIntentResponse> => {
    try {
        console.log('[API Call] recoverExistingPaymentIntent with sessionId:', sessionId);
        const response = await apiClient.post<ManualPaymentIntentResponse>(
            '/payments/admin/recover-payment-intent',
            {
                sessionId,
                adminNote: adminNote || `Récupération d'intention de paiement existante - ${sessionId}`
            }
        );

        if (response.data && response.data.success) {
            console.log('[API Succès] Intention de paiement récupérée:', response.data.data.sessionId);
            return response.data;
        } else {
            throw new Error(response.data?.message || 'Échec de récupération de l\'intention de paiement: Structure de réponse API invalide');
        }

    } catch (error) {
        console.error('[API Erreur] recoverExistingPaymentIntent:', error);
        if (error instanceof AxiosError && error.response) {
            const backendMessage = error.response.data?.message;
            throw new Error(backendMessage || `Échec de récupération de l'intention de paiement: ${error.message}`);
        } else if (error instanceof Error) {
            throw new Error(`Échec de récupération de l'intention de paiement: ${error.message}`);
        }
        throw new Error('Échec de récupération de l\'intention de paiement en raison d\'une erreur inconnue.');
    }
}; 