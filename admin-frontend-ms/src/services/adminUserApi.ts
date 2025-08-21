import axios from 'axios';

// Define PaginationOptions locally
export interface PaginationOptions {
    page: number;
    limit: number;
}

// Define SubscriptionType locally for the placeholder
enum SubscriptionType {
    CLASSIQUE = 'CLASSIQUE',
    CIBLE = 'CIBLE',
}

// Define PartnerPack enum
export enum PartnerPack {
    SILVER = 'silver',
    GOLD = 'gold',
    NONE = 'none'
}

// --- Interfaces ---

// Interface for the structure of user data returned by the API
// Updated based on expected output of userService.adminGetUserById
export interface AdminUserData {
    _id: string;
    name: string;
    email: string;
    phoneNumber?: number;
    country?: string;
    region?: string;
    city?: string;
    balance?: number;
    usdBalance?: number; // Add USD balance field
    role?: string;
    blocked?: boolean;
    deleted?: boolean;
    isVerified?: boolean;
    avatar?: string;
    momoNumber?: number;
    momoOperator?: string;
    createdAt?: string;
    lastLogin?: string;
    activeSubscriptionTypes?: SubscriptionType[];
    partnerPack?: PartnerPack;
    // Add other relevant fields from IUser model if needed
}

// Interface for partner data
export interface PartnerData {
    _id: string;
    user: AdminUserData;
    pack: 'silver' | 'gold';
    isActive: boolean;
    amount: number;
    createdAt: string;
    updatedAt: string;
}

// Interface for the list partners response
export interface PartnerListResponse {
    data: PartnerData[];
    pagination: {
        currentPage: number;
        totalPages: number;
        totalCount: number;
        limit: number;
    };
}

// Interface for the list users response
export interface AdminUserListResponse {
    data: AdminUserData[];
    pagination: {
        currentPage: number;
        totalPages: number;
        totalCount: number;
        limit: number;
    };
}

// Interface for login response
export interface AdminLoginResponse {
    token: string;
    user: Omit<AdminUserData, 'password' | 'otps' | 'contactsOtps' | 'token'>; // Match backend service response
}

// Interface for filters in listUsers
export interface AdminUserListFilters {
    status?: 'active' | 'inactive' | 'blocked' | 'deleted'; // Adjust based on backend filter logic
    role?: string; // e.g., 'user', 'admin'
    search?: string;
}

// Interface for balance adjustment
export interface AdjustBalancePayload {
    amount: number;
    reason: string;
}

// Interface for the user summary stats response data
export interface UserSummaryStats {
    totalUsers: number;
    activeClassique: number;
    activeCible: number;
    // Add other fields if the backend returns more
}

// Interface for partner summary data
export interface PartnerSummaryData {
    totalActivePartners: number;
    activeSilverPartners: number;
    activeGoldPartners: number;
}

// --- Axios Instance ---

const apiClient = axios.create({
    baseURL: import.meta.env.VITE_API_URL || '/api',
    headers: {
        'Content-Type': 'application/json'
    },
});

// Interceptor to add Auth token
apiClient.interceptors.request.use((config) => {
    const token = localStorage.getItem('adminToken'); // Simple token storage, context is better
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
}, (error) => {
    return Promise.reject(error);
});

// --- API Functions ---

// Define the expected structure of the raw Axios response for login
interface RawAdminLoginApiResponse {
    success: boolean;
    data: AdminLoginResponse; // The nested object with token and user
    message?: string; // Optional message for errors
}

export const loginAdmin = async (credentials: { email: string; password: string }): Promise<AdminLoginResponse> => {
    try {
        // Expect the raw API structure from the post call
        const response = await apiClient.post<RawAdminLoginApiResponse>('/users/admin/login', credentials);
        console.log("Raw loginAdmin response data:", response.data); // Log the raw structure

        // Check for success flag and nested data existence
        if (response.data && response.data.success === true && response.data.data) {
            // Return the nested data object which matches AdminLoginResponse
            return response.data.data;
        } else {
            // Throw an error if success is false or data is missing
            throw new Error(response.data?.message || 'Login failed: Invalid response structure from server.');
        }
    } catch (error) {
        console.error('Admin login failed:', error);
        // Handle Axios errors (network, 4xx, 5xx)
        if (axios.isAxiosError(error) && error.response) {
            // Use message from backend error response if available
            throw new Error(error.response.data?.message || 'Admin login failed');
        } else if (error instanceof Error) {
            // Handle errors thrown from the success check above
            throw error;
        }
        // Fallback error
        throw new Error('Admin login failed due to an unknown error.');
    }
};

