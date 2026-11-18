import { Schema, model, Types } from 'mongoose';
import { TICKET_CATEGORY_KEYS, TICKET_STATUS_KEYS, TICKET_PRIORITIES, TICKET_SOURCES } from '../../config/constants';

export interface ITicket {
    number: string;
    memberId: string;
    memberName?: string | null;
    subject: string;
    category: string;
    queue: string;
    priority: string;
    status: string;
    source: string;
    assigneeId?: Types.ObjectId | null;
    sla: { firstResponseDueAt: Date; resolutionDueAt: Date; firstRespondedAt?: Date | null; breachedAt?: Date | null };
    lastMemberMessageAt?: Date | null;
    lastAgentMessageAt?: Date | null;
    /** Last time an agent opened the ticket: the member's messages before it show as read (blue ticks). */
    agentReadAt?: Date | null;
    resolvedAt?: Date | null;
    closedAt?: Date | null;
    botConversationId?: Types.ObjectId | null;
    caseId?: Types.ObjectId | null;
    /** OpenReplay session the member was in when opening the ticket (services/replay.service). */
    replay?: { sessionId: string; url: string; at: Date } | null;
    createdAt?: Date;
    updatedAt?: Date;
}

const TicketSchema = new Schema<ITicket>({
    number: { type: String, required: true, unique: true },
    memberId: { type: String, required: true },
    memberName: { type: String, default: null },
    subject: { type: String, required: true, maxlength: 200 },
    category: { type: String, enum: TICKET_CATEGORY_KEYS, required: true },
    queue: { type: String, required: true },
    priority: { type: String, enum: TICKET_PRIORITIES as unknown as string[], default: 'normal' },
    status: { type: String, enum: TICKET_STATUS_KEYS, default: 'nouveau' },
    source: { type: String, enum: TICKET_SOURCES as unknown as string[], default: 'member' },
    assigneeId: { type: Schema.Types.ObjectId, default: null, index: true },
    sla: {
        firstResponseDueAt: Date,
        resolutionDueAt: Date,
        firstRespondedAt: { type: Date, default: null },
        breachedAt: { type: Date, default: null },
    },
    lastMemberMessageAt: { type: Date, default: null },
    lastAgentMessageAt: { type: Date, default: null },
    agentReadAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    botConversationId: { type: Schema.Types.ObjectId, default: null },
    caseId: { type: Schema.Types.ObjectId, default: null },
    replay: { type: new Schema({ sessionId: String, url: String, at: Date }, { _id: false }), default: null },
}, { timestamps: true });

TicketSchema.index({ status: 1, queue: 1, priority: 1, createdAt: 1 });
TicketSchema.index({ memberId: 1, createdAt: -1 });

export const Ticket = model<ITicket>('Ticket', TicketSchema, 'tickets');

export interface ITicketMessage {
    ticketId: Types.ObjectId;
    author: { type: 'member' | 'agent' | 'assistant' | 'system'; id?: string | null; name?: string | null };
    body: string;
    internal: boolean;
    attachmentIds: Types.ObjectId[];
    createdAt?: Date;
}

const TicketMessageSchema = new Schema<ITicketMessage>({
    ticketId: { type: Schema.Types.ObjectId, required: true, index: true },
    author: { type: { type: String, required: true }, id: String, name: String },
    body: { type: String, required: true, maxlength: 10000 },
    internal: { type: Boolean, default: false },
    attachmentIds: { type: [Schema.Types.ObjectId], default: [] },
}, { timestamps: { createdAt: true, updatedAt: false } });

export const TicketMessage = model<ITicketMessage>('TicketMessage', TicketMessageSchema, 'ticketmessages');

export interface ITicketEvent {
    ticketId: Types.ObjectId;
    kind: string;
    by?: { type: string; id?: string | null; name?: string | null } | null;
    from?: unknown;
    to?: unknown;
    note?: string | null;
    createdAt?: Date;
}

const TicketEventSchema = new Schema<ITicketEvent>({
    ticketId: { type: Schema.Types.ObjectId, required: true, index: true },
    kind: { type: String, required: true },
    by: { type: Schema.Types.Mixed, default: null },
    from: { type: Schema.Types.Mixed, default: null },
    to: { type: Schema.Types.Mixed, default: null },
    note: { type: String, default: null },
}, { timestamps: { createdAt: true, updatedAt: false } });

export const TicketEvent = model<ITicketEvent>('TicketEvent', TicketEventSchema, 'ticketevents');

export interface IAttachment {
    owner: { type: 'member' | 'agent'; id: string };
    ticketId?: Types.ObjectId | null;
    key: string;
    filename: string;
    mime: string;
    size: number;
    sha256: string;
    createdAt?: Date;
}

const AttachmentSchema = new Schema<IAttachment>({
    owner: { type: { type: String, required: true }, id: { type: String, required: true } },
    ticketId: { type: Schema.Types.ObjectId, default: null, index: true },
    key: { type: String, required: true },
    filename: { type: String, required: true },
    mime: { type: String, required: true },
    size: { type: Number, required: true },
    sha256: { type: String, required: true },
}, { timestamps: { createdAt: true, updatedAt: false } });
AttachmentSchema.index({ 'owner.id': 1, createdAt: -1 });

export const Attachment = model<IAttachment>('Attachment', AttachmentSchema, 'attachments');

export interface IResponseTemplate {
    title: string;
    category?: string | null;
    language: 'fr' | 'en';
    body: string;
    active: boolean;
    updatedBy?: string | null;
}

const ResponseTemplateSchema = new Schema<IResponseTemplate>({
    title: { type: String, required: true, maxlength: 120 },
    category: { type: String, default: null },
    language: { type: String, enum: ['fr', 'en'], default: 'fr' },
    body: { type: String, required: true, maxlength: 5000 },
    active: { type: Boolean, default: true },
    updatedBy: { type: String, default: null },
}, { timestamps: true });

export const ResponseTemplate = model<IResponseTemplate>('ResponseTemplate', ResponseTemplateSchema, 'responsetemplates');
