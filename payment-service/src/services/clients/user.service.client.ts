import axios from 'axios';
import { Types } from 'mongoose';
import config from '../../config';
import logger from '../../utils/logger';
import { AppError } from '../../utils/errors';

const log = logger.getLogger('UserServiceClient');

// Define and export the UserDetails interface needed by PaymentService
export interface UserDetails {
    _id: string | Types.ObjectId;
    name: string;
    email: string;
    phoneNumber?: string | number;
    // Add other common fields that user-service might return for a user
    country?: string;
    region?: string;
    city?: string;
    // Ensure all fields used by PaymentService are included here
}

export interface UserDetailsWithMomo extends UserDetails {
    momoNumber?: string;
    momoOperator?: string;
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

    constructor() {
        if (!this.baseUrl) {
            log.error('User service URL not configured (USER_SERVICE_URL).');
            // Potentially throw an error or operate in a degraded mode
        }
    }

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
                if (response.data.data !== undefined) {
                    return response.data.data;
                } else {
                    log.warn(`User Service request successful for ${path} but response data payload is missing.`);
                    throw new Error('User Service response missing expected data payload');
                }
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

    async getUserDetails(userId: string): Promise<UserDetails | null> {
        if (!this.baseUrl) {
            log.error('Cannot get user details: User service URL not configured.');
            throw new AppError('User service is not configured.', 503);
        }
        try {
            log.debug(`Fetching user details for userId: ${userId} from ${this.baseUrl}/internal/${userId}/validate`);
            const response = await axios.get(`${this.baseUrl}/internal/${userId}/validate`, {
                headers: {
                    'Authorization': `Bearer ${config.services.serviceSecret}`, // Internal service auth
                    'Content-Type': 'application/json',
                    'X-Service-Name': 'payment-service'
                },
                timeout: 5000
            });

            if (response.status === 200 && response.data && response.data.success) {
                // Assuming the user data is in response.data.data
                log.info(`Successfully fetched user details for userId: ${userId}`);
                return response.data.data as UserDetails; // Adjust based on actual response structure
            } else if (response.status === 404) {
                log.warn(`User not found in user-service for ID: ${userId}`);
                return null;
            } else {
                log.error(`Failed to fetch user details for userId ${userId}: Status ${response.status}`, response.data);
                return null; // Or throw an error based on how critical this is
            }
        } catch (error: any) {
            log.error(`Error calling user service for details of user ${userId}:`, error.response?.data || error.message);
            // Consider throwing an AppError for better handling upstream
            if (error.response?.status === 404) {
                return null;
            }
            throw new AppError(`Failed to communicate with user service for user details.`, error.response?.status || 503);
        }
    }

    async getUserDetailsWithMomo(userId: string): Promise<UserDetailsWithMomo | null> {
        if (!this.baseUrl) {
            log.error('Cannot get user details with momo: User service URL not configured.');
            throw new AppError('User service is not configured.', 503);
        }
        try {
            // Assuming there's an endpoint in user-service that returns momo details
            // For now, let's use the /me equivalent or /:userId if available and includes momo details
            // This might need a new specific internal endpoint in user-service like /internal/:userId/momo-details
            log.debug(`Fetching user details with momo for userId: ${userId} from user-service`);

            // Placeholder: Using /validate and assuming it might contain momo details
            // In a real scenario, this would be a dedicated endpoint or the /me route (if internal call is structured for it)
            const response = await axios.get(`${this.baseUrl}/internal/${userId}/validate`, { // ADJUST THIS ENDPOINT
                headers: {
                    'Authorization': `Bearer ${config.services.serviceSecret}`,
                    'Content-Type': 'application/json',
                    'X-Service-Name': 'payment-service'
                },
                timeout: 5000
            });

            if (response.status === 200 && response.data && response.data.success && response.data.data) {
                // Ensure the data structure matches UserDetailsWithMomo
                const userData = response.data.data;
                if (typeof userData.momoNumber !== 'undefined' && typeof userData.momoOperator !== 'undefined') {
                    log.info(`Successfully fetched user details with momo for userId: ${userId}`);
                    return userData as UserDetailsWithMomo;
                } else {
                    log.warn(`User ${userId} details fetched, but momoNumber or momoOperator is missing.`);
                    return userData as UserDetailsWithMomo; // Return even if momo is missing, service logic handles it
                }
            } else if (response.status === 404) {
                log.warn(`User not found in user-service for ID (momo details): ${userId}`);
                return null;
            } else {
                log.error(`Failed to fetch user (momo) details for userId ${userId}: Status ${response.status}`, response.data);
                return null;
            }
        } catch (error: any) {
            log.error(`Error calling user service for (momo) details of user ${userId}:`, error.response?.data || error.message);
            if (error.response?.status === 404) {
                return null;
            }
            throw new AppError(`Failed to communicate with user service for momo details.`, error.response?.status || 503);
        }
    }

