import cron, { type ScheduledTask } from 'node-cron';
import SubscriptionModel, { SubscriptionDuration, SubscriptionStatus, SubscriptionType } from '../database/models/subscription.model';
import { pushSubscriptionEnding } from '../services/push-notify';
import logger from '../utils/logger';

const log = logger.getLogger('SubscriptionEndingScheduler');
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Monthly subscriptions that get a reminder. Nothing renews them by itself, so
 * one that ends unnoticed just stops. RELANCE is retired (credits replaced it).
 */
const REMINDED: Partial<Record<SubscriptionType, string>> = {
    [SubscriptionType.VISIBILITE_MAX]: 'Visibilité Max',
};

/**
 * Pushes a reminder for active monthly subscriptions ending 3 to 4 days from
 * now. Run once a day, each subscription falls in exactly one window, so it
 * is reminded once without keeping track.
 */
export async function remindEndingSubscriptions(now: Date = new Date()): Promise<number> {
    const subs = await SubscriptionModel.find({
        status: SubscriptionStatus.ACTIVE,
        duration: SubscriptionDuration.MONTHLY,
        subscriptionType: { $in: Object.keys(REMINDED) },
        endDate: { $gte: new Date(now.getTime() + 3 * DAY_MS), $lt: new Date(now.getTime() + 4 * DAY_MS) },
    }).select('user subscriptionType endDate').lean();
    for (const s of subs) pushSubscriptionEnding(s.user, REMINDED[s.subscriptionType]!, s.endDate);
    return subs.length;
}

class SubscriptionEndingScheduler {
    private task: ScheduledTask | null = null;

    start(): void {
        this.task = cron.schedule('0 9 * * *', async () => {
            try {
                const n = await remindEndingSubscriptions();
                if (n) log.info(`Reminded ${n} subscription(s) ending in 3 days`);
            } catch (err: any) {
                log.error(`Subscription ending reminders failed: ${err?.message ?? err}`);
            }
        }, { timezone: 'Africa/Douala' });
        log.info('Subscription ending reminders scheduled (09:00 Africa/Douala)');
    }

    stop(): void {
        this.task?.stop();
        this.task = null;
    }
}

export const subscriptionEndingScheduler = new SubscriptionEndingScheduler();
