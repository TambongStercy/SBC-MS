import axios, { AxiosInstance, AxiosError } from 'axios';
import config from '../../config'; // Assuming config holds user-service base URL
import logger from '../../utils/logger';

const log = logger.getLogger('UserServiceClient');

// Interface for the expected user details from user-service
export interface UserDetails {
    _id: string;
    name: string;
    email?: string;
    phoneNumber?: string;
    avatar?: string;
    // Add other fields if needed (e.g., email)
}

// Interface for the expected response from the batch details endpoint
interface BatchUserDetailsResponse {
    success: boolean;
    data: UserDetails[];
    message?: string;
}

class UserServiceClient {
    private client: AxiosInstance;

    constructor() {
        if (!config.services.userService) {
            log.error('USER_SERVICE_URL is not defined in the configuration!');
            throw new Error('User Service URL is not configured.');
        }

        this.client = axios.create({
            baseURL: config.services.userService,
            timeout: 5000, // Example timeout
            headers: {
                'Content-Type': 'application/json',
                // Add any necessary auth headers for service-to-service communication if needed
                // 'X-Service-Key': config.userServiceApiKey 
                'Authorization': `Bearer ${config.services.serviceSecret}`,
                'X-Service-Name': 'tombola-service',
            }
        });

        // Optional: Add interceptors for logging or error handling
        this.client.interceptors.response.use(
            (response) => response,
            (error: AxiosError) => {
                log.error(`Error calling User Service: ${error.config?.method?.toUpperCase()} ${error.config?.url}`, {
                    status: error.response?.status,
                    data: error.response?.data,
                    message: error.message,
                });
                // Don't throw here, let the caller handle it
                return Promise.reject(error);
            }
        );
    }

    /**
     * Fetches details for multiple users by their IDs.
     * Assumes user-service has an endpoint like POST /users/batch-details
     *
     * @param userIds - An array of user IDs.
     * @returns A promise resolving to an array of UserDetails.
     */
    async getUsersByIds(userIds: string[]): Promise<UserDetails[]> {
        if (!userIds || userIds.length === 0) {
            return [];
        }
        log.info(`Requesting user details for ${userIds.length} IDs from User Service.`);
        try {
            // Assuming a POST endpoint accepting an array of IDs in the body
            const response = await this.client.post<BatchUserDetailsResponse>('/users/internal/batch-details', { userIds });


            if (response.data && response.data.success && Array.isArray(response.data.data)) {
                log.info(`Successfully retrieved details for ${response.data.data.length} users.`);
                return response.data.data;
            } else {
                log.warn('Received unexpected response format from user-service batch details endpoint:', response.data);
                return []; // Return empty array on unexpected format
            }
        } catch (error) {
            log.error('Failed to fetch user details from User Service:', error);
            // Return empty array or re-throw depending on desired behavior
            // Returning empty allows the calling service to proceed without user details
            return [];
        }
    }

    /**
     * Searches for users by name, email, or phone number and returns their IDs.
     *
     * @param searchTerm - The search term.
     * @returns A promise resolving to an array of user IDs (strings).
     */
    async findUserIdsBySearchTerm(searchTerm: string): Promise<string[]> {
        if (!searchTerm || searchTerm.trim() === '') {
            log.warn('findUserIdsBySearchTerm called with empty search term.');
            return [];
        }
        log.info(`Requesting user IDs matching search term: "${searchTerm}"`);
        try {
            // Assuming a GET endpoint like /internal/users/search-ids?q=<searchTerm>
            const response = await this.client.get<{ success: boolean; data?: { userIds: string[] }; message?: string }>(`/users/internal/search-ids`, {
                params: { q: searchTerm.trim() }
            });

            if (response.data && response.data.success && Array.isArray(response.data.data?.userIds)) {
                log.info(`Successfully retrieved ${response.data.data.userIds.length} user IDs matching search term.`);
                return response.data.data.userIds;
            } else {
                log.warn('Received unexpected response format from user-service search IDs endpoint:', response.data);
                return [];
            }
        } catch (error) {
            log.error(`Failed to fetch user IDs by search term "${searchTerm}" from User Service:`, error);
            // Return empty array - the caller (listTicketsForMonthAdmin) should handle this
            return [];
        }
    }
}

export const userServiceClient = new UserServiceClient(); 