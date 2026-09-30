import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import Event, { EventStatus } from '../../database/models/event.model';
import Order, { OrderStatus, OrderKind } from '../../database/models/order.model';
import Ticket, { TicketStatus } from '../../database/models/ticket.model'; // TicketStatus needed for dashboard aggs
import Organizer, { OrganizerStatus } from '../../database/models/organizer.model';
import Commission from '../../database/models/commission.model';
import ResaleListing from '../../database/models/resale-listing.model';
import Refund, { RefundStatus } from '../../database/models/refund.model';
import * as organizerService from '../../services/organizer.service';
import * as refundService from '../../services/refund.service';
import * as cancellationService from '../../services/cancellation.service';
import { notifyUser, Channel } from '../../services/clients/notification.service.client';
import { getEventUserDetails } from '../../services/clients/user.service.client';
import { AppError } from '../../utils/errors';
import { AuthenticatedRequest } from '../middleware/auth.middleware';
import Dispute, { DisputeStatus } from '../../database/models/dispute.model';
import { getCommissionConfig, invalidateCommissionCache } from '../../services/clients/settings.service.client';
import logger from '../../utils/logger';

const log = logger.getLogger('AdminController');

/**
 * Moderation notice (spec §23). The moderated row never carries the recipient's
 * coordinates, so resolve them from user-service — the lookup also gives the
 * first name the templates use. Push + email by default: a moderation decision
 * needs the written reason, it isn't worth an SMS. Best-effort from end to end:
 * a suspension, a removal or a dispute ruling must never fail because
 * notification plumbing is down.
 */
const notifyUserByLookup = async (
    userId: Types.ObjectId | string,
    args: { kind: string; subject: string; body: string; data?: Record<string, unknown>; eventId?: string; channels?: Channel[] },
) => {
    try {
        const [profile] = await getEventUserDetails([String(userId)]);
        await notifyUser({
            kind: args.kind,
            userId: String(userId),
            channels: args.channels || ['push', 'email'],
            email: profile?.email,
            phone: profile?.phoneNumber,
            subject: args.subject,
            body: args.body,
            data: { name: profile?.name?.split(' ')[0] || '', ...args.data },
            eventId: args.eventId,
        });
    } catch (err) {
        log.warn(`${args.kind}: notification for user ${userId} failed: ${(err as Error).message}`);
    }
};