    async updateUserBalance(userId: string, amount: number): Promise<void> {
        if (!this.baseUrl) {
            log.error('Cannot update user balance: User service URL not configured.');
            throw new AppError('User service is not configured.', 503);
        }
        try {
            log.info(`Updating balance for user ${userId} by ${amount} via user-service.`);
            const response = await axios.post(`${this.baseUrl}/internal/${userId}/balance`,
                { amount },
                {
                    headers: {
                        'Authorization': `Bearer ${config.services.serviceSecret}`,
                        'Content-Type': 'application/json',
                        'X-Service-Name': 'payment-service'
                    },
                    timeout: 7000 // Increased timeout for potentially critical operations
                }
            );

            if (response.status === 200 && response.data && response.data.success) {
                log.info(`Successfully updated balance for user ${userId}. New balance: ${response.data.data?.newBalance}`);
            } else {
                log.error(`Failed to update balance for user ${userId}: Status ${response.status}`, response.data);
                throw new AppError(response.data?.message || 'Failed to update user balance via user-service.', response.status || 500);
            }
        } catch (error: any) {
            log.error(`Error calling user-service to update balance for user ${userId}:`, error.response?.data || error.message);
            const errorMessage = error.response?.data?.message || 'Failed to communicate with user service for balance update.';
            const errorStatus = error.response?.status || 503;
            throw new AppError(errorMessage, errorStatus);
        }
    }

    async getBalance(userId: string): Promise<number> {
        if (!this.baseUrl) {
            log.error('Cannot get user balance: User service URL not configured.');
            throw new AppError('User service is not configured.', 503);
        }
        try {
            log.debug(`Fetching balance for user ${userId} from user-service.`);
            const response = await axios.get(`${this.baseUrl}/internal/${userId}/balance`, {
                headers: {
                    'Authorization': `Bearer ${config.services.serviceSecret}`,
                    'Content-Type': 'application/json',
                    'X-Service-Name': 'payment-service'
                },
                timeout: 5000
            });
            if (response.status === 200 && response.data && response.data.success && typeof response.data.data?.balance === 'number') {
                log.info(`Successfully fetched balance for user ${userId}: ${response.data.data.balance}`);
                return response.data.data.balance;
            } else {
                log.error(`Failed to fetch balance for user ${userId}: Status ${response.status}`, response.data);
                throw new AppError(response.data?.message || 'Failed to fetch user balance from user-service.', response.status || 500);
            }
        } catch (error: any) {
            log.error(`Error calling user-service for balance of user ${userId}:`, error.response?.data || error.message);
            const errorMessage = error.response?.data?.message || 'Failed to communicate with user service for balance.';
            const errorStatus = error.response?.status || 503;
            throw new AppError(errorMessage, errorStatus);
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
        if (!this.baseUrl) {
            log.error('Cannot get user details by IDs: User service URL not configured.');
            throw new AppError('User service is not configured.', 503);
        }
        if (!userIds || userIds.length === 0) {
            return [];
        }
        try {
            log.debug(`Fetching details for ${userIds.length} users from user-service.`);
            const response = await axios.post(`${this.baseUrl}/internal/batch-details`,
                { userIds },
                {
                    headers: {
                        'Authorization': `Bearer ${config.services.serviceSecret}`,
                        'Content-Type': 'application/json',
                        'X-Service-Name': 'payment-service'
                    },
                    timeout: 10000 // Potentially longer for batch operations
                }
            );

            if (response.status === 200 && response.data && response.data.success) {
                log.info(`Successfully fetched details for ${response.data.data?.length || 0} users.`);
                return response.data.data as UserDetails[];
            } else {
                log.error(`Failed to fetch batch user details: Status ${response.status}`, response.data);
                throw new AppError(response.data?.message || 'Failed to fetch batch user details from user-service.', response.status || 500);
            }
        } catch (error: any) {
            log.error(`Error calling user-service for batch user details:`, error.response?.data || error.message);
            const errorMessage = error.response?.data?.message || 'Failed to communicate with user service for batch user details.';
            const errorStatus = error.response?.status || 503;
            throw new AppError(errorMessage, errorStatus);
        }
    }

    // --- NEW METHOD: Find User IDs by Search Term ---
    async findUserIdsBySearchTerm(searchTerm: string): Promise<string[] | null> {
        if (!this.baseUrl) {
            log.error('Cannot search user IDs: User service URL not configured.');
            throw new AppError('User service is not configured.', 503);
        }
        try {
            log.debug(`Searching for user IDs with term: "${searchTerm}" in user-service.`);
            const response = await axios.get(`${this.baseUrl}/internal/search-ids`, {
                params: { term: searchTerm },
                headers: {
                    'Authorization': `Bearer ${config.services.serviceSecret}`,
                    'Content-Type': 'application/json',
                    'X-Service-Name': 'payment-service'
                },
                timeout: 7000
            });

            if (response.status === 200 && response.data && response.data.success) {
                log.info(`Successfully found ${response.data.data?.length || 0} user IDs for term "${searchTerm}".`);
                return response.data.data as string[]; // Assuming data is an array of string IDs
            } else {
                log.warn(`User ID search failed or returned no results for term "${searchTerm}": Status ${response.status}`, response.data);
                return null;
            }
        } catch (error: any) {
            log.error(`Error calling user-service for user ID search (term: "${searchTerm}"):`, error.response?.data || error.message);
            throw new AppError(`Failed to communicate with user service for user ID search.`, error.response?.status || 503);
        }
    }
}

export const userServiceClient = new UserServiceClient(); 