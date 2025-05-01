import apiClient from './apiClient';

// Admin Sign In
export const signInAdmin = async (email: string, password: string) => {
    try {
        console.log('Attempting login with:', { email });
        const response = await apiClient.post('/login', { email, password });
        console.log('Raw login response:', response);

        // Return the data directly for more flexible handling in the component
        return response.data;
    } catch (error) {
        console.error('Error in signInAdmin:', error);
        throw error; // Re-throw to be handled by the component
    }
};

// Admin Logout
export const logoutAdmin = async () => {
    try {
        const response = await apiClient.post('/logout');

        // Clear stored credentials regardless of API response
        localStorage.removeItem('adminToken');
        localStorage.removeItem('adminUser');

        return response.data;
    } catch (error) {
        // Still clear stored credentials even if API call fails
        localStorage.removeItem('adminToken');
        localStorage.removeItem('adminUser');
        throw error;
    }
};

// Fetch Admin Dashboard Data
export const fetchDashboard = async () => {
    const response = await apiClient.get('/users/admin/dashboard');
    return response.data;
};

// Fetch Admin Balance
export const fetchAdminBalance = async () => {
    const response = await apiClient.get('/stats/balance');
    return response.data;
};

// Fetch Monthly Activity Stats
export const fetchMonthlyActivity = async (months: number = 6) => {
    const response = await apiClient.get('/stats/monthly-activity', {
        params: { months }
    });
    return response.data;
};

// Fetch Balance By Country Stats
export const fetchBalanceByCountry = async () => {
    const response = await apiClient.get('/stats/balance-by-country');
    return response.data;
};

// Fetch Recent Transactions (Admin)
export const fetchRecentTransactions = async (limit: number = 5) => {
    // Use the existing admin transaction list endpoint and sort by creation date
    const response = await apiClient.get('/payments/admin/transactions', {
        params: {
            limit,
            sortBy: 'createdAt',
            sortOrder: 'desc'
        }
    });
    // Assuming the response structure is { success: boolean, data: RecentTransaction[] }
    // The actual data might be nested under response.data.data if the endpoint returns pagination info
    if (response.data && response.data.success && response.data.data) {
        return response.data.data;
    } else {
        console.error("Failed to fetch recent transactions:", response.data?.message);
        return [];
    }
};

// Update Admin Links
export const updateAdminLinks = async (data: { whatsapp?: string; telegram?: string }) => {
    const response = await apiClient.put('/settings/links', data);
    return response.data;
};

// Update Whatsapp Link
export const updateWhatsappLink = async (whatsapp: string) => {
    const response = await apiClient.put('/settings/links/whatsapp', { whatsapp });
    return response.data;
};

// Update Telegram Link
export const updateTelegramLink = async (telegramLink: string) => {
    const response = await apiClient.put('/settings/links/telegram', { telegram: telegramLink });
    return response.data;
};