export const listUsers = async (
    filters: AdminUserListFilters = {},
    pagination: PaginationOptions = { page: 1, limit: 10 }
): Promise<AdminUserListResponse> => {
    try {
        const params = {
            ...filters,
            page: pagination.page,
            limit: pagination.limit,
        };
        // Remove undefined filters
        Object.keys(params).forEach(key => params[key as keyof typeof params] === undefined && delete params[key as keyof typeof params]);

        const response = await apiClient.get('/users/admin/users', { params });
        console.log("Raw listUsers response data:", response.data); // Log the raw structure
        // Assuming backend returns { success: true, data: [...], pagination: {...} }
        return {
            data: response.data.data,
            pagination: response.data.pagination // Match backend response structure
        };
    } catch (error) {
        console.error('Failed to list users:', error);
        if (axios.isAxiosError(error) && error.response) {
            throw new Error(error.response.data?.message || 'Failed to fetch users');
        }
        throw new Error('Failed to fetch users');
    }
};

export const exportUnpaidInitialUsers = async (): Promise<Blob> => {
    try {
        const response = await apiClient.get('/users/admin/users/unpaid-initial', {
            responseType: 'blob', // Important for file download
        });
        return response.data;
    } catch (error) {
        console.error('Failed to export users:', error);
        if (axios.isAxiosError(error) && error.response) {
            // Try to read error message from blob if possible, otherwise generic
            try {
                const errJson = JSON.parse(await error.response.data.text());
                throw new Error(errJson.message || 'Failed to export users');
            } catch (parseError) {
                throw new Error('Failed to export users and parse error response.');
            }
        }
        throw new Error('Failed to export users');
    }
};

export const getUserDetails = async (userId: string): Promise<AdminUserData> => {
    try {
        const response = await apiClient.get(`/users/admin/users/${userId}`);
        return response.data.data; // Assuming { success: true, data: {...} }
    } catch (error) {
        console.error(`Failed to get user details for ${userId}:`, error);
        if (axios.isAxiosError(error) && error.response) {
            throw new Error(error.response.data?.message || 'Failed to fetch user details');
        }
        throw new Error('Failed to fetch user details');
    }
};

// Note: updateData should only contain fields the backend allows updating
export const updateUser = async (userId: string, updateData: Partial<AdminUserData>): Promise<AdminUserData> => {
    try {
        const response = await apiClient.put(`/admin/users/${userId}`, updateData);
        return response.data.data; // Assuming { success: true, data: {...} }
    } catch (error) {
        console.error(`Failed to update user ${userId}:`, error);
        if (axios.isAxiosError(error) && error.response) {
            throw new Error(error.response.data?.message || 'Failed to update user');
        }
        throw new Error('Failed to update user');
    }
};

export const blockUser = async (userId: string): Promise<void> => {
    try {
        await apiClient.patch(`/admin/users/${userId}/block`);
        // Assuming { success: true, message: '...' }
    } catch (error) {
        console.error(`Failed to block user ${userId}:`, error);
        if (axios.isAxiosError(error) && error.response) {
            throw new Error(error.response.data?.message || 'Failed to block user');
        }
        throw new Error('Failed to block user');
    }
};

export const unblockUser = async (userId: string): Promise<void> => {
    try {
        await apiClient.patch(`/admin/users/${userId}/unblock`);
    } catch (error) {
        console.error(`Failed to unblock user ${userId}:`, error);
        if (axios.isAxiosError(error) && error.response) {
            throw new Error(error.response.data?.message || 'Failed to unblock user');
        }
        throw new Error('Failed to unblock user');
    }
};

export const deleteUser = async (userId: string): Promise<void> => {
    try {
        await apiClient.delete(`/admin/users/${userId}`);
    } catch (error) {
        console.error(`Failed to delete user ${userId}:`, error);
        if (axios.isAxiosError(error) && error.response) {
            throw new Error(error.response.data?.message || 'Failed to delete user');
        }
        throw new Error('Failed to delete user');
    }
};

export const restoreUser = async (userId: string): Promise<void> => {
    try {
        await apiClient.patch(`/admin/users/${userId}/restore`);
    } catch (error) {
        console.error(`Failed to restore user ${userId}:`, error);
        if (axios.isAxiosError(error) && error.response) {
            throw new Error(error.response.data?.message || 'Failed to restore user');
        }
        throw new Error('Failed to restore user');
    }
};

export const adjustBalance = async (userId: string, payload: AdjustBalancePayload): Promise<void> => {
    try {
        // Assuming backend returns the updated user or just success
        await apiClient.post(`/admin/users/${userId}/adjust-balance`, payload);
    } catch (error) {
        console.error(`Failed to adjust balance for user ${userId}:`, error);
        if (axios.isAxiosError(error) && error.response) {
            throw new Error(error.response.data?.message || 'Failed to adjust balance');
        }
        throw new Error('Failed to adjust balance');
    }
};

// Define the expected structure of the raw Axios response for stats
interface RawStatsApiResponse<T> {
    success: boolean;
    data: T;
    message?: string;
}

