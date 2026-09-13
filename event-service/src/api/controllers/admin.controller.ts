import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import Event, { EventStatus } from '../../database/models/event.model';
import Order, { OrderStatus } from '../../database/models/order.model';
import Ticket, { TicketStatus } from '../../database/models/ticket.model';
import Organizer, { OrganizerStatus } from '../../database/models/organizer.model';
import Commission from '../../database/models/commission.model';
import ResaleListing from '../../database/models/resale-listing.model';
import * as organizerService from '../../services/organizer.service';
import * as eventService from '../../services/event.service';
import { notify } from '../../services/clients/notification.service.client';
import { AppError } from '../../utils/errors';

/** Admin global stats (spec §26). */
export const dashboard = async (_req: Request, res: Response, next: NextFunction) => {
    try {
        const [organizerAgg, eventAgg, orderAgg, ticketAgg, commissionAgg, resaleAgg] = await Promise.all([
            Organizer.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
            Event.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
            Order.aggregate([
                { $match: { status: OrderStatus.PAID } },
                { $group: { _id: null, gross: { $sum: '$subtotal' }, orderCount: { $sum: 1 } } },
            ]),
            Ticket.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
            Commission.aggregate([
                { $group: { _id: '$kind', total: { $sum: '$amount' }, n: { $sum: 1 } } },
            ]),
            ResaleListing.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
        ]);

        const orgCounts = Object.fromEntries(organizerAgg.map((r: any) => [r._id, r.n]));
        const eventCounts = Object.fromEntries(eventAgg.map((r: any) => [r._id, r.n]));
        const ticketCounts = Object.fromEntries(ticketAgg.map((r: any) => [r._id, r.n]));
        const commissionCounts = Object.fromEntries(commissionAgg.map((r: any) => [r._id, { total: r.total, count: r.n }]));
        const resaleCounts = Object.fromEntries(resaleAgg.map((r: any) => [r._id, r.n]));

        res.json({
            success: true,
            data: {
                organizers: {
                    pending: orgCounts.PENDING || 0,
                    approved: orgCounts.APPROVED || 0,
                    suspended: orgCounts.SUSPENDED || 0,
                    total: Object.values(orgCounts).reduce((s: number, n: any) => s + n, 0),
                },
                events: {
                    draft: eventCounts.DRAFT || 0,
                    published: eventCounts.PUBLISHED || 0,
                    suspended: eventCounts.SUSPENDED || 0,
                    cancelled: eventCounts.CANCELLED || 0,
                    completed: eventCounts.COMPLETED || 0,
                    total: Object.values(eventCounts).reduce((s: number, n: any) => s + n, 0),
                },
                tickets: {
                    issued: ticketCounts.ISSUED || 0,
                    checkedIn: ticketCounts.CHECKED_IN || 0,
                    refunded: ticketCounts.REFUNDED || 0,
                    cancelled: ticketCounts.CANCELLED || 0,
                    total: Object.values(ticketCounts).reduce((s: number, n: any) => s + n, 0),
                },
                orders: {
                    paidCount: orderAgg[0]?.orderCount || 0,
                    gross: orderAgg[0]?.gross || 0,
                },
                commissions: {
                    primary: commissionCounts.PRIMARY || { total: 0, count: 0 },
                    resale: commissionCounts.RESALE || { total: 0, count: 0 },
                },
                resale: {
                    active: resaleCounts.ACTIVE || 0,
                    sold: resaleCounts.SOLD || 0,
                    cancelled: resaleCounts.CANCELLED || 0,
                },
            },
        });
    } catch (err) { next(err); }
};

export const listOrganizers = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { status, limit, skip } = req.query;
        const result = await organizerService.listOrganizers({
            status: status as OrganizerStatus | undefined,
            limit: limit ? parseInt(String(limit), 10) : undefined,
            skip: skip ? parseInt(String(skip), 10) : undefined,
        });
        res.json({ success: true, data: result });
    } catch (err) { next(err); }
};

