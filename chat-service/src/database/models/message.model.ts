import { Schema, Document, Types, model } from 'mongoose';

export enum MessageType {
    TEXT = 'text',
    DOCUMENT = 'document',
    SYSTEM = 'system',
    AD = 'ad'
}

export enum MessageStatus {
    SENT = 'sent',
    DELIVERED = 'delivered',
    READ = 'read'
}

export interface IReplyTo {
    messageId: Types.ObjectId;
    content: string;
    senderId: Types.ObjectId;
    senderName?: string;
    type: MessageType;
}

export interface IMessage extends Document {
    _id: Types.ObjectId;
    conversationId: Types.ObjectId;
    senderId: Types.ObjectId;
    type: MessageType;
    content: string;
    // Document fields
    documentUrl?: string;
    documentName?: string;
    documentMimeType?: string;
    documentSize?: number;
    // Ad fields
    adId?: Types.ObjectId;
    adImageUrl?: string;
    adRedirectUrl?: string;
    adCta?: string;
    // Reply to another message
    replyTo?: IReplyTo;
    // Status tracking
    status: MessageStatus;
    readBy: Types.ObjectId[];
    deliveredTo: Types.ObjectId[];
    // Deletion
    deleted: boolean;
    deletedAt?: Date;
    deletedFor: Types.ObjectId[];
    createdAt: Date;
    updatedAt: Date;
}

const MessageSchema = new Schema<IMessage>(
    {
        conversationId: {
            type: Schema.Types.ObjectId,
            ref: 'Conversation',
            required: true,
            index: true
        },
        senderId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        type: {
            type: String,
            enum: Object.values(MessageType),
            default: MessageType.TEXT,
            required: true
        },
        content: {
            type: String,
            required: true,
            maxlength: 5000
        },
        // Document fields
        documentUrl: { type: String },
        documentName: { type: String },
        documentMimeType: { type: String },
        documentSize: { type: Number },
        // Ad fields
        adId: { type: Schema.Types.ObjectId, ref: 'Advertisement' },
        adImageUrl: { type: String },
        adRedirectUrl: { type: String },
        adCta: { type: String },
        // Reply to another message
        replyTo: {
            messageId: { type: Schema.Types.ObjectId, ref: 'Message' },
            content: { type: String },
            senderId: { type: Schema.Types.ObjectId, ref: 'User' },
            senderName: { type: String },
            type: { type: String, enum: Object.values(MessageType) }
        },
        // Status tracking
        status: {
            type: String,
            enum: Object.values(MessageStatus),
            default: MessageStatus.SENT
        },
        readBy: [{
            type: Schema.Types.ObjectId,
            ref: 'User'
        }],
        deliveredTo: [{
            type: Schema.Types.ObjectId,
            ref: 'User'
        }],
        // Deletion
        deleted: {
            type: Boolean,
            default: false
        },
        deletedAt: { type: Date },
        deletedFor: [{
            type: Schema.Types.ObjectId,
            ref: 'User'
        }]
    },
    { timestamps: true }
);

// Index for fetching messages in a conversation
MessageSchema.index({ conversationId: 1, createdAt: -1 });
// Soft delete filter
MessageSchema.index({ deleted: 1 });
// Index for user's messages
MessageSchema.index({ senderId: 1, createdAt: -1 });

export default model<IMessage>('Message', MessageSchema);
