import config from '../config';
import logger from '../utils/logger';

const log = logger.getLogger('Scheduler');

let timer: NodeJS.Timeout | null = null;

const tick = async () => {
    // Placeholder for periodic sweeps:
    //  - sweepPendingPayouts (credit organizer balances for PAID+uncredited orders)
    //  - closeExpiredEvents (mark PUBLISHED events past endsAt as COMPLETED)
    //  - expireStaleResaleListings
    // Filled in with the payout/order services.
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
