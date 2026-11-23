import mongoose, { Document, Schema, Types } from 'mongoose';
import {
    CandidateStatus, CompetitionStage, DEFAULT_SETTINGS, EditionSettings, EditionStatus, PayMethod, ProfileReview,
    RoundStatus, SubmissionKind, SubmissionStatus, VoteTxStatus,
} from './types';

// ---------- Edition ----------

export interface IImpactEdition extends Document {
    _id: Types.ObjectId;
    name: string;
    slug: string;
    description: string;
    /** Public rules (spec §18). Editable while DRAFT only. */
    rulesText: string;
    status: EditionStatus;
    statusHistory: { from: string; to: string; at: Date; by?: Types.ObjectId; reason?: string }[];
    schedule: {
        qualificationOpensAt: Date;
        qualificationClosesAt: Date;
        competitionStartsAt?: Date;
        finalAt?: Date;
    };
    settings: EditionSettings;
    /** No new profiles accepted (seats full, or qualification over). */
    registrationClosedAt?: Date;
    registrationClosedReason?: 'seats_full' | 'date' | 'admin' | 'full';
    /** Arrival-order counters: seat n°, waiting-list n°. Never reused. */
    seatSeq: number;
    waitlistSeq: number;
    /** Last instant the invitation poll covered (job cursor). */
    pollCursor?: Date;
    lastFullRecountAt?: Date;
    cancellation?: { reason: string; at: Date; by: Types.ObjectId };
    // ----- Phase 2 -----
    stage?: CompetitionStage;
    stageHistory: { stage: string; at: Date; by?: Types.ObjectId }[];
    competitionStartedAt?: Date;
    rounds: { FREE: IRound; PAID: IRound };
    /** The TOP 3 as decided (frozen): ranking by paid votes, ties to the earliest to reach the total. */
    top3?: {
        decidedAt: Date;
        by: Types.ObjectId;
        ranking: { candidateId: Types.ObjectId; rank: number; paidVotes: number; lastPaidAt?: Date | null; finalist: boolean }[];
    };
    createdBy: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

export interface IRound {
    status: RoundStatus;
    opensAt?: Date;
    closesAt?: Date;
    openedAt?: Date;
    closedAt?: Date;
}

const S = Schema.Types;

const RoundSchema = new Schema<IRound>({
    status: { type: String, enum: Object.values(RoundStatus), default: RoundStatus.SCHEDULED },
    opensAt: Date,
    closesAt: Date,
    openedAt: Date,
    closedAt: Date,
}, { _id: false });

const EditionSchema = new Schema<IImpactEdition>({
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true },
    description: { type: String, default: '', maxlength: 4000 },
    rulesText: { type: String, default: '', maxlength: 30000 },
    status: { type: String, enum: Object.values(EditionStatus), default: EditionStatus.DRAFT, index: true },
    statusHistory: [{ from: String, to: String, at: Date, by: S.ObjectId, reason: String, _id: false }],
    schedule: {
        qualificationOpensAt: { type: Date, required: true },
        qualificationClosesAt: { type: Date, required: true },
        competitionStartsAt: Date,
        finalAt: Date,
    },
    settings: { type: S.Mixed, default: () => JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) },
    registrationClosedAt: Date,
    registrationClosedReason: String,
    seatSeq: { type: Number, default: 0 },
    waitlistSeq: { type: Number, default: 0 },
    pollCursor: Date,
    lastFullRecountAt: Date,
    cancellation: { reason: String, at: Date, by: S.ObjectId },
    stage: { type: String, enum: Object.values(CompetitionStage) },
    stageHistory: [{ stage: String, at: Date, by: S.ObjectId, _id: false }],
    competitionStartedAt: Date,
    rounds: {
        FREE: { type: RoundSchema, default: () => ({}) },
        PAID: { type: RoundSchema, default: () => ({}) },
    },
    top3: {
        decidedAt: Date,
        by: S.ObjectId,
        ranking: [{ candidateId: S.ObjectId, rank: Number, paidVotes: Number, lastPaidAt: Date, finalist: Boolean, _id: false }],
    },
    createdBy: { type: S.ObjectId, required: true },
}, { timestamps: true });

