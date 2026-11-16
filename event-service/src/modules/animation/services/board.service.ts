import { Types } from 'mongoose';
import { AnimCandidate, AnimChallenge, IAnimChallenge } from '../models/challenge.model';
import { AnimBoardSnapshot, AnimResult } from '../models/reward.model';
import { AnimVote } from '../models/vote.model';
import { CandidateStatus, ChallengeStatus, ResultStatus, VoteKind, VoteStatus } from '../types';
import { BoardEntry, computeBoard } from '../lib/rules';
import { kv } from '../lib/kv';
import logger from '../../../utils/logger';

const log = logger.getLogger('AnimationBoard');

/**
 * The live leaderboard (§24). Votes only $inc counters on the candidate; the
 * ranking is derived. A dirty challenge is recomputed at most once per second
 * by the job leader, the rendered board is cached in the KV store and pushed
 * on pub/sub to every instance's SSE clients — so ten thousand viewers cost
 * one Mongo query per second, not ten thousand.
 */

export interface PublicBoard {
    challengeId: string;
    status: ChallengeStatus;
    version: number;
    computedAt: string;
    showVoteCounts: boolean;
    scoringMethod: string;
    totals: { candidates: number; votes: number };
    entries: Array<Pick<BoardEntry, 'candidateId' | 'number' | 'displayName' | 'photoFileId' | 'category' | 'rank' | 'juryScore'> & {
        score?: number;
        publicScore?: number;
        totalVotes?: number;
        freeVotes?: number;
        paidVotes?: number;
    }>;
}

const BOARD_KEY = (id: string) => `board:${id}`;
const DIRTY_SET = 'boards:dirty';
export const BOARD_CHANNEL = (id: string) => `board:${id}`;
const BOARD_TTL_SEC = 24 * 3600;

const loadEntries = async (challenge: IAnimChallenge) => {
    const rows = await AnimCandidate.find({ challengeId: challenge._id, status: CandidateStatus.APPROVED })
        .select('number displayName userId photoFileId category freeVotes paidVotes juryScore juryCount reachedTotalAt')
        .lean();
    const board = computeBoard(rows.map((r) => ({
        candidateId: String(r._id),
        number: r.number,
        displayName: r.displayName,
        userId: String(r.userId),
        photoFileId: r.photoFileId,
        category: r.category,
        freeVotes: r.freeVotes,
        paidVotes: r.paidVotes,
        juryScore: r.juryScore,
        juryCount: r.juryCount,
        reachedTotalAt: r.reachedTotalAt,
    })), challenge.scoring);
    return applyFrozenRanks(challenge, board);
};

/**
 * Once the result is frozen its ranks are the truth: a tie decided by the
 * organizer, jury or second round must not be undone by the live ordering.
 */
const applyFrozenRanks = async (challenge: IAnimChallenge, board: BoardEntry[]) => {
    if (challenge.status !== ChallengeStatus.RESULTS_PENDING && challenge.status !== ChallengeStatus.COMPLETED) return board;
    const result = await AnimResult.findOne({ challengeId: challenge._id, status: ResultStatus.FROZEN }).select('entries.candidateId entries.rank').lean();
    if (!result) return board;
    const rankOf = new Map(result.entries.map((e) => [String(e.candidateId), e.rank]));
    return board
        .map((e) => ({ ...e, rank: rankOf.get(e.candidateId) ?? e.rank }))
        .sort((a, b) => a.rank - b.rank);
};

const render = (challenge: IAnimChallenge, entries: BoardEntry[], version: number): PublicBoard => {
    const show = challenge.voting.showVoteCounts;
    return {
        challengeId: String(challenge._id),
        status: challenge.status,
        version,
        computedAt: new Date().toISOString(),
        showVoteCounts: show,
        scoringMethod: challenge.scoring.method,
        totals: {
            candidates: entries.length,
            votes: show ? entries.reduce((s, e) => s + e.totalVotes, 0) : 0,
        },
        entries: entries.map((e) => ({
            candidateId: e.candidateId,
            number: e.number,
            displayName: e.displayName,
            photoFileId: e.photoFileId,
            category: e.category,
            rank: e.rank,
            juryScore: e.juryScore,
            // The score is derived from votes (×1000 when ranking on votes): with
            // counts hidden it would give them away, so only the rank is public.
            ...(show ? { score: e.score, publicScore: e.publicScore, totalVotes: e.totalVotes, freeVotes: e.freeVotes, paidVotes: e.paidVotes } : {}),
        })),
    };
};

