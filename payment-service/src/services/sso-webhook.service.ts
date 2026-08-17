import axios from 'axios';
import crypto from 'crypto';
import { IPaymentIntent } from '../database/interfaces/IPaymentIntent';
import { userServiceClient } from './clients/user.service.client';
import { paymentIntentRepository } from '../database/repositories/paymentIntent.repository';
import logger from '../utils/logger';

const log = logger.getLogger('SsoWebhookService');

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [5_000, 30_000]; // Backoff between attempts 1→2, 2→3
const REQUEST_TIMEOUT_MS = 10_000;

interface WebhookPayload {
    event: 'payment.succeeded' | 'payment.failed' | 'payment.canceled';
    sessionId: string;
    paymentIntentId: string;
    status: string;
    amount: number | null;
    currency: string | null;
    paidAmount: number | null;
    paidCurrency: string | null;
    userId: string;
    beneficiaryUserId: string | null;
    splitBeneficiaryCredit: number | null;
    splitSbcCommission: number | null;
    subscriptionType: string | null;
    subscriptionPlan: string | null;
    clientReference: string | null;
    completedAt: string;
}

/**
 * Outbound webhook to third-party SSO clients (currently: SBC Live).
 *
 * Fires on terminal payment statuses (SUCCEEDED, FAILED, CANCELED) for intents
 * that were created via the SSO endpoint. Lets brother's app react to payment
 * outcomes without polling.
 *
 * Signature scheme: HMAC-SHA256(rawJsonBody, webhookSecret), delivered as
 * `X-SBC-Signature: sha256=<hex>` plus `X-SBC-Webhook-Timestamp: <unix-ms>`
 * (the timestamp is also embedded in the signed body to prevent replay).
 *
 * Retry policy: in-process, blocking. Up to 3 attempts, 5s then 30s backoff.
 * Not durable across restarts — sufficient for v1 because brother can always
 * fall back to polling GET /api/payments/intents/:sessionId/status. A future
 * batch can swap this for Bull/Redis once volume justifies it.
 *
 * Idempotency contract for the receiver: brother must dedupe on
 * `paymentIntentId + status` because retries / network blips can deliver the
 * same event more than once. The HMAC signature is over the exact body, so
 * delivery #2 has the identical signature as #1.
 *
 * We do NOT wrap each attempt in a try/catch for the whole batch — the outer
 * caller (handlePaymentCompletion) already swallows exceptions to keep the
 * payment finalization path from rolling back. We just log loudly on each
 * failure.
 */