export const approveOrganizer = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const org = await organizerService.approveOrganizer(req.params.id);
        res.json({ success: true, data: org });
    } catch (err) { next(err); }
};

export const suspendOrganizer = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const org = await organizerService.suspendOrganizer(req.params.id, req.body?.reason);
        res.json({ success: true, data: org });
    } catch (err) { next(err); }
};

export const listEvents = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const filter: any = {};
        if (req.query.status) filter.status = req.query.status;
        if (req.query.organizerId) filter.organizerId = new Types.ObjectId(String(req.query.organizerId));
        const limit = Math.min(parseInt(String(req.query.limit || 50), 10), 200);
        const skip = parseInt(String(req.query.skip || 0), 10);
        const [items, total] = await Promise.all([
            Event.find(filter).sort({ createdAt: -1 }).limit(limit).skip(skip).lean(),
            Event.countDocuments(filter),
        ]);
        res.json({ success: true, data: { items, total } });
    } catch (err) { next(err); }
};

export const getEvent = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const ev = await Event.findById(req.params.id).lean();
        if (!ev) throw new AppError('Événement introuvable.', 404);
        res.json({ success: true, data: ev });
    } catch (err) { next(err); }
};

export const suspendEvent = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const ev = await Event.findByIdAndUpdate(req.params.id, { $set: { status: EventStatus.SUSPENDED } }, { new: true });
        if (!ev) throw new AppError('Événement introuvable.', 404);
        res.json({ success: true, data: ev });
    } catch (err) { next(err); }
};

export const cancelEvent = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const ev = await Event.findByIdAndUpdate(
            req.params.id,
            { $set: { status: EventStatus.CANCELLED, cancelledAt: new Date(), cancellationReason: req.body?.reason } },
            { new: true },
        );
        if (!ev) throw new AppError('Événement introuvable.', 404);
        res.json({ success: true, data: ev });
    } catch (err) { next(err); }
};

/**
 * Refund an order: mark PAID→REFUNDED, invalidate every associated ticket's
 * QR (nulling qrToken means scans return INVALID), auto-cancel any ACTIVE
 * resale listings on those tickets (spec §27), and best-effort notify the buyer.
 *
 * V1 does NOT initiate a wallet refund — that requires a decision about
 * where the buyer's money goes (main balance vs mobile money), and payment-service
 * changes have real-money risk. This just closes the domain state cleanly.
 */
export const refundOrder = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const order = await Order.findById(req.params.id);
        if (!order) throw new AppError('Commande introuvable.', 404);
        if (order.status === OrderStatus.REFUNDED) return res.json({ success: true, data: order });
        if (order.status !== OrderStatus.PAID) throw new AppError('Seule une commande payée peut être remboursée.', 409);

        order.status = OrderStatus.REFUNDED;
        await order.save();

        const tickets = await Ticket.find({ orderId: order._id });
        for (const t of tickets) {
            t.status = TicketStatus.REFUNDED;
            t.qrToken = null;
            t.refundedAt = new Date();
            await t.save();
        }
        // Auto-cancel any active resale listings on these tickets
        await ResaleListing.updateMany(
            { ticketId: { $in: tickets.map((t) => t._id) }, status: 'ACTIVE' as any },
            { $set: { status: 'CANCELLED', cancelledAt: new Date() } },
        );

        const event = await Event.findById(order.eventId).lean();
        try {
            await notify({
                kind: 'refund-processed',
                userId: String(order.userId),
                channel: 'email',
                recipient: order.holder.email,
                subject: `💰 Remboursement effectué — ${event?.title || ''}`,
                body: `Votre commande a été remboursée.`,
                data: {
                    eventTitle: event?.title,
                    amount: order.total,
                    orderRef: String(order._id),
                    name: order.holder.firstName,
                },
                orderId: String(order._id),
            });
        } catch { /* logged inside */ }

        res.json({ success: true, data: order });
    } catch (err) { next(err); }
};
