import mongoose, { Document, Schema, Types } from 'mongoose';
import {
    EligibilityScope, ResultStatus, RewardStatus, RewardType, RuleKind, RuleStatus, RuleTrigger,
    TieRule, WinnerStatus,
} from '../types';

// ---------- Reward (§4–§6) ----------

export interface IAnimReward extends Document {
    _id: Types.ObjectId;
    organizerId: Types.ObjectId;
    eventId: Types.ObjectId;
    challengeId?: Types.ObjectId;
    name: string;
    description: string;
    imageFileId?: string;
    type: RewardType;
    customTypeLabel?: string;
    estimatedValue: number;
    currency: string;
    quantity: number;
    quantityAwarded: number;
    conditionsText: string;
    startsAt?: Date;
    endsAt?: Date;
    status: RewardStatus;
    activeRuleId?: Types.ObjectId;
    lockedAt?: Date;
    createdBy: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const RewardSchema = new Schema<IAnimReward>({
    organizerId: { type: Schema.Types.ObjectId, required: true },
    eventId: { type: Schema.Types.ObjectId, required: true },
    challengeId: { type: Schema.Types.ObjectId },
    name: { type: String, required: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 2000 },
    imageFileId: { type: String },
    type: { type: String, enum: Object.values(RewardType), required: true },
    customTypeLabel: { type: String, maxlength: 60 },
    estimatedValue: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: 'XAF' },
    quantity: { type: Number, required: true, min: 1, max: 100000 },
    quantityAwarded: { type: Number, default: 0, min: 0 },
    conditionsText: { type: String, default: '', maxlength: 2000 },
    startsAt: { type: Date },
    endsAt: { type: Date },
    status: { type: String, enum: Object.values(RewardStatus), default: RewardStatus.DRAFT },
    activeRuleId: { type: Schema.Types.ObjectId },
    lockedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, required: true },
}, { timestamps: true, collection: 'anim_rewards' });
RewardSchema.index({ eventId: 1, status: 1 });
export const AnimReward = mongoose.model<IAnimReward>('AnimReward', RewardSchema);

// ---------- Reward rule: immutable and versioned (§7–§8) ----------

export interface IAnimRewardRule extends Document {
    _id: Types.ObjectId;
    organizerId: Types.ObjectId;
    eventId: Types.ObjectId;
    rewardId: Types.ObjectId;
    version: number;
    kind: RuleKind;
    trigger?: RuleTrigger;
    params: {
        position?: number;
        every?: number;
        firstN?: number;
        winners?: number;
        drawAt?: Date;
        challengeId?: Types.ObjectId;
        rankFrom?: number;
        rankTo?: number;
        onePerUser: boolean;
    };
    eligibility: {
        scope: EligibilityScope;
        ticketTypeIds: Types.ObjectId[];
        challengeId?: Types.ObjectId;
    };
    status: RuleStatus;
    activatedAt?: Date;
    activatedBy?: Types.ObjectId;
    /** sha256 of the canonical definition — what was promised, provably unchanged. */
    definitionHash: string;
    counter: number;
    createdBy: Types.ObjectId;
    createdAt: Date;
}