/** Admin global stats (spec §26). */
export const dashboard = async (_req: Request, res: Response, next: NextFunction) => {
    try {
        const [organizerAgg, eventAgg, orderAgg, ticketAgg, commissionAgg, resaleAgg, refundAgg] = await Promise.all([
            Organizer.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
            Event.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
            // Grouped by kind so primary ticketing and marketplace volume can be
            // told apart (spec §26) — the legacy `orders.*` keys stay the sum of both.
            Order.aggregate([
                { $match: { status: OrderStatus.PAID } },
                { $group: { _id: '$kind', gross: { $sum: '$subtotal' }, volume: { $sum: '$total' }, orderCount: { $sum: 1 } } },
            ]),
            Ticket.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
            Commission.aggregate([
                { $group: { _id: '$kind', total: { $sum: '$amount' }, n: { $sum: 1 } } },
            ]),
            ResaleListing.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
            Refund.aggregate([{ $group: { _id: '$status', total: { $sum: '$amount' }, n: { $sum: 1 } } }]),
        ]);

        const orgCounts = Object.fromEntries(organizerAgg.map((r: any) => [r._id, r.n]));
        const eventCounts = Object.fromEntries(eventAgg.map((r: any) => [r._id, r.n]));
        const ticketCounts = Object.fromEntries(ticketAgg.map((r: any) => [r._id, r.n]));
        const commissionCounts = Object.fromEntries(commissionAgg.map((r: any) => [r._id, { total: r.total, count: r.n }]));
        const resaleCounts = Object.fromEntries(resaleAgg.map((r: any) => [r._id, r.n]));
        const refundCounts = Object.fromEntries(refundAgg.map((r: any) => [r._id, { total: r.total, count: r.n }]));
        const ordersByKind = Object.fromEntries(orderAgg.map((r: any) => [r._id, r]));
        const primaryOrders = ordersByKind[OrderKind.PRIMARY] || { gross: 0, volume: 0, orderCount: 0 };
        const resaleOrders = ordersByKind[OrderKind.RESALE] || { gross: 0, volume: 0, orderCount: 0 };

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
                    // Unchanged meaning: every PAID order, primary + resale.
                    paidCount: primaryOrders.orderCount + resaleOrders.orderCount,
                    gross: primaryOrders.gross + resaleOrders.gross,
                    primaryCount: primaryOrders.orderCount,
                    primaryGross: primaryOrders.gross,
                },
                commissions: {
                    // `resale` is the marketplace take; `primary` is the ticketing take.
                    primary: commissionCounts.PRIMARY || { total: 0, count: 0 },
                    resale: commissionCounts.RESALE || { total: 0, count: 0 },
                },
                resale: {
                    active: resaleCounts.ACTIVE || 0,
                    sold: resaleCounts.SOLD || 0,
                    cancelled: resaleCounts.CANCELLED || 0,
                    expired: resaleCounts.EXPIRED || 0,
                    suspended: resaleCounts.SUSPENDED || 0,
                    // Money that actually changed hands on the marketplace, in XAF —
                    // listing counts say nothing about volume (spec §26).
                    salesCount: resaleOrders.orderCount,
                    salesVolume: resaleOrders.volume,
                },
                refunds: {
                    count: refundCounts[RefundStatus.COMPLETED]?.count || 0,
                    total: refundCounts[RefundStatus.COMPLETED]?.total || 0,
                    pending: refundCounts[RefundStatus.PENDING]?.count || 0,
                    failed: refundCounts[RefundStatus.FAILED]?.count || 0,
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
        if (req.query.q) {
            // Free-text over title + city (spec §25), same shape as listTickets.
            // Escaped so an admin pasting a title with a "(" doesn't 500 the list.
            const q = String(req.query.q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            filter.$or = [
                { title: { $regex: q, $options: 'i' } },
                { city: { $regex: q, $options: 'i' } },
            ];
        }
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
        // The seller's ticket just vanished from the marketplace — tell them why.
        const event = await Event.findById(listing.eventId).select('title').lean();
        await notifyUserByLookup(listing.sellerUserId, {
            kind: 'resale-listing-suspended',
            subject: `⛔ Votre annonce de revente a été suspendue — ${event?.title || 'SBC Event'}`,
            body: `Votre annonce de revente a été retirée du marché par la modération.`,
            data: {
                eventTitle: event?.title || '',
                askingPrice: listing.askingPrice,
                reason: req.body?.reason || 'non précisé',
            },
            eventId: String(listing.eventId),
        });
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
        const event = await Event.findById(listing.eventId).select('title').lean();
        await notifyUserByLookup(listing.sellerUserId, {
            kind: 'resale-listing-removed',
            subject: `⛔ Votre annonce de revente a été refusée — ${event?.title || 'SBC Event'}`,
            body: `Votre annonce de revente a été supprimée par la modération. Votre billet reste valable.`,
            data: {
                eventTitle: event?.title || '',
                askingPrice: listing.askingPrice,
                reason: req.body?.reason || 'non précisé',
            },
            eventId: String(listing.eventId),
        });
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

        // The complainant opened this and has been waiting — tell them the
        // ruling and the admin's note (spec §23).
        const rejected = dispute.status === DisputeStatus.REJECTED;
        await notifyUserByLookup(dispute.complainantUserId, {
            kind: 'dispute-resolved',
            subject: rejected ? '📄 Votre litige a été clôturé' : '✅ Votre litige a été résolu',
            body: rejected
                ? `Après examen, votre litige n'a pas été retenu.`
                : `Votre litige a été traité par notre équipe.`,
            data: {
                outcome: rejected ? 'rejected' : 'resolved',
                status: dispute.status,
                note: dispute.resolutionNote || 'Aucune note.',
                disputeKind: dispute.kind,
            },
            eventId: dispute.eventId ? String(dispute.eventId) : undefined,
        });
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
