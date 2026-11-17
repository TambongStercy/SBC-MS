import { createHash } from 'crypto';
import { Types } from 'mongoose';
import Event, { EventStatus } from '../../../database/models/event.model';
import TicketType from '../../../database/models/ticket-type.model';
import config from '../../../config';
import { AppError } from '../../../utils/errors';
import { AnimCandidate, AnimChallenge, IAnimChallenge } from '../models/challenge.model';
import { AnimVote } from '../models/vote.model';
import {
    CandidateStatus, ChallengeStatus, FreeVotePeriod, RuleTrigger, VoteKind, VoterScope, allowsFreeVotes,
} from '../types';
import { QuotaKey, kv } from '../lib/kv';
import { dayKey, secondsToEndOfDay } from '../lib/rules';
import { holdsValidTicket } from './eligibility.service';
import { markBoardDirty } from './board.service';

export const hashSignal = (v?: string) =>
    v ? createHash('sha256').update(`${config.qrTokenSecret}|anim|${v}`).digest('hex').slice(0, 32) : undefined;

/** Voting window check shared by free and paid votes (§15). */
export const assertVotingOpen = async (challenge: IAnimChallenge, now = new Date()) => {
    const s = challenge.schedule;
    if (challenge.status !== ChallengeStatus.VOTING_OPEN
        || (s.votingOpensAt && new Date(s.votingOpensAt) > now)
        || (s.votingClosesAt && new Date(s.votingClosesAt) <= now)) {
        throw new AppError('Les votes ne sont pas ouverts.', 409, true, 'VOTING_CLOSED');
    }
    if (challenge.suspendedAt) throw new AppError('Ce défi est suspendu.', 409, true, 'SUSPENDED');
    const event = await Event.findById(challenge.eventId).select('status').lean();
    if (event?.status !== EventStatus.PUBLISHED && event?.status !== EventStatus.COMPLETED) {
        throw new AppError('Cet événement n’est pas ouvert.', 409, true, 'EVENT_CLOSED');
    }
};

/**
 * Voter eligibility (§7, decided per challenge). The ticket lookup is cached
 * for five minutes per voter: during a spike the same people vote again and
 * again, and the answer barely changes.
 */
export const assertCanVote = async (challenge: IAnimChallenge, userId: string) => {
    const scope = challenge.voting.voterScope;
    if (scope === VoterScope.ANY_SBC_USER) return;
    const key = `elig:${challenge._id}:${userId}`;
    const cached = await kv().get(key);
    let ok: boolean;
    if (cached !== null) ok = cached === '1';
    else {
        ok = scope === VoterScope.TICKET_HOLDERS
            ? await holdsValidTicket(userId, challenge.eventId)
            : await holdsValidTicket(userId, challenge.eventId, challenge.voting.voterTicketTypeIds);
        await kv().set(key, ok ? '1' : '0', ok ? 300 : 60);
    }
    if (!ok) {
        if (scope === VoterScope.TICKET_HOLDERS) {
            throw new AppError('Le vote est réservé aux détenteurs d’un billet de l’événement.', 403, true, 'TICKET_REQUIRED');
        }
        const types = await TicketType.find({ _id: { $in: challenge.voting.voterTicketTypeIds ?? [] } }).select('name').lean();
        const names = types.map((t) => `« ${t.name} »`).join(', ');
        throw new AppError(names
            ? `Le vote est réservé aux détenteurs d’un billet ${names}.`
            : 'Le vote est réservé à certains types de billets.', 403, true, 'TICKET_REQUIRED');
    }
};

export const loadVotable = async (challengeId: string, candidateId: string) => {
    if (!Types.ObjectId.isValid(challengeId) || !Types.ObjectId.isValid(candidateId)) throw new AppError('Candidat introuvable.', 404);
    const [challenge, candidate] = await Promise.all([
        AnimChallenge.findById(challengeId),
        AnimCandidate.findOne({ _id: candidateId, challengeId }).select('userId status number displayName challengeId eventId organizerId').lean(),
    ]);
    if (!challenge || !candidate) throw new AppError('Candidat introuvable.', 404);
    if (candidate.status !== CandidateStatus.APPROVED) throw new AppError('Ce candidat ne peut pas recevoir de votes.', 409, true, 'CANDIDATE_NOT_VOTABLE');
    return { challenge, candidate };
};

/** Abuse brakes on the vote endpoints: per account and per network address. */
export const throttle = async (userId: string, ip: string | undefined, kind: 'free' | 'paid') => {
    const limits = kind === 'free' ? { user: 30, ip: 600 } : { user: 10, ip: 120 };
    const [u, i] = await Promise.all([
        kv().hit(`rl:${kind}:u:${userId}`, 60),
        ip ? kv().hit(`rl:${kind}:ip:${ip}`, 60) : Promise.resolve(0),
    ]);
    if (u > limits.user || i > limits.ip) throw new AppError('Trop de votes en peu de temps. Patientez une minute.', 429, true, 'RATE_LIMITED');
};

