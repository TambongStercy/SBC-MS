/**
 * Vocabulary of the "Animation & Engagement" module (cahier des charges §4–§46).
 *
 * Everything here is generic: a challenge is configuration + rules, never a
 * hard-coded format. A "best outfit" contest and a quiz differ only in data.
 */

export enum TeamRole {
    OWNER = 'OWNER',          // the approved organizer (never stored)
    MANAGER = 'MANAGER',
    MODERATOR = 'MODERATOR',
    STAFF = 'STAFF',
    JURY = 'JURY',            // per challenge, via AnimJuryAssignment
    SBC_ADMIN = 'SBC_ADMIN',  // SBC administration, for audit entries
    SYSTEM = 'SYSTEM',        // jobs
    PARTICIPANT = 'PARTICIPANT', // a candidate acting on their own candidacy
    VOTER = 'VOTER',
}

/** What a role may do. Checked by requireEventRole on every manage route. */
export enum Perm {
    VIEW = 'VIEW',
    CONFIGURE = 'CONFIGURE',        // challenges, rewards, rules, packages, schedule
    MODERATE = 'MODERATE',          // candidates
    TRANSITION = 'TRANSITION',      // move a challenge through its phases
    RESULTS = 'RESULTS',            // tie decisions, freeze, publish
    CANCEL = 'CANCEL',              // cancel with refunds
    TEAM = 'TEAM',                  // invite / revoke team members
    MONEY = 'MONEY',                // vote transactions, revenue
    EXPORT = 'EXPORT',
    LIVE = 'LIVE',                  // live / TV control
}

export const ROLE_PERMS: Record<string, Perm[]> = {
    [TeamRole.OWNER]: Object.values(Perm),
    [TeamRole.MANAGER]: [Perm.VIEW, Perm.CONFIGURE, Perm.MODERATE, Perm.TRANSITION, Perm.RESULTS, Perm.MONEY, Perm.EXPORT, Perm.LIVE],
    [TeamRole.MODERATOR]: [Perm.VIEW, Perm.MODERATE, Perm.LIVE],
    [TeamRole.STAFF]: [Perm.VIEW, Perm.LIVE],
};

export enum ChallengeStatus {
    DRAFT = 'DRAFT',
    PROGRAMMED = 'PROGRAMMED',
    REGISTRATION_OPEN = 'REGISTRATION_OPEN',
    REGISTRATION_CLOSED = 'REGISTRATION_CLOSED',
    ACTIVE = 'ACTIVE',
    VOTING_OPEN = 'VOTING_OPEN',
    VOTING_CLOSED = 'VOTING_CLOSED',
    RESULTS_PENDING = 'RESULTS_PENDING',
    COMPLETED = 'COMPLETED',
    CANCELLED = 'CANCELLED',
}

/** The lifecycle order (§11). CANCELLED is reachable from any non-final state. */
export const CHALLENGE_FLOW: ChallengeStatus[] = [
    ChallengeStatus.DRAFT,
    ChallengeStatus.PROGRAMMED,
    ChallengeStatus.REGISTRATION_OPEN,
    ChallengeStatus.REGISTRATION_CLOSED,
    ChallengeStatus.ACTIVE,
    ChallengeStatus.VOTING_OPEN,
    ChallengeStatus.VOTING_CLOSED,
    ChallengeStatus.RESULTS_PENDING,
    ChallengeStatus.COMPLETED,
];

export const statusIndex = (s: ChallengeStatus) => CHALLENGE_FLOW.indexOf(s);

export enum ParticipationMode {
    OPEN = 'OPEN',                   // any SBC account
    TICKET_HOLDERS = 'TICKET_HOLDERS',
    TICKET_TYPES = 'TICKET_TYPES',
}

export enum VotingMode {
    NONE = 'NONE',
    FREE = 'FREE',
    PAID = 'PAID',
    FREE_AND_PAID = 'FREE_AND_PAID',
    JURY = 'JURY',
    PUBLIC_AND_JURY = 'PUBLIC_AND_JURY',
}

export const allowsFreeVotes = (m: VotingMode) =>
    m === VotingMode.FREE || m === VotingMode.FREE_AND_PAID || m === VotingMode.PUBLIC_AND_JURY;
export const allowsPaidVotes = (m: VotingMode) =>
    m === VotingMode.PAID || m === VotingMode.FREE_AND_PAID || m === VotingMode.PUBLIC_AND_JURY;
export const usesJury = (m: VotingMode) => m === VotingMode.JURY || m === VotingMode.PUBLIC_AND_JURY;

export enum VoterScope {
    ANY_SBC_USER = 'ANY_SBC_USER',
    TICKET_HOLDERS = 'TICKET_HOLDERS',
    TICKET_TYPES = 'TICKET_TYPES',
}

