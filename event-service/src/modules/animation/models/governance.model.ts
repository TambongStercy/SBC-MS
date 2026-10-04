import mongoose, { Document, Schema, Types } from 'mongoose';
import { ChangeRequestStatus, FraudFlagStatus, TeamRole } from '../types';

const forbidWrites = (schema: Schema, what: string) => {
    const refuse = function () { throw new Error(`${what} is append-only`); };
    for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'replaceOne'] as const) {
        schema.pre(op, refuse);
    }
};

// ---------- Team ----------

export interface IAnimTeamMember extends Document {
    organizerId: Types.ObjectId;
    /** null = every event of this organizer. */
    eventId: Types.ObjectId | null;
    userId: Types.ObjectId;
    role: TeamRole.MANAGER | TeamRole.MODERATOR | TeamRole.STAFF;
    status: 'ACTIVE' | 'REVOKED';
    invitedBy: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const TeamMemberSchema = new Schema<IAnimTeamMember>({
    organizerId: { type: Schema.Types.ObjectId, required: true },
    eventId: { type: Schema.Types.ObjectId, default: null },
    userId: { type: Schema.Types.ObjectId, required: true },
    role: { type: String, enum: [TeamRole.MANAGER, TeamRole.MODERATOR, TeamRole.STAFF], required: true },
    status: { type: String, enum: ['ACTIVE', 'REVOKED'], default: 'ACTIVE' },
    invitedBy: { type: Schema.Types.ObjectId, required: true },
}, { timestamps: true, collection: 'anim_team_members' });
TeamMemberSchema.index({ organizerId: 1, eventId: 1, userId: 1 }, { unique: true });
TeamMemberSchema.index({ userId: 1, status: 1 });
export const AnimTeamMember = mongoose.model<IAnimTeamMember>('AnimTeamMember', TeamMemberSchema);

// ---------- Invites (team members and jurors who aren't resolved yet) ----------

export interface IAnimInvite extends Document {
    organizerId: Types.ObjectId;
    eventId: Types.ObjectId;
    challengeId?: Types.ObjectId;
    kind: 'TEAM' | 'JURY';
    role?: TeamRole;
    /** TEAM invite for every event of the organizer, not just this one. */
    allEvents?: boolean;
    contact: string;
    tokenHash: string;
    expiresAt: Date;
    status: 'PENDING' | 'ACCEPTED' | 'REVOKED';
    acceptedBy?: Types.ObjectId;
    invitedBy: Types.ObjectId;
    createdAt: Date;
}

const InviteSchema = new Schema<IAnimInvite>({
    organizerId: { type: Schema.Types.ObjectId, required: true },
    eventId: { type: Schema.Types.ObjectId, required: true, index: true },
    challengeId: { type: Schema.Types.ObjectId },
    kind: { type: String, enum: ['TEAM', 'JURY'], required: true },
    role: { type: String },
    allEvents: { type: Boolean, default: false },
    contact: { type: String, required: true, maxlength: 200 },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    status: { type: String, enum: ['PENDING', 'ACCEPTED', 'REVOKED'], default: 'PENDING' },
    acceptedBy: { type: Schema.Types.ObjectId },
    invitedBy: { type: Schema.Types.ObjectId, required: true },
}, { timestamps: true, collection: 'anim_invites' });
export const AnimInvite = mongoose.model<IAnimInvite>('AnimInvite', InviteSchema);

// ---------- Audit log (§37) ----------

export interface IAnimAuditLog extends Document {
    organizerId?: Types.ObjectId;
    eventId?: Types.ObjectId;
    challengeId?: Types.ObjectId;
    actorUserId?: Types.ObjectId | null;
    actorRole: TeamRole;
    action: string;
    targetType: string;
    targetId?: Types.ObjectId | string;
    before?: unknown;
    after?: unknown;
    reason?: string;
    ip?: string;
    at: Date;
}

const AuditLogSchema = new Schema<IAnimAuditLog>({
    organizerId: { type: Schema.Types.ObjectId },
    eventId: { type: Schema.Types.ObjectId },
    challengeId: { type: Schema.Types.ObjectId },
    actorUserId: { type: Schema.Types.ObjectId, default: null },
    actorRole: { type: String, required: true },
    action: { type: String, required: true, maxlength: 80 },
    targetType: { type: String, required: true, maxlength: 40 },
    targetId: { type: Schema.Types.Mixed },
    before: { type: Schema.Types.Mixed },
    after: { type: Schema.Types.Mixed },
    reason: { type: String, maxlength: 1000 },
    ip: { type: String, maxlength: 64 },
    at: { type: Date, required: true, default: () => new Date() },
}, { collection: 'anim_audit_logs' });
AuditLogSchema.index({ eventId: 1, at: -1 });
AuditLogSchema.index({ challengeId: 1, at: -1 });
AuditLogSchema.index({ targetType: 1, targetId: 1, at: -1 });
AuditLogSchema.index({ action: 1, at: -1 });
forbidWrites(AuditLogSchema, 'The audit log');
export const AnimAuditLog = mongoose.model<IAnimAuditLog>('AnimAuditLog', AuditLogSchema);

// ---------- Change requests: edits to locked fields (§8, §38) ----------

export interface IAnimChangeRequest extends Document {
    organizerId: Types.ObjectId;
    eventId: Types.ObjectId;
    targetType: 'CHALLENGE' | 'REWARD' | 'PACKAGE';
    targetId: Types.ObjectId;
    patch: Record<string, unknown>;
    diff: { path: string; from: unknown; to: unknown }[];
    reason: string;
    requestedBy: Types.ObjectId;
    status: ChangeRequestStatus;
    reviewedBy?: Types.ObjectId;
    reviewNote?: string;
    reviewedAt?: Date;
    createdAt: Date;
}

const ChangeRequestSchema = new Schema<IAnimChangeRequest>({
    organizerId: { type: Schema.Types.ObjectId, required: true },
    eventId: { type: Schema.Types.ObjectId, required: true, index: true },
    targetType: { type: String, enum: ['CHALLENGE', 'REWARD', 'PACKAGE'], required: true },
    targetId: { type: Schema.Types.ObjectId, required: true },
    patch: { type: Schema.Types.Mixed, required: true },
    diff: [{ path: String, from: Schema.Types.Mixed, to: Schema.Types.Mixed, _id: false }],
    reason: { type: String, required: true, maxlength: 1000 },
    requestedBy: { type: Schema.Types.ObjectId, required: true },
    status: { type: String, enum: Object.values(ChangeRequestStatus), default: ChangeRequestStatus.PENDING, index: true },
    reviewedBy: { type: Schema.Types.ObjectId },
    reviewNote: { type: String, maxlength: 1000 },
    reviewedAt: { type: Date },
}, { timestamps: true, collection: 'anim_change_requests' });
ChangeRequestSchema.index({ status: 1, createdAt: 1 });
export const AnimChangeRequest = mongoose.model<IAnimChangeRequest>('AnimChangeRequest', ChangeRequestSchema);

// ---------- Fraud flags: "À vérifier" (§20) ----------

export interface IAnimFraudFlag extends Document {
    organizerId: Types.ObjectId;
    eventId: Types.ObjectId;
    challengeId: Types.ObjectId;
    subjectType: 'USER' | 'TRANSACTION' | 'CANDIDATE' | 'IP';
    subjectId: string;
    signals: { code: string; value: number; threshold: number; note?: string }[];
    score: number;
    status: FraudFlagStatus;
    reviewedBy?: Types.ObjectId;
    reviewNote?: string;
    reviewedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const FraudFlagSchema = new Schema<IAnimFraudFlag>({
    organizerId: { type: Schema.Types.ObjectId, required: true },
    eventId: { type: Schema.Types.ObjectId, required: true },
    challengeId: { type: Schema.Types.ObjectId, required: true, index: true },
    subjectType: { type: String, enum: ['USER', 'TRANSACTION', 'CANDIDATE', 'IP'], required: true },
    subjectId: { type: String, required: true },
    signals: [{ code: String, value: Number, threshold: Number, note: String, _id: false }],
    score: { type: Number, default: 0 },
    status: { type: String, enum: Object.values(FraudFlagStatus), default: FraudFlagStatus.OPEN, index: true },
    reviewedBy: { type: Schema.Types.ObjectId },
    reviewNote: { type: String, maxlength: 1000 },
    reviewedAt: { type: Date },
}, { timestamps: true, collection: 'anim_fraud_flags' });
FraudFlagSchema.index(
    { challengeId: 1, subjectType: 1, subjectId: 1 },
    { unique: true, partialFilterExpression: { status: FraudFlagStatus.OPEN } },
);
export const AnimFraudFlag = mongoose.model<IAnimFraudFlag>('AnimFraudFlag', FraudFlagSchema);

// ---------- Notification outbox (§29): deduped, batched, retried ----------

export interface IAnimOutbox extends Document {
    dedupeKey: string;
    kind: string;
    userId: Types.ObjectId;
    channels: string[];
    subject: string;
    body: string;
    data?: Record<string, unknown>;
    eventId?: Types.ObjectId;
    status: 'PENDING' | 'SENT' | 'FAILED';
    attempts: number;
    nextAt: Date;
    sentAt?: Date;
    createdAt: Date;
}

const OutboxSchema = new Schema<IAnimOutbox>({
    dedupeKey: { type: String, required: true, unique: true, maxlength: 300 },
    kind: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    channels: [{ type: String }],
    subject: { type: String, required: true },
    body: { type: String, required: true },
    data: { type: Schema.Types.Mixed },
    eventId: { type: Schema.Types.ObjectId },
    status: { type: String, enum: ['PENDING', 'SENT', 'FAILED'], default: 'PENDING' },
    attempts: { type: Number, default: 0 },
    nextAt: { type: Date, default: () => new Date() },
    sentAt: { type: Date },
}, { timestamps: true, collection: 'anim_outbox' });
OutboxSchema.index({ status: 1, nextAt: 1 });
export const AnimOutbox = mongoose.model<IAnimOutbox>('AnimOutbox', OutboxSchema);
