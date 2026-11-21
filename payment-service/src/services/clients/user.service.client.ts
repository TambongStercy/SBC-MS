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
    // User balance
    balance?: { [key: string]: number };
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

/** user-service utils/withdrawal-lock.ts */
export interface WithdrawalLock {
    locked: boolean;
    /** ISO date, only when locked. */
    until?: string;
    reason?: 'email_change' | 'phone_change' | 'momo_change' | 'crypto_change' | 'authenticator_reset' | 'account_frozen';
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

export interface ReferralStats {
    directReferrals: number;
    indirectReferrals: number;
    totalReferrals: number;
    directSubscribedReferrals: number;
    indirectSubscribedReferrals: number;
    totalSubscribedReferrals: number;
}

/** Optional wallet-ledger fields sent with a balance change (user-service walletmovements). */
export interface LedgerMovement {
    reference?: string;
    source?: string;
    description?: string;
}

export type ReserveOutcome = 'reserved' | 'already_reserved' | 'insufficient' | 'conflict';
export interface SettleOutcome {
    status: 'converted' | 'already_converted' | 'debited_unreserved';
    lateAfterRelease?: boolean;
    reservedDrift?: boolean;
    balanceAfter?: number;
}

// Locally define SubscriptionType to avoid direct dependency on user-service model
type SubscriptionType = 'CLASSIQUE' | 'CIBLE' | 'RELANCE' | 'NONE';

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

    /**
     * Takes `amount` off the main balance in one conditional update (user-service
     * checks the balance net of debt). False when it does not cover it.
     */
    async spendBalance(userId: string, amount: number, movement: LedgerMovement = {}): Promise<boolean> {
        if (!this.baseUrl) throw new AppError('User service is not configured.', 503);
        let res;
        try {
            res = await axios.post(`${this.baseUrl}/users/internal/${userId}/spend-balance`, { amount, ...movement }, {
                headers: { Authorization: `Bearer ${this.serviceSecret}`, 'x-service-name': 'payment-service' },
                timeout: 15000, validateStatus: (s) => s < 500,
            });
        } catch (error: any) {
            log.error(`spendBalance for ${userId} failed: ${error.response?.status ?? ''} ${error.message}`);
            throw new AppError('Le service des soldes est momentanément indisponible.', 503);
        }
        if (res.status === 200 && res.data?.success !== false) return true;
        if (res.status === 409 && (res.data?.code === 'MOVEMENT_UNDONE' || res.data?.code === 'MOVEMENT_PENDING')) {
            // Same reference already taken and given back (or in review): never report it as paid.
            throw new AppError('Ce paiement a été annulé ou est en vérification : recommencez avec une nouvelle demande.', 409);
        }
        if (res.status === 409) return false;
        throw new AppError(res.data?.message || `Balance spend refused (${res.status})`, res.status);
    }