const RewardRuleSchema = new Schema<IAnimRewardRule>({
    organizerId: { type: Schema.Types.ObjectId, required: true },
    eventId: { type: Schema.Types.ObjectId, required: true },
    rewardId: { type: Schema.Types.ObjectId, required: true },
    version: { type: Number, required: true },
    kind: { type: String, enum: Object.values(RuleKind), required: true },
    trigger: { type: String, enum: Object.values(RuleTrigger) },
    params: {
        position: Number,
        every: Number,
        firstN: Number,
        winners: Number,
        drawAt: Date,
        challengeId: Schema.Types.ObjectId,
        rankFrom: Number,
        rankTo: Number,
        onePerUser: { type: Boolean, default: true },
    },
    eligibility: {
        scope: { type: String, enum: Object.values(EligibilityScope), default: EligibilityScope.ALL_PARTICIPANTS },
        ticketTypeIds: [{ type: Schema.Types.ObjectId }],
        challengeId: { type: Schema.Types.ObjectId },
    },
    status: { type: String, enum: Object.values(RuleStatus), default: RuleStatus.DRAFT },
    activatedAt: { type: Date },
    activatedBy: { type: Schema.Types.ObjectId },
    definitionHash: { type: String, required: true },
    counter: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, required: true },
}, { timestamps: true, collection: 'anim_reward_rules' });
RewardRuleSchema.index({ rewardId: 1, version: 1 }, { unique: true });
RewardRuleSchema.index({ rewardId: 1 }, { unique: true, partialFilterExpression: { status: RuleStatus.ACTIVE }, name: 'one_active_rule_per_reward' });
RewardRuleSchema.index({ eventId: 1, trigger: 1, status: 1 });
export const AnimRewardRule = mongoose.model<IAnimRewardRule>('AnimRewardRule', RewardRuleSchema);

/** One row per counted subject of a rule: replays can't count twice, ordinals have no gaps. */
export interface IAnimRuleTick extends Document {
    ruleId: Types.ObjectId;
    eventId: Types.ObjectId;
    subjectKey: string;
    userId: Types.ObjectId;
    ordinal?: number;
    /** Set on a hit once its prize is decided (won or not): the next hit waits for it. */
    decidedAt?: Date;
    at: Date;
}
const RuleTickSchema = new Schema<IAnimRuleTick>({
    ruleId: { type: Schema.Types.ObjectId, required: true },
    eventId: { type: Schema.Types.ObjectId, required: true },
    subjectKey: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    ordinal: { type: Number },
    decidedAt: { type: Date },
    at: { type: Date, default: () => new Date() },
}, { collection: 'anim_rule_ticks' });
RuleTickSchema.index({ ruleId: 1, subjectKey: 1 }, { unique: true });
RuleTickSchema.index({ ruleId: 1, ordinal: 1 });
export const AnimRuleTick = mongoose.model<IAnimRuleTick>('AnimRuleTick', RuleTickSchema);

// ---------- Winners ----------

export interface IAnimRewardWinner extends Document {
    _id: Types.ObjectId;
    organizerId: Types.ObjectId;
    eventId: Types.ObjectId;
    challengeId?: Types.ObjectId;
    rewardId: Types.ObjectId;
    ruleId: Types.ObjectId;
    ruleVersion: number;
    /** "ord:50" | "draw:3" | "rank:1:<candidateId>" | "manual:<uuid>" — unique per rule. */
    slotKey: string;
    userId: Types.ObjectId;
    candidateId?: Types.ObjectId;
    sharePct: number;
    status: WinnerStatus;
    deliveredAt?: Date;
    deliveredBy?: Types.ObjectId;
    deliveryNote?: string;
    proofFileId?: string;
    awardedAt: Date;
    createdAt: Date;
}

const RewardWinnerSchema = new Schema<IAnimRewardWinner>({
    organizerId: { type: Schema.Types.ObjectId, required: true },
    eventId: { type: Schema.Types.ObjectId, required: true },
    challengeId: { type: Schema.Types.ObjectId },
    rewardId: { type: Schema.Types.ObjectId, required: true },
    ruleId: { type: Schema.Types.ObjectId, required: true },
    ruleVersion: { type: Number, required: true },
    slotKey: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    candidateId: { type: Schema.Types.ObjectId },
    sharePct: { type: Number, default: 100 },
    status: { type: String, enum: Object.values(WinnerStatus), default: WinnerStatus.AWARDED },
    deliveredAt: { type: Date },
    deliveredBy: { type: Schema.Types.ObjectId },
    deliveryNote: { type: String, maxlength: 1000 },
    proofFileId: { type: String },
    awardedAt: { type: Date, default: () => new Date() },
}, { timestamps: true, collection: 'anim_reward_winners' });
RewardWinnerSchema.index({ ruleId: 1, slotKey: 1 }, { unique: true });
RewardWinnerSchema.index({ eventId: 1, status: 1 });
RewardWinnerSchema.index({ rewardId: 1, awardedAt: 1 });
RewardWinnerSchema.index({ userId: 1, awardedAt: -1 });
export const AnimRewardWinner = mongoose.model<IAnimRewardWinner>('AnimRewardWinner', RewardWinnerSchema);

