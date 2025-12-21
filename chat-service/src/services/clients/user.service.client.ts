import axios, { AxiosInstance } from 'axios';
import config from '../../config';
import logger from '../../utils/logger';

const log = logger.getLogger('UserServiceClient');

export interface UserDetails {
    _id: string;
    name: string;
    email?: string;
    phoneNumber?: string;
    avatar?: string;
    country?: string;
    city?: string;
    region?: string;
    role?: string;
}

class UserServiceClient {
    private apiClient: AxiosInstance;

    constructor() {
        this.apiClient = axios.create({
            baseURL: config.services.userServiceUrl,
            timeout: 10000,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.services.serviceSecret}`,
                'X-Service-Name': 'chat-service'
            }
        });
        log.info('User service client initialized');
    }

    /**
     * Get user details by ID using internal endpoint
     */
    async getUserDetails(userId: string): Promise<UserDetails | null> {
        try {
            // Use the internal validate endpoint which returns user data
            // baseURL already includes /api, so path is /users/internal/...
            const response = await this.apiClient.get(`/users/internal/${userId}/validate`);
            log.debug(`[getUserDetails] Response for user ${userId}:`, {
                success: response.data.success,
                hasData: !!response.data.data,
                role: response.data.data?.role
            });
            if (response.data.success && response.data.data) {
                return response.data.data;
            }
            return null;
        } catch (error: any) {
            log.error(`Error fetching user ${userId}:`, error.message);
            return null;
        }
    }

    /**
     * Get multiple users' details using internal batch endpoint
     */
    async getMultipleUsers(userIds: string[]): Promise<Map<string, UserDetails>> {
        const result = new Map<string, UserDetails>();

        if (userIds.length === 0) {
            return result;
        }

        try {
            // baseURL already includes /api, so path is /users/internal/...
            const response = await this.apiClient.post('/users/internal/batch-details', { userIds });
            if (response.data.success && response.data.data) {
                for (const user of response.data.data) {
                    result.set(user._id, user);
                }
            }
            log.debug(`Fetched ${result.size} users from batch endpoint`);
        } catch (error: any) {
            log.error('Error fetching multiple users via batch:', error.message);
            // Fall back to individual requests
            log.info('Falling back to individual user requests');
            for (const userId of userIds) {
                const user = await this.getUserDetails(userId);
                if (user) {
                    result.set(user._id, user);
                }
            }
        }

        return result;
    }

    /**
     * Check if user is admin
     */
    async isAdmin(userId: string): Promise<boolean> {
        try {
            const user = await this.getUserDetails(userId);
            const isAdminResult = user?.role === 'admin';
            log.debug(`[isAdmin] User ${userId} - role: ${user?.role}, isAdmin: ${isAdminResult}`);
            return isAdminResult;
        } catch (error: any) {
            log.error(`Error checking admin status for ${userId}:`, error.message);
            return false;
        }
    }

    /**
     * Get user's location
     */
    async getUserLocation(userId: string): Promise<{ country?: string; city?: string; region?: string } | null> {
        const user = await this.getUserDetails(userId);
        if (user) {
            return {
                country: user.country,
                city: user.city,
                region: user.region
            };
        }
        return null;
    }

    /**
     * Check if two users have a direct (level 1) referral relationship
     */
    async checkDirectReferralRelationship(user1Id: string, user2Id: string): Promise<boolean> {
        try {
            const response = await this.apiClient.post('/users/internal/check-direct-referral', {
                user1Id,
                user2Id
            });
            if (response.data.success && response.data.data) {
                return response.data.data.hasDirectReferral || false;
            }
            return false;
        } catch (error: any) {
            log.error(`Error checking referral relationship between ${user1Id} and ${user2Id}:`, error.message);
            return false;
        }
    }
}

export const userServiceClient = new UserServiceClient();