    /**
     * `movement.reference` makes the change idempotent in user-service's wallet
     * ledger (walletmovements): the same reference never moves the balance twice.
     */
    async updateUserBalance(userId: string, amount: number, movement: LedgerMovement = {}): Promise<void> {
        if (!this.baseUrl) {
            log.error('Cannot update user balance: User service URL not configured.');
            throw new AppError('User service is not configured.', 503);
        }
        const path = `/users/internal/${userId}/balance`;
        try {
            log.info(`Updating balance for user ${userId} by ${amount} via user-service request method.`);
            const response = await this.request<{ success: boolean; data?: { newBalance?: number } }>('post', path, { amount, ...movement });

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

    /**
     * Credit (positive amount) or debit (negative amount) a user's sbcLiveBalance.
     * Used by the SSO payment flow after a paid-live charge completes — the creator
     * gets 75% credited to this dedicated wallet (separate from their main balance
     * and activation balance).
     *
     * Returns true if applied, false if user-service refused the debit (insufficient
     * funds). Throws on transport / 5xx errors so the caller can retry or alert.
     */
    async updateSbcLiveBalance(userId: string, amount: number): Promise<boolean> {
        if (!this.baseUrl) {
            log.error('Cannot update SBC Live balance: User service URL not configured.');
            throw new AppError('User service is not configured.', 503);
        }
        const path = `/users/internal/${userId}/sbc-live-balance`;
        try {
            log.info(`Updating sbcLiveBalance for user ${userId} by ${amount}`);
            const response = await this.request<{ success: boolean; data?: { sbcLiveBalance?: number } }>('post', path, { amount });
            if (response?.success) {
                log.info(`Updated sbcLiveBalance for user ${userId}. New balance: ${response.data?.sbcLiveBalance ?? 'N/A'}`);
                return true;
            }
            log.warn(`updateSbcLiveBalance for user ${userId} returned non-success.`);
            return false;
        } catch (error: any) {
            log.error(`Error updating sbcLiveBalance for user ${userId}: ${error.message}`);
            if (error instanceof AppError && error.statusCode === 409) {
                // Insufficient funds — surface as false, not a throw
                return false;
            }
            throw error;
        }
    }

    /**
     * Fetch the webhook configuration for an SSO client. Used by the outbound
     * webhook firing path to learn where to POST and which secret to sign with.
     * Returns null when the client has no webhook configured or is disabled —
     * caller should skip the webhook fire silently rather than error.
     */
    async getSsoClientWebhookConfig(
        clientId: string,
    ): Promise<{ webhookUrl: string; webhookSecret: string } | null> {
        if (!this.baseUrl) {
            log.error('Cannot fetch SSO client webhook config: User service URL not configured.');
            return null;
        }
        const path = `/users/internal/sso-clients/${encodeURIComponent(clientId)}/webhook-config`;
        try {
            const response = await this.request<{ success: boolean; data?: { webhookUrl?: string | null; webhookSecret?: string | null; enabled?: boolean } }>('get', path);
            if (!response?.success || !response.data) {
                log.warn(`SSO webhook config lookup for client ${clientId} returned non-success`);
                return null;
            }
            if (response.data.enabled === false) {
                log.info(`SSO client ${clientId} is disabled, skipping webhook fire`);
                return null;
            }
            if (!response.data.webhookUrl || !response.data.webhookSecret) {
                log.info(`SSO client ${clientId} has no webhook configured, skipping fire`);
                return null;
            }
            return { webhookUrl: response.data.webhookUrl, webhookSecret: response.data.webhookSecret };
        } catch (error: any) {
            log.error(`Failed to fetch SSO webhook config for client ${clientId}: ${error.message}`);
            return null;
        }
    }

    async getBalance(userId: string): Promise<number> {
        if (!this.baseUrl) {
            log.error('Cannot get user balance: User service URL not configured.');
            throw new AppError('User service is not configured.', 503);
        }
        const path = `/users/internal/${userId}/balance`;
        try {
            log.debug(`Fetching XAF balance for user ${userId} via user-service request method.`);
            const response = await this.request<{ success: boolean; data: { balance: number } }>('get', path);

            if (response?.success && typeof response.data?.balance === 'number') {
                log.info(`Successfully fetched XAF balance for user ${userId}: ${response.data.balance}`);
                return response.data.balance;
            } else {
                log.error(`Failed to parse XAF balance from user-service response for user ${userId}`, response);
                throw new AppError('Failed to fetch user XAF balance from user-service (invalid response format).', 500);
            }
        } catch (error: any) {
            log.error(`Error fetching XAF balance for user ${userId} (via request method):`, error.message);
            if (error instanceof AppError) throw error;
            throw new AppError(`Failed to communicate with user service for XAF balance.`, 503);
        }
    }

    async getUsdBalance(userId: string): Promise<number> {
        if (!this.baseUrl) {
            log.error('Cannot get user USD balance: User service URL not configured.');
            throw new AppError('User service is not configured.', 503);
        }
        const path = `/users/internal/${userId}/usd-balance`;
        try {
            log.debug(`Fetching USD balance for user ${userId} via user-service request method.`);
            const response = await this.request<{ success: boolean; data: { usdBalance: number } }>('get', path);

            if (response?.success && typeof response.data?.usdBalance === 'number') {
                log.info(`Successfully fetched USD balance for user ${userId}: ${response.data.usdBalance}`);
                return response.data.usdBalance;
            } else {
                log.error(`Failed to parse USD balance from user-service response for user ${userId}`, response);
                throw new AppError('Failed to fetch user USD balance from user-service (invalid response format).', 500);
            }
        } catch (error: any) {
            log.error(`Error fetching USD balance for user ${userId} (via request method):`, error.message);
            if (error instanceof AppError) throw error;
            throw new AppError(`Failed to communicate with user service for USD balance.`, 503);
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

    /**
     * Whether withdrawals are blocked after an email/phone change. Throws when
     * user-service cannot answer, so callers refuse rather than pay unchecked.
     */
    async getWithdrawalLock(userId: string): Promise<WithdrawalLock> {
        const response = await this.request<{ success: boolean; data: WithdrawalLock }>('get', `/users/internal/${userId}/withdrawal-lock`);
        if (typeof response?.data?.locked !== 'boolean') {
            throw new AppError('Unexpected withdrawal-lock response from user service.', 502);
        }
        return response.data;
    }

    /** Whether the member has set up their authenticator app (Security plan Phase 3). Throws when user-service cannot answer. */
    async isAuthenticatorEnabled(userId: string): Promise<boolean> {
        const response = await this.request<{ success: boolean; data: { enabled: boolean } }>('get', `/users/internal/${userId}/authenticator`);
        if (typeof response?.data?.enabled !== 'boolean') {
            throw new AppError('Unexpected authenticator response from user service.', 502);
        }
        return response.data.enabled;
    }

    /**
     * Checks the member's authenticator (or backup) code for a withdrawal.
     * Resolves when accepted; otherwise throws user-service's own refusal
     * (400 wrong / already used, 429 locked, 403 AUTHENTICATOR_REQUIRED) with
     * its message and code, or 503 when it cannot be reached (fail closed).
     */
    async verifyAuthenticatorCode(userId: string, code: string): Promise<void> {
        const url = `${this.baseUrl}/users/internal/${userId}/authenticator/verify`;
        try {
            await axios.post(url, { code, action: 'withdrawal' }, {
                headers: { Authorization: `Bearer ${this.serviceSecret}`, 'x-service-name': 'payment-service' },
                timeout: 10000,
            });
        } catch (error: any) {
            const status = error.response?.status;
            if (status && status < 500) {
                const refusal = new AppError(error.response?.data?.message || 'Code incorrect.', status);
                if (error.response?.data?.code) (refusal as any).code = error.response.data.code;
                throw refusal;
            }
            log.error(`Authenticator check failed for user ${userId}: ${error.message}`);
            throw new AppError('La vérification du code est momentanément indisponible. Réessayez dans quelques minutes.', 503);
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

    /**
     * Ids (hex strings) of every member of a country, deleted members included
     * (their records still belong to their country). Unknown code → [].
     * Throws on any failure: an admin country filter must never silently turn
     * into "no filter". Callers go through utils/country-members.ts (cached).
     */
    async getUserIdsByCountry(country: string): Promise<string[]> {
        if (!this.baseUrl) {
            throw new AppError('User service is not configured.', 503);
        }
        const headers: Record<string, string> = { 'x-service-name': 'payment-service' };
        if (this.serviceSecret) headers['Authorization'] = `Bearer ${this.serviceSecret}`;
        const response = await axios.get(`${this.baseUrl}/users/internal/ids-by-country`, {
            params: { country },
            headers,
            timeout: 30000,
        });
        if (!response.data?.success || !Array.isArray(response.data.data)) {
            throw new AppError('Unexpected response from user-service ids-by-country.', 502);
        }
        return response.data.data.map((id: unknown) => String(id));
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

    /**
     * Boolean check for "is this user activated?". Used by the paywall middleware
     * on protected payment-service endpoints (withdrawals, etc.). Reuses the
     * existing /active-subscriptions endpoint instead of adding a focused one to
     * minimise user-service surface area. Throws on transport failure so the
     * middleware can return 503 (SUBSCRIPTION_CHECK_UNAVAILABLE) rather than
     * silently 403'ing a subscribed user when user-service is unreachable.
     */
    async hasActiveSubscription(userId: string): Promise<boolean> {
        const subs = await this.getUserActiveSubscriptions(userId);
        return Array.isArray(subs) && subs.length > 0;
    }


    // USD Balance methods for crypto payments
    async updateUserUsdBalance(userId: string, amount: number, movement: LedgerMovement = {}): Promise<void> {
        if (!this.baseUrl) {
            log.error('Cannot update user USD balance: User service URL not configured.');
            throw new AppError('User service is not configured.', 503);
        }
        const path = `/users/internal/${userId}/usd-balance`;
        try {
            log.debug(`Updating USD balance for user ${userId} by ${amount}`);
            const response = await this.request<{ success: boolean; usdBalance?: number }>('post', path, { amount, ...movement });

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

    /**
     * Get referral statistics for a user
     * @param userId - User ID to get stats for
     * @returns Referral stats including direct/indirect referrals with active subscriptions
     */
    async getReferralStats(userId: string): Promise<ReferralStats | null> {
        if (!this.baseUrl) {
            log.error('Cannot get referral stats: User service URL not configured.');
            return null;
        }

        const path = `/users/internal/${userId}/referral-stats`;

        try {
            log.debug(`Getting referral stats for user: ${userId}`);
            const response = await this.request<{ success: boolean; data: ReferralStats }>('get', path);

            if (response?.success && response.data) {
                log.info(`Successfully retrieved referral stats for user: ${userId}`);
                return response.data;
            } else {
                log.warn(`No referral stats found for user: ${userId}`);
                return null;
            }
        } catch (error: any) {
            log.error(`Error getting referral stats for user ${userId}:`, error);
            // Return zeros on error instead of throwing
            return {
                directReferrals: 0,
                indirectReferrals: 0,
                totalReferrals: 0,
                directSubscribedReferrals: 0,
                indirectSubscribedReferrals: 0,
                totalSubscribedReferrals: 0
            };
        }
    }

    // ─── Wallet reservations (user-service /users/internal/wallet) ──────────
    // Withdrawals hold their gross amount from request to final provider answer.
    // Transport errors are thrown (callers fail closed); business answers are returned.

    private async walletCall(method: 'get' | 'post', path: string, data?: any): Promise<{ status: number; body: any }> {
        if (!this.baseUrl) throw new AppError('User service is not configured.', 503);
        try {
            const res = await axios({
                method, url: `${this.baseUrl}/users/internal/wallet${path}`, data, timeout: 15000,
                headers: { Authorization: `Bearer ${this.serviceSecret}`, 'x-service-name': 'payment-service' },
                validateStatus: (s) => s < 500,
            });
            return { status: res.status, body: res.data };
        } catch (error: any) {
            log.error(`Wallet call ${method.toUpperCase()} ${path} failed: ${error.response?.status ?? ''} ${error.message}`);
            throw new AppError('Le service des soldes est momentanément indisponible. Réessayez dans quelques minutes.', 503);
        }
    }

    async reserveWithdrawalFunds(input: { transactionId: string; userId: string; amount: number; currency: 'XAF' | 'USD' }): Promise<ReserveOutcome> {
        const { status, body } = await this.walletCall('post', '/reservations', input);
        if (status === 201 || status === 200) return body?.data?.status === 'already_reserved' ? 'already_reserved' : 'reserved';
        if (status === 409 && body?.code === 'INSUFFICIENT_AVAILABLE_BALANCE') return 'insufficient';
        if (status === 409) return 'conflict';
        if (status === 404 && body?.code !== 'USER_NOT_FOUND') {
            // An older user-service without the wallet routes (rolling deploy): refuse cleanly.
            log.error('user-service has no wallet reservation route: deploy user-service before payment-service');
            throw new AppError('Les retraits sont momentanément indisponibles (mise à jour en cours). Réessayez dans quelques minutes.', 503);
        }
        throw new AppError(body?.message || `Reservation refused (${status})`, status === 404 ? 404 : 400);
    }

    async listReservations(state: string, olderThanMinutes: number): Promise<Array<{ transactionId: string; userId: string; amount: number; currency: string; state: string; updatedAt: string }>> {
        const { status, body } = await this.walletCall('get', `/reservations?state=${encodeURIComponent(state)}&olderThanMinutes=${olderThanMinutes}&limit=2000`);
        if (status !== 200) throw new AppError(body?.message || `Reservation listing failed (${status})`, 503);
        return body?.data ?? [];
    }

    async releaseWithdrawalFunds(transactionId: string, reason: string): Promise<'released' | 'already_released' | 'not_reserved' | 'conflict'> {
        const { status, body } = await this.walletCall('post', `/reservations/${encodeURIComponent(transactionId)}/release`, { reason });
        if (status === 200) return body?.data?.status;
        if (status === 409) return 'conflict';
        throw new AppError(body?.message || `Release refused (${status})`, 400);
    }

    /** Payout confirmed: debit once (converts the reservation, or plain debit for a legacy withdrawal). */
    async settleWithdrawal(input: { transactionId: string; userId: string; amount: number; currency: 'XAF' | 'USD'; description?: string }): Promise<SettleOutcome> {
        const { status, body } = await this.walletCall('post', `/reservations/${encodeURIComponent(input.transactionId)}/convert`, input);
        if (status === 200) return body.data as SettleOutcome;
        throw new AppError(body?.message || `Settlement refused (${status})`, status === 409 ? 409 : 400);
    }

    async getWithdrawalReservation(transactionId: string): Promise<{ state: string; amount: number; currency: string; userId: string } | null> {
        const { status, body } = await this.walletCall('get', `/reservations/${encodeURIComponent(transactionId)}`);
        if (status === 404) return null;
        if (status === 200) return body.data;
        throw new AppError(body?.message || `Reservation lookup failed (${status})`, 503);
    }

    /** Pack prices (user-service subscription plans) for manual activations. */
    async getPlanPrices(): Promise<Record<'CLASSIQUE' | 'CIBLE' | 'UPGRADE', { XAF: number; USD: number }>> {
        const { status, body } = await this.walletCall('get', '/plan-prices');
        if (status !== 200 || !body?.data) throw new AppError('Prix des packs indisponibles : réessayez dans quelques minutes.', 503);
        return body.data;
    }

    async getAvailableBalance(userId: string): Promise<{ balance: number; debt: number; reservedBalance: number; available: number; usdBalance: number; reservedUsdBalance: number; availableUsd: number } | null> {
        const { status, body } = await this.walletCall('get', `/available/${encodeURIComponent(userId)}`);
        if (status === 404) return null;
        return body?.data ?? null;
    }

    async lookupWalletMovements(references: string[]): Promise<Array<{ reference: string; direction: string; amount: number; currency: string }>> {
        if (!references.length) return [];
        const { body } = await this.walletCall('post', '/movements/lookup', { references });
        return body?.data ?? [];
    }

    async listWalletMovements(referencePrefix: string, since: Date): Promise<Array<{ reference: string; direction: string; amount: number; currency: string; userId: string; appliedAt: string }>> {
        const { body } = await this.walletCall('get', `/movements?referencePrefix=${encodeURIComponent(referencePrefix)}&since=${encodeURIComponent(since.toISOString())}&limit=2000`);
        return body?.data ?? [];
    }

}

export const userServiceClient = new UserServiceClient(); 