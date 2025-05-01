import apiClient from './apiClient';

// Fetch All Advertisements
export const fetchAllAdvertisements = async (page: number = 1, limit: number = 10, status?: string) => {
    const params: any = { page, limit };
    if (status) {
        params.status = status;
    }
    const response = await apiClient.get('/advertising', { params });
    return response.data;
};

// Get Advertisement Details
export const getAdvertisementDetails = async (adId: string) => {
    const response = await apiClient.get(`/advertising/${adId}`);
    return response.data;
};

// Create Advertisement
export const createAdvertisement = async (data: any, image: File) => {
    const formData = new FormData();
    
    // Add all data fields to formData
    Object.keys(data).forEach(key => {
        formData.append(key, data[key]);
    });
    
    // Add image
    formData.append('image', image);
    
    const response = await apiClient.post('/advertising', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
    });
    return response.data;
};

// Update Advertisement
export const updateAdvertisement = async (adId: string, data: any, image?: File) => {
    const formData = new FormData();
    
    // Add all data fields to formData
    Object.keys(data).forEach(key => {
        formData.append(key, data[key]);
    });
    
    // Add image if provided
    if (image) {
        formData.append('image', image);
    }
    
    const response = await apiClient.put(`/advertising/${adId}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
    });
    return response.data;
};

// Delete Advertisement
export const deleteAdvertisement = async (adId: string) => {
    const response = await apiClient.delete(`/advertising/${adId}`);
    return response.data;
};

// Approve Advertisement
export const approveAdvertisement = async (adId: string) => {
    const response = await apiClient.patch(`/advertising/${adId}/approve`);
    return response.data;
};

// Reject Advertisement
export const rejectAdvertisement = async (adId: string, reason: string) => {
    const response = await apiClient.patch(`/advertising/${adId}/reject`, { reason });
    return response.data;
};

// Get Advertising Statistics
export const getAdvertisingStats = async () => {
    const response = await apiClient.get('/advertising/stats');
    return response.data;
};
