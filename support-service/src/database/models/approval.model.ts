import { Schema, model, Types } from 'mongoose';

export const APPROVAL_TYPES = ['contact_change', 'manual_activation', 'regularization', 'authenticator_reset', 'account_freeze', 'risk_release', 'commission_reversal'] as const;
export type ApprovalType = typeof APPROVAL_TYPES[number];
export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'executed', 'failed', 'cancelled', 'expired'] as const;
export type ApprovalStatus = typeof APPROVAL_STATUSES[number];

export interface AgentRef { id: string; name: string; roles: string[] }

export interface IApproval {
    type: ApprovalType;
    status: ApprovalStatus;
    requestedBy: AgentRef;
    reason: string;
    payload: Record<string, unknown>;
    subject: { userId?: string | null; transactionId?: string | null; sessionId?: string | null };
    requiredApprovals: number;
    approvals: { agent: AgentRef; at: Date; note?: string | null; override?: boolean }[];
    rejectedBy?: AgentRef | null;
    rejectionReason?: string | null;
    execution?: { at?: Date | null; by?: AgentRef | null; ok?: boolean; code?: string | null; message?: string | null; result?: unknown } | null;
    ticketId?: Types.ObjectId | null;
    caseId?: Types.ObjectId | null;
    expiresAt: Date;
    createdAt?: Date;
    updatedAt?: Date;
}

const AgentRefSchema = new Schema<AgentRef>({ id: String, name: String, roles: [String] }, { _id: false });

const ApprovalSchema = new Schema<IApproval>({
    type: { type: String, enum: APPROVAL_TYPES as unknown as string[], required: true, index: true },
    status: { type: String, enum: APPROVAL_STATUSES as unknown as string[], default: 'pending', index: true },
    requestedBy: { type: AgentRefSchema, required: true },
    reason: { type: String, required: true, maxlength: 2000 },
    payload: { type: Schema.Types.Mixed, default: {} },
    subject: { userId: String, transactionId: String, sessionId: String },
    requiredApprovals: { type: Number, default: 1, min: 1, max: 3 },
    approvals: { type: [{ _id: false, agent: AgentRefSchema, at: Date, note: String, override: Boolean }], default: [] },
    rejectedBy: { type: AgentRefSchema, default: null },
    rejectionReason: { type: String, default: null },
    execution: { type: Schema.Types.Mixed, default: null },
    ticketId: { type: Schema.Types.ObjectId, default: null },
    caseId: { type: Schema.Types.ObjectId, default: null },
    expiresAt: { type: Date, required: true },
}, { timestamps: true, minimize: false });

ApprovalSchema.index({ status: 1, type: 1, createdAt: -1 });
ApprovalSchema.index({ 'subject.userId': 1, createdAt: -1 });

export const Approval = model<IApproval>('Approval', ApprovalSchema, 'approvals');
