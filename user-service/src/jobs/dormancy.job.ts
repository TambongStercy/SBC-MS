import cron, { type ScheduledTask } from 'node-cron';
import { DormancySnapshotModel } from '../database/models/dormancy.model';
import { doualaDay } from '../services/activity-signals.service';
import { runDormancyPass, watchHolds } from '../services/dormancy.service';
import { dormancyConfig } from '../config/dormancy';
import logger from '../utils/logger';

const log = logger.getLogger('DormancyJob');

/**
 * Security plan Phase 7.
 *   03:45 Douala   the nightly pass (statuses + snapshot + check), after the
 *                  other night jobs (ledger check, Blnk shadow, usual country)
 *   every 10 min   a contact change during a return hold opens its case
 * At start, if tonight's snapshot is missing (first deploy, missed night), the
 * pass runs once. DORMANCY_JOB_DISABLED=true stops both.
 */
class DormancyJob {
    private tasks: ScheduledTask[] = [];

    private async nightly(): Promise<void> {
        try { await runDormancyPass(); }
        catch (err: any) { log.error(`Dormancy pass failed: ${err?.message ?? err}`); }
    }

    start(): void {
        if (dormancyConfig().disabled) {
            log.warn('Dormancy job disabled (DORMANCY_JOB_DISABLED=true)');
            return;
        }
        this.tasks.push(cron.schedule('45 3 * * *', () => { void this.nightly(); }, { timezone: 'Africa/Douala' }));
        this.tasks.push(cron.schedule('*/10 * * * *', () => {
            watchHolds().then(n => { if (n) log.warn(`${n} contact change(s) during a dormant-return hold: case(s) opened`); })
                .catch((err: any) => log.error(`Dormancy hold watch failed: ${err?.message ?? err}`));
        }, { timezone: 'Africa/Douala' }));
        setTimeout(() => {
            void (async () => {
                const today = doualaDay();
                const yesterday = doualaDay(new Date(Date.now() - 86_400_000));
                const last: any = await DormancySnapshotModel.findOne({}).sort({ _id: -1 }).select('_id').lean();
                if (!last || last._id < yesterday) await this.nightly();
                else log.info(`Dormancy snapshot ${last._id} present (today ${today})`);
            })().catch((err: any) => log.error(`Dormancy startup check failed: ${err?.message ?? err}`));
        }, 60_000).unref?.();
        log.info('Dormancy job scheduled (nightly 03:45 Africa/Douala; hold watch every 10 min)');
    }

    stop(): void {
        for (const t of this.tasks) t.stop();
        this.tasks = [];
    }
}

export const dormancyJob = new DormancyJob();
