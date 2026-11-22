import { Schema, model, Types } from 'mongoose';
import { AgentRef } from './approval.model';

/**
 * KYC level 3 (2026-11-22): one ID document + selfie sent by a member or by a person who lost
 * access (guest request). The images and the check results live on the secondary server
 * (kyc-worker, `kycId`); this keeps who, why, the status and the decision for the desk lists.
 * The decision is evidence for the agents, nothing more: a release, an authenticator reset or a
 * contact change still goes through its own approval.
 */
export const IDENTITY_STATUSES = ['pending', 'checked', 'approved', 'refused'] as const;

export interface IIdentityVerification {
    kycId: string;
    memberId: string | null;
    ticketId: Types.ObjectId | null;
    purpose: 'fraud_hold' | 'authenticator_reset' | 'lost_access';
    status: typeof IDENTITY_STATUSES[number];
    country: string | null;
    name: string | null;
    images: string[];
    hints: string[];
    matchScore: number | null;
    decidedBy?: AgentRef | null;
    decidedAt?: Date | null;
    decisionReason?: string | null;
    imagesDeletedAt?: Date | null;
    createdAt?: Date;
    updatedAt?: Date;
}

const AgentRefSchema = new Schema<AgentRef>({ id: String, name: String, roles: [String] }, { _id: false });

const IdentityVerificationSchema = new Schema<IIdentityVerification>({
    kycId: { type: String, required: true, unique: true },
    memberId: { type: String, default: null },
    ticketId: { type: Schema.Types.ObjectId, default: null },
    purpose: { type: String, enum: ['fraud_hold', 'authenticator_reset', 'lost_access'], required: true },
    status: { type: String, enum: IDENTITY_STATUSES as unknown as string[], default: 'pending' },
    country: { type: String, default: null },
    name: { type: String, default: null },
    images: { type: [String], default: [] },
    hints: { type: [String], default: [] },
    matchScore: { type: Number, default: null },
    decidedBy: { type: AgentRefSchema, default: null },
    decidedAt: { type: Date, default: null },
    decisionReason: { type: String, default: null, maxlength: 2000 },
    imagesDeletedAt: { type: Date, default: null },
}, { timestamps: true, minimize: false });

IdentityVerificationSchema.index({ status: 1, createdAt: -1 });
IdentityVerificationSchema.index({ memberId: 1, createdAt: -1 });
IdentityVerificationSchema.index({ ticketId: 1, createdAt: -1 });

export const IdentityVerification = model<IIdentityVerification>('IdentityVerification', IdentityVerificationSchema, 'identityverifications');
