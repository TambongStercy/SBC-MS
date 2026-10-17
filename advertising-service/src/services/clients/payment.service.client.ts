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

/**
 * Pays part of a campaign from the annonceur's SBC balance. payment-service
 * takes it in one conditional debit and writes it in the wallet history.
 * Returns false when the balance no longer covers it (409).
 */
export const spendFromBalance = async (args: {
    userId: string;
    amount: number;
    reference: string;
    campaignId: string;
    campaignTitle: string;
}): Promise<boolean> => {
    try {
        await client.post('/internal/balance-spend', {
            userId: args.userId,
            amount: args.amount,
            reference: args.reference,
            description: `Campagne SBC Ads Network : ${args.campaignTitle}`,
            metadata: { campaignId: args.campaignId, originatingService: 'advertising-service' },
        });
        return true;
    } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 409) return false;
        log.error(`Balance payment failed for campaign ${args.campaignId}: ${(err as Error).message}`);
        throw new AppError('Le paiement avec le solde SBC a échoué. Réessayez.', 502);
    }
};

/** Gives a balance payment back. Safe to call again: payment-service refunds a reference once. */
export const refundBalanceSpend = async (args: { userId: string; reference: string; campaignTitle: string }) => {
    await client.post('/internal/balance-refund', {
        userId: args.userId,
        reference: args.reference,
        description: `Remboursement campagne SBC Ads Network : ${args.campaignTitle}`,
    });
};
