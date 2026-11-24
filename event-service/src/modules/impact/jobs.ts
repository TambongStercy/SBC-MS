import logger from '../../utils/logger';
import { INSTANCE_ID, kv } from '../animation/lib/kv';
import { qualificationTick } from './services/qualification.service';
import { invalidateCurrent } from './services/edition.service';
import { recountVotes, roundTick } from './services/stage.service';
import { reconcilePurchases, retryRefunds, sweepBalancePayments } from './services/vote.service';
import { invalidateBoard } from './services/board.service';
import { ImpactEdition } from './models';
import { EditionStatus } from './types';

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
let tickCount = 0;

const step = async (name: string, fn: () => Promise<number>) => {
    try {
        const n = await fn();
        if (n) log.info(`${name}: ${n}`);
    } catch (err) {
        log.error(`${name} failed: ${(err as Error).message}`);
    }
};

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
        const r = await roundTick();
        if (r) log.info(`vote rounds: ${r} opened/closed`);
        tickCount++;
        // Every minute: payments whose callback never came, balance payments with an
        // unknown outcome, refunds to retry.
        if (tickCount % Math.max(1, Math.round(60_000 / TICK_MS)) === 0) {
            await step('reconcile purchases', reconcilePurchases);
            await step('balance payments', sweepBalancePayments);
            await step('refund retries', retryRefunds);
        }
        // Every 5 min: counters from the ledgers (the decision itself recounts too).
        if (tickCount % Math.max(1, Math.round(300_000 / TICK_MS)) === 0) {
            const live = await ImpactEdition.find({ status: EditionStatus.COMPETITION }).select('_id').lean();
            for (const e of live) {
                const changed = await recountVotes(e._id);
                if (changed) invalidateBoard();
            }
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
