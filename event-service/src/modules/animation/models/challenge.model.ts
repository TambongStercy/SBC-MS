import mongoose, { Document, Schema, Types } from 'mongoose';
import {
    CandidateStatus, ChallengeStatus, FreeVotePeriod, ParticipationMode, ScoringMethod,
    TieRule, VoterScope, VotingMode,
} from '../types';

// ---------- Challenge (§9–§12) ----------

export interface ScoringCriterion { key: string; label: string; weight: number; maxScore: number }

export interface IAnimChallenge extends Document {
    _id: Types.ObjectId;
    organizerId: Types.ObjectId;
    eventId: Types.ObjectId;
    slug: string;
    name: string;
    description: string;
    imageFileId?: string;
    rulesText: string;
    status: ChallengeStatus;
    statusHistory: { from: string; to: string; at: Date; by?: Types.ObjectId; reason?: string }[];
    /** SBC admin pause, orthogonal to status: registrations and votes refused. */
    suspendedAt?: Date;
    suspendedReason?: string;
    schedule: {
        registrationOpensAt?: Date;
        registrationClosesAt?: Date;
        startsAt?: Date;
        votingOpensAt?: Date;
        votingClosesAt?: Date;
        endsAt?: Date;
        /** Minutes after votingClosesAt during which a payment started in time still counts. */
        settlementGraceMin: number;
    };
    participation: {
        mode: ParticipationMode;
        ticketTypeIds: Types.ObjectId[];
        requiresApproval: boolean;
        maxCandidates: number;
        categories: string[];
        photoRequired: boolean;
        videoAllowed: boolean;
    };
    voting: {
        mode: VotingMode;
        voterScope: VoterScope;
        voterTicketTypeIds: Types.ObjectId[];
        free: {
            perPeriod: number;
            period: FreeVotePeriod;
            /** Optional: max free votes for the same candidate per period. */
            perCandidatePerPeriod?: number;
            /** Optional cap over the whole challenge. */
            totalPerChallenge?: number;
        };
        /** A candidate may not buy votes for themselves unless allowed. */
        selfVoteAllowed: boolean;
        showVoteCounts: boolean;
    };
    scoring: {
        method: ScoringMethod;
        publicWeight: number;   // % (0–100)
        juryWeight: number;     // % (0–100), publicWeight + juryWeight = 100 for HYBRID
        criteria: ScoringCriterion[];
    };
    tieRule: TieRule;
    /** Rewards handed to ranks when the result is frozen. */
    rankRewards: { rank: number; rewardId: Types.ObjectId }[];
    parentChallengeId?: Types.ObjectId;
    /** Atomic counter for candidate numbers. */
    candidateSeq: number;
    counters: {
        candidates: number;     // live candidacies (not rejected/withdrawn)
        approved: number;
        freeVotes: number;
        paidVotes: number;
        paidRevenue: number;
        paidTransactions: number;
    };
    boardVersion: number;
    cancellation?: { reason: string; at: Date; by: Types.ObjectId; refundedTransactions: number };
    resultId?: Types.ObjectId;
    createdBy: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const ChallengeSchema = new Schema<IAnimChallenge>({
    organizerId: { type: Schema.Types.ObjectId, required: true },
    eventId: { type: Schema.Types.ObjectId, required: true },
    slug: { type: String, required: true, maxlength: 140 },
    name: { type: String, required: true, maxlength: 140 },
    description: { type: String, default: '', maxlength: 5000 },
    imageFileId: { type: String },
    rulesText: { type: String, default: '', maxlength: 10000 },
    status: { type: String, enum: Object.values(ChallengeStatus), default: ChallengeStatus.DRAFT },
    statusHistory: [{ from: String, to: String, at: Date, by: Schema.Types.ObjectId, reason: String, _id: false }],
    suspendedAt: { type: Date },
    suspendedReason: { type: String, maxlength: 500 },
    schedule: {
        registrationOpensAt: Date,
        registrationClosesAt: Date,
        startsAt: Date,
        votingOpensAt: Date,
        votingClosesAt: Date,
        endsAt: Date,
        settlementGraceMin: { type: Number, default: 10, min: 0, max: 120 },
    },
    participation: {
        mode: { type: String, enum: Object.values(ParticipationMode), default: ParticipationMode.OPEN },
        ticketTypeIds: [{ type: Schema.Types.ObjectId }],
        requiresApproval: { type: Boolean, default: true },
        maxCandidates: { type: Number, default: 100, min: 1, max: 100000 },
        categories: [{ type: String, maxlength: 60 }],
        photoRequired: { type: Boolean, default: true },
        videoAllowed: { type: Boolean, default: false },
    },
    voting: {
        mode: { type: String, enum: Object.values(VotingMode), default: VotingMode.FREE },
        voterScope: { type: String, enum: Object.values(VoterScope), default: VoterScope.ANY_SBC_USER },
        voterTicketTypeIds: [{ type: Schema.Types.ObjectId }],
        free: {
            perPeriod: { type: Number, default: 1, min: 0, max: 1000 },
            period: { type: String, enum: Object.values(FreeVotePeriod), default: FreeVotePeriod.DAY },
            perCandidatePerPeriod: { type: Number, min: 1 },
            totalPerChallenge: { type: Number, min: 1 },
        },
        selfVoteAllowed: { type: Boolean, default: false },
        showVoteCounts: { type: Boolean, default: true },
    },
    scoring: {
        method: { type: String, enum: Object.values(ScoringMethod), default: ScoringMethod.VOTES },
        publicWeight: { type: Number, default: 100, min: 0, max: 100 },
        juryWeight: { type: Number, default: 0, min: 0, max: 100 },
        criteria: [{ key: String, label: String, weight: Number, maxScore: Number, _id: false }],
    },
    tieRule: { type: String, enum: Object.values(TieRule), default: TieRule.EARLIEST_TO_REACH },
    rankRewards: [{ rank: Number, rewardId: Schema.Types.ObjectId, _id: false }],
    parentChallengeId: { type: Schema.Types.ObjectId },
    candidateSeq: { type: Number, default: 0 },
    counters: {
        candidates: { type: Number, default: 0 },
        approved: { type: Number, default: 0 },
        freeVotes: { type: Number, default: 0 },
        paidVotes: { type: Number, default: 0 },
        paidRevenue: { type: Number, default: 0 },
        paidTransactions: { type: Number, default: 0 },
    },
    boardVersion: { type: Number, default: 0 },
    cancellation: {
        reason: String,
        at: Date,
        by: Schema.Types.ObjectId,
        refundedTransactions: Number,
    },
    resultId: { type: Schema.Types.ObjectId },
    createdBy: { type: Schema.Types.ObjectId, required: true },
}, { timestamps: true, collection: 'anim_challenges' });
ChallengeSchema.index({ eventId: 1, slug: 1 }, { unique: true });
ChallengeSchema.index({ eventId: 1, status: 1 });
ChallengeSchema.index({ status: 1, 'schedule.votingClosesAt': 1 });
ChallengeSchema.index({ organizerId: 1, createdAt: -1 });
export const AnimChallenge = mongoose.model<IAnimChallenge>('AnimChallenge', ChallengeSchema);

// ---------- Candidate (§13–§14) ----------

export interface IAnimCandidate extends Document {
    _id: Types.ObjectId;
    organizerId: Types.ObjectId;
    eventId: Types.ObjectId;
    challengeId: Types.ObjectId;
    userId: Types.ObjectId;
    number: number;
    displayName: string;
    photoFileId?: string;
    videoFileId?: string;
    description?: string;
    category?: string;
    status: CandidateStatus;
    statusHistory: { from: string; to: string; at: Date; by?: Types.ObjectId; reason?: string }[];
    freeVotes: number;
    paidVotes: number;
    totalVotes: number;
    /** Mean of submitted jury scores, 0–100. */
    juryScore: number;
    juryCount: number;
    /** Final integer score (milli-points) used for ranking. */
    score: number;
    rank?: number;
    /** When totalVotes last changed — tie-break EARLIEST_TO_REACH. */
    reachedTotalAt?: Date;
    lastVoteAt?: Date;
    addedByOrganizer: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const CandidateSchema = new Schema<IAnimCandidate>({
    organizerId: { type: Schema.Types.ObjectId, required: true },
    eventId: { type: Schema.Types.ObjectId, required: true },
    challengeId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    number: { type: Number, required: true },
    displayName: { type: String, required: true, maxlength: 80 },
    photoFileId: { type: String },
    videoFileId: { type: String },
    description: { type: String, maxlength: 2000 },
    category: { type: String, maxlength: 60 },
    status: { type: String, enum: Object.values(CandidateStatus), default: CandidateStatus.PENDING },
    statusHistory: [{ from: String, to: String, at: Date, by: Schema.Types.ObjectId, reason: String, _id: false }],
    freeVotes: { type: Number, default: 0 },
    paidVotes: { type: Number, default: 0 },
    totalVotes: { type: Number, default: 0 },
    juryScore: { type: Number, default: 0 },
    juryCount: { type: Number, default: 0 },
    score: { type: Number, default: 0 },
    rank: { type: Number },
    reachedTotalAt: { type: Date },
    lastVoteAt: { type: Date },
    addedByOrganizer: { type: Boolean, default: false },
}, { timestamps: true, collection: 'anim_candidates' });
CandidateSchema.index({ challengeId: 1, number: 1 }, { unique: true });
CandidateSchema.index({ challengeId: 1, userId: 1 }, { unique: true });
CandidateSchema.index({ challengeId: 1, status: 1, totalVotes: -1, number: 1 });
CandidateSchema.index({ challengeId: 1, status: 1, score: -1, number: 1 });
CandidateSchema.index({ userId: 1, createdAt: -1 });
CandidateSchema.index({ challengeId: 1, displayName: 1 });
export const AnimCandidate = mongoose.model<IAnimCandidate>('AnimCandidate', CandidateSchema);

// ---------- Jury (§23) ----------

export interface IAnimJuryAssignment extends Document {
    organizerId: Types.ObjectId;
    eventId: Types.ObjectId;
    challengeId: Types.ObjectId;
    userId: Types.ObjectId;
    status: 'ACTIVE' | 'REVOKED';
    invitedBy: Types.ObjectId;
    createdAt: Date;
}

const JuryAssignmentSchema = new Schema<IAnimJuryAssignment>({
    organizerId: { type: Schema.Types.ObjectId, required: true },
    eventId: { type: Schema.Types.ObjectId, required: true },
    challengeId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    status: { type: String, enum: ['ACTIVE', 'REVOKED'], default: 'ACTIVE' },
    invitedBy: { type: Schema.Types.ObjectId, required: true },
}, { timestamps: true, collection: 'anim_jury_assignments' });
JuryAssignmentSchema.index({ challengeId: 1, userId: 1 }, { unique: true });
JuryAssignmentSchema.index({ userId: 1, status: 1 });
export const AnimJuryAssignment = mongoose.model<IAnimJuryAssignment>('AnimJuryAssignment', JuryAssignmentSchema);

export interface IAnimJuryScore extends Document {
    organizerId: Types.ObjectId;
    eventId: Types.ObjectId;
    challengeId: Types.ObjectId;
    candidateId: Types.ObjectId;
    jurorUserId: Types.ObjectId;
    scores: { key: string; value: number }[];
    weightedScore: number; // 0–100
    status: 'DRAFT' | 'SUBMITTED';
    submittedAt?: Date;
    comment?: string;
    createdAt: Date;
    updatedAt: Date;
}

const JuryScoreSchema = new Schema<IAnimJuryScore>({
    organizerId: { type: Schema.Types.ObjectId, required: true },
    eventId: { type: Schema.Types.ObjectId, required: true },
    challengeId: { type: Schema.Types.ObjectId, required: true },
    candidateId: { type: Schema.Types.ObjectId, required: true },
    jurorUserId: { type: Schema.Types.ObjectId, required: true },
    scores: [{ key: String, value: Number, _id: false }],
    weightedScore: { type: Number, default: 0 },
    status: { type: String, enum: ['DRAFT', 'SUBMITTED'], default: 'DRAFT' },
    submittedAt: { type: Date },
    comment: { type: String, maxlength: 1000 },
}, { timestamps: true, collection: 'anim_jury_scores' });
JuryScoreSchema.index({ challengeId: 1, candidateId: 1, jurorUserId: 1 }, { unique: true });
JuryScoreSchema.index({ candidateId: 1, status: 1 });
export const AnimJuryScore = mongoose.model<IAnimJuryScore>('AnimJuryScore', JuryScoreSchema);
