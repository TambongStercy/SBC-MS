import { Schema, model, Types, HydratedDocument } from 'mongoose';
import { ROLES } from '../../config/permissions';

/** Support agents. Never stored in user-service `users` (separate accounts). */
export interface IAgent {
    email: string;
    name: string;
    roles: string[];
    status: 'pending' | 'active' | 'disabled';
    passwordHash?: string | null;
    passwordChangedAt?: Date | null;
    totp: { secretEnc?: string | null; enrolled: boolean; enrolledAt?: Date | null; lastUsedStep?: number | null };
    backupCodes: { hash: string; usedAt?: Date | null }[];
    activation?: { tokenHash?: string | null; expiresAt?: Date | null; usedAt?: Date | null; createdBy?: Types.ObjectId | null } | null;
    knownDevices: { hash: string; firstSeenAt: Date; lastSeenAt: Date }[];
    lastLoginAt?: Date | null;
    lastLoginIp?: string | null;
    views: { available: boolean; lastAssignedAt?: Date | null; lastSeenAt?: Date | null };
    /** Country team (ISO codes). Empty = every country. Filters the activity panel (Phase 11). */
    countries: string[];
    createdBy?: Types.ObjectId | null;
    disabledAt?: Date | null;
    createdAt?: Date;
    updatedAt?: Date;
}

const AgentSchema = new Schema<IAgent>({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    roles: { type: [String], enum: ROLES as unknown as string[], default: [] },
    status: { type: String, enum: ['pending', 'active', 'disabled'], default: 'pending', index: true },
    passwordHash: { type: String, default: null },
    passwordChangedAt: { type: Date, default: null },
    totp: {
        secretEnc: { type: String, default: null },
        enrolled: { type: Boolean, default: false },
        enrolledAt: { type: Date, default: null },
        lastUsedStep: { type: Number, default: null },
    },
    backupCodes: { type: [{ _id: false, hash: String, usedAt: { type: Date, default: null } }], default: [] },
    activation: {
        tokenHash: { type: String, default: null },
        expiresAt: { type: Date, default: null },
        usedAt: { type: Date, default: null },
        createdBy: { type: Schema.Types.ObjectId, default: null },
    },
    knownDevices: { type: [{ _id: false, hash: String, firstSeenAt: Date, lastSeenAt: Date }], default: [] },
    lastLoginAt: { type: Date, default: null },
    lastLoginIp: { type: String, default: null },
    views: {
        available: { type: Boolean, default: false },
        lastAssignedAt: { type: Date, default: null },
        lastSeenAt: { type: Date, default: null },
    },
    countries: { type: [String], default: [] },
    createdBy: { type: Schema.Types.ObjectId, default: null },
    disabledAt: { type: Date, default: null },
}, { timestamps: true });

AgentSchema.index({ roles: 1, status: 1 });
AgentSchema.index({ 'activation.tokenHash': 1 }, { unique: true, partialFilterExpression: { 'activation.tokenHash': { $type: 'string' } } });

export type AgentDoc = HydratedDocument<IAgent>;
export const Agent = model<IAgent>('Agent', AgentSchema, 'agents');
