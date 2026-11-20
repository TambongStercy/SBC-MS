import { Schema, model } from 'mongoose';

/** The desk's bell: alerts to one agent or to every agent holding a role. */
export interface IAgentNotification {
    agentId?: string | null;
    role?: string | null;
    kind: string;
    title: string;
    body: string;
    link?: string | null;
    dedupKey?: string | null;
    readBy: string[];
    createdAt?: Date;
}

const AgentNotificationSchema = new Schema<IAgentNotification>({
    agentId: { type: String, default: null, index: true },
    role: { type: String, default: null, index: true },
    kind: { type: String, required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    link: { type: String, default: null },
    dedupKey: { type: String, default: undefined },
    readBy: { type: [String], default: [] },
}, { timestamps: { createdAt: true, updatedAt: false } });
AgentNotificationSchema.index({ dedupKey: 1 }, { unique: true, partialFilterExpression: { dedupKey: { $type: 'string' } } });
AgentNotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });

export const AgentNotification = model<IAgentNotification>('AgentNotification', AgentNotificationSchema, 'agentnotifications');