export const ImpactEdition = mongoose.model<IImpactEdition>('ImpactEdition', EditionSchema);

// ---------- Candidate ----------

export interface CandidateProfile {
    name: string;
    /** settings-service file id (R2 key) of the photo. */
    photoFileId: string;
    country: string;
    city: string;
    activity: string;
    category: string;
    projectName: string;
    projectDescription: string;
    presentation: string;
    link?: string;
    /** Answers to the edition's extra profile questions. */
    extra: Record<string, string>;
}

export interface IImpactCandidate extends Document {
    _id: Types.ObjectId;
    editionId: Types.ObjectId;
    userId: Types.ObjectId;
    /** SBC identifier shown on the profile: the member's referral code. */
    sbcId?: string;
    profile: CandidateProfile;
    consent: { at: Date; version: string };
    /** Changes only when the profile changes (guards reviews against a concurrent edit). */
    profileUpdatedAt: Date;
    status: CandidateStatus;
    statusHistory: { from: string; to: string; at: Date; by?: Types.ObjectId; reason?: string }[];
    /** Status to return to when a suspension is lifted. */
    suspendedFrom?: CandidateStatus;
    invitations: {
        valid: number;
        pending: number;
        /** When the required count was reached (time of the N-th paid pack). */
        reachedAt?: Date | null;
        checkedAt?: Date;
    };
    /** Arrival order among those who got a seat (1 = first). */
    seatNumber?: number;
    seatAt?: Date;
    waitlistRank?: number;
    waitlistAt?: Date;
    review: { status: ProfileReview; reason?: string; at?: Date; by?: Types.ObjectId };
    // ----- Phase 2 -----
    /** Profile published (week 1). */
    publishedAt?: Date;
    /** Counters; the ledgers (free votes, vote purchases) are the truth, a job recounts. */
    votes: { free: number; paid: number; paidAmount: number; lastFreeAt?: Date; lastPaidAt?: Date };
    /** Place in the TOP 3 ranking once decided. */
    rank?: number;
    createdAt: Date;
    updatedAt: Date;
}

const CandidateSchema = new Schema<IImpactCandidate>({
    editionId: { type: S.ObjectId, required: true },
    userId: { type: S.ObjectId, required: true },
    sbcId: String,
    profile: {
        name: { type: String, required: true },
        photoFileId: { type: String, required: true },
        country: { type: String, required: true },
        city: { type: String, required: true },
        activity: { type: String, required: true },
        category: { type: String, required: true },
        projectName: { type: String, required: true },
        projectDescription: { type: String, required: true },
        presentation: { type: String, required: true },
        link: String,
        extra: { type: S.Mixed, default: {} },
    },
    consent: { at: { type: Date, required: true }, version: { type: String, required: true } },
    profileUpdatedAt: { type: Date, default: Date.now },
    status: { type: String, enum: Object.values(CandidateStatus), default: CandidateStatus.QUALIFYING },
    statusHistory: [{ from: String, to: String, at: Date, by: S.ObjectId, reason: String, _id: false }],
    suspendedFrom: String,
    invitations: {
        valid: { type: Number, default: 0 },
        pending: { type: Number, default: 0 },
        reachedAt: { type: Date, default: null },
        checkedAt: Date,
    },
    seatNumber: Number,
    seatAt: Date,
    waitlistRank: Number,
    waitlistAt: Date,
    review: {
        status: { type: String, enum: Object.values(ProfileReview), default: ProfileReview.PENDING },
        reason: String,
        at: Date,
        by: S.ObjectId,
    },
    publishedAt: Date,
    votes: {
        free: { type: Number, default: 0 },
        paid: { type: Number, default: 0 },
        paidAmount: { type: Number, default: 0 },
        lastFreeAt: Date,
        lastPaidAt: Date,
    },
    rank: Number,
}, { timestamps: true });

