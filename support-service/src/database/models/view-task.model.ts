import { Schema, model, Types } from 'mongoose';
import { VIEW_TASK_STATES } from '../../config/constants';

/** One WhatsApp-views proof (advertising `manualverifications` entry) to verify. */
export interface IViewTask {
    sourceId: string;
    submittedAt: Date;
    campaignId?: string | null;
    diffuseurUserId?: string | null;
    dayIndex?: number | null;
    country?: string | null;
    state: string;
    assigneeId?: Types.ObjectId | null;
    assignedAt?: Date | null;
    startedAt?: Date | null;
    lastActivityAt?: Date | null;
    idleAlertedAt?: Date | null;
    version: number;
    requeueCount: number;
    decision?: { decision: string; observedViews?: number | null; reason?: string | null; ban?: boolean; at: Date; by: string; byName?: string } | null;
    qa?: { sampled: boolean; reviewedBy?: string | null; verdict?: 'confirmed' | 'overturned' | null; note?: string | null; at?: Date | null } | null;
    createdAt?: Date;
    updatedAt?: Date;
}

const ViewTaskSchema = new Schema<IViewTask>({
    sourceId: { type: String, required: true },
    submittedAt: { type: Date, required: true },
    campaignId: { type: String, default: null },
    diffuseurUserId: { type: String, default: null },
    dayIndex: { type: Number, default: null },
    country: { type: String, default: null },
    state: { type: String, enum: VIEW_TASK_STATES as unknown as string[], default: 'available' },
    assigneeId: { type: Schema.Types.ObjectId, default: null },
    assignedAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    lastActivityAt: { type: Date, default: null },
    idleAlertedAt: { type: Date, default: null },
    version: { type: Number, default: 0 },
    requeueCount: { type: Number, default: 0 },
    decision: { type: Schema.Types.Mixed, default: null },
    qa: { type: Schema.Types.Mixed, default: null },
}, { timestamps: true, versionKey: false });

ViewTaskSchema.index({ sourceId: 1 }, { unique: true });
// The database itself refuses two active assignments of the same proof.
ViewTaskSchema.index(
    { sourceId: 1, state: 1 },
    { unique: true, name: 'one_active_assignment', partialFilterExpression: { state: { $in: ['assigned', 'in_progress'] } } },
);
ViewTaskSchema.index({ state: 1, submittedAt: 1 });
ViewTaskSchema.index({ assigneeId: 1, state: 1 });

export const ViewTask = model<IViewTask>('ViewTask', ViewTaskSchema, 'viewtasks');

export interface IAssignmentHistory {
    taskId: Types.ObjectId;
    sourceId: string;
    kind: 'claim' | 'auto' | 'manual' | 'requeue' | 'release' | 'decision';
    from?: string | null;
    to?: string | null;
    by?: string | null;
    reason?: string | null;
    at: Date;
}

const AssignmentHistorySchema = new Schema<IAssignmentHistory>({
    taskId: { type: Schema.Types.ObjectId, required: true, index: true },
    sourceId: { type: String, required: true },
    kind: { type: String, required: true },
    from: { type: String, default: null },
    to: { type: String, default: null },
    by: { type: String, default: null },
    reason: { type: String, default: null },
    at: { type: Date, default: Date.now },
}, { versionKey: false });
AssignmentHistorySchema.index({ at: -1 });

export const AssignmentHistory = model<IAssignmentHistory>('AssignmentHistory', AssignmentHistorySchema, 'assignmenthistory');
