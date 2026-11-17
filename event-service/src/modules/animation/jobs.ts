import config from '../../config';
import logger from '../../utils/logger';
import { AnimChallenge } from './models/challenge.model';
import { ChallengeStatus } from './types';
import { INSTANCE_ID, kv } from './lib/kv';
import { flushDirtyBoards, recountFromLedger, takeSnapshot } from './services/board.service';
import { autoAdvance } from './services/challenge.service';
import { flushOutbox } from './services/outbox.service';
import { reconcileVotePayments, retryVoteRefunds, sweepStrandedPaidVotes, sweepVoteCredits } from './services/paid-vote.service';
import { runDueDraws, sweepOrphanTicks } from './services/reward.service';
import { scanChallenges } from './services/fraud.service';

const log = logger.getLogger('AnimationJobs');

/**
 * Background work of the animation module. Every instance runs the timers;
 * only the one holding the Redis leader lock does the work, so scaling
 * event-service out never runs a job twice (and a dead leader is replaced
 * within the lock TTL).
 *
 *  - every second: recompute dirty boards and broadcast them (§24, §36);
 *  - every tick (30 s): date-driven transitions, draws, payment reconciliation,
 *    organizer credits, refunds, orphan reward ticks, notification outbox;
 *  - every 5 min: ledger recount, board snapshots (15 min), fraud scan.
 */
const LEADER_TTL_MS = 10_000;
let timers: NodeJS.Timeout[] = [];
const running = new Set<string>();

const asLeader = async () => {
    try {
        return await kv().acquireLock('anim-leader', INSTANCE_ID, LEADER_TTL_MS);
    } catch (err) {
        log.warn(`leader lock unavailable: ${(err as Error).message}`);
        return false;
    }
};

const once = (name: string, fn: () => Promise<unknown>) => async () => {
    if (running.has(name)) return; // previous run still going
    running.add(name);
    try {
        if (await asLeader()) await fn();
    } catch (err) {
        log.error(`${name} failed: ${(err as Error).message}`);
    } finally {
        running.delete(name);
    }
};

const step = async (name: string, fn: () => Promise<number>) => {
    try {
        const n = await fn();
        if (n) log.info(`${name}: ${n}`);
    } catch (err) {
        log.error(`${name} failed: ${(err as Error).message}`);
    }
};

export const mainTick = async () => {
    await step('auto-advance', autoAdvance);
    await step('orphan ticks', sweepOrphanTicks);
    await step('draws', runDueDraws);
    await step('vote reconciler', reconcileVotePayments);
    await step('vote credits', sweepVoteCredits);
    await step('vote refunds', retryVoteRefunds);
    await step('outbox', flushOutbox);
};

export const slowTick = async () => {
    const live = await AnimChallenge.find({ status: ChallengeStatus.VOTING_OPEN }).select('_id').lean();
    for (const c of live) {
        await step(`recount ${c._id}`, () => recountFromLedger(c._id));
        const key = `snap:${c._id}`;
        if (!(await kv().get(key))) {
            const challenge = await AnimChallenge.findById(c._id);
            if (challenge) await takeSnapshot(challenge, 'PERIODIC');
            await kv().set(key, '1', 15 * 60);
        }
    }
    await step('fraud scan', scanChallenges);
    await step('stranded paid votes', sweepStrandedPaidVotes);
};

export const startAnimationJobs = () => {
    if (timers.length) return;
    timers = [
        setInterval(once('boards', flushDirtyBoards), 1000),
        setInterval(once('main', mainTick), config.animation.tickIntervalMs),
        setInterval(once('slow', slowTick), 5 * 60_000),
    ];
    log.info(`Animation jobs started (instance ${INSTANCE_ID}, state on ${kv().backend}).`);
};

export const stopAnimationJobs = () => {
    timers.forEach(clearInterval);
    timers = [];
};
