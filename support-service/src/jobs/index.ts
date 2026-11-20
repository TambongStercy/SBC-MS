import Bull, { Queue } from 'bull';
import config from '../config';
import { withLock } from '../lib/lock';
import logger from '../utils/logger';
import { autoCloseResolved, checkSla } from '../services/ticket.service';
import { alertIdle, catchUpFromAdvertising, dispatch, requeueUnstarted } from '../services/views.service';
import { withdrawalAgeAlerts } from '../services/finance.service';
import { getSetting, isKillSwitchOn } from '../services/settings.service';
import { recheckPayin } from '../services/clients/payment.client';
import { openActivationCaseAndTicket } from '../services/activation.service';

const log = logger.getLogger('Jobs');

/**
 * Scheduled work on Bull (repeatable jobs are deduplicated by Bull across
 * processes) plus a Redis lock per job, so even a slow run never overlaps
 * another process's run of the same schedule.
 */

interface Schedule { name: string; everyMs: number; run: () => Promise<unknown> }

const SCHEDULES: Schedule[] = [
    { name: 'ticket-sla', everyMs: 5 * 60_000, run: checkSla },
    { name: 'ticket-autoclose', everyMs: 60 * 60_000, run: async () => autoCloseResolved(await getSetting<number>('tickets.autoCloseResolvedDays')) },
    { name: 'views-catchup', everyMs: 5 * 60_000, run: catchUpFromAdvertising },
    { name: 'views-requeue', everyMs: 60_000, run: requeueUnstarted },
    { name: 'views-idle', everyMs: 60_000, run: alertIdle },
    { name: 'views-dispatch', everyMs: 60_000, run: dispatch },
    {
        name: 'finance-age-alerts', everyMs: 60 * 60_000,
        run: async () => ((await isKillSwitchOn('reconciliation')) ? 'skipped (kill switch)' : withdrawalAgeAlerts()),
    },
];

let queue: Queue | null = null;

const bullOpts = () => ({ redis: config.redis.url, prefix: `bull:${config.redis.keyPrefix.replace(/:$/, '')}` });

export async function runScheduled(name: string): Promise<unknown> {
    const s = SCHEDULES.find((x) => x.name === name);
    if (!s) throw new Error(`unknown job ${name}`);
    return withLock(`job:${name}`, Math.max(s.everyMs, 60_000), s.run);
}

export async function startJobs(): Promise<void> {
    queue = new Bull('support-jobs', bullOpts());
    queue.process('scheduled', 1, async (job) => {
        const name = job.data.name as string;
        try {
            const result = await runScheduled(name);
            if (result !== undefined) log.debug('job done', { name, result });
        } catch (err) {
            log.warn('job failed', { name, message: (err as Error).message });
            throw err;
        }
    });
    queue.process('activation-recheck', 2, async (job) => {
        const { sessionId, userId } = job.data as { sessionId: string; userId: string };
        const r = await recheckPayin(sessionId);
        if (r.result === 'pending') throw new Error('still pending'); // Bull retries with backoff
        if (r.result === 'not_found' || r.result === 'provider_unavailable') await openActivationCaseAndTicket(userId, sessionId, r, 'session');
        return r.result;
    });
    queue.on('failed', async (job, err) => {
        if (job.name === 'activation-recheck' && job.attemptsMade >= (job.opts.attempts ?? 1)) {
            const { sessionId, userId } = job.data as { sessionId: string; userId: string };
            log.info('activation still pending after retries: opening a case', { sessionId });
            await openActivationCaseAndTicket(userId, sessionId, { result: 'pending', provider: 'unknown', checkedAt: new Date().toISOString() }, 'session').catch(() => undefined);
        }
        if (job.name !== 'activation-recheck') log.warn('job failed', { name: job.data?.name, message: err.message });
    });
    // Drop schedules from older versions, then (re)register ours.
    const existing = await queue.getRepeatableJobs();
    for (const r of existing) {
        if (!SCHEDULES.some((s) => r.id === s.name && r.every === s.everyMs)) await queue.removeRepeatableByKey(r.key);
    }
    for (const s of SCHEDULES) {
        await queue.add('scheduled', { name: s.name }, { jobId: s.name, repeat: { every: s.everyMs }, removeOnComplete: 50, removeOnFail: 50 });
    }
    log.info('jobs scheduled', { count: SCHEDULES.length });
}

/** Payment still pending: re-check after 5, 10, 20, 40 min; then open a case. */
export async function scheduleActivationRecheck(sessionId: string, userId: string): Promise<void> {
    if (!queue) return;
    await queue.add('activation-recheck', { sessionId, userId }, {
        jobId: `recheck:${sessionId}`, delay: 5 * 60_000, attempts: 4, backoff: { type: 'exponential', delay: 5 * 60_000 },
        removeOnComplete: 100, removeOnFail: 100,
    });
}

export async function stopJobs(): Promise<void> {
    if (queue) {
        await queue.close().catch(() => undefined);
        queue = null;
    }
}
