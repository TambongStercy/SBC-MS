import apiClient from './apiClient';

// Fetch All Tombolas
export const fetchAllTombolas = async (page: number = 1, limit: number = 10) => {
    const response = await apiClient.get('/tombolas/admin', {
        params: { page, limit }
    });
    return response.data;
};

// Get Tombola Details
export const getTombolaDetails = async (tombolaId: string) => {
    const response = await apiClient.get(`/tombolas/admin/${tombolaId}`);
    return response.data;
};

// Create New Tombola Month
export const createTombola = async (data: { month: string; year: number; prize: number; ticketPrice?: number }) => {
    const response = await apiClient.post('/tombolas/admin', data);
    return response.data;
};

// Perform Draw for a Tombola Month
export const performDraw = async (tombolaId: string) => {
    const response = await apiClient.post(`/tombolas/admin/${tombolaId}/draw`);
    return response.data;
};

// Update Tombola Status
export const updateTombolaStatus = async (tombolaId: string, status: string) => {
    const response = await apiClient.patch(`/tombolas/admin/${tombolaId}/status`, { status });
    return response.data;
};

// List Tickets for a Tombola Month
export const listTicketsForMonth = async (tombolaId: string, page: number = 1, limit: number = 10) => {
    const response = await apiClient.get(`/tombolas/admin/${tombolaId}/tickets`, {
        params: { page, limit }
    });
    return response.data;
};

// Get Tombola Statistics
export const getTombolaStats = async () => {
    const response = await apiClient.get('/tombolas/admin/stats');
    return response.data;
};
