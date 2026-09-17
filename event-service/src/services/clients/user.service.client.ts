import axios from 'axios';
import config from '../../config';
import { AppError } from '../../utils/errors';
import logger from '../../utils/logger';

const log = logger.getLogger('UserServiceClient');

const client = axios.create({
    baseURL: config.services.userService,
    timeout: 10000,
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.services.serviceSecret}`,
        'X-Service-Name': 'event-service',
    },
});

export interface EventUserDetails {
    _id: string;
    name?: string;
    email?: string;
    phoneNumber?: string;
    avatar?: string;
    role?: string;
}

/**
 * Batch profile lookup for ticket-holder hydration. Uses the module-specific
 * projection endpoint (following the sbclove-details / advertising-details
 * precedent) so that if we ever need fields user-service's batch-details doesn't
 * expose, we own the projection.
 */
export const getEventUserDetails = async (userIds: string[]): Promise<EventUserDetails[]> => {
    if (userIds.length === 0) return [];
    try {
        const { data } = await client.post('/users/internal/event-details', { userIds });
        if (!data?.success) throw new AppError(data?.message || 'user-service refused event-details call', 502);
        return (data.data as EventUserDetails[]) || [];
    } catch (err) {
        if (err instanceof AppError) throw err;
        log.error(`event-details fetch failed: ${(err as Error).message}`);
        // Fallback to batch-details so a missing endpoint on user-service doesn't wedge
        // the entire ticket screen — projection is narrower but present.
        try {
            const { data } = await client.post('/users/internal/batch-details', { userIds });
            if (!data?.success) return [];
            return (data.data as EventUserDetails[]) || [];
        } catch {
            return [];
        }
    }
};

/**
 * Credit the seller/organizer's dedicated event balance. Called on:
 *  - primary order settlement (organizer credit)
 *  - resale settlement (seller credit, minus resale commission)
 *
 * `reference` is an idempotency key — user-service must reject a second credit
 * with the same reference to guarantee at-most-once payout.
 */
/**
 * Debit the seller's event-organizer balance during a resale refund.
 * The balance may go negative (docs on user-service side).
 */
export const debitEventOrganizerBalance = async (args: {
    userId: string;
    amount: number;
    reference: string;
    description: string;
}): Promise<{ newEventOrganizerBalance: number; wentNegative: boolean; transactionId: string }> => {
    try {
        const { data } = await client.post(
            '/event-organizer-balance/internal/debit',
            {
                userId: args.userId,
                amount: args.amount,
                reference: args.reference,
                description: args.description,
            },
        );
        if (!data?.success) throw new AppError(data?.message || 'user-service refused debit', 502);
        return data.data;
    } catch (err) {
        if (err instanceof AppError) throw err;
        log.error(`event-organizer-balance debit failed for ${args.userId}: ${(err as Error).message}`);
        if (axios.isAxiosError(err)) {
            throw new AppError(
                err.response?.data?.message || 'user-service unreachable',
                err.response?.status || 502,
            );
        }
        throw new AppError('user-service unreachable', 502);
    }
};

export const creditEventOrganizerBalance = async (args: {
    userId: string;
    amount: number;
    reference: string;
    description: string;
}): Promise<{ newEventOrganizerBalance: number; transactionId: string }> => {
    try {
        const { data } = await client.post(
            '/event-organizer-balance/internal/credit',
            {
                userId: args.userId,
                amount: args.amount,
                reference: args.reference,
                description: args.description,
            },
        );
        if (!data?.success) {
            throw new AppError(data?.message || 'user-service refused credit', 502);
        }
        return data.data;
    } catch (err) {
        if (err instanceof AppError) throw err;
        log.error(`event-organizer-balance credit failed for ${args.userId}: ${(err as Error).message}`);
        if (axios.isAxiosError(err)) {
            throw new AppError(
                err.response?.data?.message || 'user-service unreachable',
                err.response?.status || 502,
            );
        }
        throw new AppError('user-service unreachable', 502);
    }
};
