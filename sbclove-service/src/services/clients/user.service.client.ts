import axios, { AxiosInstance, AxiosError } from 'axios';
import config from '../../config';
import logger from '../../utils/logger';

const log = logger.getLogger('UserServiceClient');

// Subset of user-service User fields SBCLOVE relies on (source of truth for
// identity/demographics — spec §5). Names mirror the user-service model.
export interface UserDetails {
    _id: string;
    name: string;
    email?: string;
    sex?: string;          // UserSex: male | female | other | prefer_not_to_say
    birthDate?: string;
    city?: string;
    country?: string;
    avatar?: string;
    isVerified?: boolean;
}

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
            timeout: 5000,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.services.serviceSecret}`,
                'X-Service-Name': 'sbclove-service',
            },
        });

        this.client.interceptors.response.use(
            (response) => response,
            (error: AxiosError) => {
                log.error(`Error calling User Service: ${error.config?.method?.toUpperCase()} ${error.config?.url}`, {
                    status: error.response?.status,
                    data: error.response?.data,
                    message: error.message,
                });
                return Promise.reject(error);
            }
        );
    }

    /**
     * Fetches a single user's SBCLOVE details by id.
     */
    async getUserById(userId: string): Promise<UserDetails | null> {
        const [user] = await this.getUsersByIds([userId]);
        return user ?? null;
    }

    /**
     * Fetches the SBCLOVE demographic subset for multiple users (batch hydration).
     * Backed by user-service POST /users/internal/sbclove-details, which returns
     * { _id, name, avatar, sex, birthDate, city, country, isVerified }.
     */
    async getUsersByIds(userIds: string[]): Promise<UserDetails[]> {
        if (!userIds || userIds.length === 0) {
            return [];
        }
        log.info(`Requesting SBCLOVE user details for ${userIds.length} IDs from User Service.`);
        try {
            const response = await this.client.post<BatchUserDetailsResponse>('/users/internal/sbclove-details', { userIds });
            if (response.data?.success && Array.isArray(response.data.data)) {
                return response.data.data;
            }
            log.warn('User Service sbclove-details responded with an unexpected shape.');
            return [];
        } catch (error: any) {
            log.error(`Failed SBCLOVE user fetch: ${error.message}`);
            return [];
        }
    }
}

export const userServiceClient = new UserServiceClient();
