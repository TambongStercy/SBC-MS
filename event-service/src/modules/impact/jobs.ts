import logger from '../../utils/logger';
import { INSTANCE_ID, kv } from '../animation/lib/kv';
import { qualificationTick } from './services/qualification.service';
import { invalidateCurrent } from './services/edition.service';

const log = logger.getLogger('ImpactJobs');

/**
 * Every instance runs the timer; only the holder of the Redis leader lock does
 * the work, so seats are handed out by a single writer even when event-service
 * runs several processes.
 */
const TICK_MS = Number(process.env.IMPACT_TICK_MS || 10_000);
const LEADER_TTL_MS = 30_000;
let timer: NodeJS.Timeout | null = null;
let running = false;

const tick = async () => {
    if (running) return;
    running = true;
    try {
        if (!(await kv().acquireLock('impact-leader', INSTANCE_ID, LEADER_TTL_MS))) return;
        const n = await qualificationTick();
        if (n) {
            invalidateCurrent();
            log.info(`qualification: ${n} change(s)`);
        }
    } catch (err) {
        log.error(`impact tick failed: ${(err as Error).message}`);
    } finally {
        running = false;
    }
};

export const startImpactJobs = () => {
    if (timer) return;
    timer = setInterval(tick, TICK_MS);
    log.info(`Impact Challenge jobs started (every ${TICK_MS} ms, instance ${INSTANCE_ID}).`);
};

export const stopImpactJobs = () => {
    if (timer) clearInterval(timer);
    timer = null;
};
