import { Schema, model, Document, Types } from 'mongoose';

export type ContactsEventType =
    | 'subscription.activated'
    | 'subscription.renewed'
    | 'subscription.updated'
    | 'subscription.expired'
    | 'subscription.cancelled';

/**
 * Outbox for the SBC Network webhook. The body is stored exactly as sent,
 * because the signature covers the raw bytes and retries must resend the same
 * event (same id) for the app to apply it once.
 */
export interface IContactsWebhookEvent extends Document {
    eventId: string;
    type: ContactsEventType;
    userId: Types.ObjectId;
    body: string;
    status: 'pending' | 'delivered' | 'failed';
    attempts: number;
    nextAttemptAt: Date;
    lastStatus?: number;
    lastError?: string;
    deliveredAt?: Date;
    createdAt: Date;
}

const schema = new Schema<IContactsWebhookEvent>({
    eventId: { type: String, required: true, unique: true },
    type: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    body: { type: String, required: true },
    status: { type: String, enum: ['pending', 'delivered', 'failed'], default: 'pending' },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, required: true },
    lastStatus: Number,
    lastError: String,
    deliveredAt: Date,
}, { timestamps: true });

schema.index({ status: 1, nextAttemptAt: 1 });
// Delivered events are kept 30 days for support, then dropped.
schema.index({ deliveredAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });

export default model<IContactsWebhookEvent>('ContactsWebhookEvent', schema);