// ---------- Random draws: committed seed, frozen entrants, public proof ----------

export interface IAnimRewardDraw extends Document {
    _id: Types.ObjectId;
    ruleId: Types.ObjectId;
    rewardId: Types.ObjectId;
    eventId: Types.ObjectId;
    status: 'SCHEDULED' | 'RUNNING' | 'DONE';
    scheduledAt?: Date;
    seedCommitment: string;
    seed: string;
    eligibleCount?: number;
    eligibleSetHash?: string;
    winners: { position: number; userId: Types.ObjectId }[];
    leaseUntil?: Date;
    drawnAt?: Date;
    createdAt: Date;
}

const RewardDrawSchema = new Schema<IAnimRewardDraw>({
    ruleId: { type: Schema.Types.ObjectId, required: true, unique: true },
    rewardId: { type: Schema.Types.ObjectId, required: true },
    eventId: { type: Schema.Types.ObjectId, required: true },
    status: { type: String, enum: ['SCHEDULED', 'RUNNING', 'DONE'], default: 'SCHEDULED' },
    scheduledAt: { type: Date },
    seedCommitment: { type: String, required: true },
    seed: { type: String, required: true, select: false },
    eligibleCount: { type: Number },
    eligibleSetHash: { type: String },
    winners: [{ position: Number, userId: Schema.Types.ObjectId, _id: false }],
    leaseUntil: { type: Date },
    drawnAt: { type: Date },
}, { timestamps: true, collection: 'anim_reward_draws' });
RewardDrawSchema.index({ status: 1, scheduledAt: 1 });
export const AnimRewardDraw = mongoose.model<IAnimRewardDraw>('AnimRewardDraw', RewardDrawSchema);

export interface IAnimDrawEntrants extends Document {
    drawId: Types.ObjectId;
    chunk: number;
    userIds: string[];
}
const DrawEntrantsSchema = new Schema<IAnimDrawEntrants>({
    drawId: { type: Schema.Types.ObjectId, required: true },
    chunk: { type: Number, required: true },
    userIds: [{ type: String }],
}, { collection: 'anim_draw_entrants' });
DrawEntrantsSchema.index({ drawId: 1, chunk: 1 }, { unique: true });
export const AnimDrawEntrants = mongoose.model<IAnimDrawEntrants>('AnimDrawEntrants', DrawEntrantsSchema);

// ---------- Results (§27–§28) and board history (§25) ----------

export interface ResultEntry {
    candidateId: Types.ObjectId;
    number: number;
    displayName: string;
    userId: Types.ObjectId;
    freeVotes: number;
    paidVotes: number;
    totalVotes: number;
    juryScore: number;
    score: number;
    rank: number;
    sharedRank: boolean;
}

