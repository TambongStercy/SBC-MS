import mongoose, { Document, Schema, Types } from 'mongoose';
import { FraudReview, VoteKind, VoteStatus, VoteTxStatus } from '../types';

// ---------- Vote packs (§17) ----------

export interface IAnimVotePackage extends Document {
    _id: Types.ObjectId;
    organizerId: Types.ObjectId;
    eventId: Types.ObjectId;
    challengeId: Types.ObjectId;
    label: string;
    votes: number;
    price: number;
    currency: string;
    /** Frozen once voting opens: archived, never edited (§38). */
    status: 'ACTIVE' | 'ARCHIVED';
    availableFrom?: Date;
    availableUntil?: Date;
    sortOrder: number;
    createdAt: Date;
}

const VotePackageSchema = new Schema<IAnimVotePackage>({
    organizerId: { type: Schema.Types.ObjectId, required: true },
    eventId: { type: Schema.Types.ObjectId, required: true },
    challengeId: { type: Schema.Types.ObjectId, required: true },
    label: { type: String, required: true, maxlength: 60 },
    votes: { type: Number, required: true, min: 1, max: 100000 },
    price: { type: Number, required: true, min: 100 },
    currency: { type: String, default: 'XAF' },
    status: { type: String, enum: ['ACTIVE', 'ARCHIVED'], default: 'ACTIVE' },
    availableFrom: { type: Date },
    availableUntil: { type: Date },
    sortOrder: { type: Number, default: 0 },
}, { timestamps: true, collection: 'anim_vote_packages' });
VotePackageSchema.index({ challengeId: 1, status: 1, sortOrder: 1 });
export const AnimVotePackage = mongoose.model<IAnimVotePackage>('AnimVotePackage', VotePackageSchema);

// ---------- Paid vote transactions (§18–§19) ----------

export interface IAnimVoteTransaction extends Document {
    _id: Types.ObjectId;
    organizerId: Types.ObjectId;
    eventId: Types.ObjectId;
    challengeId: Types.ObjectId;
    candidateId: Types.ObjectId;
    userId: Types.ObjectId;
    packageId: Types.ObjectId;
    packageSnapshot: { label: string; votes: number; price: number };
    votes: number;
    amount: number;
    currency: string;
    commissionRate: number;
    commissionAmount: number;
    organizerNet: number;
    status: VoteTxStatus;
    paymentSessionId?: string;
    providerStatus?: string;
    paymentMethod?: string;
    idempotencyKey: string;
    /** Settled after the voting window: money refunded, no votes counted. */
    lateSettlement?: boolean;
    settledAt?: Date;
    settlingAt?: Date;
    votesCreditedAt?: Date;
    /** Organizer's share credited to their event balance (immediately, like tickets). */
    creditedAt?: Date;
    reconciledAt?: Date;
    refundedAt?: Date;
    ipHash?: string;
    uaHash?: string;
    fraud: { score: number; flags: string[]; review: FraudReview };
    createdAt: Date;
    updatedAt: Date;
}

const VoteTransactionSchema = new Schema<IAnimVoteTransaction>({
    organizerId: { type: Schema.Types.ObjectId, required: true },
    eventId: { type: Schema.Types.ObjectId, required: true },
    challengeId: { type: Schema.Types.ObjectId, required: true },
    candidateId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    packageId: { type: Schema.Types.ObjectId, required: true },
    packageSnapshot: { label: String, votes: Number, price: Number },
    votes: { type: Number, required: true, min: 1 },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'XAF' },
    commissionRate: { type: Number, required: true, min: 0 },
    commissionAmount: { type: Number, required: true, min: 0 },
    organizerNet: { type: Number, required: true, min: 0 },
    status: { type: String, enum: Object.values(VoteTxStatus), default: VoteTxStatus.PENDING },
    paymentSessionId: { type: String },
    providerStatus: { type: String },
    paymentMethod: { type: String },
    idempotencyKey: { type: String, required: true, maxlength: 100 },
    lateSettlement: { type: Boolean },
    settledAt: { type: Date },
    settlingAt: { type: Date },
    votesCreditedAt: { type: Date },
    creditedAt: { type: Date },
    reconciledAt: { type: Date },
    refundedAt: { type: Date },
    ipHash: { type: String },
    uaHash: { type: String },
    fraud: {
        score: { type: Number, default: 0 },
        flags: [{ type: String }],
        review: { type: String, enum: Object.values(FraudReview), default: FraudReview.NONE },
    },
}, { timestamps: true, collection: 'anim_vote_transactions' });
VoteTransactionSchema.index({ paymentSessionId: 1 }, { unique: true, partialFilterExpression: { paymentSessionId: { $type: 'string' } } });
VoteTransactionSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true });
VoteTransactionSchema.index({ challengeId: 1, status: 1, createdAt: -1 });
VoteTransactionSchema.index({ status: 1, createdAt: 1 });
VoteTransactionSchema.index({ candidateId: 1, status: 1 });
VoteTransactionSchema.index({ userId: 1, challengeId: 1, createdAt: -1 });
VoteTransactionSchema.index({ status: 1, creditedAt: 1 });
export const AnimVoteTransaction = mongoose.model<IAnimVoteTransaction>('AnimVoteTransaction', VoteTransactionSchema);

