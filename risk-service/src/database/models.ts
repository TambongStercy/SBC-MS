import { Schema, model } from 'mongoose';

/**
 * Security plan Phase 4 (sbc_risk / sbc_risk_preprod).
 *   identifiers  one per shared identifier: a phone number (whatever its uses:
 *                withdrawal, profile MoMo, paying number) or a device, stored as
 *                an HMAC: never in clear. `tail` (last 3
 *                digits) lets finance recognise a number in a case.
 *   riskmembers  each member's group (strong links only), score, decision, reasons.
 *   riskruns     each look-back / scoring run, with its counts.
 */
export type IdentifierKind = 'payout_number' | 'profile_momo' | 'payin_number' | 'device';
/** How identifiers link accounts: one phone number whatever its use, or one device. */
export type LinkKind = 'phone' | 'device';
export const STRONG_KINDS: IdentifierKind[] = ['payout_number', 'profile_momo', 'payin_number', 'device'];

const IdentifierSchema = new Schema({
    kind: { type: String, required: true }, // 'phone' | 'device'
    uses: { type: [String], default: [] }, // payout_number, profile_momo, payin_number, device
    hash: { type: String, required: true },
    tail: { type: String, default: null },
    accounts: { type: [String], default: [] },
    payoutAccounts: { type: [String], default: [] },
    count: { type: Number, default: 0 },
    hub: { type: Boolean, default: false },
    firstSeenAt: { type: Date, default: null },
    lastSeenAt: { type: Date, default: null },
}, { collection: 'identifiers', versionKey: false });
IdentifierSchema.index({ kind: 1, hash: 1 }, { unique: true });
IdentifierSchema.index({ accounts: 1 });
export const IdentifierModel = model('Identifier', IdentifierSchema);

export type Decision = 'allow' | 'require_code' | 'hold';
export interface Reason { rule: string; points: number; detail: string; caseType?: string }

const MemberSchema = new Schema({
    userId: { type: String, required: true },
    groupId: { type: String, required: true },
    groupSize: { type: Number, default: 1 },
    score: { type: Number, default: 0 },
    decision: { type: String, default: 'allow' },
    reasons: { type: [{ _id: false, rule: String, points: Number, detail: String, caseType: String }], default: [] },
    country: { type: String, default: null },
    scoredAt: { type: Date, default: null },
    runId: { type: String, default: null },
}, { collection: 'riskmembers', versionKey: false });
MemberSchema.index({ userId: 1 }, { unique: true });
MemberSchema.index({ groupId: 1 });
MemberSchema.index({ decision: 1, score: -1 });
export const RiskMemberModel = model('RiskMember', MemberSchema);

const RunSchema = new Schema({
    _id: String,
    kind: String,
    dryRun: Boolean,
    startedAt: Date,
    finishedAt: Date,
    stats: Schema.Types.Mixed,
}, { collection: 'riskruns', versionKey: false });
export const RiskRunModel = model('RiskRun', RunSchema);

/**
 * Security plan Phase 8: KYC level 1.
 *   kycqueue    one row per member waiting for a check (_id = userId), live hints first;
 *               `v` grows with every hint, so a hint arriving mid-check makes it run again.
 *   kycresults  the member's latest level 1: signals and a score only (never the
 *               email, number or a profile), deleted after KYC_RETENTION_DAYS (TTL).
 */
export const KYC_LIVE = 0;
export const KYC_BACKFILL = 1;
const KycQueueSchema = new Schema({
    _id: { type: String },
    reason: { type: String, required: true }, // signup | contact_change | refresh | manual
    priority: { type: Number, default: KYC_LIVE },
    v: { type: Number, default: 0 },
    enqueuedAt: { type: Date, required: true },
    nextAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: null },
    claimedUntil: { type: Date, default: null },
    claimToken: { type: String, default: null },
}, { collection: 'kycqueue', versionKey: false });
KycQueueSchema.index({ priority: 1, nextAt: 1 });
KycQueueSchema.index({ claimToken: 1 }, { sparse: true });
export const KycQueueModel = model('KycQueue', KycQueueSchema);

const KycResultSchema = new Schema({
    userId: { type: String, required: true },
    level: { type: Number, default: 1 },
    /** HMAC of the checked fields + the checks' version: unchanged → no new check. */
    fingerprint: { type: String, required: true },
    signals: { type: Schema.Types.Mixed, default: {} },
    reasons: { type: [String], default: [] },
    workerScore: { type: Number, default: 0 },
    score: { type: Number, default: 0 },
    band: { type: String, default: 'low' },
    /** HMAC of the mailbox the address really reaches (+tag and Gmail dots dropped). */
    emailKey: { type: String, default: null },
    variantAccounts: { type: Number, default: 0 },
    trigger: { type: String, default: null },
    checkedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
}, { collection: 'kycresults', versionKey: false });
KycResultSchema.index({ userId: 1 }, { unique: true });
KycResultSchema.index({ emailKey: 1 }, { sparse: true });
KycResultSchema.index({ band: 1, score: -1 });
KycResultSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const KycResultModel = model('KycResult', KycResultSchema);
