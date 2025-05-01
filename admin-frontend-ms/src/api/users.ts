import apiClient from './apiClient';

// Fetch Users with pagination and optional filtering
export const fetchUsers = async (name: string = '', page: number = 1, limit: number = 10, signal?: AbortSignal) => {
    const response = await apiClient.get('/users', {
        params: {
            name,
            page,
            limit
        },
        signal, // Attach the abort signal here
    });
    return response.data;
};

// Function to fetch user details by ID
export const fetchUserDetails = async (userId: string) => {
    try {
        const response = await apiClient.get(`/users/${userId}`);
        return response.data;
    } catch (error) {
        console.error("Error fetching user details:", error);
        throw error;
    }
};

// Modify User
export const modifyUser = async (userId: string, data: { name?: string; region?: string; phoneNumber?: string; subscribed?: boolean; pack?: string }) => {
    const response = await apiClient.put(`/users/${userId}`, data);
    return response.data;
};

// Block User
export const blockUser = async (userId: string) => {
    const response = await apiClient.patch(`/users/${userId}/block`);
    return response.data;
};

// Unblock User
export const unblockUser = async (userId: string) => {
    const response = await apiClient.patch(`/users/${userId}/unblock`);
    return response.data;
};

// Delete User (Soft Delete)
export const deleteUser = async (userId: string) => {
    const response = await apiClient.delete(`/users/${userId}`);
    return response.data;
};

// Restore User
export const restoreUser = async (userId: string) => {
    const response = await apiClient.patch(`/users/${userId}/restore`);
    return response.data;
};

// Adjust User Balance
export const adjustUserBalance = async (userId: string, amount: number, reason: string) => {
    const response = await apiClient.post(`/users/${userId}/adjust-balance`, { amount, reason });
    return response.data;
};

// Fetch User Subscriptions
export const fetchUserSubscriptions = async (userId: string) => {
    const response = await apiClient.get(`/users/${userId}/subscriptions`);
    return response.data;
};

// Note: Partner functionality has been removed in the current API version

// Fetch non-subscribed users
export const fetchNonSubscribedUsers = async () => {
    const response = await apiClient.get('/users/unpaid-initial');
    return response.data;
};

// Download non-subscribed users contacts
export const downloadNonSubContacts = async () => {
    const response = await apiClient.get('/users/unpaid-initial/export');
    return response.data;
};

// Fetch Users Summary Data
export const fetchUsersData = async () => {
    const response = await apiClient.get('/stats/users-summary');
    return response.data;
};