import apiClient from './apiClient';

// Fetch All Withdrawals
export const fetchAllWithdrawals = async (page: number = 1, limit: number = 10, filters?: any) => {
    const response = await apiClient.get('/withdrawals', {
        params: {
            page,
            limit,
            ...filters
        }
    });
    return response.data;
};

// Get Withdrawal Details
export const getWithdrawalDetails = async (withdrawalId: string) => {
    const response = await apiClient.get(`/withdrawals/${withdrawalId}`);
    return response.data;
};

// Admin Withdrawal (Self)
export const adminWithdrawal = async (data: { password: string; phone: string; amount: number; operator: string }) => {
    const response = await apiClient.post('/withdrawals/admin', data);
    return response.data;
};

// Process User Withdrawal (Admin initiates withdrawal for a user)
export const processUserWithdrawal = async (data: { userId: string; password: string; phone: string; amount: number; operator: string }) => {
    const response = await apiClient.post('/withdrawals/process', data);
    return response.data;
};

// Note: Partner withdrawal functionality has been removed as partners are no longer supported in the current API version

// Approve Withdrawal
export const approveWithdrawal = async (withdrawalId: string) => {
    const response = await apiClient.patch(`/withdrawals/${withdrawalId}/approve`);
    return response.data;
};

// Reject Withdrawal
export const rejectWithdrawal = async (withdrawalId: string, reason: string) => {
    const response = await apiClient.patch(`/withdrawals/${withdrawalId}/reject`, { reason });
    return response.data;
};

// Get Withdrawal Statistics
export const getWithdrawalStats = async () => {
    const response = await apiClient.get('/withdrawals/stats');
    return response.data;
};
