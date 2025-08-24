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
    notificationPreference?: 'email' | 'whatsapp';
    language?: string[];
    // Add other common fields that user-service might return for a user
    country?: string;
    region?: string;
    city?: string;
    // Crypto wallet fields for crypto withdrawals
    cryptoWalletAddress?: string;
    cryptoWalletCurrency?: string;
    // Ensure all fields used by PaymentService are included here
}

export interface UserDetailsWithMomo extends UserDetails {
    momoNumber?: string;
    momoOperator?: string;
    cryptoWalletAddress?: string;
    cryptoWalletCurrency?: string;
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

// Locally define SubscriptionType to avoid direct dependency on user-service model
type SubscriptionType = 'CLASSIQUE' | 'CIBLE' | 'NONE';

class UserServiceClient {
    private baseUrl = config.services.userServiceUrl;
    private serviceSecret = config.services.serviceSecret;

    constructor() {
        if (!this.baseUrl) {
            log.error('User service URL not configured (USER_SERVICE_URL).');
            // Potentially throw an error or operate in a degraded mode
        }
    }

    private async request<T>(method: 'get' | 'post' | 'put' | 'delete', path: string, data?: any, params?: any): Promise<T> {
        const url = `${this.baseUrl}${path}`;
        log.debug(`Making ${method.toUpperCase()} request to User Service: ${url}`, { data, params });
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
                params,
                headers
            });