CandidateSchema.index({ editionId: 1, userId: 1 }, { unique: true });
CandidateSchema.index({ editionId: 1, status: 1, 'votes.paid': -1 });
CandidateSchema.index({ editionId: 1, status: 1, 'invitations.reachedAt': 1 });
CandidateSchema.index({ userId: 1, createdAt: -1 });
// Two candidates can never share a seat or a waiting-list number.
CandidateSchema.index({ editionId: 1, seatNumber: 1 }, { unique: true, partialFilterExpression: { seatNumber: { $exists: true } } });
CandidateSchema.index({ editionId: 1, waitlistRank: 1 }, { unique: true, partialFilterExpression: { waitlistRank: { $exists: true } } });

export const ImpactCandidate = mongoose.model<IImpactCandidate>('ImpactCandidate', CandidateSchema);

// ---------- Audit (append-only) ----------

export interface IImpactAudit extends Document {
    editionId?: Types.ObjectId;
    candidateId?: Types.ObjectId;
    actorUserId?: Types.ObjectId | null;
    actorRole: 'admin' | 'member' | 'system';
    action: string;
    before?: unknown;
    after?: unknown;
    reason?: string;
    at: Date;
}

const AuditSchema = new Schema<IImpactAudit>({
    editionId: S.ObjectId,
    candidateId: S.ObjectId,
    actorUserId: { type: S.ObjectId, default: null },
    actorRole: { type: String, required: true },
    action: { type: String, required: true },
    before: S.Mixed,
    after: S.Mixed,
    reason: String,
    at: { type: Date, default: Date.now },
});
AuditSchema.index({ editionId: 1, at: -1 });
AuditSchema.index({ candidateId: 1, at: -1 });

export const ImpactAudit = mongoose.model<IImpactAudit>('ImpactAudit', AuditSchema);

// ---------- Phase 2: submissions (§6.1, §7) ----------

export interface VideoContent { videoFileId: string; caption?: string }
export interface ProjectContent {
    problem: string; solution: string; howItWorks: string; targetCustomers: string;
    businessModel: string; expectedImpact: string; fundingUse: string; outlook: string;
    videoFileId?: string;
}

export interface IImpactSubmission extends Document {
    _id: Types.ObjectId;
    editionId: Types.ObjectId;
    candidateId: Types.ObjectId;
    userId: Types.ObjectId;
    kind: SubmissionKind;
    /** 1, 2… a new version after « nouvelle soumission demandée ». */
    version: number;
    /** The candidate's current submission of this kind. */
    current: boolean;
    status: SubmissionStatus;
    video?: VideoContent;
    project?: ProjectContent;
    review?: { reason?: string; at: Date; by: Types.ObjectId };
    publishedAt?: Date;
    /** Where SBC published it (Facebook post…), set by the administration. */
    externalUrl?: string;
    createdAt: Date;
    updatedAt: Date;
}

const SubmissionSchema = new Schema<IImpactSubmission>({
    editionId: { type: S.ObjectId, required: true },
    candidateId: { type: S.ObjectId, required: true },
    userId: { type: S.ObjectId, required: true },
    kind: { type: String, enum: Object.values(SubmissionKind), required: true },
    version: { type: Number, required: true },
    current: { type: Boolean, default: true },
    status: { type: String, enum: Object.values(SubmissionStatus), default: SubmissionStatus.PENDING },
    video: { videoFileId: String, caption: String },
    project: {
        problem: String, solution: String, howItWorks: String, targetCustomers: String,
        businessModel: String, expectedImpact: String, fundingUse: String, outlook: String, videoFileId: String,
    },
    review: { reason: String, at: Date, by: S.ObjectId },
    publishedAt: Date,
    externalUrl: String,
}, { timestamps: true });
SubmissionSchema.index({ candidateId: 1, kind: 1, version: 1 }, { unique: true });
// One current submission per candidate and kind.
SubmissionSchema.index({ candidateId: 1, kind: 1 }, { unique: true, partialFilterExpression: { current: true } });
SubmissionSchema.index({ editionId: 1, kind: 1, status: 1, createdAt: 1 });

export const ImpactSubmission = mongoose.model<IImpactSubmission>('ImpactSubmission', SubmissionSchema);

