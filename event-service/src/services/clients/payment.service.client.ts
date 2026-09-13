import axios from 'axios';
import config from '../../config';
import { AppError } from '../../utils/errors';
import logger from '../../utils/logger';

const log = logger.getLogger('PaymentServiceClient');

interface PaymentIntentResponse {
    success: boolean;
    data?: {
        sessionId: string;
        clientSecret?: string;
    };
    message?: string;
}

const client = axios.create({
    baseURL: config.services.paymentService,
    timeout: 10000,
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.services.serviceSecret}`,
        'X-Service-Name': 'event-service',
    },
});

/**
 * Open a payment session for a primary ticket purchase.
 *
 * `callbackPath` is how tickets ever become ISSUED: payment-service POSTs the
 * terminal status back to it, and that callback is the only caller of settlement.
 * It's the internal address (service-to-service, not through the gateway) — so it
 * MUST come from config.selfBaseUrl derived from the running port, otherwise
 * preprod callbacks would land on prod.
 */
export const createPrimaryOrderPaymentIntent = async (args: {
    userId: string;
    amount: number;
    orderId: string;
    eventTitle: string;
}) => {
    return openIntent({
        userId: args.userId,
        amount: args.amount,
        paymentType: 'EVENT_TICKET_PURCHASE',
        metadata: {
            orderId: args.orderId,
            eventTitle: args.eventTitle,
        },
    });
};

/** Open a payment session for a resale purchase. Different `paymentType` so the
 *  commission-config resolver picks the resale rate. */
export const createResaleOrderPaymentIntent = async (args: {
    userId: string;
    amount: number;
    resaleOrderId: string;
    eventTitle: string;
}) => {
    return openIntent({
        userId: args.userId,
        amount: args.amount,
        paymentType: 'EVENT_TICKET_RESALE',
        metadata: {
            resaleOrderId: args.resaleOrderId,
            eventTitle: args.eventTitle,
        },
    });
};

const openIntent = async (args: {
    userId: string;
    amount: number;
    paymentType: string;
    metadata: Record<string, unknown>;
}) => {
    try {
        const { data, status } = await client.post<PaymentIntentResponse>('/payments/intents', {
            userId: args.userId,
            amount: args.amount,
            currency: 'XAF',
            paymentType: args.paymentType,
            metadata: {
                ...args.metadata,
                userId: args.userId,
                originatingService: 'event-service',
                callbackPath: `${config.selfBaseUrl.replace(/\/$/, '')}/api/tickets/webhooks/payment-confirmation`,
            },
        });

        if (!data?.success || !data.data?.sessionId) {
            throw new AppError(data?.message || 'Le service de paiement n\'a pas pu ouvrir la session.', status);
        }
        return data.data;
    } catch (err) {
        if (err instanceof AppError) throw err;
        log.error(`Failed to create payment intent: ${(err as Error).message}`);
        if (axios.isAxiosError(err)) {
            throw new AppError(
                err.response?.data?.message || 'Le service de paiement est injoignable.',
                err.response?.status || 502,
            );
        }
        throw new AppError('Le service de paiement est injoignable.', 502);
    }
};