// ---------- Vote ledger: the source of truth for every count (§18, §25) ----------

export interface IAnimVote extends Document {
    organizerId: Types.ObjectId;
    eventId: Types.ObjectId;
    challengeId: Types.ObjectId;
    candidateId: Types.ObjectId;
    voterUserId: Types.ObjectId;
    kind: VoteKind;
    quantity: number;
    transactionId?: Types.ObjectId;
    /** Day bucket (challenge timezone) for free votes, e.g. 2026-10-04. */
    periodKey?: string;
    ipHash?: string;
    uaHash?: string;
    status: VoteStatus;
    voidReason?: string;
    voidedBy?: Types.ObjectId;
    at: Date;
}

const VoteSchema = new Schema<IAnimVote>({
    organizerId: { type: Schema.Types.ObjectId, required: true },
    eventId: { type: Schema.Types.ObjectId, required: true },
    challengeId: { type: Schema.Types.ObjectId, required: true },
    candidateId: { type: Schema.Types.ObjectId, required: true },
    voterUserId: { type: Schema.Types.ObjectId, required: true },
    kind: { type: String, enum: Object.values(VoteKind), required: true },
    quantity: { type: Number, required: true },
    transactionId: { type: Schema.Types.ObjectId },
    periodKey: { type: String },
    ipHash: { type: String },
    uaHash: { type: String },
    status: { type: String, enum: Object.values(VoteStatus), default: VoteStatus.COUNTED },
    voidReason: { type: String, maxlength: 500 },
    voidedBy: { type: Schema.Types.ObjectId },
    at: { type: Date, required: true, default: () => new Date() },
}, { collection: 'anim_votes' });
// A paid transaction becomes at most one ledger row — the exactly-once guarantee for credited votes.
VoteSchema.index({ transactionId: 1 }, { unique: true, partialFilterExpression: { kind: VoteKind.PAID } });
VoteSchema.index({ challengeId: 1, candidateId: 1, status: 1 });
VoteSchema.index({ challengeId: 1, voterUserId: 1, at: -1 });
VoteSchema.index({ challengeId: 1, ipHash: 1, at: -1 });
VoteSchema.index({ challengeId: 1, at: -1 });
export const AnimVote = mongoose.model<IAnimVote>('AnimVote', VoteSchema);

// ---------- Vote refunds (§39) ----------

export interface IAnimVoteRefund extends Document {
    voteTransactionId: Types.ObjectId;
    challengeId: Types.ObjectId;
    eventId: Types.ObjectId;
    userId: Types.ObjectId;
    amount: number;
    reason: string;
    initiatedBy?: Types.ObjectId;
    status: 'PENDING' | 'COMPLETED' | 'FAILED';
    attempts: number;
    lastError?: string;
    walletCreditedAt?: Date;
    organizerDebitedAt?: Date;
    completedAt?: Date;
    createdAt: Date;
}

const VoteRefundSchema = new Schema<IAnimVoteRefund>({
    voteTransactionId: { type: Schema.Types.ObjectId, required: true, unique: true },
    challengeId: { type: Schema.Types.ObjectId, required: true, index: true },
    eventId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    amount: { type: Number, required: true, min: 0 },
    reason: { type: String, required: true, maxlength: 500 },
    initiatedBy: { type: Schema.Types.ObjectId },
    status: { type: String, enum: ['PENDING', 'COMPLETED', 'FAILED'], default: 'PENDING' },
    attempts: { type: Number, default: 0 },
    lastError: { type: String },
    walletCreditedAt: { type: Date },
    organizerDebitedAt: { type: Date },
    completedAt: { type: Date },
}, { timestamps: true, collection: 'anim_vote_refunds' });
VoteRefundSchema.index({ status: 1, updatedAt: 1 });
export const AnimVoteRefund = mongoose.model<IAnimVoteRefund>('AnimVoteRefund', VoteRefundSchema);
