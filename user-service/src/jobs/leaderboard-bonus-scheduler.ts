import cron, { type ScheduledTask } from 'node-cron';
import { leaderboardBonusService } from '../services/leaderboard-bonus.service';
import config from '../config';
import logger from '../utils/logger';

const log = logger.getLogger('LeaderboardBonusScheduler');

/**
 * Runs the monthly leaderboard bonus payout (default: 03:00 on the 1st, Douala).
 *
 * The job itself is a thin trigger — the month lock and the per-member
 * idempotency live in the service, so a missed month can be replayed by hand
 * through the admin endpoint and lands on exactly the same result.
 */
export class LeaderboardBonusScheduler {
    private task: ScheduledTask | null = null;

    start(): void {
        if (this.task) {
            log.warn('Leaderboard bonus scheduler is already running');
            return;
        }
        if (!config.leaderboardBonus.enabled) {
            log.info('Leaderboard bonus payout disabled — scheduler not started.');
            return;
        }

        const { cron: expression, timezone } = config.leaderboardBonus;
        if (!cron.validate(expression)) {
            // Fail loudly at boot rather than silently never paying anyone.
            log.error(`Invalid LEADERBOARD_BONUS_CRON "${expression}" — payout NOT scheduled.`);
            return;
        }

        this.task = cron.schedule(expression, async () => {
            try {
                await leaderboardBonusService.runScheduledPayout('cron');
            } catch (error: any) {
                // Never let a payout failure take the process down; the month
                // can be replayed from the admin endpoint.
                log.error('Scheduled leaderboard bonus payout failed:', error);
            }
        }, { timezone });

        log.info(`Leaderboard bonus scheduler started (${expression}, ${timezone}).`);
    }

    stop(): void {
        this.task?.stop();
        this.task = null;
    }
}

export const leaderboardBonusScheduler = new LeaderboardBonusScheduler();
