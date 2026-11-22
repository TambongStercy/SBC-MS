import cron, { type ScheduledTask } from 'node-cron';
import { rollupDay } from '../services/activity-dashboard.service';
import { closeUnverifiedAttempts, flushSignupAttempts } from '../services/signup-attempts.service';
import { flushSigninAttempts } from '../services/signin-attempts.service';
import { doualaDay } from '../services/activity-signals.service';
import logger from '../utils/logger';

const log = logger.getLogger('ActivityRollupJob');

/**
 * Security plan Phase 11: keeps activity_days current.
 *   every minute     today's sign-ups and connected members
 *   every 5 minutes  today's activations and unfinished payments (other services' data)
 *   every 10 minutes closes sign-ups never verified after 24 h, refreshes their days
 *   00:15 Douala     yesterday in full, connected members counted exactly
 * ACTIVITY_ROLLUP_DISABLED=true stops it (the dashboards then show the last figures).
 */
class ActivityRollupJob {
    private tasks: ScheduledTask[] = [];
    private running = false;

    private async guarded(label: string, fn: () => Promise<void>): Promise<void> {
        if (this.running) return;
        this.running = true;
        try { await fn(); }
        catch (err: any) { log.error(`${label} failed: ${err?.message ?? err}`); }
        finally { this.running = false; }
    }

    async tick(now: Date = new Date()): Promise<void> {
        const today = doualaDay(now);
        const minute = Number(new Date(now.getTime() + 3600_000).toISOString().slice(14, 16));
        await flushSignupAttempts();
        await flushSigninAttempts();
        if (minute % 10 === 0) {
            const { closed, days } = await closeUnverifiedAttempts(now);
            if (closed) log.info(`Closed ${closed} sign-up(s) never verified after 24 h`);
            for (const d of days) if (d !== today) await rollupDay(d, { signups: true }, now);
        }
        await rollupDay(today, { signups: true, connected: true, activated: minute % 5 === 0, payments: minute % 5 === 0 }, now);
    }

    async nightly(now: Date = new Date()): Promise<void> {
        const yesterday = doualaDay(new Date(now.getTime() - 86400_000));
        await rollupDay(yesterday, undefined, now);
    }

    start(): void {
        if (String(process.env.ACTIVITY_ROLLUP_DISABLED || '').toLowerCase() === 'true') {
            log.warn('Activity rollup disabled (ACTIVITY_ROLLUP_DISABLED=true)');
            return;
        }
        this.tasks.push(cron.schedule('* * * * *', () => this.guarded('Activity rollup', () => this.tick()), { timezone: 'Africa/Douala' }));
        // Not behind the minute's guard: a long tick must not skip the night's exact count.
        this.tasks.push(cron.schedule('15 0 * * *', () => {
            this.nightly().catch((err: any) => log.error(`Activity nightly rollup failed: ${err?.message ?? err}`));
        }, { timezone: 'Africa/Douala' }));
        // First figures at start: today in full, and yesterday if the night pass was missed.
        setTimeout(() => {
            void this.guarded('Activity startup rollup', async () => {
                const now = new Date();
                await rollupDay(doualaDay(now), undefined, now);
                await this.nightly(now);
            });
        }, 20_000).unref?.();
        log.info('Activity rollup scheduled (every minute; nightly 00:15 Africa/Douala)');
    }

    stop(): void {
        for (const t of this.tasks) t.stop();
        this.tasks = [];
        void flushSignupAttempts();
    }
}

export const activityRollupJob = new ActivityRollupJob();
