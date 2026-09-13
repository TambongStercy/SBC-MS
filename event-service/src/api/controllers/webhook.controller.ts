import { Request, Response, NextFunction } from 'express';
import * as orderService from '../../services/order.service';
import logger from '../../utils/logger';

const log = logger.getLogger('WebhookController');

/**
 * payment-service POSTs terminal payment status here.
 *
 * Always returns 200 on non-SUCCESS deliveries — payment-service treats
 * non-2xx as delivery failure and would retry a webhook that ended in
 * FAILED/CANCELLED, hammering us for nothing. Only genuine internal errors
 * respond 500 so provider retries can help.
 */
export const paymentConfirmation = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { sessionId, status, metadata } = req.body || {};
        log.info(`Payment webhook: session=${sessionId} status=${status}`);

        const primary = await orderService.settleFromWebhook({ sessionId, status, metadata });
        if (primary.handled) {
            return res.json({ success: true, data: primary });
        }

        // If the session doesn't match a primary order, it's either a resale
        // order or noise — safe to return success so no retries pile up.
        res.json({ success: true, data: { handled: false, note: 'unknown session' } });
    } catch (err) {
        log.error(`Payment webhook failed:`, err);
        return res.status(500).json({ success: false, message: (err as Error).message });
    }
};
