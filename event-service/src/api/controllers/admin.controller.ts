import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import Event, { EventStatus } from '../../database/models/event.model';
import Order, { OrderStatus } from '../../database/models/order.model';
import Ticket, { TicketStatus } from '../../database/models/ticket.model'; // TicketStatus needed for dashboard aggs
import Organizer, { OrganizerStatus } from '../../database/models/organizer.model';
import Commission from '../../database/models/commission.model';
import ResaleListing from '../../database/models/resale-listing.model';
import * as organizerService from '../../services/organizer.service';
import * as refundService from '../../services/refund.service';
import * as cancellationService from '../../services/cancellation.service';
import { AppError } from '../../utils/errors';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import Dispute, { DisputeStatus } from '../../database/models/dispute.model';
import { getCommissionConfig, invalidateCommissionCache } from '../../services/clients/settings.service.client';

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
        const admin = (req as AuthenticatedRequest).user!;
        const result = await cancellationService.cancelEventAndCascade({
            eventId: req.params.id,
            initiatedByAdminId: admin.userId,
            reason: req.body?.reason,
        });
        res.json({ success: true, data: result });
    } catch (err) { next(err); }
};

/**
 * Refund an order — closes domain state AND credits the buyer's main balance
 * via payment-service /internal/deposit. Idempotent on orderId; wallet-credit
 * failure leaves the domain state closed and the Refund row FAILED for the
 * sweeper to retry.
 */
export const refundOrder = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const admin = (req as AuthenticatedRequest).user!;
        const result = await refundService.refundOrder({
            orderId: req.params.id,
            initiatedByAdminId: admin.userId,
            reason: req.body?.reason,
        });
        res.json({ success: true, data: result });
    } catch (err) { next(err); }
};

// ---------- admin orders / tickets / marketplace / disputes / commissions ----------

/** GET /admin/orders — paginated list, filter by status/kind/eventId */
export const listOrders = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const filter: any = {};
        if (req.query.status) filter.status = req.query.status;
        if (req.query.kind) filter.kind = req.query.kind;
        if (req.query.eventId) filter.eventId = new Types.ObjectId(String(req.query.eventId));
        if (req.query.userId) filter.userId = new Types.ObjectId(String(req.query.userId));
        const limit = Math.min(parseInt(String(req.query.limit || 50), 10), 200);
        const skip = parseInt(String(req.query.skip || 0), 10);
        const [items, total] = await Promise.all([
            Order.find(filter).sort({ createdAt: -1 }).limit(limit).skip(skip).lean(),
            Order.countDocuments(filter),
        ]);
        res.json({ success: true, data: { items, total } });
    } catch (err) { next(err); }
};

/** GET /admin/tickets — search by serial/holder/event */
export const listTickets = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const filter: any = {};
        if (req.query.status) filter.status = req.query.status;
        if (req.query.eventId) filter.eventId = new Types.ObjectId(String(req.query.eventId));
        if (req.query.serial) filter.serial = String(req.query.serial).toUpperCase();
        if (req.query.q) {
            const q = String(req.query.q);
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

/** GET /admin/resale-listings — marketplace moderation list */
export const listResaleListings = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const filter: any = {};
        if (req.query.status) filter.status = req.query.status;
        if (req.query.eventId) filter.eventId = new Types.ObjectId(String(req.query.eventId));
        const limit = Math.min(parseInt(String(req.query.limit || 50), 10), 200);
        const skip = parseInt(String(req.query.skip || 0), 10);
        const [items, total] = await Promise.all([
            ResaleListing.find(filter).sort({ createdAt: -1 }).limit(limit).skip(skip).lean(),
            ResaleListing.countDocuments(filter),
        ]);
        res.json({ success: true, data: { items, total } });
    } catch (err) { next(err); }
};

/** POST /admin/resale-listings/:id/suspend — moderator removes a listing from the marketplace */
export const suspendResaleListing = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const listing = await ResaleListing.findByIdAndUpdate(
            req.params.id,
            { $set: { status: 'SUSPENDED', suspendedAt: new Date() } },
            { new: true },
        );
        if (!listing) throw new AppError('Annonce introuvable.', 404);
        await Ticket.updateOne(
            { _id: listing.ticketId, resaleListingId: listing._id },
            { $unset: { resaleListingId: '' } },
        );
        res.json({ success: true, data: listing });
    } catch (err) { next(err); }
};

/** DELETE /admin/resale-listings/:id — permanent removal */
export const removeResaleListing = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const listing = await ResaleListing.findById(req.params.id);
        if (!listing) throw new AppError('Annonce introuvable.', 404);
        if (listing.status === 'SOLD') throw new AppError('Une annonce déjà vendue ne peut pas être supprimée.', 409);
        listing.status = 'CANCELLED' as any;
        listing.cancelledAt = new Date();
        await listing.save();
        await Ticket.updateOne(
            { _id: listing.ticketId, resaleListingId: listing._id },
            { $unset: { resaleListingId: '' } },
        );
        res.json({ success: true, data: listing });
    } catch (err) { next(err); }
};

/** GET /admin/disputes — moderation queue */
export const listDisputes = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const filter: any = {};
        if (req.query.status) filter.status = req.query.status;
        const limit = Math.min(parseInt(String(req.query.limit || 50), 10), 200);
        const skip = parseInt(String(req.query.skip || 0), 10);
        const [items, total] = await Promise.all([
            Dispute.find(filter).sort({ createdAt: -1 }).limit(limit).skip(skip).lean(),
            Dispute.countDocuments(filter),
        ]);
        res.json({ success: true, data: { items, total } });
    } catch (err) { next(err); }
};

/** POST /admin/disputes/:id/resolve — admin decision */
export const resolveDispute = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const admin = (req as AuthenticatedRequest).user!;
        const { note, outcome } = req.body || {};
        const dispute = await Dispute.findByIdAndUpdate(
            req.params.id,
            { $set: {
                status: outcome === 'reject' ? DisputeStatus.REJECTED : DisputeStatus.RESOLVED,
                resolutionNote: note,
                resolvedByAdminId: new Types.ObjectId(admin.userId),
                resolvedAt: new Date(),
            } },
            { new: true },
        );
        if (!dispute) throw new AppError('Litige introuvable.', 404);
        res.json({ success: true, data: dispute });
    } catch (err) { next(err); }
};

/** GET /admin/commission-config — current rates in effect (cache-aware) */
export const getCommissionConfigController = async (_req: Request, res: Response, next: NextFunction) => {
    try {
        const cfg = await getCommissionConfig();
        res.json({ success: true, data: cfg });
    } catch (err) { next(err); }
};

/**
 * PATCH /admin/commission-config — invalidates the local cache. Real updates
 * happen in settings-service via the settings admin; this endpoint is a
 * convenience to force event-service to reload on the next request.
 */
export const bustCommissionConfigCache = async (_req: Request, res: Response, next: NextFunction) => {
    try {
        invalidateCommissionCache();
        const cfg = await getCommissionConfig();
        res.json({ success: true, data: cfg, message: 'Cache invalidated. New settings will apply on next lookup.' });
    } catch (err) { next(err); }
};
