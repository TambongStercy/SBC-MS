import { ChallengeStatus } from './types';

/** Accepts a hydrated document or a lean object. */
type Doc = Record<string, any>;

/**
 * What the public may see of a challenge. Revenue, internal counters and
 * moderation data stay out; vote counts only when the organizer shows them.
 */
export const publicChallenge = (c: Doc, extra: Record<string, unknown> = {}) => ({
    _id: c._id,
    eventId: c.eventId,
    slug: c.slug,
    name: c.name,
    description: c.description,
    imageFileId: c.imageFileId,
    rulesText: c.rulesText,
    status: c.status,
    suspended: Boolean(c.suspendedAt),
    schedule: c.schedule,
    participation: {
        mode: c.participation.mode,
        requiresApproval: c.participation.requiresApproval,
        maxCandidates: c.participation.maxCandidates,
        categories: c.participation.categories,
        photoRequired: c.participation.photoRequired,
        videoAllowed: c.participation.videoAllowed,
        ticketTypeIds: c.participation.ticketTypeIds,
        placesLeft: Math.max(0, c.participation.maxCandidates - (c.counters?.candidates ?? 0)),
    },
    voting: {
        mode: c.voting.mode,
        voterScope: c.voting.voterScope,
        voterTicketTypeIds: c.voting.voterTicketTypeIds,
        free: c.voting.free,
        selfVoteAllowed: c.voting.selfVoteAllowed,
        showVoteCounts: c.voting.showVoteCounts,
    },
    scoring: { method: c.scoring.method, publicWeight: c.scoring.publicWeight, juryWeight: c.scoring.juryWeight, criteria: c.scoring.criteria },
    tieRule: c.tieRule,
    counters: {
        candidates: c.counters?.approved ?? 0,
        ...(c.voting.showVoteCounts ? { votes: (c.counters?.freeVotes ?? 0) + (c.counters?.paidVotes ?? 0) } : {}),
    },
    parentChallengeId: c.parentChallengeId,
    ...extra,
});

export const publicCandidate = (c: Doc, showVotes: boolean) => ({
    _id: c._id,
    challengeId: c.challengeId,
    number: c.number,
    displayName: c.displayName,
    photoFileId: c.photoFileId,
    videoFileId: c.videoFileId,
    description: c.description,
    category: c.category,
    status: c.status,
    rank: c.rank,
    ...(showVotes ? { totalVotes: c.totalVotes, freeVotes: c.freeVotes, paidVotes: c.paidVotes } : {}),
});

/** Statuses a visitor may browse (drafts stay private). */
export const PUBLIC_STATUSES = [
    ChallengeStatus.PROGRAMMED, ChallengeStatus.REGISTRATION_OPEN, ChallengeStatus.REGISTRATION_CLOSED, ChallengeStatus.ACTIVE,
    ChallengeStatus.VOTING_OPEN, ChallengeStatus.VOTING_CLOSED, ChallengeStatus.RESULTS_PENDING, ChallengeStatus.COMPLETED, ChallengeStatus.CANCELLED,
];
