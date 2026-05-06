import apiClient from '../api/apiClient';

export interface UserAnalyticsEntry {
    userId: string;
    name: string;
    email: string;
    phoneNumber: string;
    country: string;
    balance: number;
    totalWithdrawn: number;
    totalEarned: number;
    withdrawalCount: number;
    earningCount: number;
    total: number;
}

export interface UserAnalyticsFilters {
    country?: string;
    minAmount?: number;
    page?: number;
    limit?: number;
    sortBy?: 'totalWithdrawn' | 'totalEarned' | 'total';
    sortOrder?: 'asc' | 'desc';
}

export interface UserAnalyticsResponse {
    success: boolean;
    data: UserAnalyticsEntry[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}

export async function getUserFinancialAnalytics(filters: UserAnalyticsFilters): Promise<UserAnalyticsResponse> {
    const response = await apiClient.get('/transactions/admin/user-analytics', { params: filters });
    return response.data;
}
