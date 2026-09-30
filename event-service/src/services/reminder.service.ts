import { Types } from 'mongoose';
import Event, { EventStatus } from '../database/models/event.model';
import Order, { OrderStatus, OrderKind } from '../database/models/order.model';
import { notifyUser } from './clients/notification.service.client';
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

            const contactByUser = new Map<string, { email?: string; phone?: string; firstName: string }>();
            for (const o of orders) {
                const id = String(o.userId);
                if (!contactByUser.has(id) && (o.holder?.email || o.holder?.phone)) {
                    contactByUser.set(id, { email: o.holder.email, phone: o.holder.phone, firstName: o.holder.firstName });
                }
            }
            const missing = paidUserIds.map((id) => String(id)).filter((id) => !contactByUser.has(id));
            if (missing.length > 0) {
                try {
                    const profiles = await getEventUserDetails(missing);
                    for (const p of profiles) {
                        contactByUser.set(String(p._id), { email: p.email, phone: p.phoneNumber, firstName: p.name?.split(' ')[0] || '' });
                    }
                } catch (err) {
                    log.warn(`reminder: event-details lookup failed for ${event._id}: ${(err as Error).message}`);
                }
            }

            const hours = Math.round((event.startsAt.getTime() - now.getTime()) / (3600 * 1000));
            const whenPhrase = hours <= 1 ? "dans moins d'une heure" : `dans ${hours} heure${hours > 1 ? 's' : ''}`;

            for (const [userId, { email, phone, firstName }] of contactByUser.entries()) {
                try {
                    // Reminder is a nudge, not a document: push + SMS only (spec §23).
                    await notifyUser({
                        kind: 'event-reminder',
                        userId,
                        channels: ['push', 'sms'],
                        email,
                        phone,
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
