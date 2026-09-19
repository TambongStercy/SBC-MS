import { Types } from 'mongoose';
import Order, { OrderStatus, OrderKind } from '../database/models/order.model';
import Ticket, { TicketStatus } from '../database/models/ticket.model';
import ResaleListing, { ResaleListingStatus } from '../database/models/resale-listing.model';
import Refund, { RefundStatus } from '../database/models/refund.model';
import Event from '../database/models/event.model';
import { creditBuyerBalance } from './clients/payment.service.client';
import { notifyUser } from './clients/notification.service.client';
import { debitEventOrganizerBalance } from './clients/user.service.client';
import ResaleOrder, { ResaleOrderStatus } from '../database/models/resale-order.model';
import { getCommissionConfig } from './clients/settings.service.client';
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
        // Delegate to the resale-specific path: debit seller, credit buyer,
        // invalidate the new ticket. The seller's balance may go negative
        // if they've already transferred out — that's flagged in the log
        // and audited via the debit transaction.
        return refundResaleOrderInternal(order, args.initiatedByAdminId, args.reason);
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
        // Money moment: push + email + SMS. holder.email is optional — notifyUser
        // falls back to user-service only for the coordinate it's missing.
        await notifyUser({
            kind: 'refund-processed',
            userId: String(order.userId),
            channels: ['push', 'email', 'sms'],
            email: order.holder.email,
            phone: order.holder.phone,
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
    } catch { /* logged inside notify */ }

    return { order, refunded: true };
};

/**
 * Refund a RESALE order. Different money-flow shape from a primary refund:
 *  - the seller was already credited with (askingPrice - resaleCommission)
 *  - the buyer paid the full askingPrice into the payment provider
 *  - the buyer now holds a fresh ticket minted from the old one
 *
 * We reverse the money-flow:
 *  1. Invalidate the new ticket (status→REFUNDED, qrToken=null)
 *  2. Mark the ResaleOrder + top-level Order as REFUNDED/CANCELLED
 *  3. Debit the seller's event-organizer balance for what they were credited
 *     (may go negative — see debit doc)
 *  4. Credit the buyer's main balance for the full order.total
 *  5. Best-effort notification to the buyer
 *
 * We do NOT restore the seller's original ticket — the resale destroyed it
 * and re-minting it would let the seller show up at the event with an
 * already-refunded ticket. If the seller is entitled to their ticket back
 * (e.g. bad-faith dispute against the buyer), an admin action can create
 * a new ticket for them out-of-band.
 */
const refundResaleOrderInternal = async (
    order: any,
    initiatedByAdminId: string,
    reason?: string,
): Promise<{ order: any; refunded: boolean; alreadyRefunded?: boolean }> => {
    if (!order.resaleListingId) throw new AppError('Cette commande de revente n\'a pas d\'annonce liée.', 500);

    const resaleOrder = await ResaleOrder.findOne({ orderId: order._id });
    if (!resaleOrder) throw new AppError('Revente introuvable.', 404);

    // Idempotency — one Refund row per order.
    const existingCompleted = await Refund.findOne({ orderId: order._id, status: RefundStatus.COMPLETED });
    if (existingCompleted) {
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
                reason,
                initiatedByAdminId: new Types.ObjectId(initiatedByAdminId),
                status: RefundStatus.PENDING,
            },
        },
        { upsert: true, new: true },
    );

    // Step 1: flip domain state first.
    order.status = OrderStatus.REFUNDED;
    await order.save();
    if (resaleOrder.status !== ResaleOrderStatus.PAID) {
        // Not fully settled — nothing to reverse on the seller side, treat as
        // a plain buyer refund.
        // (This branch is reachable if admin refunds an order whose resale
        // webhook hasn't landed yet.)
    }
    if (resaleOrder.newTicketId) {
        await Ticket.updateOne(
            { _id: resaleOrder.newTicketId, status: { $ne: TicketStatus.CHECKED_IN } },
            { $set: { status: TicketStatus.REFUNDED, qrToken: null, refundedAt: new Date() } },
        );
    }
    // Also cancel the listing bookkeeping (already SOLD, but flip to CANCELLED
    // for clarity in the admin view).
    const listing = await ResaleListing.findById(order.resaleListingId);

    // Step 2: reverse the seller credit (may go negative).
    let sellerDebit: { wentNegative: boolean; newBalance: number } | null = null;
    if (listing && resaleOrder.status === ResaleOrderStatus.PAID) {
        const { resalePct } = await getCommissionConfig();
        const sellerNetPaid = Math.round(listing.askingPrice - listing.askingPrice * resalePct);
        try {
            const res = await debitEventOrganizerBalance({
                userId: String(listing.sellerUserId),
                amount: sellerNetPaid,
                reference: `resale-refund:${order._id}`,
                description: `Débit remboursement revente (${order._id})`,
            });
            sellerDebit = { wentNegative: res.wentNegative, newBalance: res.newEventOrganizerBalance };
            if (res.wentNegative) {
                log.warn(`Seller ${listing.sellerUserId} went negative on resale refund ${order._id}: ${res.newEventOrganizerBalance}`);
            }
        } catch (err) {
            log.error(`Seller debit failed for resale refund ${order._id}: ${(err as Error).message}`);
            // Continue anyway — the buyer must still get their money.
        }
    }

    // Step 3: credit buyer's main balance.
    try {
        const tx = await creditBuyerBalance({
            userId: String(order.userId),
            amount: order.total,
            description: `Remboursement revente (${order._id})`,
            reference: `event-refund:${order._id}`,
            eventId: String(order.eventId),
        });
        refund.status = RefundStatus.COMPLETED;
        refund.providerRef = tx.transactionId;
        refund.completedAt = new Date();
        await refund.save();
    } catch (err) {
        log.error(`Resale refund wallet credit failed for order ${order._id} — Refund PENDING:`, err);
        refund.status = RefundStatus.FAILED;
        await refund.save();
    }

    // Step 4: best-effort buyer notification.
    try {
        const event = await Event.findById(order.eventId).lean();
        await notifyUser({
            kind: 'refund-processed',
            userId: String(order.userId),
            channels: ['push', 'email', 'sms'],
            email: order.holder.email,
            phone: order.holder.phone,
            subject: `💰 Remboursement effectué — ${event?.title || ''}`,
            body: `Votre commande de revente a été remboursée.`,
            data: {
                eventTitle: event?.title,
                amount: order.total,
                orderRef: String(order._id),
                name: order.holder.firstName,
            },
            orderId: String(order._id),
            eventId: String(order.eventId),
        });
    } catch { /* logged */ }

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
