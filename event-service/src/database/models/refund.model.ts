import mongoose, { Document, Schema, Types } from 'mongoose';

export enum RefundStatus {
    PENDING = 'PENDING',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED',
}

export interface IRefund extends Document {
    _id: Types.ObjectId;
    orderId: Types.ObjectId;
    ticketId?: Types.ObjectId;
    amount: number;
    reason?: string;
    initiatedByAdminId: Types.ObjectId;
    providerRef?: string;
    status: RefundStatus;
    completedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const RefundSchema = new Schema<IRefund>({
    orderId: { type: Schema.Types.ObjectId, required: true, ref: 'Order', index: true },
    ticketId: { type: Schema.Types.ObjectId, ref: 'Ticket' },
    amount: { type: Number, required: true, min: 0 },
    reason: { type: String, maxlength: 500 },
    initiatedByAdminId: { type: Schema.Types.ObjectId, required: true },
    providerRef: { type: String },
    status: { type: String, enum: Object.values(RefundStatus), default: RefundStatus.PENDING, index: true },
    completedAt: { type: Date },
}, { timestamps: true });

export default mongoose.model<IRefund>('Refund', RefundSchema);
