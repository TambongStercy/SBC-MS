import { Schema, model, Types } from 'mongoose';

/** Server-side agent sessions: revocable, refresh token rotated on every use. */
export interface IAgentSession {
    agentId: Types.ObjectId;
    refreshHash: string;
    usedRefreshHashes: string[];
    createdAt: Date;
    lastActivityAt: Date;
    absoluteExpiresAt: Date;
    revokedAt?: Date | null;
    revokeReason?: string | null;
    ip?: string;
    userAgent?: string;
    deviceHash?: string;
}

const AgentSessionSchema = new Schema<IAgentSession>({
    agentId: { type: Schema.Types.ObjectId, required: true, index: true },
    refreshHash: { type: String, required: true },
    usedRefreshHashes: { type: [String], default: [] },
    createdAt: { type: Date, default: Date.now },
    lastActivityAt: { type: Date, default: Date.now },
    absoluteExpiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokeReason: { type: String, default: null },
    ip: String,
    userAgent: String,
    deviceHash: String,
});
// Old sessions are purged a month after their absolute expiry.
AgentSessionSchema.index({ absoluteExpiresAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });

export const AgentSession = model<IAgentSession>('AgentSession', AgentSessionSchema, 'agentsessions');