/** Recomputes, caches and broadcasts one board. */
export const refreshBoard = async (challengeId: string): Promise<PublicBoard | null> => {
    const challenge = await AnimChallenge.findOneAndUpdate(
        { _id: challengeId },
        { $inc: { boardVersion: 1 } },
        { new: true },
    );
    if (!challenge) return null;
    const entries = await loadEntries(challenge);
    const board = render(challenge, entries, challenge.boardVersion);
    const json = JSON.stringify(board);
    await kv().set(BOARD_KEY(challengeId), json, BOARD_TTL_SEC);
    await kv().publish(BOARD_CHANNEL(challengeId), json);
    return board;
};

/** Marks a board for recompute on the next publisher pass (≤ 1 s). */
export const markBoardDirty = async (challengeId: string | Types.ObjectId) => {
    try {
        await kv().sadd(DIRTY_SET, String(challengeId));
    } catch (err) {
        log.warn(`markBoardDirty failed for ${challengeId}: ${(err as Error).message}`);
    }
};

/** Leader-only: recompute every dirty board. Returns how many. */
export const flushDirtyBoards = async (): Promise<number> => {
    const ids = await kv().spopAll(DIRTY_SET);
    for (const id of ids) {
        try { await refreshBoard(id); } catch (err) { log.error(`refreshBoard ${id} failed: ${(err as Error).message}`); }
    }
    return ids.length;
};

/** Cached board, computed on a miss (cold cache, KV restart). */
export const getBoard = async (challengeId: string): Promise<PublicBoard | null> => {
    const cached = await kv().get(BOARD_KEY(challengeId));
    if (cached) return JSON.parse(cached) as PublicBoard;
    return refreshBoard(challengeId);
};

/** Full-precision entries for results and snapshots (not cached). */
export const computeEntries = async (challenge: IAnimChallenge) => loadEntries(challenge);

/**
 * Heals counter drift: recounts each candidate's free/paid votes from the
 * ledger (the source of truth) and rewrites counters that disagree. A crash
 * between a ledger insert and its $inc is the only way they drift.
 */
export const recountFromLedger = async (challengeId: string | Types.ObjectId): Promise<number> => {
    const cid = new Types.ObjectId(String(challengeId));
    const agg = await AnimVote.aggregate<{ _id: { c: Types.ObjectId; k: VoteKind }; q: number; last: Date }>([
        { $match: { challengeId: cid, status: VoteStatus.COUNTED } },
        { $group: { _id: { c: '$candidateId', k: '$kind' }, q: { $sum: '$quantity' }, last: { $max: '$at' } } },
    ]);
    const byCandidate = new Map<string, { free: number; paid: number; last?: Date }>();
    for (const r of agg) {
        const key = String(r._id.c);
        const acc = byCandidate.get(key) ?? { free: 0, paid: 0 };
        if (r._id.k === VoteKind.PAID) acc.paid += r.q; else acc.free += r.q; // ADJUSTMENT counts as free-side public votes
        if (!acc.last || r.last > acc.last) acc.last = r.last;
        byCandidate.set(key, acc);
    }
    const candidates = await AnimCandidate.find({ challengeId: cid }).select('freeVotes paidVotes').lean();
    let fixed = 0;
    for (const c of candidates) {
        const truth = byCandidate.get(String(c._id)) ?? { free: 0, paid: 0 };
        if (c.freeVotes !== truth.free || c.paidVotes !== truth.paid) {
            await AnimCandidate.updateOne({ _id: c._id }, {
                $set: { freeVotes: truth.free, paidVotes: truth.paid, totalVotes: truth.free + truth.paid },
            });
            fixed++;
        }
    }
    if (fixed) {
        log.warn(`Recount fixed ${fixed} candidate counters on challenge ${cid}`);
        await markBoardDirty(cid);
    }
    return fixed;
};

export const takeSnapshot = async (challenge: IAnimChallenge, kind: 'PERIODIC' | 'PHASE' | 'FINAL') => {
    const entries = await loadEntries(challenge);
    const keep = kind === 'FINAL' ? entries : entries.slice(0, 200);
    await AnimBoardSnapshot.create({
        challengeId: challenge._id,
        eventId: challenge.eventId,
        kind,
        boardVersion: challenge.boardVersion,
        takenAt: new Date(),
        entries: keep.map((e) => ({
            candidateId: new Types.ObjectId(e.candidateId), number: e.number,
            free: e.freeVotes, paid: e.paidVotes, jury: e.juryScore, score: e.score, rank: e.rank,
        })),
    });
    // Persist ranks at snapshot time only — never per vote.
    if (entries.length) {
        await AnimCandidate.bulkWrite(entries.map((e) => ({
            updateOne: { filter: { _id: new Types.ObjectId(e.candidateId) }, update: { $set: { rank: e.rank, score: e.score } } },
        })));
    }
    return keep;
};
