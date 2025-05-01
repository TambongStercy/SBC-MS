import axios from 'axios';
import config from '../config';
import logger from '../utils/logger';

const log = logger.getLogger('UserServiceClient');

// Define and export the UserDetails interface needed by PaymentService
export interface UserDetails {
    _id: string;
    name: string;
    phoneNumber?: number; // Add phoneNumber (assuming it's number in user-service)
    // Add other fields if needed later (e.g., email)
}

interface ReferrerIds {
    level1?: string;
    level2?: string;
    level3?: string;
}

interface WithdrawalLimitCheckResponse {
    allowed: boolean;
    reason?: string;
    dailyLimit?: number;
    dailyRemaining?: number;
}

interface UserValidationResponse {
    valid: boolean;
}

class UserServiceClient {
    private baseUrl = config.services.userServiceUrl;
    private serviceSecret = config.services.serviceSecret;

    private async request<T>(method: 'get' | 'post' | 'put' | 'delete', path: string, data?: any): Promise<T> {
        const url = `${this.baseUrl}${path}`;
        log.debug(`Making ${method.toUpperCase()} request to User Service: ${url}`, data);
        try {
            const headers: { [key: string]: string } = {};
            if (this.serviceSecret) {
                headers['Authorization'] = `Bearer ${this.serviceSecret}`;
            }
            headers['x-service-name'] = 'payment-service';

            const response = await axios({
                method,
                url,
                data,
                headers
            });

            if (response.data && (response.data.success === true || response.status < 300)) {
                log.debug(`User Service request successful for ${path}`);
                return response.data.data !== undefined ? response.data.data : { success: true };
            } else {
                log.warn(`User Service request failed or returned unsuccessful status for ${path}:`, response.data);
                throw new Error(response.data?.message || 'User Service request failed');
            }
        } catch (error: any) {
            log.error(`Error calling User Service at ${url}:`, error.response?.data || error.message);
            const errorMessage = error.response?.data?.message || error.message || 'User Service communication error';
            throw new Error(errorMessage);
        }
    }

    async updateUserBalance(userId: string, amountChange: number): Promise<{ balance: number } | null> {
        try {
            const path = `/users/internal/${userId}/balance`;
            const response = await this.request<{ balance: number }>('post', path, { amount: amountChange });
            return response;
        } catch (error) {
            log.error(`Failed to update balance for user ${userId} via User Service:`, error);
            return null;
        }
    }

    async activateSubscription(userId: string, type: string, planIdentifier: string): Promise<any | null> {
        try {
            const path = '/subscriptions/internal/activate';
            const response = await this.request<any>('post', path, {
                userId,
                subscriptionType: type,
                planIdentifier
            });
            return response;
        } catch (error) {
            log.error(`Failed to activate subscription for user ${userId} via User Service:`, error);
            return null;
        }
    }

    async getReferrerIds(userId: string): Promise<ReferrerIds | null> {
        try {
            const path = `/users/internal/${userId}/referrers`;
            const response = await this.request<ReferrerIds>('get', path);
            return response;
        } catch (error) {
            log.error(`Failed to get referrer IDs for user ${userId} from User Service:`, error);
            return null;
        }
    }

    async getBalance(userId: string): Promise<number> {
        try {
            const path = `/users/internal/${userId}/balance`;
            const response = await this.request<{ balance: number }>('get', path);
            return response.balance;
        } catch (error) {
            log.error(`Failed to get balance for user ${userId} from User Service:`, error);
            throw new Error(`Could not retrieve balance for user ${userId}`);
        }
    }

    async validateUser(userId: string): Promise<boolean> {
        try {
            const path = `/users/internal/${userId}/validate`;
            const response = await this.request<UserValidationResponse>('get', path);
            return response.valid;
        } catch (error) {
            log.error(`Failed to validate user ${userId} via User Service:`, error);
            return false;
        }
    }

    async checkWithdrawalLimits(userId: string, amount: number): Promise<WithdrawalLimitCheckResponse> {
        try {
            const path = `/users/internal/${userId}/withdrawal-limits/check`;
            const response = await this.request<WithdrawalLimitCheckResponse>('post', path, { amount });
            return response;
        } catch (error) {
            log.error(`Failed to check withdrawal limits for user ${userId} via User Service:`, error);
            return { allowed: false, reason: 'Error communicating with User Service' };
        }
    }

    // --- NEW METHOD: Get User Details by IDs ---
    async getUsersByIds(userIds: string[]): Promise<UserDetails[]> {
        if (!userIds || userIds.length === 0) {
            return [];
        }
        try {
            // Correct path based on user-service routes
            const path = '/users/internal/batch-details';
            log.debug(`Requesting user details for ${userIds.length} users from User Service.`);
            // Assuming the user-service endpoint returns { success: true, data: UserDetails[] }
            const response = await this.request<UserDetails[]>('post', path, { userIds });
            // Adjust response handling if user-service wraps the array differently (e.g., in a `users` key)
            return response || []; // Directly return the array if data is the array itself
        } catch (error) {
            log.error(`Failed to get details for users ${userIds.join(', ')} from User Service:`, error);
            // Decide whether to throw or return empty array on error
            // Returning empty might be safer for enrichment purposes
            return [];
        }
    }

    // --- NEW METHOD: Find User IDs by Search Term ---
    async findUserIdsBySearchTerm(searchTerm: string): Promise<string[]> {
        if (!searchTerm || searchTerm.trim() === '') {
            return [];
        }
        try {
            // Assumes user-service has endpoint GET /users/internal/search-ids?q=<term>
            const path = '/users/internal/search-ids';
            log.debug(`Searching user IDs for term "${searchTerm}" in User Service.`);
            // Assuming response is { success: true, data: { userIds: [...] } }
            const response = await this.request<{ userIds: string[] }>('get', path, { params: { q: searchTerm.trim() } });
            return response.userIds || [];
        } catch (error) {
            log.error(`Failed to find user IDs for search term "${searchTerm}" from User Service:`, error);
            return []; // Return empty on error
        }
    }
}

export const userServiceClient = new UserServiceClient(); 