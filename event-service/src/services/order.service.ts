import { Types, ClientSession } from 'mongoose';
import mongoose from 'mongoose';
import Event, { EventStatus } from '../database/models/event.model';
import TicketType, { TicketTypeStatus, saleWindowState } from '../database/models/ticket-type.model';
import Order, { IOrder, OrderKind, OrderStatus } from '../database/models/order.model';
import Ticket, { TicketStatus } from '../database/models/ticket.model';
import Commission, { CommissionKind } from '../database/models/commission.model';
import { generateTicketSerial } from '../utils/serial';
import { generateQrToken, renderQrDataUrl } from './qr.service';
import { getCommissionConfig } from './clients/settings.service.client';
import { creditEventOrganizerBalance } from './clients/user.service.client';
import { createPrimaryOrderPaymentIntent } from './clients/payment.service.client';
import { notifyUser } from './clients/notification.service.client';
import { AppError } from '../utils/errors';
import logger from '../utils/logger';

const log = logger.getLogger('OrderService');

export interface CreateOrderInput {
    userId: string;
    eventId: string;
    items: Array<{ ticketTypeId: string; quantity: number }>;
    holder: {
        firstName: string;
        lastName: string;
        phone: string;
        email?: string;
    };
}

const frDateTime = (d: Date) => d.toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });

/**
 * Sale-window refusal (spec §6/§7). The shared AppError carries no code field
 * and utils/errors.ts isn't ours to widen, so the code rides along as an extra
 * property — the French message stays the user-facing text either way.
 */
const saleWindowError = (message: string, code: 'SALES_NOT_OPEN' | 'SALES_CLOSED') =>
    Object.assign(new AppError(message, 409), { code });

/**
 * Creates a PENDING order + opens a payment session. No seats are reserved yet —
 * settlement (payment webhook) does atomic allocation via a $lte-guarded $inc.
 */
export const createPrimaryOrder = async (input: CreateOrderInput) => {
    if (!input.holder.firstName?.trim() || !input.holder.lastName?.trim() || !input.holder.phone?.trim()) {
        throw new AppError('Nom, prénom et téléphone sont obligatoires.', 400);
    }
    if (!input.items?.length) throw new AppError('Sélectionnez au moins un billet.', 400);

    const event = await Event.findById(new Types.ObjectId(input.eventId));
    if (!event) throw new AppError('Événement introuvable.', 404);
    if (event.status !== EventStatus.PUBLISHED) throw new AppError('Cet événement n\'est pas ouvert à la vente.', 409);
    if (event.endsAt && event.endsAt < new Date()) throw new AppError('Cet événement est terminé.', 409);

    // Fetch ticket types + guard against basic invariants
    const ttIds = input.items.map((i) => new Types.ObjectId(i.ticketTypeId));
    const ttDocs = await TicketType.find({ _id: { $in: ttIds }, eventId: event._id });
    const ttById = new Map(ttDocs.map((t) => [String(t._id), t]));

    const now = new Date();
    let subtotal = 0;
    for (const item of input.items) {
        const tt = ttById.get(item.ticketTypeId);
        if (!tt) throw new AppError('Type de billet inconnu.', 400);
        if (tt.status !== TicketTypeStatus.ACTIVE) throw new AppError(`Le billet « ${tt.name} » n'est plus en vente.`, 409);
        // Sale window (spec §6/§7). Checked at order creation only: refusing at
        // settlement would mean taking the buyer's money and then saying no.
        const window = saleWindowState(tt, now);
        if (window === 'SALES_NOT_OPEN') {
            throw saleWindowError(
                `La vente du billet « ${tt.name} » ouvre le ${frDateTime(tt.salesStart!)}.`,
                'SALES_NOT_OPEN',
            );
        }
        if (window === 'SALES_CLOSED') {
            throw saleWindowError(
                `La vente du billet « ${tt.name} » est terminée depuis le ${frDateTime(tt.salesEnd!)}.`,
                'SALES_CLOSED',
            );
        }
        if (item.quantity < 1 || item.quantity > tt.maxPerOrder) {
            throw new AppError(`Vous ne pouvez commander qu'entre 1 et ${tt.maxPerOrder} billets de type « ${tt.name} ».`, 400);
        }
        // Cheap pre-check; settlement re-checks atomically.
        const available = Math.max(0, tt.quantityTotal - tt.quantitySold);
        if (item.quantity > available) throw new AppError(`Il ne reste que ${available} billet(s) « ${tt.name} ».`, 409);
        subtotal += tt.price * item.quantity;
    }

    const { primaryPct } = await getCommissionConfig();
    const commission = Math.round(subtotal * primaryPct);
    const total = subtotal; // buyer pays subtotal; commission is split at settlement

    const order = await Order.create({
        userId: new Types.ObjectId(input.userId),
        eventId: event._id,
        kind: OrderKind.PRIMARY,
        items: input.items.map((i) => ({
            ticketTypeId: new Types.ObjectId(i.ticketTypeId),
            quantity: i.quantity,
            unitPrice: ttById.get(i.ticketTypeId)!.price,
        })),
        subtotal,
        commission,
        total,
        status: OrderStatus.PENDING,
        holder: input.holder,
    });

    try {
        const intent = await createPrimaryOrderPaymentIntent({
            userId: input.userId,
            amount: total,
            orderId: String(order._id),
            eventTitle: event.title,
        });
        order.paymentSessionId = intent.sessionId;
        await order.save();
        return { order, paymentSession: intent };
    } catch (err) {
        order.status = OrderStatus.FAILED;
        order.failedAt = new Date();
        await order.save().catch(() => undefined);
        throw err;
    }
};

