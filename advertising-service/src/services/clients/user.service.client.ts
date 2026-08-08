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
    /** Doubles as the diffuseur's affiliate code on their tracking links. */
    referralCode?: string;
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
        // user-service's authenticateServiceRequest reads Authorization: Bearer.
        // An X-Service-Secret header is ignored and every internal call 401s —
        // which is what broke diffuseur eligibility on preprod.
        'Authorization': `Bearer ${config.services.serviceSecret}`,
        'X-Service-Name': 'advertising-service',
    },
});

/**
 * Returns null rather than throwing when the user simply isn't found, so callers
 * can distinguish "no such user" from "user-service is down" (which does throw).
 *
 * Goes through the batch endpoint because user-service has no single-user internal
 * route — an earlier GET /users/internal/:userId here 404'd on every call, which
 * made diffuseur eligibility permanently fail with "profil introuvable".
 */
export const getUserProfile = async (userId: string): Promise<IUserProfile | null> => {
    const [profile] = await getUserProfiles([userId]);
    return profile ?? null;
};

/**
 * Bulk lookup for the allocation engine, which resolves hundreds of candidate
 * diffuseurs at once and must not issue one request each.
 */
/**
 * Credits a diffuseur's advertising balance.
 *
 * Throws on failure, deliberately: the caller releases its payout claim so the
 * next sweep retries. Swallowing this would mean a diffuseur silently never gets
 * paid.
 */
export const creditAdvertisingEarnings = async (args: {
    userId: string;
    amount: number;
    reference: string;
    description: string;
}): Promise<{ newAdvertisingBalance: number; transactionId: string }> => {
    const { data } = await client.post('/advertising-balance/internal/credit', args);
    if (!data?.success) {
        throw new Error(data?.message || 'user-service refused the advertising credit');
    }
    return data.data;
};

/**
 * The user's direct (level 1) referrer, or null.
 *
 * Only level 1 matters: Rufus's rule is « quelqu'un qu'il aura invite
 * directement ». Deeper levels earn nothing from advertising campaigns.
 */
export const getDirectReferrer = async (userId: string): Promise<string | null> => {
    try {
        const { data } = await client.get(`/users/internal/${userId}/referrers`);
        return data?.data?.level1 ?? null;
    } catch (err) {
        log.warn(`Could not resolve referrer for ${userId}: ${(err as Error).message}`);
        return null;
    }
};

/**
 * Targeting projection, NOT `batch-details`.
 *
 * batch-details returns name/email/balance and none of country, city, region,
 * sex, birthDate, language, interests or profession. Using it does not error —
 * every targeted campaign simply matches nobody, silently.
 */
export const getUserProfiles = async (userIds: string[]): Promise<IUserProfile[]> => {
    if (!userIds.length) return [];
    try {
        const { data } = await client.post('/users/internal/advertising-details', { userIds });
        return data?.data ?? [];
    } catch (err) {
        log.error(`Failed to batch-fetch ${userIds.length} users from user-service:`, err);
        throw err;
    }
};
