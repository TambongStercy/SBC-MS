import cron, { type ScheduledTask } from 'node-cron';
import { recomputeUsualCountries } from '../services/activity-signals.service';
import logger from '../utils/logger';

const log = logger.getLogger('ActivitySignalsJob');

/** Security plan Phase 1: recomputes each member's usual country every night (03:30 Douala). */
class ActivitySignalsJob {
    private task: ScheduledTask | null = null;
    private running = false;

    start(): void {
        this.task = cron.schedule('30 3 * * *', async () => {
            if (this.running) return;
            this.running = true;
            try { await recomputeUsualCountries(); }
            catch (err: any) { log.error(`Usual-country pass failed: ${err?.message ?? err}`); }
            finally { this.running = false; }
        }, { timezone: 'Africa/Douala' });
        log.info('Usual-country recompute scheduled (03:30 Africa/Douala)');
    }

    stop(): void {
        this.task?.stop();
        this.task = null;
    }
}

export const activitySignalsJob = new ActivitySignalsJob();
