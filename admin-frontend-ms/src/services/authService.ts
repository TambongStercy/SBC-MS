import apiClient from './api';

// Define the expected response structure from the backend
interface AdminLoginResponse {
    success: boolean;
    message: string;
    data?: {
        token: string;
        user: { // Define the expected user fields
            _id: string;
            name: string;
            email: string;
            role: string;
            // Add other relevant user fields
        };
    };
}

const loginAdmin = async (email: string, password: string): Promise<AdminLoginResponse> => {
    try {
        console.log('Sending admin login request to:', `${apiClient.defaults.baseURL}/admin/login`);

        const response = await apiClient.post<AdminLoginResponse>('/admin/login', {
            email,
            password,
        });

        console.log('Login response:', {
            success: response.data.success,
            hasToken: !!response.data.data?.token,
            userRole: response.data.data?.user.role
        });

        return response.data;
    } catch (error: any) {
        console.error('Admin login API error:', error.response?.data || error.message);
        return {
            success: false,
            message: error.response?.data?.message || 'Login failed. Please try again.',
        };
    }
};

// Check if the user is currently authenticated
const checkAuth = async (): Promise<boolean> => {
    try {
        // Call a simple admin endpoint to verify the token works
        // Using '/admin/users' with limit 1 as a stable endpoint for auth check
        const response = await apiClient.get('/admin/users', { params: { limit: 1 } });
        return response.status === 200;
    } catch (error: any) {
        console.error('Auth check failed:', error.response?.data || error.message);
        // If it's a 401, that specifically means the token is invalid/missing
        if (error.response?.status === 401) {
            console.warn('Auth check failed specifically due to 401.');
        }
        return false;
    }
};

// Logout function to clear stored credentials
const logout = (): void => {
    console.log('Logging out and clearing admin credentials...');
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminUser');
    // Redirect to login page after clearing credentials
    window.location.href = '/login';
};

export const authService = {
    loginAdmin,
    checkAuth,
    logout
}; 