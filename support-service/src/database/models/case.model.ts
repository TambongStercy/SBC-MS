import { Schema, model, Types } from 'mongoose';
import { CASE_TYPES, CASE_SEVERITIES, CASE_STATUSES } from '../../config/constants';

/** Activation and finance cases. One anomaly reported twice = one case (unique dedupKey). */
export interface ICase {
    type: string;
    dedupKey: string;
    severity: string;
    status: string;
    subject: { userId?: string | null; transactionId?: string | null; sessionId?: string | null; gateway?: string | null };
    /** Member's country (ISO), for country teams (Phase 5). Null when unknown. */
    country?: string | null;
    /** Money at stake (XAF), for the fraud queue's order. */
    amount?: number | null;
    /** 0 info, 1 warning, 2 critical: sorts the queues by severity. */
    severityRank?: number;
    summary: string;
    details?: unknown;
    source: string;
    occurrences: number;
    lastSeenAt: Date;
    assigneeId?: Types.ObjectId | null;
    checks: { at: Date; by?: string | null; source: string; result: unknown; requestId?: string | null }[];
    comments: { at: Date; agentId: string; name: string; body: string }[];
    history: { at: Date; kind: string; by?: string | null; from?: unknown; to?: unknown; note?: string | null }[];
    ticketId?: Types.ObjectId | null;
    resolvedAt?: Date | null;
    createdAt?: Date;
    updatedAt?: Date;
}

const CaseSchema = new Schema<ICase>({
    type: { type: String, enum: CASE_TYPES as unknown as string[], required: true },
    dedupKey: { type: String, required: true, unique: true, maxlength: 300 },
    severity: { type: String, enum: CASE_SEVERITIES as unknown as string[], default: 'warning' },
    status: { type: String, enum: CASE_STATUSES as unknown as string[], default: 'open' },
    subject: { userId: String, transactionId: String, sessionId: String, gateway: String },
    country: { type: String, default: null },
    amount: { type: Number, default: null },
    severityRank: { type: Number, default: 1 },
    summary: { type: String, required: true, maxlength: 1000 },
    details: { type: Schema.Types.Mixed, default: null },
    source: { type: String, default: 'unknown' },
    occurrences: { type: Number, default: 1 },
    lastSeenAt: { type: Date, default: Date.now },
    assigneeId: { type: Schema.Types.ObjectId, default: null },
    checks: { type: [{ _id: false, at: Date, by: String, source: String, result: Schema.Types.Mixed, requestId: String }], default: [] },
    comments: { type: [{ _id: false, at: Date, agentId: String, name: String, body: String }], default: [] },
    history: { type: [{ _id: false, at: Date, kind: String, by: String, from: Schema.Types.Mixed, to: Schema.Types.Mixed, note: String }], default: [] },
    ticketId: { type: Schema.Types.ObjectId, default: null },
    resolvedAt: { type: Date, default: null },
}, { timestamps: true, minimize: false });

CaseSchema.index({ status: 1, severity: 1, createdAt: -1 });
CaseSchema.index({ type: 1, status: 1 });
CaseSchema.index({ 'subject.userId': 1 });
// Fraud queue: worst first, then the largest amount (Security plan Phase 5).
CaseSchema.index({ status: 1, severityRank: -1, amount: -1 });
CaseSchema.index({ country: 1, status: 1 });

export const Case = model<ICase>('Case', CaseSchema, 'cases');