export interface IAnimResult extends Document {
    _id: Types.ObjectId;
    challengeId: Types.ObjectId;
    eventId: Types.ObjectId;
    organizerId: Types.ObjectId;
    status: ResultStatus;
    computedAt: Date;
    frozenAt?: Date;
    frozenBy?: Types.ObjectId;
    publishedAt?: Date;
    configSnapshot: Record<string, unknown>;
    /** sha256 over the ledger aggregates the result was computed from. */
    inputsHash: string;
    entries: ResultEntry[];
    ties: { rank: number; candidateIds: Types.ObjectId[] }[];
    tieResolution?: { method: TieRule; decidedBy?: Types.ObjectId; at: Date; note?: string; order?: Types.ObjectId[] };
    secondRoundChallengeId?: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const ResultSchema = new Schema<IAnimResult>({
    challengeId: { type: Schema.Types.ObjectId, required: true, unique: true },
    eventId: { type: Schema.Types.ObjectId, required: true },
    organizerId: { type: Schema.Types.ObjectId, required: true },
    status: { type: String, enum: Object.values(ResultStatus), required: true },
    computedAt: { type: Date, required: true },
    frozenAt: { type: Date },
    frozenBy: { type: Schema.Types.ObjectId },
    publishedAt: { type: Date },
    configSnapshot: { type: Schema.Types.Mixed },
    inputsHash: { type: String, required: true },
    entries: [{
        candidateId: Schema.Types.ObjectId, number: Number, displayName: String, userId: Schema.Types.ObjectId,
        freeVotes: Number, paidVotes: Number, totalVotes: Number, juryScore: Number, score: Number,
        rank: Number, sharedRank: Boolean, _id: false,
    }],
    ties: [{ rank: Number, candidateIds: [Schema.Types.ObjectId], _id: false }],
    tieResolution: {
        method: String, decidedBy: Schema.Types.ObjectId, at: Date, note: String, order: [Schema.Types.ObjectId],
    },
    secondRoundChallengeId: { type: Schema.Types.ObjectId },
}, { timestamps: true, collection: 'anim_results' });
// A frozen result is final (§27): only publishing it remains possible.
const guardFrozen = async function (this: any) {
    const filter = this.getFilter();
    const update = this.getUpdate() || {};
    // `timestamps` adds updatedAt (and $setOnInsert.createdAt) to every update.
    const sets = Object.keys(update.$set || {}).filter((k) => k !== 'updatedAt');
    const onlyPublish = sets.length > 0 && sets.every((k) => k === 'publishedAt')
        && Object.keys(update).every((k) => k === '$set' || k === '$setOnInsert');
    if (onlyPublish) return;
    const frozen = await mongoose.model('AnimResult').exists({ ...filter, status: ResultStatus.FROZEN });
    if (frozen) throw new Error('A frozen result cannot be modified');
};
ResultSchema.pre('updateOne', guardFrozen);
ResultSchema.pre('findOneAndUpdate', guardFrozen);
ResultSchema.pre('updateMany', guardFrozen);
ResultSchema.pre('deleteOne', guardFrozen);
export const AnimResult = mongoose.model<IAnimResult>('AnimResult', ResultSchema);

export interface IAnimBoardSnapshot extends Document {
    challengeId: Types.ObjectId;
    eventId: Types.ObjectId;
    kind: 'PERIODIC' | 'PHASE' | 'FINAL';
    boardVersion: number;
    takenAt: Date;
    entries: { candidateId: Types.ObjectId; number: number; free: number; paid: number; jury: number; score: number; rank: number }[];
}
const BoardSnapshotSchema = new Schema<IAnimBoardSnapshot>({
    challengeId: { type: Schema.Types.ObjectId, required: true },
    eventId: { type: Schema.Types.ObjectId, required: true },
    kind: { type: String, enum: ['PERIODIC', 'PHASE', 'FINAL'], required: true },
    boardVersion: { type: Number, default: 0 },
    takenAt: { type: Date, default: () => new Date() },
    entries: [{ candidateId: Schema.Types.ObjectId, number: Number, free: Number, paid: Number, jury: Number, score: Number, rank: Number, _id: false }],
}, { collection: 'anim_board_snapshots' });
BoardSnapshotSchema.index({ challengeId: 1, takenAt: 1 });
export const AnimBoardSnapshot = mongoose.model<IAnimBoardSnapshot>('AnimBoardSnapshot', BoardSnapshotSchema);
