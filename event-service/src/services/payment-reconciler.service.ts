import Order, { OrderKind, OrderStatus } from '../database/models/order.model';
import ResaleOrder, { ResaleOrderStatus } from '../database/models/resale-order.model';
import { getPaymentIntentState } from './clients/payment.service.client';
import { settleFromWebhook } from './order.service';
import { settleResaleFromWebhook } from './resale.service';
import logger from '../utils/logger';

const log = logger.getLogger('PaymentReconciler');

/**
 * Recovers purchases whose payment callback never arrived.
 *
 * payment-service sends its callback once, with no retry. When that request is
 * lost the buyer has paid and the order sits PENDING forever: no ticket, no
 * organizer credit. This asks payment-service for the real outcome and runs
 * it through the normal settlement — which is idempotent, so racing a late
 * callback is harmless.
 */
const MIN_AGE_MS = 15 * 60 * 1000;          // let the normal callback land first
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // matches payment-service's own payin reconciler
const RECHECK_MS = 30 * 60 * 1000;          // don't re-ask about the same order every tick
const BATCH = 50;

const SUCCESS = new Set(['SUCCEEDED', 'CONFIRMED']);
const TERMINAL_FAILURE = new Set(['FAILED', 'CANCELED', 'EXPIRED', 'ERROR']);

const due = (now: number) => ({
    paymentSessionId: { $exists: true, $ne: null },
    createdAt: { $lt: new Date(now - MIN_AGE_MS), $gt: new Date(now - MAX_AGE_MS) },
    $or: [
        { reconciledAt: { $exists: false } },
        { reconciledAt: { $lt: new Date(now - RECHECK_MS) } },
    ],
});

const outcomeFor = (status: string): 'SUCCEEDED' | string | null => {
    if (SUCCESS.has(status)) return 'SUCCEEDED';
    if (TERMINAL_FAILURE.has(status)) return status;
    return null; // still in flight at the provider
};

export const reconcilePendingPayments = async (): Promise<number> => {
    const now = Date.now();
    let settled = 0;

    const orders = await Order.find({ kind: OrderKind.PRIMARY, status: OrderStatus.PENDING, ...due(now) })
        .sort({ createdAt: 1 }).limit(BATCH).select('_id paymentSessionId').lean();
    for (const o of orders) {
        try {
            const intent = await getPaymentIntentState(String(o.paymentSessionId));
            await Order.updateOne({ _id: o._id }, { $set: { reconciledAt: new Date() } });
            const status = intent ? outcomeFor(intent.status) : null;
            if (!status) continue;
            const res = await settleFromWebhook({ sessionId: String(o.paymentSessionId), status, metadata: intent?.metadata });
            if ('outcome' in res && res.outcome === 'paid') {
                settled++;
                log.warn(`Recovered paid order ${o._id} whose payment callback never arrived.`);
            }
        } catch (err) {
            log.error(`Reconcile order ${o._id} failed: ${(err as Error).message}`);
        }
    }

    const resales = await ResaleOrder.find({ status: ResaleOrderStatus.PENDING, ...due(now) })
        .sort({ createdAt: 1 }).limit(BATCH).select('_id paymentSessionId').lean();
    for (const r of resales) {
        try {
            const intent = await getPaymentIntentState(String(r.paymentSessionId));
            await ResaleOrder.updateOne({ _id: r._id }, { $set: { reconciledAt: new Date() } });
            const status = intent ? outcomeFor(intent.status) : null;
            if (!status) continue;
            const res = await settleResaleFromWebhook({ sessionId: String(r.paymentSessionId), status, metadata: intent?.metadata });
            if ('outcome' in res && res.outcome === 'paid') {
                settled++;
                log.warn(`Recovered paid resale ${r._id} whose payment callback never arrived.`);
            }
        } catch (err) {
            log.error(`Reconcile resale ${r._id} failed: ${(err as Error).message}`);
        }
    }

    return settled;
};
