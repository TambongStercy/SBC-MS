import { Types } from 'mongoose';
import Event, { EventStatus } from '../database/models/event.model';
import Order, { OrderStatus, OrderKind } from '../database/models/order.model';
import { notify } from './clients/notification.service.client';
import { getEventUserDetails } from './clients/user.service.client';
import logger from '../utils/logger';

const log = logger.getLogger('ReminderService');

/**
 * Pre-event reminder (spec §23). Runs from the scheduler. For every PUBLISHED
 * event starting in the next `REMINDER_WINDOW_HOURS` (default 24) and NOT
 * already reminded, send a reminder email to every unique buyer and stamp
 * `reminderSentAt` on the event so we don't re-notify.
 *
 * Best-effort: individual send failures are audit-logged inside notify(),
 * they don't stop the loop.
 */
const WINDOW_HOURS = parseInt(process.env.REMINDER_WINDOW_HOURS || '24', 10);

export const sweepEventReminders = async (): Promise<number> => {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + WINDOW_HOURS * 3600 * 1000);

    // Find events starting inside the window that haven't been reminded yet.
    // reminderSentAt is added ad-hoc via $set — no schema change needed
    // (Mongoose stores it as a document field either way).
    const candidates = await Event.find({
        status: EventStatus.PUBLISHED,
        startsAt: { $gt: now, $lte: windowEnd },
        reminderSentAt: { $exists: false },
    } as any).limit(50);

    let reminded = 0;
    for (const event of candidates) {
        try {
            const paidUserIds = await Order.distinct('userId', {
                eventId: event._id,
                status: OrderStatus.PAID,
                kind: OrderKind.PRIMARY,
            });
            const orders = await Order.find({
                eventId: event._id,
                status: OrderStatus.PAID,
                kind: OrderKind.PRIMARY,
            }).select('userId holder').lean();

            const emailByUser = new Map<string, { email: string; firstName: string }>();
            for (const o of orders) {
                if (o.holder?.email) {
                    emailByUser.set(String(o.userId), { email: o.holder.email, firstName: o.holder.firstName });
                }
            }
            const missing = paidUserIds.map((id) => String(id)).filter((id) => !emailByUser.has(id));
            if (missing.length > 0) {
                try {
                    const profiles = await getEventUserDetails(missing);
                    for (const p of profiles) {
                        if (p.email) emailByUser.set(String(p._id), { email: p.email, firstName: p.name?.split(' ')[0] || '' });
                    }
                } catch (err) {
                    log.warn(`reminder: event-details lookup failed for ${event._id}: ${(err as Error).message}`);
                }
            }

            const hours = Math.round((event.startsAt.getTime() - now.getTime()) / (3600 * 1000));
            const whenPhrase = hours <= 1 ? "dans moins d'une heure" : `dans ${hours} heure${hours > 1 ? 's' : ''}`;

            for (const [userId, { email, firstName }] of emailByUser.entries()) {
                try {
                    await notify({
                        kind: 'event-reminder',
                        userId,
                        channel: 'email',
                        recipient: email,
                        subject: `⏰ Rappel — ${event.title} approche`,
                        body: `L'événement approche.`,
                        data: {
                            name: firstName,
                            eventTitle: event.title,
                            whenPhrase,
                            eventVenue: event.venue,
                        },
                        eventId: String(event._id),
                    });
                } catch { /* audit-logged */ }
            }

            // Stamp so we don't send again on the next tick.
            await Event.updateOne({ _id: event._id }, { $set: { reminderSentAt: new Date() } });
            reminded++;
        } catch (err) {
            log.warn(`Reminder tick failed for event ${event._id}: ${(err as Error).message}`);
        }
    }
    return reminded;
};
