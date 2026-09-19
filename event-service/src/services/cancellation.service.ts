import { Types } from 'mongoose';
import Event, { EventStatus } from '../database/models/event.model';
import Order, { OrderStatus, OrderKind } from '../database/models/order.model';
import Ticket, { TicketStatus } from '../database/models/ticket.model';
import ResaleListing, { ResaleListingStatus } from '../database/models/resale-listing.model';
import { refundAllOrdersForEvent } from './refund.service';
import { notifyUser } from './clients/notification.service.client';
import { getEventUserDetails } from './clients/user.service.client';
import { AppError } from '../utils/errors';
import logger from '../utils/logger';

const log = logger.getLogger('CancellationService');

/**
 * Full cancellation cascade (spec §22).
 *
 * 1. Set event.status = CANCELLED (blocks new sales via order.service guard)
 * 2. Cancel all ACTIVE resale listings for the event
 * 3. Bulk-refund every PAID primary order (credits buyer wallet, invalidates
 *    tickets, sends refund-processed notification)
 * 4. Send an event-cancelled notification to every unique buyer
 *
 * Best-effort on steps 3+4 so a failure late in the pipeline doesn't leave
 * the event stuck in a weird half-cancelled state.
 */
export const cancelEventAndCascade = async (args: {
    eventId: string;
    initiatedByAdminId: string;
    reason?: string;
}): Promise<{
    event: any;
    listingsCancelled: number;
    refundStats: { processed: number; refunded: number; failed: number };
    notified: number;
}> => {
    const event = await Event.findById(new Types.ObjectId(args.eventId));
    if (!event) throw new AppError('Événement introuvable.', 404);

    // Step 1 — atomically flip to CANCELLED
    if (event.status !== EventStatus.CANCELLED) {
        event.status = EventStatus.CANCELLED;
        event.cancelledAt = new Date();
        event.cancellationReason = args.reason;
        await event.save();
    }

    // Step 2 — cancel every ACTIVE resale listing for this event
    const listingsRes = await ResaleListing.updateMany(
        { eventId: event._id, status: ResaleListingStatus.ACTIVE },
        { $set: { status: ResaleListingStatus.CANCELLED, cancelledAt: new Date() } },
    );
    // Clear the denorm pointer on tickets whose listings we just killed
    await Ticket.updateMany(
        { eventId: event._id, resaleListingId: { $exists: true } },
        { $unset: { resaleListingId: '' } },
    );

    // Step 3 — bulk refund every PAID primary order (also invalidates their tickets)
    const refundStats = await refundAllOrdersForEvent({
        eventId: String(event._id),
        initiatedByAdminId: args.initiatedByAdminId,
        reason: args.reason || 'Événement annulé',
    });

    // Step 4 — event-cancelled email to every unique buyer, whether the
    // refund succeeded or not. Their email address may not be on the order
    // (holder.email is optional), so hydrate missing ones from user-service.
    const paidUserIds = await Order.distinct('userId', {
        eventId: event._id,
        // include REFUNDED (we just refunded them) so buyers get the notice
        status: { $in: [OrderStatus.PAID, OrderStatus.REFUNDED] },
        kind: OrderKind.PRIMARY,
    });

    // Also grab any explicitly-provided emails from orders so we don't
    // over-fetch user-service for buyers who already gave one.
    const orders = await Order.find({
        eventId: event._id,
        status: { $in: [OrderStatus.PAID, OrderStatus.REFUNDED] },
        kind: OrderKind.PRIMARY,
    }).select('userId holder').lean();
    const contactByUserId = new Map<string, { email?: string; phone?: string }>();
    for (const o of orders) {
        const id = String(o.userId);
        if (!contactByUserId.has(id) && (o.holder?.email || o.holder?.phone)) {
            contactByUserId.set(id, { email: o.holder.email, phone: o.holder.phone });
        }
    }
    // Fill gaps from user-service (batch — one call, not one per buyer)
    const missingIds = paidUserIds
        .map((id) => String(id))
        .filter((id) => !contactByUserId.has(id));
    if (missingIds.length > 0) {
        try {
            const profiles = await getEventUserDetails(missingIds);
            for (const p of profiles) {
                contactByUserId.set(String(p._id), { email: p.email, phone: p.phoneNumber });
            }
        } catch (err) {
            log.warn(`event-details lookup for cancellation notifications failed: ${(err as Error).message}`);
        }
    }

    let notified = 0;
    for (const [userId, contact] of contactByUserId.entries()) {
        try {
            // Access moment: push + email + SMS, each independent.
            const sent = await notifyUser({
                kind: 'event-cancelled',
                userId,
                channels: ['push', 'email', 'sms'],
                email: contact.email,
                phone: contact.phone,
                subject: `⚠️ Événement annulé — ${event.title}`,
                body: `L'événement a été annulé.`,
                data: {
                    name: '',
                    eventTitle: event.title,
                    eventDate: event.startsAt.toISOString(),
                    reason: args.reason || 'non précisé',
                },
                eventId: String(event._id),
            });
            if (sent > 0) notified++;
        } catch { /* audit-logged inside notify */ }
    }

    return {
        event,
        listingsCancelled: listingsRes.modifiedCount || 0,
        refundStats,
        notified,
    };
};
