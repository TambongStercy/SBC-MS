import axios from 'axios';
import config from '../../config';
import logger from '../../utils/logger';

const log = logger.getLogger('UserServiceClient');

// Define criteria structure (should match user-service)
interface ITargetCriteria {
    regions?: string[];
    minAge?: number;
    maxAge?: number;
    sex?: 'male' | 'female' | 'other';
    interests?: string[];
    professions?: string[];
    language?: string[]; // Added language
    city?: string[];     // Added city
    // Add other fields used in user-service if needed
}

interface FindUsersResponse {
    success: boolean;
    message?: string;
    data?: {
        userIds: string[];
    };
}

interface UserDetails {
    _id: string;
    email?: string;
    phoneNumber?: string;
    language?: string[];
    name?: string;
}

interface GetUserDetailsResponse {
    success: boolean;
    message?: string;
    data?: UserDetails;
}


class UserServiceClient {
    private userServiceUrl: string;
    private serviceSecret: string;

    constructor() {
        this.userServiceUrl = config.services.userService;
        this.serviceSecret = config.services.serviceSecret;

        if (!this.userServiceUrl) {
            log.warn('User Service URL is not configured. Cannot communicate with User Service.');
        }
        if (!this.serviceSecret) {
            log.warn('Service-to-service secret is not configured. Authentication between services might fail.');
        }
    }

    /**
     * Finds user IDs based on criteria by calling the user-service internal endpoint.
     * @param criteria Targeting criteria.
     * @returns Promise<string[]> Array of user IDs.
     */
    async findUserIdsByCriteria(criteria: ITargetCriteria): Promise<string[]> {
        if (!this.userServiceUrl) {
            log.error('User Service URL not configured. Cannot find users.');
            return [];
        }

        const url = `${this.userServiceUrl}/users/internal/find-by-criteria`;
        log.info(`Calling User Service to find users by criteria at ${url}`);
        log.debug('Criteria for user search:', criteria);

        try {
            const response = await axios.post<FindUsersResponse>(url, criteria, {
                headers: {
                    'Authorization': `Bearer ${this.serviceSecret}`,
                    'Content-Type': 'application/json',
                    'X-Service-Name': 'notification-service'
                },
                timeout: 15000 // 15 second timeout
            });

            if (response.data?.success && response.data?.data?.userIds) {
                log.info(`Found ${response.data.data.userIds.length} user IDs from User Service.`);
                return response.data.data.userIds;
            } else {
                log.warn(`User Service call to find users by criteria returned success=false or no userIds. Message: ${response.data?.message}`);
                return [];
            }
        } catch (error: any) {
            log.error(`Error calling User Service findUserIdsByCriteria at ${url}:`, error.response?.data || error.message);
            return [];
        }
    }

    /**
     * Fetches basic details (email, phone, language, name) for a single user.
     * Uses the existing /batch-details endpoint with a single user ID.
     * @param userId The ID of the user to fetch.
     * @returns Promise<UserDetails | null> User details or null if not found/error.
     */
    async getUserDetails(userId: string): Promise<UserDetails | null> {
        if (!this.userServiceUrl) {
            log.error('User Service URL not configured. Cannot get user details.');
            return null;
        }

        const url = `${this.userServiceUrl}/users/internal/batch-details`;
        log.debug(`Calling User Service to get details for user: ${userId} at ${url}`);

        try {
            const response = await axios.post<{ success: boolean; data: UserDetails[] }>(url, {
                userIds: [userId] // Send single user ID in array
            }, {
                headers: {
                    'Authorization': `Bearer ${this.serviceSecret}`,
                    'X-Service-Name': 'notification-service'
                },
                timeout: 5000
            });

            if (response.data?.success && Array.isArray(response.data?.data) && response.data.data.length > 0) {
                log.info(`Successfully fetched user details for userId: ${userId}`);
                return response.data.data[0]; // Return the first (and only) user from the array
            } else {
                log.warn(`User Service batch-details call returned no data for user ${userId}`);
                return null;
            }
        } catch (error: any) {
            log.error(`Error calling User Service batch-details at ${url} for user ${userId}:`, error.response?.data || error.message);
            return null;
        }
    }

    /**
     * Get unpaid referrals for a user (for relance feature)
     * @param userId The ID of the user
     * @returns Array of unpaid referral objects
     */
    async getUnpaidReferrals(userId: string): Promise<any[]> {
        if (!this.userServiceUrl) {
            log.error('User Service URL not configured. Cannot get unpaid referrals.');
            return [];
        }

        const url = `${this.userServiceUrl}/users/internal/${userId}/unpaid-referrals`;
        log.debug(`Fetching unpaid referrals for user ${userId} at ${url}`);

        try {
            const response = await axios.get<{ success: boolean; data: any[] }>(url, {
                headers: {
                    'Authorization': `Bearer ${this.serviceSecret}`,
                    'X-Service-Name': 'notification-service'
                },
                timeout: 10000
            });

            if (response.data?.success && Array.isArray(response.data.data)) {
                log.info(`Successfully fetched ${response.data.data.length} unpaid referrals for user ${userId}`);
                return response.data.data;
            } else {
                log.warn(`User Service call for unpaid referrals returned no data for user ${userId}`);
                return [];
            }
        } catch (error: any) {
            log.error(`Error fetching unpaid referrals for user ${userId}:`, error.response?.data || error.message);
            return [];
        }
    }

    /**
     * Check if user has active RELANCE subscription
     * @param userId The ID of the user
     * @returns Boolean indicating if user has active RELANCE subscription
     */
    async hasRelanceSubscription(userId: string): Promise<boolean> {
        if (!this.userServiceUrl) {
            log.error('User Service URL not configured. Cannot check RELANCE subscription.');
            return false;
        }

        const url = `${this.userServiceUrl}/users/internal/${userId}/has-relance-subscription`;
        log.debug(`Checking RELANCE subscription for user ${userId} at ${url}`);

        try {
            const response = await axios.get<{ success: boolean; data: { hasRelance: boolean } }>(url, {
                headers: {
                    'Authorization': `Bearer ${this.serviceSecret}`,
                    'X-Service-Name': 'notification-service'
                },
                timeout: 5000
            });

            if (response.data?.success && typeof response.data.data?.hasRelance === 'boolean') {
                log.info(`User ${userId} has RELANCE subscription: ${response.data.data.hasRelance}`);
                return response.data.data.hasRelance;
            } else {
                log.warn(`User Service call for RELANCE subscription check returned invalid data for user ${userId}`);
                return false;
            }
        } catch (error: any) {
            log.error(`Error checking RELANCE subscription for user ${userId}:`, error.response?.data || error.message);
            return false;
        }
    }
}

// Export a singleton instance
export const userServiceClient = new UserServiceClient(); 