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
/** A reason from a live event (Phase 4 part 2): it counts until `expiresAt`. */
export interface LiveReason extends Reason { at: Date; expiresAt: Date }

const MemberSchema = new Schema({
    userId: { type: String, required: true },
    groupId: { type: String, required: true },
    groupSize: { type: Number, default: 1 },
    score: { type: Number, default: 0 },
    decision: { type: String, default: 'allow' },
    /** Links and referral rules (look-back, weekly rebuild, live group rescoring). */
    reasons: { type: [{ _id: false, rule: String, points: Number, detail: String, caseType: String }], default: [] },
    structuralScore: { type: Number, default: 0 },
    /** Event rules (contact change then withdrawal, new device + country + number…), each until its expiry. */
    liveReasons: { type: [{ _id: false, rule: String, points: Number, detail: String, caseType: String, at: Date, expiresAt: Date }], default: [] },
    country: { type: String, default: null },
    scoredAt: { type: Date, default: null },
    runId: { type: String, default: null },
}, { collection: 'riskmembers', versionKey: false });
MemberSchema.index({ userId: 1 }, { unique: true });
MemberSchema.index({ groupId: 1 });
MemberSchema.index({ decision: 1, score: -1 });
MemberSchema.index({ 'liveReasons.expiresAt': 1 }, { sparse: true });
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
 * Security plan Phase 4, part 2: live events.
 *   riskevents   one row per event, from user-service (signup, contact change, authenticator,
 *                dormant account back), payment-service (ledger mismatch), the gateway
 *                (automation seen: Phase 9) or read from the payment database by
 *                the watcher (withdrawal requested, payment paid). `key` makes each one unique,
 *                so a repeated hint or a second watcher pass adds nothing. Hashes only: never a
 *                number, address or device in clear. Deleted after RISK_EVENT_RETENTION_DAYS.
 *   riskcursors  where the watcher stopped reading the payment database.
 *   riskcasessent what was last sent to support per case, so an unchanged case is not resent
 *                on every event (support would count each as an occurrence).
 */
export type RiskEventType = 'signup' | 'contact_change' | 'authenticator_change' | 'dormant_reactivated' | 'balance_mismatch' | 'withdrawal_requested' | 'payin_succeeded' | 'automation_seen' | 'signin_failures';
export const RISK_EVENT_TYPES: RiskEventType[] = ['signup', 'contact_change', 'authenticator_change', 'dormant_reactivated', 'balance_mismatch', 'withdrawal_requested', 'payin_succeeded', 'automation_seen', 'signin_failures'];
const RiskEventSchema = new Schema({
    key: { type: String, required: true },
    type: { type: String, required: true },
    userId: { type: String, required: true },
    at: { type: Date, required: true },
    data: { type: Schema.Types.Mixed, default: {} },
    source: { type: String, default: null },
    status: { type: String, default: 'pending' }, // pending | done | failed
    attempts: { type: Number, default: 0 },
    nextAt: { type: Date, required: true },
    claimToken: { type: String, default: null },
    claimedUntil: { type: Date, default: null },
    lastError: { type: String, default: null },
    processedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
}, { collection: 'riskevents', versionKey: false });
RiskEventSchema.index({ key: 1 }, { unique: true });
RiskEventSchema.index({ status: 1, nextAt: 1 });
RiskEventSchema.index({ userId: 1, type: 1, at: -1 });
RiskEventSchema.index({ type: 1, 'data.sponsorId': 1, at: -1 }, { partialFilterExpression: { type: 'signup' } });
RiskEventSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const RiskEventModel = model('RiskEvent', RiskEventSchema);

/**
 * Support's release of a held member (approved in support, decided 2026-11-22):
 * the member may withdraw again while their score stays at or under the score
 * they had when released. A new reason that raises it holds them again.
 */
const ReleaseSchema = new Schema({
    _id: String, // userId
    scoreAtRelease: { type: Number, required: true },
    reason: { type: String, default: null },
    by: { type: Schema.Types.Mixed, default: null }, // { id, name } of the approving agent
    approvalId: { type: String, default: null },
    at: { type: Date, required: true },
    /** Ended by support (kept, never deleted). */
    endedAt: { type: Date, default: null },
}, { collection: 'riskreleases', versionKey: false });
export const RiskReleaseModel = model('RiskRelease', ReleaseSchema);

const CursorSchema = new Schema({ _id: String, lastId: { type: String, default: null }, at: Date }, { collection: 'riskcursors', versionKey: false });
export const RiskCursorModel = model('RiskCursor', CursorSchema);

const CaseSentSchema = new Schema({
    _id: String, // dedupKey
    severity: String,
    accountCount: { type: Number, default: 0 },
    sentAt: Date,
}, { collection: 'riskcasessent', versionKey: false });
export const RiskCaseSentModel = model('RiskCaseSent', CaseSentSchema);

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

/**
 * Security plan Phase 8: KYC level 2 (where else the e-mail address is used, run on the
 * secondary server). Main-server side: an outbox and a record of what was asked.
 *   kycl2queue     one row per member to send (_id = userId): `check` (the secondary looks the
 *                  address up) or `forget` (the address changed: drop the old result). No address.
 *   kycl2requests  the last request per member: trigger, the secondary's answer, and when the
 *                  member may be asked about again (`retryAt`), so a flagged member is looked up
 *                  once per KYC_L2_RECHECK_DAYS, not on every event.
 */
const KycL2QueueSchema = new Schema({
    _id: { type: String },
    action: { type: String, enum: ['check', 'forget'], required: true },
    trigger: { type: String, required: true },
    enqueuedAt: { type: Date, required: true },
    nextAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: null },
    claimedUntil: { type: Date, default: null },
    claimToken: { type: String, default: null },
}, { collection: 'kycl2queue', versionKey: false });
KycL2QueueSchema.index({ nextAt: 1 });
KycL2QueueSchema.index({ claimToken: 1 }, { sparse: true });
export const KycL2QueueModel = model('KycL2Queue', KycL2QueueSchema);

const KycL2RequestSchema = new Schema({
    _id: { type: String },
    trigger: { type: String, required: true },
    outcome: { type: String, required: true }, // queued | fresh | off | not_allowlisted | invalid | no_email | gone
    at: { type: Date, required: true },
    retryAt: { type: Date, required: true },
}, { collection: 'kycl2requests', versionKey: false });
KycL2RequestSchema.index({ retryAt: 1 });
export const KycL2RequestModel = model('KycL2Request', KycL2RequestSchema);
