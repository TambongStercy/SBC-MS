import axios from 'axios';
import config from '../../config';
import logger from '../../utils/logger';

const log = logger.getLogger('UserServiceClient');

export interface IUserProfile {
    _id: string;
    name?: string;
    email?: string;
    phoneNumber?: string;
    country?: string;
    region?: string;
    city?: string;
    sex?: string;
    birthDate?: string;
    language?: string[];
    interests?: string[];
    profession?: string;
}

const client = axios.create({
    baseURL: config.services.userService,
    timeout: 10000,
    headers: {
        'Content-Type': 'application/json',
        'X-Service-Secret': config.services.serviceSecret,
    },
});

/**
 * Returns null rather than throwing when the user simply isn't found, so callers
 * can distinguish "no such user" from "user-service is down" (which does throw).
 */
export const getUserProfile = async (userId: string): Promise<IUserProfile | null> => {
    try {
        const { data } = await client.get(`/users/internal/${userId}`);
        return data?.data ?? data ?? null;
    } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 404) return null;
        log.error(`Failed to fetch user ${userId} from user-service:`, err);
        throw err;
    }
};

/**
 * Bulk lookup for the allocation engine, which resolves hundreds of candidate
 * diffuseurs at once and must not issue one request each.
 */
export const getUserProfiles = async (userIds: string[]): Promise<IUserProfile[]> => {
    if (!userIds.length) return [];
    try {
        const { data } = await client.post('/users/internal/batch-details', { userIds });
        return data?.data ?? [];
    } catch (err) {
        log.error(`Failed to batch-fetch ${userIds.length} users from user-service:`, err);
        throw err;
    }
};
