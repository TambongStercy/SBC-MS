import apiClient from '../api/apiClient';
import { AxiosError } from 'axios';
import axios from 'axios';

// --- Enums & Interfaces (mirroring backend) ---

export enum TombolaStatus {
    OPEN = 'open',
    DRAWING = 'drawing', // Consider if frontend needs this intermediate state
    CLOSED = 'closed',
}

export interface Winner {
    userId: string; // Assuming string representation on frontend
    prize: string;
    rank: number;
    _id?: string; // Subdocuments might get an _id from mongoose
    winningTicketNumber: number;
}

export interface TombolaMonth {
    _id: string;
    month: number;
    year: number;
    status: TombolaStatus;
    startDate: string; // Use string for ISO dates from API
    endDate?: string;
    drawDate?: string;
    winners: Winner[];
    lastTicketNumber: number;
    createdAt: string;
    updatedAt: string;
}

export interface TombolaTicket { // Basic structure, add more if needed
    _id: string;
    userId: string; // Could be populated user object later
    tombolaMonthId: string; // Could be populated month object later
    ticketId: string;
    ticketNumber: number;
    purchaseTimestamp: string;
    paymentIntentId?: string;
    // Add user details if populated by backend
    userName?: string;
    userPhoneNumber?: string; // Added phone number
    userEmail?: string; // Keep email if backend provides it
}

// Generic Pagination Options
export interface PaginationOptions {
    page?: number;
    limit?: number;
}

// Response for listing Tombola Months (Revised based on logs)
interface TombolaListResponse {
    success: boolean;
    message?: string; // Make message optional
    data: TombolaMonth[]; // Assume data is the array directly based on logs
    pagination: {
        totalCount: number;
        page: number;
        totalPages: number;
        limit?: number; // Optional limit info
        hasNextPage?: boolean;
        hasPrevPage?: boolean;
    };
}

// Response for listing tickets
interface TicketListResponse {
    success: boolean;
    data: {
        tickets: TombolaTicket[];
        totalCount: number;
        page: number;
        totalPages: number;
    };
    message?: string;
    
    pagination: {
        totalCount: number;
        page: number;
        totalPages: number;
        limit?: number; // Optional limit info
        hasNextPage?: boolean;
        hasPrevPage?: boolean;
    };
}

// Response for single TombolaMonth actions (Create, Draw, UpdateStatus, Delete)
interface TombolaActionResponse {
    success: boolean;
    data?: TombolaMonth; // Often returns the updated/created object
    message?: string;
}

// --- API Functions ---

// Helper to handle errors
const handleError = (error: unknown, defaultMessage: string): string => {
    if (error instanceof AxiosError && error.response?.data?.message) {
        return error.response.data.message;
    }
    if (error instanceof Error) {
        return error.message;
    }
    return defaultMessage;
};

/**
 * List all Tombola Months (Admin)
 */
export const listTombolaMonths = async (pagination: PaginationOptions = {}): Promise<TombolaListResponse> => {
    console.log('[API] Listing Tombola Months with pagination:', pagination);
    try {
        // Assume the raw response might have data as array and pagination alongside
        const response = await apiClient.get<TombolaListResponse>('/tombolas/admin', { params: pagination });
        console.log('[API] Tombola Months List Raw Response:', response.data);

        // Basic validation of expected structure
        if (!response.data || typeof response.data !== 'object' || !response.data.success || !Array.isArray(response.data.data) || !response.data.pagination) {
            console.error('[API] Unexpected Tombola List Response structure:', response.data);
            throw new Error('Failed to parse tombola list response from server.');
        }

        // Return the structured data as expected by the interface
        return response.data;

    } catch (error) {
        console.error('[API] Error listing Tombola Months:', error);
        throw new Error(handleError(error, 'Failed to fetch tombola list'));
    }
};

/**
 * Create a new Tombola Month (Admin)
 */
export const createTombolaMonth = async (month: number, year: number): Promise<TombolaMonth> => {
    console.log(`[API] Creating Tombola Month for ${year}-${month}`);
    try {
        const response = await apiClient.post<TombolaActionResponse>('/tombolas/admin', { month, year });
        console.log('[API] Create Tombola Response:', response.data);
        if (response.data.success && response.data.data) {
            return response.data.data;
        } else {
            throw new Error(response.data.message || 'Failed to create tombola month: Unexpected response');
        }
    } catch (error) {
        console.error('[API] Error creating Tombola Month:', error);
        throw new Error(handleError(error, 'Failed to create tombola month'));
    }
};

/**
 * Get details for a specific Tombola Month (Admin)
 */
export const getTombolaMonthDetails = async (tombolaMonthId: string): Promise<TombolaMonth> => {
    console.info(`[API] Getting details for Tombola Month: ${tombolaMonthId}`); // Use console.info
    try {
        // Assume the backend returns { success: true, data: TombolaMonth }
        const response = await apiClient.get<{ success: boolean, data: TombolaMonth, message?: string }>(`/tombolas/admin/${tombolaMonthId}`);
        console.debug('[API] Get Tombola Details Raw Response:', response.data); // Use console.debug
        if (response.data?.success && response.data.data) {
            return response.data.data;
        } else {
            throw new Error(response.data?.message || 'Failed to fetch tombola details: Unexpected response');
        }
    } catch (error) {
        console.error(`[API] Error getting details for Tombola Month ${tombolaMonthId}:`, error); // Use console.error
        throw new Error(handleError(error, 'Failed to fetch tombola details'));
    }
};

