import axios from 'axios';

// Create an Axios instance with default configurations
const apiClient = axios.create({
    baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000/api', // Fallback to gateway service
    headers: {
        'Content-Type': 'application/json', // Default content type for requests
    },
});

// Add request interceptor for handling authentication
apiClient.interceptors.request.use(
    (config) => {
        // Get the token from localStorage
        const token = localStorage.getItem('adminToken');
        if (token) {
            console.log('Adding token to request:', config.url);
            config.headers.Authorization = `Bearer ${token}`;
        } else {
            console.log('No token available for request:', config.url);
        }
        return config;
    },
    (error) => {
        console.error('Request interceptor error:', error);
        return Promise.reject(error);
    }
);

// Add response interceptor to handle global errors
apiClient.interceptors.response.use(
    response => {
        console.log('API Response:', response.config.url, response.status, response.data);
        return response;
    },
    error => {
        if (error.response) {
            console.error('API Error Response:', error.config?.url, error.response.status, error.response.data);

            // Handle unauthorized access (e.g., redirect to login)
            if (error.response.status === 401) {
                console.error('Authentication error:', error.response.data);
                // Clear stored credentials on auth errors
                localStorage.removeItem('adminToken');
                localStorage.removeItem('adminUser');
                // Redirect to login page if not already there
                if (window.location.pathname !== '/login') {
                    console.log('Redirecting to login page due to 401 error');
                    window.location.href = '/login';
                }
            } else if (error.response.status >= 500) {
                console.error('Server error:', error.response.data);
            }
        } else if (error.request) {
            // The request was made but no response was received
            console.error('Network error - no response received:', error.config?.url, error.request);
        } else {
            // Something happened in setting up the request
            console.error('Request error:', error.message);
        }
        return Promise.reject(error);
    }
);

import { getAvatarUrl as getAvatarUrlUtil } from '../utils/fileUtils';

export const getAvatarUrl = (avatarId?: string | null): string => {
    if (!avatarId) return '';
    const baseUrl = apiClient.defaults.baseURL || '';
    return getAvatarUrlUtil(avatarId, `${baseUrl}/users/files`);
};

export default apiClient;
