import mongoose, { Document, Schema, Types } from 'mongoose';

export enum ResaleOrderStatus {
    PENDING = 'PENDING',
    PAID = 'PAID',
    FAILED = 'FAILED',
    CANCELLED = 'CANCELLED',
}

export interface IResaleOrder extends Document {
    _id: Types.ObjectId;
    listingId: Types.ObjectId;
    buyerUserId: Types.ObjectId;
    /** Copy of the top-level Order id — kept for join-free queries and audit. */
    orderId?: Types.ObjectId;
    paymentSessionId?: string;
    newTicketId?: Types.ObjectId;
    status: ResaleOrderStatus;
    settledAt?: Date;
    /** Settlement claim (see Order.settlingAt). */
    settlingAt?: Date;
    /** Last time the payment reconciler asked payment-service about this order. */
    reconciledAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const ResaleOrderSchema = new Schema<IResaleOrder>({
    listingId: { type: Schema.Types.ObjectId, required: true, ref: 'ResaleListing', index: true },
    buyerUserId: { type: Schema.Types.ObjectId, required: true, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order' },
    paymentSessionId: { type: String, sparse: true, unique: true },
    newTicketId: { type: Schema.Types.ObjectId, ref: 'Ticket' },
    status: { type: String, enum: Object.values(ResaleOrderStatus), default: ResaleOrderStatus.PENDING, index: true },
    settledAt: { type: Date },
    settlingAt: { type: Date },
    reconciledAt: { type: Date },
}, { timestamps: true });

export default mongoose.model<IResaleOrder>('ResaleOrder', ResaleOrderSchema);
