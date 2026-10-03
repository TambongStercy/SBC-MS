import { createHash, createHmac } from 'crypto';
import { ChallengeStatus, statusIndex } from '../types';

/**
 * Locking (§8, §38): once a challenge reaches a phase, the parameters people
 * relied on stop being editable. Field path prefix → first status where it is locked.
 *
 * Participation is locked as soon as anyone can register; everything that
 * decides the outcome — how votes count, what they cost, the schedule, the
 * prize and the tie rule — as soon as the competition is under way.
 */
export const LOCK_POLICY: { prefix: string; from: ChallengeStatus }[] = [
    { prefix: 'participation', from: ChallengeStatus.REGISTRATION_OPEN },
    { prefix: 'voting', from: ChallengeStatus.ACTIVE },
    { prefix: 'scoring', from: ChallengeStatus.ACTIVE },
    { prefix: 'tieRule', from: ChallengeStatus.ACTIVE },
    { prefix: 'rankRewards', from: ChallengeStatus.ACTIVE },
    { prefix: 'schedule', from: ChallengeStatus.ACTIVE },
    { prefix: 'rulesText', from: ChallengeStatus.REGISTRATION_OPEN },
];

/** Fields that are never editable through a patch, whatever the phase. */
export const IMMUTABLE_FIELDS = new Set([
    'organizerId', 'eventId', 'status', 'statusHistory', 'counters', 'candidateSeq', 'boardVersion',
    'resultId', 'cancellation', 'createdBy', 'suspendedAt', 'suspendedReason', 'parentChallengeId', 'slug',
]);

/** Fields an organizer may still change on a locked challenge without review. */
const ALWAYS_EDITABLE = new Set(['description', 'imageFileId', 'name']);

export const lockedPathsFor = (status: ChallengeStatus, paths: string[]): string[] => {
    if (status === ChallengeStatus.DRAFT || status === ChallengeStatus.PROGRAMMED) return [];
    const idx = statusIndex(status);
    const terminal = status === ChallengeStatus.CANCELLED || status === ChallengeStatus.COMPLETED;
    return paths.filter((p) => {
        if (ALWAYS_EDITABLE.has(p.split('.')[0])) return terminal;
        if (terminal) return true;
        // Extending the voting deadline before it passes is the one self-service
        // exception (§38: controlled and logged); shortening it is not.
        if (p === 'schedule.votingClosesAt' && idx < statusIndex(ChallengeStatus.VOTING_CLOSED)) return false;
        return LOCK_POLICY.some((rule) => (p === rule.prefix || p.startsWith(`${rule.prefix}.`)) && idx >= statusIndex(rule.from));
    });
};

/** Allowed moves of the state machine (§11). */
export const NEXT_STATUS: Partial<Record<ChallengeStatus, ChallengeStatus[]>> = {
    [ChallengeStatus.DRAFT]: [ChallengeStatus.PROGRAMMED],
    [ChallengeStatus.PROGRAMMED]: [ChallengeStatus.REGISTRATION_OPEN, ChallengeStatus.ACTIVE, ChallengeStatus.DRAFT],
    [ChallengeStatus.REGISTRATION_OPEN]: [ChallengeStatus.REGISTRATION_CLOSED],
    [ChallengeStatus.REGISTRATION_CLOSED]: [ChallengeStatus.ACTIVE],
    [ChallengeStatus.ACTIVE]: [ChallengeStatus.VOTING_OPEN, ChallengeStatus.VOTING_CLOSED],
    [ChallengeStatus.VOTING_OPEN]: [ChallengeStatus.VOTING_CLOSED],
    [ChallengeStatus.VOTING_CLOSED]: [ChallengeStatus.RESULTS_PENDING],
    [ChallengeStatus.RESULTS_PENDING]: [ChallengeStatus.COMPLETED],
};

export const canTransition = (from: ChallengeStatus, to: ChallengeStatus) => {
    if (to === ChallengeStatus.CANCELLED) return from !== ChallengeStatus.COMPLETED && from !== ChallengeStatus.CANCELLED;
    return (NEXT_STATUS[from] ?? []).includes(to);
};

// ---------- Scoring (§21–§22) ----------

export interface BoardInput {
    candidateId: string;
    number: number;
    displayName: string;
    userId: string;
    photoFileId?: string;
    category?: string;
    freeVotes: number;
    paidVotes: number;
    juryScore: number;
    juryCount: number;
    reachedTotalAt?: Date | null;
}

export interface BoardEntry extends BoardInput {
    totalVotes: number;
    publicScore: number;   // 0–100
    score: number;         // integer milli-points
    rank: number;
    /** Same final score as another candidate (before any tie-break). */
    tied: boolean;
}

