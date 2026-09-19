import config from '../config';
import logger from '../utils/logger';
import { sweepPendingPayouts } from './order.service';
import { retryPendingRefunds } from './refund.service';
import { sweepEventReminders } from './reminder.service';
import Event, { EventStatus } from '../database/models/event.model';
import ResaleListing, { ResaleListingStatus } from '../database/models/resale-listing.model';
import Ticket from '../database/models/ticket.model';

const log = logger.getLogger('Scheduler');

let timer: NodeJS.Timeout | null = null;

/**
 * Flip ACTIVE resale listings to EXPIRED once their event is over (spec §30 —
 * the status existed but nothing ever set it).
 *
 * Driven from the listing side on purpose: the set of events carrying an ACTIVE
 * listing is small and shrinks as we sweep, while the set of past events grows
 * forever. Idempotent — the second pass finds nothing ACTIVE left.
 */
export const expireEndedResaleListings = async (): Promise<number> => {
    const eventIds = await ResaleListing.distinct('eventId', { status: ResaleListingStatus.ACTIVE });
    if (eventIds.length === 0) return 0;

    const now = new Date();
    const overIds = await Event.find({
        _id: { $in: eventIds },
        $or: [
            { endsAt: { $lt: now } },
            { status: { $in: [EventStatus.COMPLETED, EventStatus.CANCELLED] } },
        ],
    }).distinct('_id');
    if (overIds.length === 0) return 0;

    const res = await ResaleListing.updateMany(
        { eventId: { $in: overIds }, status: ResaleListingStatus.ACTIVE },
        { $set: { status: ResaleListingStatus.EXPIRED, expiredAt: now } },
    );
    // Clear the denorm pointer the same way cancellation.service does — a ticket
    // pointing at a dead listing makes "Mes billets" claim it's still on sale.
    await Ticket.updateMany(
        { eventId: { $in: overIds }, resaleListingId: { $exists: true } },
        { $unset: { resaleListingId: '' } },
    );
    return res.modifiedCount || 0;
};

const tick = async () => {
    // 1. Credit organizer balances for PAID orders that failed on first attempt.
    try {
        const n = await sweepPendingPayouts();
        if (n > 0) log.info(`Swept ${n} pending organizer payouts.`);
    } catch (err) {
        log.error('sweepPendingPayouts tick failed:', err);
    }

    // 2. Close events whose endsAt has passed so they stop showing in listings.
    try {
        const now = new Date();
        const res = await Event.updateMany(
            { status: EventStatus.PUBLISHED, endsAt: { $lt: now } },
            { $set: { status: EventStatus.COMPLETED } },
        );
        if (res.modifiedCount > 0) log.info(`Closed ${res.modifiedCount} expired events.`);
    } catch (err) {
        log.error('closeExpiredEvents tick failed:', err);
    }

    // 3. Retry PENDING/FAILED refunds where the wallet credit didn't land.
    try {
        const n = await retryPendingRefunds();
        if (n > 0) log.info(`Retried ${n} pending refunds.`);
    } catch (err) {
        log.error('retryPendingRefunds tick failed:', err);
    }

    // 4. Pre-event reminders (spec §23) — one email per buyer, once per event.
    try {
        const n = await sweepEventReminders();
        if (n > 0) log.info(`Sent reminders for ${n} events.`);
    } catch (err) {
        log.error('sweepEventReminders tick failed:', err);
    }

    // 5. Expire resale listings on events that are over (spec §30). Runs after
    //    step 2 so events just closed this tick are swept in the same pass.
    try {
        const n = await expireEndedResaleListings();
        if (n > 0) log.info(`Expired ${n} resale listings on ended events.`);
    } catch (err) {
        log.error('expireEndedResaleListings tick failed:', err);
    }
};

export const startScheduler = () => {
    if (!config.scheduler.enabled) {
        log.info('Scheduler disabled by config.');
        return;
    }
    if (timer) return;
    log.info(`Starting scheduler every ${config.scheduler.intervalMs}ms.`);
    timer = setInterval(() => {
        tick().catch((err) => log.error('Scheduler tick failed', err));
    }, config.scheduler.intervalMs);
};

export const stopScheduler = () => {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
    log.info('Scheduler stopped.');
};
