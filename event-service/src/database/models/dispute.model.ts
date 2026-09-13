import mongoose, { Document, Schema, Types } from 'mongoose';

export enum DisputeStatus {
    OPEN = 'OPEN',
    RESOLVED = 'RESOLVED',
    REJECTED = 'REJECTED',
}

export enum DisputeKind {
    RESALE_INVALID_TICKET = 'RESALE_INVALID_TICKET',
    RESALE_NOT_RECEIVED = 'RESALE_NOT_RECEIVED',
    EVENT_NOT_AS_ADVERTISED = 'EVENT_NOT_AS_ADVERTISED',
    OTHER = 'OTHER',
}

export interface IDispute extends Document {
    _id: Types.ObjectId;
    kind: DisputeKind;
    complainantUserId: Types.ObjectId;
    resaleOrderId?: Types.ObjectId;
    ticketId?: Types.ObjectId;
    eventId?: Types.ObjectId;
    description: string;
    status: DisputeStatus;
    resolutionNote?: string;
    resolvedByAdminId?: Types.ObjectId;
    resolvedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const DisputeSchema = new Schema<IDispute>({
    kind: { type: String, enum: Object.values(DisputeKind), required: true, index: true },
    complainantUserId: { type: Schema.Types.ObjectId, required: true, index: true },
    resaleOrderId: { type: Schema.Types.ObjectId, ref: 'ResaleOrder', sparse: true },
    ticketId: { type: Schema.Types.ObjectId, ref: 'Ticket', sparse: true },
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', sparse: true },
    description: { type: String, required: true, maxlength: 2000 },
    status: { type: String, enum: Object.values(DisputeStatus), default: DisputeStatus.OPEN, index: true },
    resolutionNote: { type: String, maxlength: 2000 },
    resolvedByAdminId: { type: Schema.Types.ObjectId },
    resolvedAt: { type: Date },
}, { timestamps: true });

DisputeSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model<IDispute>('Dispute', DisputeSchema);
