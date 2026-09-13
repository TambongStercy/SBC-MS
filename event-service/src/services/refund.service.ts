import { Types } from 'mongoose';
import Order, { OrderStatus, OrderKind } from '../database/models/order.model';
import Ticket, { TicketStatus } from '../database/models/ticket.model';
import ResaleListing, { ResaleListingStatus } from '../database/models/resale-listing.model';
import Refund, { RefundStatus } from '../database/models/refund.model';
import Event from '../database/models/event.model';
import { creditBuyerBalance } from './clients/payment.service.client';
import { notify } from './clients/notification.service.client';
import { getEventUserDetails } from './clients/user.service.client';
import { AppError } from '../utils/errors';
import logger from '../utils/logger';

const log = logger.getLogger('RefundService');

/**
 * Refund a PAID order. Idempotent:
 *  - if already REFUNDED, returns a no-op success
 *  - the wallet credit is guarded by a Refund record with status=COMPLETED,
 *    so a retry after a wallet-credit failure only re-attempts the credit
 *
 * Cascade:
 *  1. Order → REFUNDED (marks it done for the sweeper too)
 *  2. Every ticket → REFUNDED, qrToken=null (spec §21: scan of a refunded
 *     ticket must be refused)
 *  3. Every ACTIVE ResaleListing on those tickets → CANCELLED (spec §27)
 *  4. Credit buyer's main balance via payment-service /internal/deposit
 *     (recorded as an internal Transaction there for audit)
 *  5. Local Refund record → COMPLETED
 *  6. Best-effort buyer notification
 */
export const refundOrder = async (args: {
    orderId: string;
    initiatedByAdminId: string;
    reason?: string;
}): Promise<{ order: any; refunded: boolean; alreadyRefunded?: boolean }> => {
    const order = await Order.findById(new Types.ObjectId(args.orderId));
    if (!order) throw new AppError('Commande introuvable.', 404);
    if (order.status === OrderStatus.REFUNDED) {
        // Return whatever local Refund row we have for reference
        return { order, refunded: true, alreadyRefunded: true };
    }
    if (order.status !== OrderStatus.PAID) {
        throw new AppError('Seule une commande payée peut être remboursée.', 409);
    }
    if (order.kind === OrderKind.RESALE) {
        // Resale refunds are a can of worms — the seller was already paid
        // and their ticket was already destroyed. V1 refuses; admin needs
        // to reconcile manually.
        throw new AppError(
            'Le remboursement automatique d\'une commande de revente n\'est pas encore supporté. Contactez le support SBC.',
            501,
        );
    }

    // Local Refund record (idempotent on orderId — one refund per order).
    // Check first; if a COMPLETED one exists, don't credit again.
    const existingCompleted = await Refund.findOne({ orderId: order._id, status: RefundStatus.COMPLETED });
    if (existingCompleted) {
        // Domain state may have drifted (order still PAID?) — reconcile it.
        order.status = OrderStatus.REFUNDED;
        await order.save();
        return { order, refunded: true, alreadyRefunded: true };
    }

    const refund = await Refund.findOneAndUpdate(
        { orderId: order._id },
        {
            $setOnInsert: {
                orderId: order._id,
                amount: order.total,
                reason: args.reason,
                initiatedByAdminId: new Types.ObjectId(args.initiatedByAdminId),
                status: RefundStatus.PENDING,
            },
        },
        { upsert: true, new: true },
    );

    // Flip order + tickets + listings BEFORE we move money — this prevents
    // the buyer from spending a refunded ticket while the wallet credit is
    // in-flight. If the credit fails, we retry it; the domain state is
    // already correct.
    order.status = OrderStatus.REFUNDED;
    await order.save();

    const tickets = await Ticket.find({ orderId: order._id });
    const ticketIds = tickets.map((t) => t._id);
    if (ticketIds.length > 0) {
        await Ticket.updateMany(
            { _id: { $in: ticketIds }, status: { $ne: TicketStatus.CHECKED_IN } },
            { $set: { status: TicketStatus.REFUNDED, qrToken: null, refundedAt: new Date() } },
        );
        await ResaleListing.updateMany(
            { ticketId: { $in: ticketIds }, status: ResaleListingStatus.ACTIVE },
            { $set: { status: ResaleListingStatus.CANCELLED, cancelledAt: new Date() } },
        );
    }

    // Money movement. Failure here leaves the domain state closed AND the
    // Refund row PENDING — a follow-up admin retry (or a sweep) can re-attempt.
    try {
        const tx = await creditBuyerBalance({
            userId: String(order.userId),
            amount: order.total,
            description: `Remboursement commande événement (${order._id})`,
            reference: `event-refund:${order._id}`,
            eventId: String(order.eventId),
        });
        refund.status = RefundStatus.COMPLETED;
        refund.providerRef = tx.transactionId;
        refund.completedAt = new Date();
        await refund.save();
    } catch (err) {
        log.error(`Refund wallet credit failed for order ${order._id} — Refund left PENDING:`, err);
        refund.status = RefundStatus.FAILED;
        await refund.save();
        // Do NOT throw — the domain state is already closed (tickets invalid,
        // order REFUNDED). The wallet credit needs manual retry, not rollback.
    }

    // Best-effort buyer notification
    try {
        const event = await Event.findById(order.eventId).lean();
        // Resolve email (order.holder.email may be missing since it's optional)
        let email = order.holder.email;
        if (!email) {
            const [profile] = await getEventUserDetails([String(order.userId)]);
            email = profile?.email;
        }
        if (email) {
            await notify({
                kind: 'refund-processed',
                userId: String(order.userId),
                channel: 'email',
                recipient: email,
                subject: `💰 Remboursement effectué — ${event?.title || ''}`,
                body: `Votre commande a été remboursée.`,
                data: {
                    eventTitle: event?.title,
                    amount: order.total,
                    orderRef: String(order._id),
                    name: order.holder.firstName,
                },
                orderId: String(order._id),
                eventId: String(order.eventId),
            });
        }
    } catch { /* logged inside notify */ }

    return { order, refunded: true };
};

