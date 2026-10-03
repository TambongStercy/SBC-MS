import { Request, Response, NextFunction } from 'express';
import * as orderService from '../../services/order.service';
import * as resaleService from '../../services/resale.service';
import { getPaymentIntentState } from '../../services/clients/payment.service.client';
import logger from '../../utils/logger';

const log = logger.getLogger('WebhookController');

/**
 * payment-service POSTs terminal payment status here.
 *
 * We try primary-order settlement first, then resale-order. Only one will
 * match a given sessionId. Always answer 200 on non-SUCCESS deliveries —
 * payment-service treats non-2xx as delivery failure and would retry a
 * webhook that already ended in FAILED/CANCELLED, hammering us for nothing.
 * Only genuine internal errors respond 500 so provider retries can help.
 */
export const paymentConfirmation = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { sessionId } = req.body || {};
        let { status, metadata } = req.body || {};
        log.info(`Payment webhook: session=${sessionId} status=${status}`);

        // A success is only taken from payment-service itself, never from the
        // callback body: whoever holds the service secret could otherwise post
        // SUCCEEDED for any session and receive tickets for free. If
        // payment-service can't be reached we answer 500; the payment
        // reconciler settles the order from the real status a little later.
        let verifiedAmount: number | undefined;
        // CONFIRMED is a crypto payment's success; settlement only knows SUCCEEDED.
        if (status === 'SUCCEEDED' || status === 'CONFIRMED') {
            const intent = await getPaymentIntentState(String(sessionId));
            if (!intent || (intent.status !== 'SUCCEEDED' && intent.status !== 'CONFIRMED')) {
                log.error(`Unverified ${status} callback for session ${sessionId}: payment-service says ${intent?.status ?? 'unknown session'}. Ignored.`);
                return res.json({ success: true, data: { handled: false, note: 'unverified success' } });
            }
            status = 'SUCCEEDED';
            metadata = intent.metadata;
            verifiedAmount = intent.amount;
        }

        const primary = await orderService.settleFromWebhook({ sessionId, status, metadata });
        if (primary.handled) return res.json({ success: true, data: primary });

        const resale = await resaleService.settleResaleFromWebhook({ sessionId, status, metadata });
        if (resale.handled) return res.json({ success: true, data: resale });

        // Unknown session — safe to return success so no retries pile up.
        res.json({ success: true, data: { handled: false, note: 'unknown session' } });
    } catch (err) {
        log.error(`Payment webhook failed:`, err);
        return res.status(500).json({ success: false, message: (err as Error).message });
    }
};