/**
 * Generic score (§22): public part = votes normalised to the leader (share of
 * max, 0–100), jury part = mean weighted criteria (0–100); final =
 * round(1000 × (wP·public + wJ·jury)/100). Integer, so comparison is exact.
 * VOTES ranks on raw votes; JURY on the jury score alone.
 *
 * Live order breaks equal scores by who got there first, then by number; the
 * `tied` flag lets the result apply the challenge's tie rule instead.
 */
export const computeBoard = (
    rows: BoardInput[],
    scoring: { method: string; publicWeight: number; juryWeight: number },
): BoardEntry[] => {
    const maxVotes = Math.max(0, ...rows.map((r) => r.freeVotes + r.paidVotes));
    const entries = rows.map((r) => {
        const totalVotes = r.freeVotes + r.paidVotes;
        const publicScore = maxVotes > 0 ? (100 * totalVotes) / maxVotes : 0;
        let score: number;
        if (scoring.method === 'VOTES') score = totalVotes * 1000;
        else if (scoring.method === 'JURY') score = Math.round(1000 * r.juryScore);
        else score = Math.round((1000 * (scoring.publicWeight * publicScore + scoring.juryWeight * r.juryScore)) / 100);
        return { ...r, totalVotes, publicScore: Math.round(publicScore * 100) / 100, score, rank: 0, tied: false };
    });
    entries.sort((a, b) =>
        b.score - a.score
        || (a.reachedTotalAt ? +a.reachedTotalAt : Infinity) - (b.reachedTotalAt ? +b.reachedTotalAt : Infinity)
        || a.number - b.number);
    const byScore = new Map<number, number>();
    for (const e of entries) byScore.set(e.score, (byScore.get(e.score) ?? 0) + 1);
    entries.forEach((e, i) => {
        e.rank = i + 1;
        e.tied = (byScore.get(e.score) ?? 0) > 1 && e.score > 0;
    });
    return entries;
};

/** Jury score of one sheet: Σ (value/max) × weight, weights summing to 100 → 0–100. */
export const weightedJuryScore = (
    criteria: { key: string; weight: number; maxScore: number }[],
    scores: { key: string; value: number }[],
) => {
    const totalWeight = criteria.reduce((s, c) => s + c.weight, 0) || 1;
    let sum = 0;
    for (const c of criteria) {
        const v = scores.find((s) => s.key === c.key)?.value ?? 0;
        sum += (Math.min(Math.max(v, 0), c.maxScore) / (c.maxScore || 1)) * c.weight;
    }
    return Math.round((sum / totalWeight) * 100 * 100) / 100;
};

// ---------- Verifiable random draw ----------

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Picks `k` distinct entrants from a sorted list with an HMAC-SHA256 stream
 * keyed by `seed` (partial Fisher–Yates, rejection sampling — no modulo bias).
 * Deterministic: the same seed and entrants always give the same winners, so a
 * crashed draw re-runs to the same result and anyone holding the revealed seed
 * and the entrant list can check it.
 */
export const drawWinners = (sortedEntrants: string[], k: number, seed: string): string[] => {
    const pool = [...sortedEntrants];
    const n = Math.min(k, pool.length);
    let counter = 0;
    const nextUint32 = () => {
        const h = createHmac('sha256', seed).update(String(counter++)).digest();
        return h.readUInt32BE(0);
    };
    const randomBelow = (bound: number) => {
        const limit = Math.floor(0x100000000 / bound) * bound;
        let x: number;
        do { x = nextUint32(); } while (x >= limit);
        return x % bound;
    };
    for (let i = 0; i < n; i++) {
        const j = i + randomBelow(pool.length - i);
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, n);
};

/** Canonical JSON (sorted keys) so a definition hashes the same however it was built. */
export const canonical = (v: unknown): string => {
    if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
    if (v && typeof v === 'object' && !(v instanceof Date)) {
        return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as any)[k])}`).join(',')}}`;
    }
    if (v instanceof Date) return JSON.stringify(v.toISOString());
    return JSON.stringify(v ?? null);
};

/** Day bucket in the challenge's timezone (Douala, UTC+1, no DST). */
export const dayKey = (d: Date, utcOffsetMin = 60) =>
    new Date(d.getTime() + utcOffsetMin * 60_000).toISOString().slice(0, 10);

/** Seconds until the end of the current day bucket — free-vote quota TTL. */
export const secondsToEndOfDay = (d: Date, utcOffsetMin = 60) => {
    const local = d.getTime() + utcOffsetMin * 60_000;
    const end = Math.floor(local / 86_400_000) * 86_400_000 + 86_400_000;
    return Math.max(60, Math.ceil((end - local) / 1000) + 3600); // + 1 h margin, keys die after their day
};

/** A free-text reason as the end of a sentence: trimmed, exactly one final punctuation mark. */
export const asSentence = (text?: string | null) => {
    const t = (text ?? '').trim();
    return !t ? '' : /[.!?…]$/.test(t) ? t : `${t}.`;
};
