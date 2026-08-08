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
        'X-Service-Name': 'advertising-service',
    },
});

/**
 * Opens a payment session for a campaign.
 *
 * `callbackPath` is how the campaign ever goes live: payment-service posts the
 * terminal status back to it, and that callback is the only caller of activation.
 * It is an internal address — payment-service calls it service-to-service, not
 * through the gateway.
 */
export const createCampaignPaymentIntent = async (args: {
    userId: string;
    amount: number;
    campaignId: string;
    campaignTitle: string;
}) => {
    try {
        const { data, status } = await client.post<PaymentIntentResponse>('/payments/intents', {
            userId: args.userId,
            amount: args.amount,
            currency: 'XAF',
            paymentType: 'AD_CAMPAIGN',
            metadata: {
                campaignId: args.campaignId,
                campaignTitle: args.campaignTitle,
                userId: args.userId,
                originatingService: 'advertising-service',
                callbackPath: `${config.selfBaseUrl.replace(/\/$/, '')}/api/advertising/webhooks/payment-confirmation`,
            },
        });

        if (!data?.success || !data.data?.sessionId) {
            throw new AppError(data?.message || 'Le service de paiement n\'a pas pu ouvrir la session.', status);
        }
        return data.data;
    } catch (err) {
        if (err instanceof AppError) throw err;
        log.error(`Failed to create payment intent for campaign ${args.campaignId}: ${(err as Error).message}`);
        if (axios.isAxiosError(err)) {
            throw new AppError(
                err.response?.data?.message || 'Le service de paiement est injoignable.',
                err.response?.status || 502,
            );
        }
        throw new AppError('Le service de paiement est injoignable.', 502);
    }
};