/**
 * Payment webhook entry point. Called by payment-service (service-to-service).
 * Idempotent: a second delivery for the same sessionId is a no-op.
 */
export const settleFromWebhook = async (payload: {
    sessionId: string;
    status: string;
    metadata?: Record<string, any>;
}) => {
    const { sessionId, status, metadata } = payload;
    if (!sessionId) throw new AppError('sessionId is required', 400);

    // PRIMARY only. A resale purchase writes BOTH a top-level Order(kind=RESALE)
    // and a ResaleOrder against the same session; without this filter the primary
    // path claimed that session, answered "handled", and the resale settlement —
    // which transfers the ticket, issues the new QR and credits the seller —
    // never ran. The buyer paid and received nothing.
    const order = await Order.findOne({ paymentSessionId: sessionId, kind: OrderKind.PRIMARY });
    if (!order) {
        // Could be a resale order — handled by resale.service. Return silently so
        // payment-service records delivery (avoids retry storms).
        log.warn(`No primary order found for session ${sessionId}`);
        return { handled: false };
    }

    // Idempotency guard
    if (order.status === OrderStatus.PAID || order.status === OrderStatus.REFUNDED) {
        return { handled: true, alreadyProcessed: true };
    }

    if (status !== 'SUCCEEDED') {
        order.status = OrderStatus.FAILED;
        order.failedAt = new Date();
        order.metadata = { ...(order.metadata || {}), providerStatus: status };
        await order.save();
        return { handled: true, outcome: 'failed' };
    }

    // Atomic seat allocation for each item. If any fails (sold out), roll back.
    const allocated: Types.ObjectId[] = [];
    for (const item of order.items) {
        const res = await TicketType.updateOne(
            {
                _id: item.ticketTypeId,
                $expr: { $lte: [{ $add: ['$quantitySold', item.quantity] }, '$quantityTotal'] },
            },
            { $inc: { quantitySold: item.quantity } },
        );
        if (res.modifiedCount !== 1) {
            // Roll back what we did allocate
            await Promise.all(allocated.map((_id) => TicketType.updateOne({ _id }, { $inc: { quantitySold: -item.quantity } })));
            order.status = OrderStatus.CANCELLED;
            order.metadata = { ...(order.metadata || {}), reason: `Sold out for ticket type ${item.ticketTypeId}` };
            await order.save();
            log.warn(`Sold-out race for order ${order._id} on ${item.ticketTypeId}`);
            return { handled: true, outcome: 'sold_out', ticketTypeId: String(item.ticketTypeId) };
        }
        allocated.push(item.ticketTypeId);
    }

    // Mint tickets
    const event = await Event.findById(order.eventId);
    if (!event) throw new AppError('Event vanished', 500);

    const ticketDocs = [];
    for (const item of order.items) {
        for (let n = 0; n < item.quantity; n++) {
            ticketDocs.push({
                orderId: order._id,
                eventId: order.eventId,
                ticketTypeId: item.ticketTypeId,
                ownerUserId: order.userId,
                serial: generateTicketSerial(),
                qrToken: generateQrToken(),
                status: TicketStatus.ISSUED,
                holderName: `${order.holder.firstName} ${order.holder.lastName}`,
                holderPhone: order.holder.phone,
                holderEmail: order.holder.email,
                issuedAt: new Date(),
            });
        }
    }
    const tickets = await Ticket.insertMany(ticketDocs);

    // Update event denorm totals (non-critical; a bad update mustn't break settlement)
    try {
        await Event.updateOne(
            { _id: order.eventId },
            {
                $inc: {
                    'totals.ticketsSold': tickets.length,
                    'totals.grossRevenue': order.total,
                    'totals.commissionRevenue': order.commission,
                },
            },
        );
    } catch (err) {
        log.warn(`Event denorm totals update failed for ${order.eventId}: ${(err as Error).message}`);
    }

    // Book the commission row (audit)
    try {
        await Commission.create({
            kind: CommissionKind.PRIMARY,
            orderId: order._id,
            eventId: order.eventId,
            basisAmount: order.subtotal,
            rate: order.subtotal ? order.commission / order.subtotal : 0,
            amount: order.commission,
            sbcRevenueBookedAt: new Date(),
        });
    } catch (err) {
        log.warn(`Commission row insert failed for ${order._id}: ${(err as Error).message}`);
    }

    order.status = OrderStatus.PAID;
    order.paidAt = new Date();
    await order.save();

    // Credit organizer balance (net of commission). Best-effort — sweeper retries.
    try {
        const orgNet = order.subtotal - order.commission;
        if (orgNet > 0) {
            await creditEventOrganizerBalance({
                userId: String(event.organizerId),
                amount: orgNet,
                reference: `event-order:${order._id}`,
                description: `Vente billets « ${event.title} »`,
            });
            order.creditedAt = new Date();
            await order.save();
        }
    } catch (err) {
        log.error(`Organizer credit failed for order ${order._id}: ${(err as Error).message} — sweeper will retry.`);
    }

    // Best-effort buyer notification (never let this rollback settlement)
    try {
        await notifyUser({
            kind: 'event-ticket-purchased',
            userId: String(order.userId),
            // Time-critical for the buyer: push + email + SMS. The holder block
            // always carries a phone and often an email — no user-service hop.
            channels: ['push', 'email', 'sms'],
            email: order.holder.email,
            phone: order.holder.phone,
            subject: `🎫 Vos billets SBC Event — ${event.title}`,
            body: `Votre paiement pour ${event.title} est confirmé.`,
            data: {
                eventTitle: event.title,
                ticketSerial: tickets[0].serial,
                ticketType: '', // filled by template if provided by caller in future
                quantity: tickets.length,
                eventDate: event.startsAt.toISOString(),
                eventVenue: event.venue,
                name: order.holder.firstName,
            },
            orderId: String(order._id),
            eventId: String(event._id),
        });
    } catch { /* audit-logged inside notify */ }

    return { handled: true, outcome: 'paid', orderId: String(order._id), ticketCount: tickets.length };
};

