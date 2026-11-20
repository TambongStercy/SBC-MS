import { Schema, model, Types } from 'mongoose';

export interface IBotConversation {
    memberId: string;
    messages: {
        role: 'member' | 'assistant';
        text: string;
        anonymized?: string | null;
        source?: 'faq' | 'ai' | 'route' | null;
        route?: string | null;
        articles?: { slug: string; title: string }[];
        at: Date;
    }[];
    aiCalls: number;
    escalatedTicketId?: Types.ObjectId | null;
    createdAt?: Date;
    updatedAt?: Date;
}

const BotConversationSchema = new Schema<IBotConversation>({
    memberId: { type: String, required: true, index: true },
    messages: {
        type: [{
            _id: false, role: String, text: String, anonymized: String, source: String, route: String,
            articles: [{ _id: false, slug: String, title: String }], at: Date,
        }],
        default: [],
    },
    aiCalls: { type: Number, default: 0 },
    escalatedTicketId: { type: Schema.Types.ObjectId, default: null },
}, { timestamps: true });

export const BotConversation = model<IBotConversation>('BotConversation', BotConversationSchema, 'botconversations');

/** Monthly DeepSeek spend, kept in Mongo so a Redis flush cannot reset the budget. */
export interface IAssistantUsage { month: string; calls: number; costUsd: number; promptTokens: number; completionTokens: number }
const AssistantUsageSchema = new Schema<IAssistantUsage>({
    month: { type: String, required: true, unique: true },
    calls: { type: Number, default: 0 },
    costUsd: { type: Number, default: 0 },
    promptTokens: { type: Number, default: 0 },
    completionTokens: { type: Number, default: 0 },
}, { versionKey: false });
export const AssistantUsage = model<IAssistantUsage>('AssistantUsage', AssistantUsageSchema, 'assistantusage');