            if (response.status < 300 && response.data?.success !== false) {
                log.debug(`User Service request successful for ${path}`);
                return response.data;
            } else {
                log.warn(`User Service request failed or returned unsuccessful status for ${path}:`, response.data);
                throw new AppError(response.data?.message || 'User Service request failed', response.status || 500);
            }
        } catch (error: any) {
            log.error(`Error calling User Service at ${url}:`, error.response?.data || error.message);
            const errorMessage = error.response?.data?.message || error.message || 'User Service communication error';
            const errorStatus = error.response?.status;
            throw new AppError(errorMessage, errorStatus || 503);
        }
    }

    async getUserDetails(userId: string): Promise<UserDetails | null> {
        if (!this.baseUrl) {
            log.error('Cannot get user details: User service URL not configured.');
            throw new AppError('User service is not configured.', 503);
        }
        // Use the batch endpoint even for a single user
        const path = '/users/internal/batch-details';
        try {
            log.debug(`Fetching user details for userId: ${userId} via batch endpoint (request method)`);
            // Send userId in an array via POST body
            const response = await this.request<{ success: boolean; data: UserDetails[] } | null>('post', path, { userIds: [userId] });

            if (response?.success && Array.isArray(response.data) && response.data.length > 0) {
                log.info(`Successfully fetched user details for userId: ${userId}`);
                return response.data[0]; // Return the first user from the array
            } else {
                log.warn(`User details not found or request unsuccessful for ID: ${userId} using batch endpoint`);
                return null;
            }
        } catch (error: any) {
            // Batch endpoint might not return 404 for a specific missing user, but rather success:true, data:[]
            log.error(`Error fetching user details for user ${userId} (via batch endpoint, request method):`, error.message);
            if (error instanceof AppError) throw error;
            throw new AppError(`Failed to communicate with user service for user details.`, 503);
        }
    }

    async getUserDetailsWithMomo(userId: string): Promise<UserDetailsWithMomo | null> {
        if (!this.baseUrl) {
            log.error('Cannot get user details with momo: User service URL not configured.');
            throw new AppError('User service is not configured.', 503);
        }
        // Use the batch endpoint even for a single user
        const path = '/users/internal/batch-details';
        try {
            log.debug(`Fetching user details with momo for userId: ${userId} via batch endpoint (request method)`);
            // Send userId in an array via POST body
            const response = await this.request<{ success: boolean; data: UserDetailsWithMomo[] } | null>('post', path, { userIds: [userId] });
            if (response?.success && Array.isArray(response.data) && response.data.length > 0) {
                const userDetails = response.data[0];
                if (typeof userDetails.momoNumber === 'undefined' || typeof userDetails.momoOperator === 'undefined') {
                    log.warn(`User ${userId} details fetched via batch, but momoNumber or momoOperator is missing.`);
                }
                log.info(`Successfully fetched user details with momo for userId: ${userId} via batch endpoint`);
                return userDetails;
            } else {
                log.warn(`User details with momo not found or request unsuccessful for ID: ${userId} using batch endpoint`);
                return null;
            }
        } catch (error: any) {
            // Batch endpoint might not return 404 for a specific missing user
            log.error(`Error calling user service for (momo) details of user ${userId} (via batch endpoint, request method):`, error.message);
            if (error instanceof AppError) throw error;
            throw new AppError(`Failed to communicate with user service for momo details.`, 503);
        }
    }

    async updateUserBalance(userId: string, amount: number): Promise<void> {
        if (!this.baseUrl) {
            log.error('Cannot update user balance: User service URL not configured.');
            throw new AppError('User service is not configured.', 503);
        }
        const path = `/users/internal/${userId}/balance`;
        try {
            log.info(`Updating balance for user ${userId} by ${amount} via user-service request method.`);
            const response = await this.request<{ success: boolean; data?: { newBalance?: number } }>('post', path, { amount });

            if (response?.success) {
                log.info(`Successfully updated balance for user ${userId}. New balance: ${response.data?.newBalance ?? 'N/A'}`);
            } else {
                log.warn(`Update balance call for user ${userId} reported non-success or missing response.`);
                throw new AppError('Failed to update user balance via user-service (request succeeded but action failed).', 500);
            }
        } catch (error: any) {
            log.error(`Error updating balance for user ${userId} (via request method):`, error.message);
            if (error instanceof AppError) throw error;
            throw new AppError(`Failed to communicate with user service for balance update.`, 503);
        }
    }

    async getBalance(userId: string): Promise<number> {
        if (!this.baseUrl) {
            log.error('Cannot get user balance: User service URL not configured.');
            throw new AppError('User service is not configured.', 503);
        }
        const path = `/users/internal/${userId}/balance`;
        try {
            log.debug(`Fetching balance for user ${userId} via user-service request method.`);
            const response = await this.request<{ success: boolean; data: { balance: number } }>('get', path);

            if (response?.success && typeof response.data?.balance === 'number') {
                log.info(`Successfully fetched balance for user ${userId}: ${response.data.balance}`);
                return response.data.balance;
            } else {
                log.error(`Failed to parse balance from user-service response for user ${userId}`, response);
                throw new AppError('Failed to fetch user balance from user-service (invalid response format).', 500);
            }
        } catch (error: any) {
            log.error(`Error fetching balance for user ${userId} (via request method):`, error.message);
            if (error instanceof AppError) throw error;
            throw new AppError(`Failed to communicate with user service for balance.`, 503);
        }
    }

    async activateSubscription(userId: string, type: string, planIdentifier: string): Promise<any | null> {
        const path = '/subscriptions/internal/activate';
        try {
            log.info(`Activating subscription for user ${userId} via request method`);
            const response = await this.request<any>('post', path, {
                userId,
                subscriptionType: type,
                planIdentifier
            });
            return response.data;
        } catch (error: any) {
            log.error(`Failed to activate subscription for user ${userId} via User Service (request method):`, error.message);
            return null;
        }
    }

    async getReferrerIds(userId: string): Promise<ReferrerIds | null> {
        const path = `/users/internal/${userId}/referrers`;
        try {
            log.info(`Getting referrer IDs for user ${userId} via request method`);
            const response = await this.request<{ success: boolean, data: ReferrerIds } | null>('get', path);
            return response?.data ?? null;
        } catch (error: any) {
            log.error(`Failed to get referrer IDs for user ${userId} from User Service (request method):`, error.message);
            return null;
        }
    }

    async validateUser(userId: string): Promise<boolean> {
        const path = `/users/internal/${userId}/validate`; // Correct endpoint for validation
        try {
            log.info(`Validating user ${userId} via request method`);
            const response = await this.request<{ success: boolean, data?: { valid?: boolean } } | null>('get', path); // data shape might vary, check user-service controller
            // Check for success and explicitly true 'valid' property if present
            return response?.success === true && response.data?.valid === true;
        } catch (error: any) {
            // Treat errors (including 404 from AppError) as invalid user
            if (error instanceof AppError && error.statusCode === 404) {
                log.warn(`Validation check: User ${userId} not found in user-service.`);
            } else {
                log.error(`Failed to validate user ${userId} via User Service (request method):`, error.message);
            }
            return false;
        }
    }

    async checkWithdrawalLimits(userId: string, amount: number, currency: 'USD' | 'XAF' = 'XAF'): Promise<WithdrawalLimitCheckResponse> {
        const path = `/users/internal/${userId}/withdrawal-limits/check`;
        try {
            log.info(`Checking withdrawal limits for user ${userId} (${currency}) via request method`);
            const response = await this.request<{ success: boolean, data: WithdrawalLimitCheckResponse } | null>('post', path, { amount, currency });
            return response?.data ?? { allowed: false, reason: 'Error processing request or invalid response' };
        } catch (error: any) {
            log.error(`Failed to check withdrawal limits for user ${userId} via User Service (request method):`, error.message);
            return { allowed: false, reason: 'Error communicating with User Service' };
        }
    }

    async processSuccessfulWithdrawal(userId: string, amount: number, currency: 'USD' | 'XAF'): Promise<{ success: boolean; message?: string }> {
        const path = `/users/internal/${userId}/withdrawal/success`;
        try {
            log.info(`Processing successful withdrawal for user ${userId}: ${amount} ${currency}`);
            const response = await this.request<{ success: boolean; message?: string }>('post', path, { amount, currency });
            return response ?? { success: false, message: 'Error processing request or invalid response' };
        } catch (error: any) {
            log.error(`Failed to process successful withdrawal for user ${userId} via User Service:`, error.message);
            return { success: false, message: 'Error communicating with User Service' };
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
        const path = '/users/internal/batch-details'; // Correct endpoint
        try {
            log.debug(`Fetching details for ${userIds.length} users via request method.`);
            const response = await this.request<{ success: boolean, data: UserDetails[] } | null>('post', path, { userIds }); // Correct method and body

            if (response?.success && Array.isArray(response.data)) {
                log.info(`Successfully fetched details for ${response.data.length} users.`);
                return response.data;
            } else {
                log.warn(`Failed to fetch batch user details or invalid response format.`);
                return [];
            }
        } catch (error: any) {
            log.error(`Error fetching batch user details (via request method):`, error.message);
            if (error instanceof AppError) throw error;
            throw new AppError(`Failed to communicate with user service for batch user details.`, 503);
        }
    }

    // --- NEW METHOD: Find User IDs by Search Term ---
    async findUserIdsBySearchTerm(searchTerm: string): Promise<string[] | null> {
        if (!this.baseUrl) {
            log.error('Cannot search user IDs: User service URL not configured.');
            throw new AppError('User service is not configured.', 503);
        }
        const path = '/users/internal/search-ids';
        try {
            log.debug(`Searching for user IDs with term: "${searchTerm}" via request method.`);
            const response = await this.request<{ success: boolean; data: string[] } | null>('get', path, undefined, { term: searchTerm });

            if (response?.success && Array.isArray(response.data)) {
                log.info(`Successfully found ${response.data.length} user IDs for term "${searchTerm}".`);
                return response.data;
            } else {
                log.warn(`User ID search failed or returned no results for term "${searchTerm}".`);
                return null;
            }
        } catch (error: any) {
            log.error(`Error calling user-service for user ID search (term: "${searchTerm}") (via request method):`, error.message);
            if (error instanceof AppError) throw error;
            throw new AppError(`Failed to communicate with user service for user ID search.`, 503);
        }
    }

    async getUserActiveSubscriptions(userId: string): Promise<SubscriptionType[]> {
        if (!this.baseUrl) {
            log.error('Cannot get active subscriptions: User service URL not configured.');
            throw new AppError('User service is not configured.', 503);
        }
        const path = `/users/internal/${userId}/active-subscriptions`;
        try {
            log.debug(`Fetching active subscriptions for user ${userId} via request method.`);
            const response = await this.request<{ success: boolean; data: SubscriptionType[] }>('get', path);

            if (response?.success && Array.isArray(response.data)) {
                log.info(`Successfully fetched active subscriptions for user ${userId}.`);
                return response.data;
            } else {
                log.warn(`Failed to fetch active subscriptions or invalid response format for user ${userId}.`);
                return []; // Return empty array on non-success or invalid data
            }
        } catch (error: any) {
            log.error(`Error getting active subscriptions for user ${userId} (via request method):`, error.message);
            if (error instanceof AppError) throw error;
            throw new AppError(`Failed to communicate with user service for active subscriptions.`, 503);
        }
    }


    // USD Balance methods for crypto payments
    async updateUserUsdBalance(userId: string, amount: number): Promise<void> {
        if (!this.baseUrl) {
            log.error('Cannot update user USD balance: User service URL not configured.');
            throw new AppError('User service is not configured.', 503);
        }
        const path = `/users/internal/${userId}/usd-balance`;
        try {
            log.debug(`Updating USD balance for user ${userId} by ${amount}`);
            const response = await this.request<{ success: boolean; usdBalance?: number }>('post', path, { amount });

            if (response?.success) {
                log.info(`Successfully updated USD balance for user ${userId}`);
            } else {
                throw new AppError('Failed to update user USD balance', 500);
            }
        } catch (error: any) {
            log.error(`Error updating USD balance for user ${userId}:`, error.message);
            if (error instanceof AppError) throw error;
            throw new AppError(`Failed to communicate with user service for USD balance update.`, 503);
        }
    }

    async getUsdBalance(userId: string): Promise<number> {
        if (!this.baseUrl) {
            log.error('Cannot get user USD balance: User service URL not configured.');
            throw new AppError('User service is not configured.', 503);
        }
        const path = `/users/internal/${userId}/usd-balance`;
        try {
            log.debug(`Fetching USD balance for user ${userId}`);
            const response = await this.request<{ success: boolean; usdBalance: number }>('get', path);

            if (response?.success && typeof response.usdBalance === 'number') {
                return response.usdBalance;
            } else {
                throw new AppError('Failed to fetch user USD balance', 500);
            }
        } catch (error: any) {
            log.error(`Error fetching USD balance for user ${userId}:`, error.message);
            if (error instanceof AppError) throw error;
            throw new AppError(`Failed to communicate with user service for USD balance.`, 503);
        }
    }

    async getUserByEmail(email: string): Promise<{ id: string; email?: string; phoneNumber?: string } | null> {
        if (!this.baseUrl) {
            log.error('Cannot find user by email: User service URL not configured.');
            throw new AppError('User service is not configured.', 503);
        }
        const path = `/users/internal/find-by-email`;
        try {
            log.debug(`Finding user by email: ${email}`);
            const response = await this.request<{ success: boolean; data: { id: string; email?: string; phoneNumber?: string } | null }>('post', path, { email });
            if (response?.success && response.data) {
                log.info(`Successfully found user by email: ${email}`);
                return response.data;
            } else {
                log.debug(`User not found by email: ${email}`);
                return null;
            }
        } catch (error: any) {
            if (error instanceof AppError && error.statusCode === 404) {
                return null;
            }
            log.error(`Error finding user by email ${email}:`, error);
            return null; // Don't throw error, just return null for user not found
        }
    }

    async getUserByPhoneNumber(phoneNumber: string): Promise<{ id: string; email?: string; phoneNumber?: string } | null> {
        if (!this.baseUrl) {
            log.error('Cannot find user by phone: User service URL not configured.');
            throw new AppError('User service is not configured.', 503);
        }
        const path = `/users/internal/find-by-phone`;
        try {
            log.debug(`Finding user by phone: ${phoneNumber}`);
            const response = await this.request<{ success: boolean; data: { id: string; email?: string; phoneNumber?: string } | null }>('post', path, { phoneNumber });
            if (response?.success && response.data) {
                log.info(`Successfully found user by phone: ${phoneNumber}`);
                return response.data;
            } else {
                log.debug(`User not found by phone: ${phoneNumber}`);
                return null;
            }
        } catch (error: any) {
            if (error instanceof AppError && error.statusCode === 404) {
                return null;
            }
            log.error(`Error finding user by phone ${phoneNumber}:`, error);
            return null; // Don't throw error, just return null for user not found
        }
    }

    async getUserByMomoNumber(momoNumber: string): Promise<{ id: string; email?: string; phoneNumber?: string } | null> {
        if (!this.baseUrl) {
            log.error('Cannot find user by momo number: User service URL not configured.');
            throw new AppError('User service is not configured.', 503);
        }
        const path = `/users/internal/find-by-momo`;
        try {
            log.debug(`Finding user by momo number: ${momoNumber}`);
            const response = await this.request<{ success: boolean; data: { id: string; email?: string; phoneNumber?: string } | null }>('post', path, { momoNumber });
            if (response?.success && response.data) {
                log.info(`Successfully found user by momo number: ${momoNumber}`);
                return response.data;
            } else {
                log.debug(`User not found by momo number: ${momoNumber}`);
                return null;
            }
        } catch (error: any) {
            if (error instanceof AppError && error.statusCode === 404) {
                return null;
            }
            log.error(`Error finding user by momo number ${momoNumber}:`, error);
            return null; // Don't throw error, just return null for user not found
        }
    }
}

export const userServiceClient = new UserServiceClient(); 