export const getOrder = async (userId: string, orderId: string) => {
    const order = await Order.findOne({ _id: new Types.ObjectId(orderId), userId: new Types.ObjectId(userId) }).lean();
    if (!order) throw new AppError('Commande introuvable.', 404);
    return order;
};

export const listMyOrders = async (userId: string, params: { limit?: number; skip?: number }) => {
    const filter = { userId: new Types.ObjectId(userId) };
    const [items, total] = await Promise.all([
        Order.find(filter).sort({ createdAt: -1 }).limit(params.limit ?? 20).skip(params.skip ?? 0).lean(),
        Order.countDocuments(filter),
    ]);
    return { items, total };
};

/** For sweeper: retry organizer credit for orders that failed on first attempt. */
export const sweepPendingPayouts = async (): Promise<number> => {
    const unpaid = await Order.find({ status: OrderStatus.PAID, creditedAt: { $exists: false } }).limit(50);
    let credited = 0;
    for (const order of unpaid) {
        try {
            const event = await Event.findById(order.eventId);
            if (!event) continue;
            const orgNet = order.subtotal - order.commission;
            if (orgNet <= 0) {
                order.creditedAt = new Date();
                await order.save();
                continue;
            }
            await creditEventOrganizerBalance({
                userId: String(event.organizerId),
                amount: orgNet,
                reference: `event-order:${order._id}`,
                description: `Vente billets « ${event.title} » (rattrapage)`,
            });
            order.creditedAt = new Date();
            await order.save();
            credited++;
        } catch (err) {
            log.warn(`Sweeper credit failed for order ${order._id}: ${(err as Error).message}`);
        }
    }
    return credited;
};
