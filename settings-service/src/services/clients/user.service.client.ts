import axios from 'axios';
import config from '../../config';
import logger from '../../utils/logger';

const log = logger.getLogger('UserServiceClient(for Settings)');

interface ApiResponse<T> {
    success: boolean;
    data: T;
    message?: string;
}

class UserServiceClient {
    private apiClient = axios.create({
        baseURL: config.services.userService,
        timeout: 8000,
        headers: {
            'Content-Type': 'application/json',
            'X-Internal-Service': 'settings-service',
            'Authorization': `Bearer ${config.services.serviceSecret}`
        }
    });

    constructor() {
        log.info(`User service client initialized. Base URL: ${config.services.userService}`);
    }

    async getActiveSubscriptionTypes(userId: string): Promise<string[]> {
        try {
            const response = await this.apiClient.get<ApiResponse<string[]>>(`/users/internal/${userId}/active-subscription-types`);
            return response.data.success && Array.isArray(response.data.data) ? response.data.data : [];
        } catch (error: any) {
            log.warn(`Failed to fetch active subscription types for user ${userId}: ${error.message}`);
            return [];
        }
    }
}

export default new UserServiceClient();
