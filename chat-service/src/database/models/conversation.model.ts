import { Schema, Document, Types, model } from 'mongoose';

export enum ConversationType {
    DIRECT = 'direct',
    STATUS_REPLY = 'status_reply'
}

export enum ConversationAcceptanceStatus {
    PENDING = 'pending',
    ACCEPTED = 'accepted',
    REPORTED = 'reported',
    BLOCKED = 'blocked'
}

export interface IConversation extends Document {
    _id: Types.ObjectId;
    participants: Types.ObjectId[];
    type: ConversationType;
    statusId?: Types.ObjectId;
    lastMessage?: Types.ObjectId;
    lastMessageAt?: Date;
    lastMessagePreview?: string;
    lastMessageSenderId?: Types.ObjectId;
    unreadCounts: Map<string, number>;
    deletedFor: Types.ObjectId[];
    acceptanceStatus: ConversationAcceptanceStatus;
    initiatorId?: Types.ObjectId;
    messageCounts: Map<string, number>;
    acceptedAt?: Date;
    reportedAt?: Date;
    reportedBy?: Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const ConversationSchema = new Schema<IConversation>(
    {
        participants: [{
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        }],
        type: {
            type: String,
            enum: Object.values(ConversationType),
            default: ConversationType.DIRECT,
            required: true
        },
        statusId: {
            type: Schema.Types.ObjectId,
            ref: 'Status',
            sparse: true
        },
        lastMessage: {
            type: Schema.Types.ObjectId,
            ref: 'Message'
        },
        lastMessageAt: {
            type: Date,
            index: true
        },
        lastMessagePreview: {
            type: String,
            maxlength: 100
        },
        lastMessageSenderId: {
            type: Schema.Types.ObjectId,
            ref: 'User'
        },
        unreadCounts: {
            type: Map,
            of: Number,
            default: new Map()
        },
        deletedFor: [{
            type: Schema.Types.ObjectId,
            ref: 'User'
        }],
        acceptanceStatus: {
            type: String,
            enum: Object.values(ConversationAcceptanceStatus),
            default: ConversationAcceptanceStatus.ACCEPTED,
            required: true
        },
        initiatorId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            index: true
        },
        messageCounts: {
            type: Map,
            of: Number,
            default: new Map()
        },
        acceptedAt: {
            type: Date
        },
        reportedAt: {
            type: Date
        },
        reportedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User'
        }
    },
    { timestamps: true }
);

// Compound index for efficient participant lookup
ConversationSchema.index({ participants: 1, type: 1 });
// Index for sorting by recent activity
ConversationSchema.index({ lastMessageAt: -1 });
// Index for finding conversation between two users
ConversationSchema.index({ participants: 1 }, { unique: false });

export default model<IConversation>('Conversation', ConversationSchema);
