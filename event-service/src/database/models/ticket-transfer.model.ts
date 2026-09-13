import mongoose, { Document, Schema, Types } from 'mongoose';

export interface ITicketTransfer extends Document {
    _id: Types.ObjectId;
    fromTicketId: Types.ObjectId;
    toTicketId: Types.ObjectId;
    fromUserId: Types.ObjectId;
    toUserId: Types.ObjectId;
    viaResaleOrderId?: Types.ObjectId;
    at: Date;
    createdAt: Date;
    updatedAt: Date;
}

const TicketTransferSchema = new Schema<ITicketTransfer>({
    fromTicketId: { type: Schema.Types.ObjectId, required: true, ref: 'Ticket', index: true },
    toTicketId: { type: Schema.Types.ObjectId, required: true, ref: 'Ticket', index: true },
    fromUserId: { type: Schema.Types.ObjectId, required: true },
    toUserId: { type: Schema.Types.ObjectId, required: true },
    viaResaleOrderId: { type: Schema.Types.ObjectId, ref: 'ResaleOrder' },
    at: { type: Date, required: true, default: () => new Date() },
}, { timestamps: true });

export default mongoose.model<ITicketTransfer>('TicketTransfer', TicketTransferSchema);