const quotaKeys = (challenge: IAnimChallenge, userId: string, candidateId: string, now: Date): QuotaKey[] => {
    const f = challenge.voting.free;
    const cid = String(challenge._id);
    const closes = challenge.schedule.votingClosesAt ? new Date(challenge.schedule.votingClosesAt).getTime() : now.getTime() + 30 * 86_400_000;
    // Whole-challenge counters live until two days after voting closes.
    const challengeTtl = Math.max(3600, Math.ceil((closes - now.getTime()) / 1000) + 2 * 86_400);
    const daily = f.period === FreeVotePeriod.DAY;
    const bucket = daily ? `d:${dayKey(now)}` : 'all';
    const ttl = daily ? secondsToEndOfDay(now) : challengeTtl;
    const keys: QuotaKey[] = [{ key: `q:${cid}:${userId}:${bucket}`, limit: f.perPeriod, ttlSec: ttl }];
    if (f.perCandidatePerPeriod) keys.push({ key: `q:${cid}:${userId}:c:${candidateId}:${bucket}`, limit: f.perCandidatePerPeriod, ttlSec: ttl });
    if (f.totalPerChallenge) keys.push({ key: `q:${cid}:${userId}:total`, limit: f.totalPerChallenge, ttlSec: challengeTtl });
    return keys;
};

const QUOTA_MESSAGES = [
    'Vous avez utilisé tous vos votes gratuits pour cette période.',
    'Vous avez déjà voté le maximum pour ce candidat pour cette période.',
    'Vous avez utilisé tous vos votes gratuits pour ce défi.',
];

/**
 * A free vote (§16). The quota is claimed in Redis first — atomically across
 * every applicable limit — then the vote is written to the ledger and the
 * counters incremented. If the ledger write fails the quota is given back, so
 * a failed request never costs the voter a vote.
 */
export const castFreeVote = async (args: { userId: string; challengeId: string; candidateId: string; ip?: string; ua?: string }) => {
    const { challenge, candidate } = await loadVotable(args.challengeId, args.candidateId);
    if (!allowsFreeVotes(challenge.voting.mode)) throw new AppError('Ce défi n’a pas de votes gratuits.', 409, true, 'NO_FREE_VOTES');
    const now = new Date();
    await assertVotingOpen(challenge, now);
    if (!challenge.voting.selfVoteAllowed && String(candidate.userId) === args.userId) {
        throw new AppError('Vous ne pouvez pas voter pour vous-même.', 403, true, 'SELF_VOTE');
    }
    await assertCanVote(challenge, args.userId);
    await throttle(args.userId, args.ip, 'free');

    const keys = quotaKeys(challenge, args.userId, args.candidateId, now);
    const exhausted = await kv().claimQuota(keys);
    if (exhausted >= 0) {
        const which = keys[exhausted].key.includes(':c:') ? 1 : keys[exhausted].key.endsWith(':total') ? 2 : 0;
        throw new AppError(QUOTA_MESSAGES[which], 429, true, 'QUOTA_EXHAUSTED');
    }

    try {
        await AnimVote.create({
            organizerId: challenge.organizerId, eventId: challenge.eventId, challengeId: challenge._id,
            candidateId: candidate._id, voterUserId: args.userId, kind: VoteKind.FREE, quantity: 1,
            periodKey: dayKey(now), ipHash: hashSignal(args.ip), uaHash: hashSignal(args.ua), at: now,
        });
    } catch (err) {
        await kv().releaseQuota(keys.map((k) => k.key));
        throw err;
    }
    await Promise.all([
        AnimCandidate.updateOne({ _id: candidate._id }, { $inc: { freeVotes: 1, totalVotes: 1 }, $set: { reachedTotalAt: now, lastVoteAt: now } }),
        AnimChallenge.updateOne({ _id: challenge._id }, { $inc: { 'counters.freeVotes': 1 } }),
    ]);
    await markBoardDirty(challenge._id);
    const { onTrigger } = await import('./reward.service');
    await onTrigger({
        trigger: RuleTrigger.VOTE_CAST, eventId: String(challenge.eventId), challengeId: String(challenge._id),
        userId: args.userId, subjectKey: `voter:${args.userId}`,
    });
    return getQuota(challenge, args.userId, args.candidateId);
};

/** What the voter has left (§16), for the vote button. */
export const getQuota = async (challenge: IAnimChallenge, userId: string, candidateId?: string) => {
    if (!allowsFreeVotes(challenge.voting.mode)) return { enabled: false, remaining: 0, perPeriod: 0, period: challenge.voting.free.period };
    const now = new Date();
    const keys = quotaKeys(challenge, userId, candidateId ?? 'none', now);
    const used = await kv().getCounts(keys.map((k) => k.key));
    const remainingPerKey = keys.map((k, i) => (candidateId || !k.key.includes(':c:') ? Math.max(0, k.limit - used[i]) : Infinity));
    const overall = Math.min(...keys.map((k, i) => (k.key.includes(':c:') ? Infinity : Math.max(0, k.limit - used[i]))));
    const candIdx = keys.findIndex((k) => k.key.includes(':c:'));
    return {
        enabled: true,
        remaining: Math.min(...remainingPerKey),
        /** Free votes left for anyone (daily/total limits only). */
        remainingOverall: overall,
        /** Left for this candidate under the per-candidate cap (null when there is no such cap). */
        remainingForCandidate: candidateId && candIdx >= 0 ? Math.max(0, keys[candIdx].limit - used[candIdx]) : null,
        perCandidatePerPeriod: challenge.voting.free.perCandidatePerPeriod ?? null,
        perPeriod: challenge.voting.free.perPeriod,
        period: challenge.voting.free.period,
        resetsAt: challenge.voting.free.period === FreeVotePeriod.DAY
            ? new Date(now.getTime() + (secondsToEndOfDay(now) - 3600) * 1000).toISOString()
            : null,
    };
};
