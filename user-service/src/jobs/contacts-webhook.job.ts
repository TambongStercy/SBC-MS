import cron, { type ScheduledTask } from 'node-cron';
import { deliverDueContactsEvents, expireEndedAddons } from '../services/contacts-webhook.service';
import logger from '../utils/logger';

const log = logger.getLogger('ContactsWebhookJob');

/**
 * Every minute: (re)send Contacts webhook events that are due.
 * Every 10 minutes: mark PRO / MISE_EN_AVANT periods that have ended as
 * expired, which queues a subscription.expired event for the app.
 */
class ContactsWebhookJob {
    private tasks: ScheduledTask[] = [];
    private running = false;

    start(): void {
        this.tasks.push(cron.schedule('* * * * *', async () => {
            if (this.running) return;
            this.running = true;
            try { await deliverDueContactsEvents(); }
            catch (err: any) { log.error(`Delivery pass failed: ${err?.message ?? err}`); }
            finally { this.running = false; }
        }));
        this.tasks.push(cron.schedule('*/10 * * * *', async () => {
            try {
                const n = await expireEndedAddons();
                if (n) log.info(`Marked ${n} ended PRO / MISE_EN_AVANT period(s) expired`);
            } catch (err: any) { log.error(`Expiry pass failed: ${err?.message ?? err}`); }
        }));
        log.info('Contacts webhook delivery (every minute) and add-on expiry (every 10 min) scheduled');
    }

    stop(): void {
        this.tasks.forEach(t => t.stop());
        this.tasks = [];
    }
}

export const contactsWebhookJob = new ContactsWebhookJob();