export const getUserSummaryStats = async (): Promise<UserSummaryStats> => {
    // log.info('Fetching user summary stats'); // Removed log
    try {
        const response = await apiClient.get<RawStatsApiResponse<UserSummaryStats>>('/users/admin/stats/user-summary');
        // log.debug('Raw summary stats response:', response.data); // Removed log

        if (response.data && response.data.success === true && response.data.data) {
            return response.data.data;
        } else {
            throw new Error(response.data?.message || 'Failed to fetch summary stats: Invalid response structure');
        }
    } catch (error) {
        // log.error('Failed to fetch user summary stats:', error); // Removed log
        // Re-log error in component if needed
        console.error('API Error fetching user summary stats:', error);
        if (axios.isAxiosError(error) && error.response) {
            throw new Error(error.response.data?.message || 'Failed to fetch user summary stats');
        } else if (error instanceof Error) {
            throw error;
        }
        throw new Error('Failed to fetch user summary stats due to an unknown error.');
    }
};

// Replace placeholder with actual API call
export const adminUpdateUserSubscription = async (userId: string, subscriptionType: SubscriptionType | 'NONE'): Promise<void> => {
    console.log(`API CALL: Update subscription for ${userId} to ${subscriptionType}`);
    try {
        // Make PATCH request to the new endpoint
        const response = await apiClient.patch<RawStatsApiResponse<null>>(`/admin/users/${userId}/subscription`, { type: subscriptionType });

        if (response.data && response.data.success === true) {
            console.log(`API CALL: Successfully updated subscription for ${userId}`);
            // Optionally return message or data if backend sends it
            // return response.data.message;
        } else {
            throw new Error(response.data?.message || 'Failed to update subscription: Invalid response structure');
        }
    } catch (error) {
        console.error('API Error updating subscription:', error);
        if (axios.isAxiosError(error) && error.response) {
            throw new Error(error.response.data?.message || 'Failed to update subscription');
        } else if (error instanceof Error) {
            throw error;
        }
        throw new Error('Failed to update subscription due to an unknown error.');
    }
};

// Add functions for getUserSubscriptions, getBalanceByCountryStats, getMonthlyActivity later if needed
// export const getUserSubscriptions = async (userId: string): Promise<any> => { ... };
// export const getBalanceByCountryStats = async (): Promise<any> => { ... };
// export const getMonthlyActivity = async (months?: number): Promise<any> => { ... };

// --- Partner Management Functions ---

export const setUserAsPartner = async (userId: string, pack: 'silver' | 'gold'): Promise<void> => {
    try {
        await apiClient.post('/users/admin/partners/set-user-partner', { userId, pack });
    } catch (error) {
        console.error(`Failed to set user ${userId} as partner with pack ${pack}:`, error);
        if (axios.isAxiosError(error) && error.response) {
            throw new Error(error.response.data?.message || 'Failed to set user as partner');
        }
        throw new Error('Failed to set user as partner');
    }
};

export const deactivatePartner = async (userId: string): Promise<void> => {
    try {
        await apiClient.patch(`/users/admin/partners/${userId}/deactivate`);
    } catch (error) {
        console.error(`Failed to deactivate partner status for user ${userId}:`, error);
        if (axios.isAxiosError(error) && error.response) {
            throw new Error(error.response.data?.message || 'Failed to deactivate partner');
        }
        throw new Error('Failed to deactivate partner');
    }
};

export const adminUpdateUserPartner = async (userId: string, partnerPack: 'silver' | 'gold' | 'none'): Promise<void> => {
    try {
        if (partnerPack === 'none') {
            await deactivatePartner(userId);
        } else {
            await setUserAsPartner(userId, partnerPack as 'silver' | 'gold');
        }
    } catch (error) {
        console.error(`Failed to update partner status for user ${userId}:`, error);
        throw error;
    }
};

export const listPartners = async (
    pagination: PaginationOptions = { page: 1, limit: 10 }
): Promise<PartnerListResponse> => {
    try {
        const params = {
            page: pagination.page,
            limit: pagination.limit,
        };

        const response = await apiClient.get('/users/admin/partners', { params });
        return {
            data: response.data.data,
            pagination: response.data.pagination
        };
    } catch (error) {
        console.error('Failed to list partners:', error);
        if (axios.isAxiosError(error) && error.response) {
            throw new Error(error.response.data?.message || 'Failed to fetch partners');
        }
        throw new Error('Failed to fetch partners');
    }
};

export const getPartnerSummary = async (): Promise<PartnerSummaryData> => {
    const response = await apiClient.get<{ success: boolean, data: PartnerSummaryData }>('/users/admin/partners/summary'); // Adjust base URL if needed
    if (response.data.success) {
        return response.data.data;
    } else {
        throw new Error('Failed to fetch partner summary');
    }
};