class SsoWebhookService {
    public async firePaymentEvent(paymentIntent: IPaymentIntent): Promise<void> {
        const meta = paymentIntent.metadata || {};
        if (meta.paymentSource !== 'sso_third_party') {
            return; // Not an SSO payment, nothing to send
        }
        const clientId = meta.ssoClientId as string | undefined;
        if (!clientId) {
            log.warn(`SSO webhook: PaymentIntent ${paymentIntent.sessionId} has no ssoClientId, skipping`);
            return;
        }

        const event = this.mapStatusToEvent(paymentIntent.status);
        if (!event) {
            // Non-terminal status — don't fire
            return;
        }

        // Idempotency guard: don't re-fire the same event for the same intent
        // unless an admin explicitly clears the flag. Provider webhook retries
        // can call handlePaymentCompletion twice in a row.
        const lastFired = meta.lastWebhookFiredEvent as string | undefined;
        if (lastFired === event) {
            log.info(`SSO webhook: already fired ${event} for PaymentIntent ${paymentIntent.sessionId}, skipping duplicate`);
            return;
        }

        const config = await userServiceClient.getSsoClientWebhookConfig(clientId);
        if (!config) {
            return; // user.service.client logged already
        }

        const payload = this.buildPayload(paymentIntent, event);
        const rawBody = JSON.stringify(payload);
        const signature = this.sign(rawBody, config.webhookSecret);
        const timestamp = String(payload.completedAtMs);

        let delivered = false;
        let lastError: string | null = null;
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                const res = await axios.post(config.webhookUrl, rawBody, {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-SBC-Signature': `sha256=${signature}`,
                        'X-SBC-Webhook-Timestamp': timestamp,
                        'X-SBC-Webhook-Event': event,
                        'User-Agent': 'sbc-payment-service-webhook/1',
                    },
                    timeout: REQUEST_TIMEOUT_MS,
                });
                if (res.status >= 200 && res.status < 300) {
                    delivered = true;
                    log.info(`SSO webhook delivered: client=${clientId} event=${event} session=${paymentIntent.sessionId} attempt=${attempt} status=${res.status}`);
                    break;
                }
                lastError = `HTTP ${res.status}`;
                log.warn(`SSO webhook attempt ${attempt}/${MAX_ATTEMPTS} for client=${clientId} session=${paymentIntent.sessionId} got ${res.status}, will retry`);
            } catch (error: any) {
                lastError = error.response ? `HTTP ${error.response.status}` : error.message;
                log.warn(`SSO webhook attempt ${attempt}/${MAX_ATTEMPTS} for client=${clientId} session=${paymentIntent.sessionId} failed: ${lastError}`);
            }
            if (attempt < MAX_ATTEMPTS) {
                await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]));
            }
        }

        // Persist delivery state so admins can see what happened and brother's
        // app can dedupe on retry. Don't fail the whole completion path if this
        // write errors — the customer's payment already succeeded.
        try {
            await paymentIntentRepository.update(String(paymentIntent._id), {
                metadata: {
                    ...meta,
                    lastWebhookFiredEvent: event,
                    lastWebhookFiredAt: new Date(),
                    lastWebhookDelivered: delivered,
                    lastWebhookError: delivered ? null : lastError,
                    webhookAttemptCount: (meta.webhookAttemptCount || 0) + MAX_ATTEMPTS,
                },
            });
        } catch (persistError: any) {
            log.error(`SSO webhook: failed to persist delivery state for ${paymentIntent.sessionId}: ${persistError.message}`);
        }

        if (!delivered) {
            log.error(`SSO webhook PERMANENTLY FAILED after ${MAX_ATTEMPTS} attempts: client=${clientId} event=${event} session=${paymentIntent.sessionId} lastError=${lastError}. Brother's app can recover by polling GET /api/payments/intents/${paymentIntent.sessionId}/status.`);
        }
    }

    private mapStatusToEvent(status: string): WebhookPayload['event'] | null {
        if (status === 'SUCCEEDED') return 'payment.succeeded';
        if (status === 'FAILED') return 'payment.failed';
        if (status === 'CANCELED') return 'payment.canceled';
        return null; // PROCESSING, PENDING, etc. — don't fire
    }

    private buildPayload(intent: IPaymentIntent, event: WebhookPayload['event']): WebhookPayload & { completedAtMs: number } {
        const meta = intent.metadata || {};
        const now = new Date();
        return {
            event,
            sessionId: intent.sessionId,
            paymentIntentId: String(intent._id),
            status: intent.status,
            amount: intent.amount ?? null,
            currency: intent.currency ?? null,
            paidAmount: intent.paidAmount ?? null,
            paidCurrency: intent.paidCurrency ?? null,
            userId: intent.userId,
            beneficiaryUserId: meta.beneficiaryUserId || null,
            splitBeneficiaryCredit: meta.splitBeneficiaryCredit ?? null,
            splitSbcCommission: meta.splitSbcCommission ?? null,
            subscriptionType: meta.ssoSubscriptionType || null,
            subscriptionPlan: meta.ssoSubscriptionPlan || null,
            clientReference: meta.ssoClientReference || null,
            completedAt: now.toISOString(),
            completedAtMs: now.getTime(),
        };
    }

    private sign(rawBody: string, secret: string): string {
        return crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
    }
}

export const ssoWebhookService = new SsoWebhookService();
export default ssoWebhookService;
