import mongoose, { Document, Schema, Types } from 'mongoose';

/**
 * Audit trail of notifications the service fired — separate from
 * notification-service's own history. Useful when investigating "the buyer
 * says they didn't get the email" without needing cross-service queries.
 */
export interface INotificationLog extends Document {
    _id: Types.ObjectId;
    kind: string; // e.g. 'event-ticket-purchased'
    userId?: Types.ObjectId;
    orderId?: Types.ObjectId;
    ticketId?: Types.ObjectId;
    eventId?: Types.ObjectId;
    channel: 'email' | 'sms' | 'push' | 'whatsapp';
    recipient?: string;
    delivered: boolean;
    reason?: string;
    at: Date;
    createdAt: Date;
    updatedAt: Date;
}

const NotificationLogSchema = new Schema<INotificationLog>({
    kind: { type: String, required: true, index: true },
    userId: { type: Schema.Types.ObjectId, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', index: true, sparse: true },
    ticketId: { type: Schema.Types.ObjectId, ref: 'Ticket', sparse: true },
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', sparse: true },
    channel: { type: String, enum: ['email', 'sms', 'push', 'whatsapp'], required: true },
    recipient: { type: String },
    delivered: { type: Boolean, required: true },
    reason: { type: String, maxlength: 500 },
    at: { type: Date, required: true, default: () => new Date() },
}, { timestamps: true });

NotificationLogSchema.index({ kind: 1, at: -1 });

export default mongoose.model<INotificationLog>('NotificationLog', NotificationLogSchema);