/**
 * Bulk refund every PAID order for an event. Used by the event-cancellation
 * cascade. Continues on individual failures so one bad refund doesn't wedge
 * the whole cancellation.
 */
export const refundAllOrdersForEvent = async (args: {
    eventId: string;
    initiatedByAdminId: string;
    reason?: string;
}): Promise<{ processed: number; refunded: number; failed: number }> => {
    const orders = await Order.find({
        eventId: new Types.ObjectId(args.eventId),
        status: OrderStatus.PAID,
        kind: OrderKind.PRIMARY,
    }).select('_id');

    let refunded = 0;
    let failed = 0;
    for (const o of orders) {
        try {
            await refundOrder({ orderId: String(o._id), initiatedByAdminId: args.initiatedByAdminId, reason: args.reason });
            refunded++;
        } catch (err) {
            failed++;
            log.warn(`Bulk refund failed for order ${o._id}: ${(err as Error).message}`);
        }
    }
    return { processed: orders.length, refunded, failed };
};

/** Retry PENDING/FAILED refunds — called by the scheduler. */
export const retryPendingRefunds = async (): Promise<number> => {
    const pending = await Refund.find({ status: { $in: [RefundStatus.PENDING, RefundStatus.FAILED] } }).limit(20);
    let retried = 0;
    for (const r of pending) {
        const order = await Order.findById(r.orderId);
        if (!order) continue;
        try {
            const tx = await creditBuyerBalance({
                userId: String(order.userId),
                amount: r.amount,
                description: `Remboursement commande événement (${order._id}) — rattrapage`,
                reference: `event-refund:${order._id}`,
                eventId: String(order.eventId),
            });
            r.status = RefundStatus.COMPLETED;
            r.providerRef = tx.transactionId;
            r.completedAt = new Date();
            await r.save();
            retried++;
        } catch (err) {
            log.warn(`Refund retry failed for ${r._id}: ${(err as Error).message}`);
        }
    }
    return retried;
};
