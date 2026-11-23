import axios from 'axios';
import { toast } from 'sonner';
import { isGatewayAccessRefusal } from '../lib/permissions';
import { isAdminCodeError, requestAdminCode } from '../lib/adminCodePrompt';
import { attachSigning } from '../lib/signAxios';

declare module 'axios' {
    interface AxiosRequestConfig { __adminCodeTries?: number }
}

// Create an Axios instance with default configurations
const apiClient = axios.create({
    baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000/api', // Fallback to gateway service
    headers: {
        'Content-Type': 'application/json', // Default content type for requests
    },
});

// Security plan Phase 9: registered first so it runs after the token interceptor below.
attachSigning(apiClient);

// Add request interceptor for handling authentication
apiClient.interceptors.request.use(
    (config) => {
        // Get the token from localStorage
        const token = localStorage.getItem('adminToken');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => {
        console.error('Request interceptor error:', error);
        return Promise.reject(error);
    }
);

const isUserServiceUrl = (url?: string) => /^\/?users(\/|$|\?)/.test(url || '');

/**
 * Only user-service decides that the admin's session is over. A 401 from any
 * other service (sbclove-service running with a different JWT_SECRET did this
 * on prod) used to sign the admin out of the whole panel the moment the page
 * opened; now the token is checked with user-service first, and if it is still
 * good the page just shows its own error.
 */
const sessionStillValid = async (): Promise<boolean> => {
    const token = localStorage.getItem('adminToken');
    if (!token) return false;
    try {
        // An admin path: it checks the admin session (authenticator sign-in), not just the token.
        await axios.get(`${apiClient.defaults.baseURL}/users/admin/me/access`, { headers: { Authorization: `Bearer ${token}` } });
        return true;
    } catch {
        return false;
    }
};

// Add response interceptor to handle global errors
apiClient.interceptors.response.use(
    response => response,
    async error => {
        if (error.response) {
            console.error('API Error Response:', error.config?.url, error.response.status, error.response.data);

            // A money action needs the admin's own authenticator code (Security plan Phase 3 item 6):
            // ask for it, then send the same request again with it (at most 3 tries).
            if (isAdminCodeError(error.response.status, error.response.data) && error.config && (error.config.__adminCodeTries ?? 0) < 3) {
                const answer = await requestAdminCode(error.response.data?.code === 'ADMIN_CODE_INVALID' ? error.response.data.message : undefined);
                if (answer) {
                    let body: Record<string, unknown> = {};
                    try { body = typeof error.config.data === 'string' && error.config.data ? JSON.parse(error.config.data) : (error.config.data ?? {}); } catch { body = {}; }
                    // a previous try's code is replaced, never sent alongside the new one
                    delete body.adminCode;
                    delete body.adminBackupCode;
                    return apiClient.request({ ...error.config, data: { ...body, ...answer }, __adminCodeTries: (error.config.__adminCodeTries ?? 0) + 1 } as typeof error.config);
                }
                return Promise.reject(error);
            }

            // A module this account may only read (or not see): say so, stay signed in.
            // One toast at a time, however many calls the page made.
            if (isGatewayAccessRefusal(error.response.status, error.response.data)) {
                toast.error(error.response.data.message, { id: 'admin-module-refused', duration: 5000 });
                return Promise.reject(error);
            }

            // The gateway or user-service says the admin session itself is over (sign-out,
            // 30 min idle, 12 h, reset): back to the sign-in, whatever service answered.
            const sessionEnded = error.response.data?.code === 'ADMIN_SESSION_ENDED';
            if (error.response.status === 401 && !sessionEnded && !isUserServiceUrl(error.config?.url) && await sessionStillValid()) {
                console.error('401 from a service other than user-service while the session is valid:', error.config?.url);
                return Promise.reject(error);
            }

            // Handle unauthorized access — clear creds, redirect cleanly to /login.
            // We return a non-resolving promise so downstream `.catch()` handlers in
            // pages don't fire and flash an "Error loading data" UI before the
            // browser navigation completes.
            if (error.response.status === 401) {
                console.error('Authentication error:', error.response.data);
                localStorage.removeItem('adminToken');
                localStorage.removeItem('adminUser');
                if (window.location.pathname !== '/login') {
                    console.log('Redirecting to login page due to 401 error');
                    window.location.href = '/login';
                }
                return new Promise(() => { /* never resolves — caller stays in loading state until redirect */ });
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
