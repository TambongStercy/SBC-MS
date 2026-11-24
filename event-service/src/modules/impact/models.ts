import mongoose, { Document, Schema, Types } from 'mongoose';
import {
    CandidateStatus, DEFAULT_SETTINGS, EditionSettings, EditionStatus, ProfileReview,
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
    createdBy: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const S = Schema.Types;

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
}, { timestamps: true });

CandidateSchema.index({ editionId: 1, userId: 1 }, { unique: true });
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
