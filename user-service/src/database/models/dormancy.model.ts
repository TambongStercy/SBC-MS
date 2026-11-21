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
