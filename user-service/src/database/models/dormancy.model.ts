import { Schema, model } from 'mongoose';

/**
 * Security plan Phase 7: dormant accounts.
 *
 * - dormancy_snapshots: one document per night (Douala day), written by the
 *   nightly pass. The admin page's headline card, breakdowns and trend read
 *   only these: the page never adds up users live.
 * - dormancy_returns: every first sign-in after dormant / long_dormant, with
 *   what came with it (new country, new device, recent contact change), in
 *   every hold mode, to measure before turning the hold on. Kept a year.
 * - dormancy_exports: CSV exports, built in the background into GridFS bucket
 *   `dormancy_exports`; the file and its row go after 24 h.
 */
const Totals = { _id: false, count: { type: Number, default: 0 }, xaf: { type: Number, default: 0 }, usd: { type: Number, default: 0 }, xafEq: { type: Number, default: 0 } };

const SnapshotSchema = new Schema({
    _id: { type: String }, // Douala day YYYY-MM-DD
    runId: { type: String, required: true },
    at: { type: Date, required: true },
    durationMs: { type: Number },
    thresholds: { type: Schema.Types.Mixed },
    xafPerUsd: { type: Number },
    /** Every account holding money. */
    all: Totals,
    /** Accounts holding money but less than the minimum (DORMANCY_MIN_XAF): no status. */
    belowMin: Totals,
    byStatus: { type: Schema.Types.Mixed, default: {} },
    /** Accounts inactive for inactiveDays or more (inactive + dormant + long_dormant). */
    dormant: { type: Schema.Types.Mixed, default: {} },
    /** Nightly check: the card total equals the sum of the list (same stored fields, same filters). */
    check: { type: Schema.Types.Mixed, default: null },
}, { collection: 'dormancy_snapshots', versionKey: false });
export const DormancySnapshotModel = model('DormancySnapshot', SnapshotSchema);

const ReturnSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    at: { type: Date, required: true },
    from: { type: String, required: true },
    lastSeenAt: { type: Date },
    heldXaf: { type: Number, default: 0 },
    mode: { type: String, required: true },
    held: { type: Boolean, default: false },
    holdUntil: { type: Date, default: null },
    signals: {
        _id: false,
        newCountry: { type: Boolean, default: false },
        country: { type: String, default: null },
        newDevice: { type: Boolean, default: null }, // null = no device known before
        contactChange: { type: String, default: null },
        contactChangeDuringHold: { type: Boolean, default: false },
    },
    caseOpened: { type: Boolean, default: false },
}, { collection: 'dormancy_returns', versionKey: false });
ReturnSchema.index({ at: 1 }, { expireAfterSeconds: 365 * 86400 });
export const DormancyReturnModel = model('DormancyReturn', ReturnSchema);

const ExportSchema = new Schema({
    status: { type: String, enum: ['running', 'done', 'failed'], default: 'running' },
    filters: { type: Schema.Types.Mixed, default: {} },
    createdBy: { type: String, required: true },
    rows: { type: Number, default: 0 },
    fileId: { type: Schema.Types.ObjectId, default: null },
    fileName: { type: String, default: null },
    error: { type: String, default: null },
    createdAt: { type: Date, default: () => new Date() },
    finishedAt: { type: Date, default: null },
}, { collection: 'dormancy_exports', versionKey: false });
ExportSchema.index({ createdAt: 1 });
ExportSchema.index({ createdBy: 1, status: 1 });
export const DormancyExportModel = model('DormancyExport', ExportSchema);

/**
 * Phase 7 part 2: the « réactivation » campaign.
 *
 * - dormancy_reactivation_texts: one document (`_id: 'reactivation'`) with the draft a super
 *   admin edits and the APPROVED version (who, when, version number). A send always uses the
 *   approved version, copied into the campaign.
 * - dormancy_campaigns: one per send, with its filters, the approved text it used, and its counters.
 * - dormancy_campaign_targets: one row per member per campaign (unique), the outbox the sender
 *   works through (resumable after a restart).
 * - dormancy_contacts: one row per member (`_id` = userId): when a réactivation last went to
 *   them. Claimed with one conditional upsert, so a second campaign inside 30 days is refused by
 *   the database itself (duplicate key), not by a read-then-write.
 */
const TextFields = {
    subject: { type: String, required: true },
    body: { type: String, required: true },
    pushTitle: { type: String, required: true },
    pushBody: { type: String, required: true },
};
const ReactivationTextSchema = new Schema({
    _id: { type: String },
    draft: { type: new Schema({ ...TextFields, updatedBy: { type: String }, updatedAt: { type: Date } }, { _id: false }), default: null },
    approved: { type: new Schema({ ...TextFields, version: { type: Number, required: true }, approvedBy: { type: String, required: true }, approvedAt: { type: Date, required: true } }, { _id: false }), default: null },
}, { collection: 'dormancy_reactivation_texts', versionKey: false });
export const DormancyReactivationTextModel = model('DormancyReactivationText', ReactivationTextSchema);

const CampaignSchema = new Schema({
    status: { type: String, enum: ['building', 'sending', 'done', 'cancelled', 'failed'], required: true },
    filters: { type: Schema.Types.Mixed, default: {} },
    text: { type: Schema.Types.Mixed, required: true }, // the approved version used (subject, body, push, version)
    mode: { type: String, enum: ['live', 'allowlist'], required: true },
    createdBy: { type: String, required: true },
    createdAt: { type: Date, default: () => new Date() },
    builtAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    /** The mail budget said wait (night, minute full, relance's daily total): no call before this. */
    waitUntil: { type: Date, default: null },
    cancelledBy: { type: String, default: null },
    error: { type: String, default: null },
    counts: {
        _id: false,
        targets: { type: Number, default: 0 },
        sent: { type: Number, default: 0 },
        failed: { type: Number, default: 0 },
        skipped: { type: Number, default: 0 },
        returned: { type: Number, default: 0 },
        emailSent: { type: Number, default: 0 },
        pushSent: { type: Number, default: 0 },
    },
    /** Why members were left out, at build and at send time ({ reason: count }). */
    excluded: { type: Schema.Types.Mixed, default: {} },
}, { collection: 'dormancy_campaigns', versionKey: false });
CampaignSchema.index({ createdAt: -1 });
CampaignSchema.index({ status: 1 });
export const DormancyCampaignModel = model('DormancyCampaign', CampaignSchema);

const TargetSchema = new Schema({
    campaignId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    status: { type: String, enum: ['pending', 'sent', 'failed', 'skipped'], default: 'pending' },
    reason: { type: String, default: null },
    attempts: { type: Number, default: 0 },
    nextAt: { type: Date, default: () => new Date() },
    email: { type: String, default: null },
    push: { type: String, default: null },
    sentAt: { type: Date, default: null },
    returnedAt: { type: Date, default: null },
}, { collection: 'dormancy_campaign_targets', versionKey: false });
TargetSchema.index({ campaignId: 1, userId: 1 }, { unique: true });
TargetSchema.index({ status: 1, nextAt: 1 });
TargetSchema.index({ userId: 1, sentAt: -1 });
TargetSchema.index({ sentAt: 1 }, { expireAfterSeconds: 400 * 86400 });
export const DormancyCampaignTargetModel = model('DormancyCampaignTarget', TargetSchema);

const ContactSchema = new Schema({
    _id: { type: Schema.Types.ObjectId },
    lastAt: { type: Date, required: true },
    campaignId: { type: Schema.Types.ObjectId, required: true },
}, { collection: 'dormancy_contacts', versionKey: false });
export const DormancyContactModel = model('DormancyContact', ContactSchema);