/**
 * Trigger the winner draw for a Tombola Month (Admin)
 */
export const performDraw = async (tombolaMonthId: string): Promise<TombolaMonth> => {
    console.log(`[API] Performing draw for Tombola Month: ${tombolaMonthId}`);
    try {
        const response = await apiClient.post<TombolaActionResponse>(`/tombolas/admin/${tombolaMonthId}/draw`);
        console.log('[API] Perform Draw Response:', response.data);
        if (response.data.success && response.data.data) {
            return response.data.data;
        } else {
            throw new Error(response.data.message || 'Failed to perform draw: Unexpected response');
        }
    } catch (error) {
        console.error('[API] Error performing draw:', error);
        throw new Error(handleError(error, 'Failed to perform draw'));
    }
};

/**
 * Fetches all ticket numbers for a specific tombola month.
 * @param tombolaMonthId - The ID of the tombola month.
 * @returns A promise that resolves to an array of ticket numbers.
 */
export const getAllTicketNumbersForMonth = async (tombolaMonthId: string): Promise<number[]> => {
    console.info(`[API] Fetching all ticket numbers for Tombola Month: ${tombolaMonthId}`); // Use console.info
    try {
        // Define the expected response structure for this endpoint
        interface TicketNumbersResponse {
            success: boolean;
            data: number[];
            message?: string;
        }

        const response = await apiClient.get<TicketNumbersResponse>(`/tombolas/admin/${tombolaMonthId}/ticket-numbers`);
        console.debug(`[API] Response for get ticket numbers ${tombolaMonthId}:`, response.data); // Use console.debug

        if (!response.data?.success) {
            throw new Error(response.data?.message || 'Failed to fetch ticket numbers');
        }
        return response.data.data || []; // Return the array of numbers or empty array
    } catch (error) {
        console.error(`[API] Error fetching ticket numbers for Tombola Month ${tombolaMonthId}:`, error); // Use console.error
        if (axios.isAxiosError(error) && error.response) { // Keep axios check here
            throw new Error(error.response.data?.message || 'Failed to fetch ticket numbers');
        }
        throw new Error('Failed to fetch ticket numbers due to an unknown error.');
    }
};

/**
 * List tickets for a specific Tombola Month (Admin)
 */
export const listTicketsForMonth = async (
    tombolaMonthId: string,
    pagination: PaginationOptions = {},
    search?: string // Add optional search parameter
): Promise<TicketListResponse> => {
    console.log(`[API] Listing tickets for month ${tombolaMonthId} with pagination:`, pagination, `Search: ${search || 'none'}`);
    try {
        // Combine pagination and search params
        const params = {
            ...pagination,
            ...(search && { search: search.trim() }) // Add search only if it exists and is not empty
        };
        const response = await apiClient.get<TicketListResponse>(`/tombolas/admin/${tombolaMonthId}/tickets`, { params });
        console.log(`[API] Tickets List Response for month ${tombolaMonthId}:`, response.data);
        return response.data;
    } catch (error) {
        console.error(`[API] Error listing tickets for month ${tombolaMonthId}:`, error);
        throw new Error(handleError(error, 'Failed to fetch ticket list'));
    }
};

/**
 * Update the status of a Tombola Month (Admin)
 */
export const updateTombolaStatus = async (tombolaMonthId: string, status: TombolaStatus.OPEN | TombolaStatus.CLOSED): Promise<TombolaMonth> => {
    console.log(`[API] Updating status for Tombola Month ${tombolaMonthId} to ${status}`);
    try {
        const response = await apiClient.patch<TombolaActionResponse>(`/tombolas/admin/${tombolaMonthId}/status`, { status });
        console.log('[API] Update Status Response:', response.data);
        if (response.data.success && response.data.data) {
            return response.data.data;
        } else {
            throw new Error(response.data.message || 'Failed to update status: Unexpected response');
        }
    } catch (error) {
        console.error('[API] Error updating tombola status:', error);
        throw new Error(handleError(error, 'Failed to update tombola status'));
    }
};

/**
 * Delete a Tombola Month (Admin)
 */
export const deleteTombolaMonth = async (tombolaMonthId: string): Promise<{ success: boolean; message?: string }> => {
    console.log(`[API] Deleting Tombola Month: ${tombolaMonthId}`);
    try {
        const response = await apiClient.delete<{ success: boolean; message?: string }>(`/tombolas/admin/${tombolaMonthId}`);
        console.log('[API] Delete Tombola Response:', response.data);
        if (!response.data.success) {
            throw new Error(response.data.message || 'Failed to delete tombola month: Delete unsuccessful');
        }
        return response.data;
    } catch (error) {
        console.error('[API] Error deleting Tombola Month:', error);
        throw new Error(handleError(error, 'Failed to delete tombola month'));
    }
}; 