// ---------- Phase 2: free votes (§6.3) ----------

export interface IImpactFreeVote extends Document {
    editionId: Types.ObjectId;
    candidateId: Types.ObjectId;
    voterUserId: Types.ObjectId;
    ipHash?: string;
    uaHash?: string;
    at: Date;
}

const FreeVoteSchema = new Schema<IImpactFreeVote>({
    editionId: { type: S.ObjectId, required: true },
    candidateId: { type: S.ObjectId, required: true },
    voterUserId: { type: S.ObjectId, required: true },
    ipHash: String,
    uaHash: String,
    at: { type: Date, default: Date.now },
});
// 1 compte SBC = 1 vote (the database refuses a second one).
FreeVoteSchema.index({ editionId: 1, voterUserId: 1 }, { unique: true });
FreeVoteSchema.index({ editionId: 1, candidateId: 1, at: -1 });
FreeVoteSchema.index({ editionId: 1, ipHash: 1 });

export const ImpactFreeVote = mongoose.model<IImpactFreeVote>('ImpactFreeVote', FreeVoteSchema);

// ---------- Phase 2: paid vote purchases (§8) ----------

export interface IImpactVoteTx extends Document {
    _id: Types.ObjectId;
    editionId: Types.ObjectId;
    candidateId: Types.ObjectId;
    userId: Types.ObjectId;
    votes: number;
    amount: number;
    method: PayMethod;
    status: VoteTxStatus;
    /** One per click, from the app: a double tap returns the same purchase. */
    idempotencyKey: string;
    paymentSessionId?: string;
    /** Reference of the SBC-balance payment (payment-service balance-spend). */
    balanceRef?: string;
    balanceAttemptAt?: Date;
    providerStatus?: string;
    /** Lease while one settler works on it. */
    settlingAt?: Date;
    settledAt?: Date;
    /** Set once, when the votes were added to the candidate. */
    votesCreditedAt?: Date;
    /** Paid too late (round closed, TOP 3 set, candidate out): refunded, never counted. */
    lateSettlement?: boolean;
    refund?: { reason: string; at?: Date; by?: Types.ObjectId | null; claimedAt: Date; reference: string; uncertain?: boolean };
    reconciledAt?: Date;
    flags: string[];
    ipHash?: string;
    uaHash?: string;
    createdAt: Date;
    updatedAt: Date;
}

const VoteTxSchema = new Schema<IImpactVoteTx>({
    editionId: { type: S.ObjectId, required: true },
    candidateId: { type: S.ObjectId, required: true },
    userId: { type: S.ObjectId, required: true },
    votes: { type: Number, required: true, min: 1 },
    amount: { type: Number, required: true, min: 1 },
    method: { type: String, enum: Object.values(PayMethod), required: true },
    status: { type: String, enum: Object.values(VoteTxStatus), default: VoteTxStatus.PENDING },
    idempotencyKey: { type: String, required: true },
    paymentSessionId: String,
    balanceRef: String,
    balanceAttemptAt: Date,
    providerStatus: String,
    settlingAt: Date,
    settledAt: Date,
    votesCreditedAt: Date,
    lateSettlement: Boolean,
    refund: { reason: String, at: Date, by: S.ObjectId, claimedAt: Date, reference: String, uncertain: Boolean },
    reconciledAt: Date,
    flags: { type: [String], default: [] },
    ipHash: String,
    uaHash: String,
}, { timestamps: true });
VoteTxSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true });
VoteTxSchema.index({ paymentSessionId: 1 }, { unique: true, partialFilterExpression: { paymentSessionId: { $type: 'string' } } });
VoteTxSchema.index({ editionId: 1, status: 1, createdAt: -1 });
VoteTxSchema.index({ editionId: 1, candidateId: 1, status: 1 });
VoteTxSchema.index({ userId: 1, createdAt: -1 });
VoteTxSchema.index({ status: 1, method: 1, createdAt: 1 });

export const ImpactVoteTx = mongoose.model<IImpactVoteTx>('ImpactVoteTx', VoteTxSchema);