export enum FreeVotePeriod {
    DAY = 'DAY',
    CHALLENGE = 'CHALLENGE',
}

export enum ScoringMethod {
    VOTES = 'VOTES',
    JURY = 'JURY',
    HYBRID = 'HYBRID',
}

export enum TieRule {
    EARLIEST_TO_REACH = 'EARLIEST_TO_REACH',
    SPLIT_PRIZE = 'SPLIT_PRIZE',
    JURY_DECIDES = 'JURY_DECIDES',
    ORGANIZER_DECIDES = 'ORGANIZER_DECIDES',
    SECOND_ROUND = 'SECOND_ROUND',
}

export enum CandidateStatus {
    PENDING = 'PENDING',
    APPROVED = 'APPROVED',
    REJECTED = 'REJECTED',
    DISQUALIFIED = 'DISQUALIFIED',
    WITHDRAWN = 'WITHDRAWN',
}

export enum VoteKind {
    FREE = 'FREE',
    PAID = 'PAID',
    ADJUSTMENT = 'ADJUSTMENT',
}

export enum VoteStatus {
    COUNTED = 'COUNTED',
    VOID = 'VOID',
}

export enum VoteTxStatus {
    PENDING = 'PENDING',
    SUCCESS = 'SUCCESS',
    FAILED = 'FAILED',
    CANCELLED = 'CANCELLED',
    REFUNDED = 'REFUNDED',
}

export enum FraudReview {
    NONE = 'NONE',
    PENDING = 'PENDING',     // "À vérifier" (§20)
    CLEARED = 'CLEARED',
    CONFIRMED = 'CONFIRMED',
}

export enum RewardType {
    CASH = 'CASH',
    PRODUCT = 'PRODUCT',
    GIFT = 'GIFT',
    VOUCHER = 'VOUCHER',
    TICKET = 'TICKET',
    SERVICE = 'SERVICE',
    CUSTOM = 'CUSTOM',
}

export enum RewardStatus {
    DRAFT = 'DRAFT',
    ACTIVE = 'ACTIVE',
    EXHAUSTED = 'EXHAUSTED',
    CLOSED = 'CLOSED',
    CANCELLED = 'CANCELLED',
}

export enum RuleKind {
    POSITION = 'POSITION',            // the Nth eligible subject
    PERIODIC = 'PERIODIC',            // every Nth
    RANDOM_DRAW = 'RANDOM_DRAW',      // X winners among the eligible
    ACTION = 'ACTION',                // the first N to do something
    MANUAL = 'MANUAL',                // picked by the organizer
    CHALLENGE_RANK = 'CHALLENGE_RANK',// rank X of a challenge's result
}

export enum RuleTrigger {
    TICKET_ORDER_PAID = 'TICKET_ORDER_PAID',
    CHALLENGE_REGISTERED = 'CHALLENGE_REGISTERED',
    CANDIDATE_APPROVED = 'CANDIDATE_APPROVED',
    VOTE_CAST = 'VOTE_CAST',
    PAID_VOTE = 'PAID_VOTE',
    CHECKED_IN = 'CHECKED_IN',
}

export enum EligibilityScope {
    ALL_PARTICIPANTS = 'ALL_PARTICIPANTS',     // anyone who triggers it
    TICKET_HOLDERS = 'TICKET_HOLDERS',
    TICKET_TYPES = 'TICKET_TYPES',
    CHALLENGE_PARTICIPANTS = 'CHALLENGE_PARTICIPANTS',
    CHALLENGE_VOTERS = 'CHALLENGE_VOTERS',
}

export enum RuleStatus {
    DRAFT = 'DRAFT',
    ACTIVE = 'ACTIVE',
    SUPERSEDED = 'SUPERSEDED',
}

export enum WinnerStatus {
    AWARDED = 'AWARDED',
    DELIVERED = 'DELIVERED',
    FORFEITED = 'FORFEITED',
    REVOKED = 'REVOKED',
}

export enum ResultStatus {
    COMPUTED = 'COMPUTED',
    AWAITING_TIE_DECISION = 'AWAITING_TIE_DECISION',
    AWAITING_SECOND_ROUND = 'AWAITING_SECOND_ROUND',
    FROZEN = 'FROZEN',
}

export enum ChangeRequestStatus {
    PENDING = 'PENDING',
    APPROVED = 'APPROVED',
    REJECTED = 'REJECTED',
}

export enum FraudFlagStatus {
    OPEN = 'OPEN',
    CLEARED = 'CLEARED',
    CONFIRMED = 'CONFIRMED',
}

/** Request context resolved by requireEventRole: who acts, on what, with which rights. */
export interface AnimCtx {
    organizerId: string;
    eventId: string;
    actorUserId: string;
    role: TeamRole;
    perms: Perm[];
    ip?: string;
}
