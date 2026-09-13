import config from '../config';
import logger from '../utils/logger';
import { sweepPendingPayouts } from './order.service';
import Event, { EventStatus } from '../database/models/event.model';

const log = logger.getLogger('Scheduler');

let timer: NodeJS.Timeout | null = null;

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
