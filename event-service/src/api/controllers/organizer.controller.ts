import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import { OrganizerRequest } from '../middleware/organizer.middleware';
import * as organizerService from '../../services/organizer.service';
import * as eventService from '../../services/event.service';
import Ticket, { TicketStatus } from '../../database/models/ticket.model';
import Order, { OrderStatus } from '../../database/models/order.model';
import Event from '../../database/models/event.model';
import { AppError } from '../../utils/errors';
import { Types } from 'mongoose';

export const apply = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const user = (req as AuthenticatedRequest).user!;
        const org = await organizerService.applyAsOrganizer(user.userId, req.body || {});
        res.status(201).json({ success: true, data: org });
    } catch (err) { next(err); }
};

export const getMe = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const user = (req as AuthenticatedRequest).user!;
        const org = await organizerService.findMyOrganizer(user.userId);
        res.json({ success: true, data: org });
    } catch (err) { next(err); }
};

export const createEvent = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const org = (req as OrganizerRequest).organizer!;
        const doc = await eventService.createEvent(String(org._id), req.body || {});
        res.status(201).json({ success: true, data: doc });
    } catch (err) { next(err); }
};

export const listEvents = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const org = (req as OrganizerRequest).organizer!;
        const { limit, skip, status } = req.query;
        const result = await eventService.listOrganizerEvents(String(org._id), {
            limit: limit ? parseInt(String(limit), 10) : undefined,
            skip: skip ? parseInt(String(skip), 10) : undefined,
            status: status as any,
        });
        res.json({ success: true, data: result });
    } catch (err) { next(err); }
};

export const getEvent = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const org = (req as OrganizerRequest).organizer!;
        const ev = await eventService.getOrganizerEvent(String(org._id), req.params.id);
        res.json({ success: true, data: ev });
    } catch (err) { next(err); }
};

export const updateEvent = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const org = (req as OrganizerRequest).organizer!;
        const ev = await eventService.updateEvent(String(org._id), req.params.id, req.body || {});
        res.json({ success: true, data: ev });
    } catch (err) { next(err); }
};

export const publishEvent = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const org = (req as OrganizerRequest).organizer!;
        const ev = await eventService.publishEvent(String(org._id), req.params.id);
        res.json({ success: true, data: ev });
    } catch (err) { next(err); }
};

export const suspendEvent = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const org = (req as OrganizerRequest).organizer!;
        const ev = await eventService.suspendEvent(String(org._id), req.params.id);
        res.json({ success: true, data: ev });
    } catch (err) { next(err); }
};

export const cancelEvent = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const org = (req as OrganizerRequest).organizer!;
        const ev = await eventService.cancelEvent(String(org._id), req.params.id, req.body?.reason);
        res.json({ success: true, data: ev });
    } catch (err) { next(err); }
};

export const createTicketType = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const org = (req as OrganizerRequest).organizer!;
        const tt = await eventService.createTicketType(String(org._id), req.params.id, req.body || {});
        res.status(201).json({ success: true, data: tt });
    } catch (err) { next(err); }
};

export const listTicketTypes = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const org = (req as OrganizerRequest).organizer!;
        const list = await eventService.listTicketTypes(String(org._id), req.params.id);
        res.json({ success: true, data: list });
    } catch (err) { next(err); }
};

/** Organizer's per-event participants (spec §17). */
export const listParticipants = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const org = (req as OrganizerRequest).organizer!;
        const eventId = req.params.id;
        const event = await Event.findOne({ _id: new Types.ObjectId(eventId), organizerId: org._id });
        if (!event) throw new AppError('Événement introuvable.', 404);

        const q = String(req.query.q || '').trim();
        const filter: any = { eventId: event._id, status: { $in: [TicketStatus.ISSUED, TicketStatus.CHECKED_IN] } };
        if (q) {
            // simple contains match; index-less, but scanning tickets of one event is bounded.
            filter.$or = [
                { holderName: { $regex: q, $options: 'i' } },
                { holderPhone: { $regex: q, $options: 'i' } },
                { serial: { $regex: q, $options: 'i' } },
            ];
        }
        const limit = Math.min(parseInt(String(req.query.limit || 50), 10), 200);
        const skip = parseInt(String(req.query.skip || 0), 10);
        const [items, total] = await Promise.all([
            Ticket.find(filter).sort({ createdAt: -1 }).limit(limit).skip(skip).lean(),
            Ticket.countDocuments(filter),
        ]);
        res.json({ success: true, data: { items, total } });
    } catch (err) { next(err); }
};

/** Organizer dashboard (sales, revenue, entries, available payout). */
export const dashboard = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const org = (req as OrganizerRequest).organizer!;
        const events = await Event.find({ organizerId: org._id }).lean();
        const eventIds = events.map((e) => e._id);
        const [orderAgg, ticketAgg] = await Promise.all([
            Order.aggregate([
                { $match: { eventId: { $in: eventIds }, status: OrderStatus.PAID } },
                { $group: { _id: null, gross: { $sum: '$subtotal' }, commission: { $sum: '$commission' }, orderCount: { $sum: 1 } } },
            ]),
            Ticket.aggregate([
                { $match: { eventId: { $in: eventIds } } },
                { $group: { _id: '$status', n: { $sum: 1 } } },
            ]),
        ]);
        const gross = orderAgg[0]?.gross ?? 0;
        const commission = orderAgg[0]?.commission ?? 0;
        const orderCount = orderAgg[0]?.orderCount ?? 0;
        const statusCounts = Object.fromEntries(ticketAgg.map((r: any) => [r._id, r.n]));

        res.json({
            success: true,
            data: {
                eventCount: events.length,
                orderCount,
                gross,
                commission,
                organizerNet: gross - commission,
                checkedIn: statusCounts[TicketStatus.CHECKED_IN] || 0,
                issued: statusCounts[TicketStatus.ISSUED] || 0,
                refunded: statusCounts[TicketStatus.REFUNDED] || 0,
                cancelled: statusCounts[TicketStatus.CANCELLED] || 0,
            },
        });
    } catch (err) { next(err); }
};
