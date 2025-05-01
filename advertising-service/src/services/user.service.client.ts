import axios, { AxiosInstance } from 'axios';
import config from '../config';
import logger from '../utils/logger';
import { AppError } from '../utils/errors';

const log = logger.getLogger('UserServiceClient');

// Define expected response/payload structures based on user-service endpoints
interface ReferrerInfo {
    referrerId: string;
    // Add other fields if user-service returns more (e.g., referrerName)
}

interface CreditCommissionPayload {
    referrerId: string;
    amount: number;
    currency: string;
    source: string; // e.g., 'AD_PACK_PURCHASE'
    sourceDetails: Record<string, any>; // e.g., { buyerUserId, packId, packPrice }
}

// Define structure for getting random user IDs response
interface RandomUserIdsResponse {
    success: boolean;
    data?: { userIds: string[] };
    message?: string;
}

// Define structure for getAffiliator response
interface AffiliatorResponse {
    success: boolean;
    data?: ReferrerInfo;
    message?: string;
}

// Define structure for credit commission response
interface CreditCommissionResponse {
    success: boolean;
    message?: string;
}

class UserServiceClient {
    private apiClient: AxiosInstance;

    constructor() {
        if (!config.services.userService) {
            log.error('User Service URL is not configured.');
            throw new Error('User Service URL is not configured.');
        }
        this.apiClient = axios.create({
            baseURL: config.services.userService,
            timeout: 5000,
            headers: {
                'Content-Type': 'application/json',
                // Use the shared secret for service-to-service auth
                'Authorization': `Bearer ${config.services.serviceSecret}`,
                'X-Service-Name': 'advertising-service' // Identify the calling service
            },
        });
        log.info(`User Service Client initialized for URL: ${config.services.userService}`);
    }

    /**
     * Fetches ~N random active user IDs.
     * NOTE: Endpoint /users/random-ids needs to be implemented in user-service.
     */
    async getRandomUserIds(count: number): Promise<string[]> {
        const url = `/users/random-ids?count=${count}&active=true`; // Adjust endpoint as needed
        log.debug(`Requesting ${count} random user IDs from user service: ${this.apiClient.defaults.baseURL}${url}`);
        try {
            const response = await this.apiClient.get<RandomUserIdsResponse>(url);
            if (response.data?.success && response.data.data?.userIds) {
                log.info(`Successfully retrieved ${response.data.data.userIds.length} random user IDs.`);
                return response.data.data.userIds;
            }
            log.warn('Failed to get random user IDs from user service or format invalid.', { responseData: response.data });
            return [];
        } catch (error: any) {
            log.error(`Error calling user service ${url}: ${error.message}`);
            if (axios.isAxiosError(error)) {
                log.error('User Service Error Response (getRandomUserIds):', { status: error.response?.status, data: error.response?.data });
            }
            return []; // Return empty, don't block ad processing
        }
    }

    /**
     * Gets the direct referrer for a given user.
     * NOTE: Endpoint /users/:userId/affiliator needs to be implemented in user-service.
     */
    async getAffiliator(userId: string): Promise<ReferrerInfo | null> {
        const url = `/users/${userId}/affiliator`; // Adjust endpoint as needed
        log.debug(`Requesting affiliator for user ${userId}: ${this.apiClient.defaults.baseURL}${url}`);
        try {
            const response = await this.apiClient.get<AffiliatorResponse>(url);
            if (response.data?.success && response.data.data?.referrerId) {
                log.info(`Found referrer ${response.data.data.referrerId} for user ${userId}`);
                return response.data.data;
            }
            log.info(`No affiliator data found for user ${userId}.`, { responseData: response.data });
            return null;
        } catch (error: any) {
            log.error(`Error calling user service ${url}: ${error.message}`);
            if (axios.isAxiosError(error)) {
                // Handle 404 specifically as "not found" rather than error
                if (error.response?.status === 404) {
                    log.info(`Affiliator not found for user ${userId} (404).`);
                    return null;
                }
                log.error('User Service Error Response (getAffiliator):', { status: error.response?.status, data: error.response?.data });
            }
            return null; // Return null on error, don't block flow
        }
    }

    /**
     * Credits commission to a referrer.
     * NOTE: Endpoint /users/internal/credit-commission needs to be implemented in user-service.
     */
    async creditReferralCommission(payload: CreditCommissionPayload): Promise<boolean> {
        const url = '/users/internal/credit-commission'; // Adjust endpoint as needed
        log.info(`Sending credit commission request for referrer ${payload.referrerId} to ${this.apiClient.defaults.baseURL}${url}`);
        log.debug('Credit commission payload:', payload);
        try {
            const response = await this.apiClient.post<CreditCommissionResponse>(url, payload);
            if (response.data?.success) {
                log.info(`Successfully credited commission to referrer ${payload.referrerId}.`);
                return true;
            }
            log.warn(`Failed to credit commission via user service.`, { responseData: response.data });
            return false;
        } catch (error: any) {
            log.error(`Error calling user service ${url}: ${error.message}`);
            if (axios.isAxiosError(error)) {
                log.error('User Service Error Response (creditReferralCommission):', { status: error.response?.status, data: error.response?.data });
            }
            return false; // Return false on error
        }
    }

    /**
     * Fetches user IDs from the user service based on targeting criteria.
     * Assumes the user service has an endpoint like /internal/users/find-by-criteria
     */
    async findUsersByCriteria(criteria: any): Promise<string[]> {
        const endpoint = '/internal/users/find-by-criteria'; // Define the criteria search endpoint
        log.info(`Requesting user IDs from User Service based on criteria`);
        log.debug('Criteria being sent:', criteria);
        try {
            const response = await this.apiClient.post(endpoint, criteria);

            if (response.status === 200 && response.data.success && Array.isArray(response.data.data?.userIds)) {
                log.info(`Received ${response.data.data.userIds.length} user IDs from User Service.`);
                return response.data.data.userIds;
            } else {
                log.warn(`User Service returned non-success or invalid data for criteria search: ${response.status}`, {
                    data: response.data
                });
                return []; // Return empty array on failure
            }
        } catch (error: any) {
            log.error('Error calling User Service for findUsersByCriteria:', {
                error: error.response?.data || error.message,
                status: error.response?.status
            });
            return []; // Return empty array on error
        }
    }
}

// Export a singleton instance
export const userService = new UserServiceClient(); 