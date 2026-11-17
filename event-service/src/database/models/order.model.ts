import mongoose, { Document, Schema, Types } from 'mongoose';

export enum OrderStatus {
    PENDING = 'PENDING',
    PAID = 'PAID',
    FAILED = 'FAILED',
    CANCELLED = 'CANCELLED',
    REFUNDED = 'REFUNDED',
}

export enum OrderKind {
    PRIMARY = 'PRIMARY',
    RESALE = 'RESALE',
}

export interface IOrderItem {
    ticketTypeId: Types.ObjectId;
    quantity: number;
    unitPrice: number;
}

export interface IOrder extends Document {
    _id: Types.ObjectId;
    userId: Types.ObjectId;
    eventId: Types.ObjectId;
    kind: OrderKind;
    /** Present when this is a resale purchase. */
    resaleListingId?: Types.ObjectId;
    items: IOrderItem[];
    subtotal: number;
    commission: number;
    total: number;
    /** payment-service session id. Unique-sparse — orders may exist briefly without it. */
    paymentSessionId?: string;
    status: OrderStatus;
    /** Participant info captured at checkout (spec §8). */
    holder: {
        firstName: string;
        lastName: string;
        phone: string;
        email?: string;
    };
    paidAt?: Date;
    failedAt?: Date;
    /**
     * Set once the organizer's payout has been credited by the sweeper.
     * Idempotent guard: sweeper skips orders where creditedAt is present.
     */
    creditedAt?: Date;
    /**
     * Settlement claim. Set atomically by the one webhook that gets to settle;
     * a concurrent or replayed callback finds it set and stops. Expires after a
     * lease so a crash mid-settlement can be picked up again.
     */
    settlingAt?: Date;
    /** Seats were taken for this order — a resumed settlement must not take them twice. */
    seatsAllocatedAt?: Date;
    /** Last time the payment reconciler asked payment-service about this order. */
    reconciledAt?: Date;
    metadata?: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
}

const OrderItemSchema = new Schema<IOrderItem>({
    ticketTypeId: { type: Schema.Types.ObjectId, required: true, ref: 'TicketType' },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
}, { _id: false });

const OrderSchema = new Schema<IOrder>({
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    eventId: { type: Schema.Types.ObjectId, required: true, ref: 'Event', index: true },
    kind: { type: String, enum: Object.values(OrderKind), default: OrderKind.PRIMARY, index: true },
    resaleListingId: { type: Schema.Types.ObjectId, ref: 'ResaleListing' },
    items: { type: [OrderItemSchema], required: true },
    subtotal: { type: Number, required: true, min: 0 },
    commission: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },
    paymentSessionId: { type: String, index: true, sparse: true, unique: true },
    status: { type: String, enum: Object.values(OrderStatus), default: OrderStatus.PENDING, index: true },
    holder: {
        firstName: { type: String, required: true, maxlength: 80 },
        lastName: { type: String, required: true, maxlength: 80 },
        phone: { type: String, required: true, maxlength: 24 },
        email: { type: String, maxlength: 254 },
    },
    paidAt: { type: Date },
    failedAt: { type: Date },
    creditedAt: { type: Date },
    settlingAt: { type: Date },
    seatsAllocatedAt: { type: Date },
    reconciledAt: { type: Date },
    metadata: { type: Schema.Types.Mixed },
}, { timestamps: true });

OrderSchema.index({ userId: 1, createdAt: -1 });
OrderSchema.index({ status: 1, createdAt: -1 });
OrderSchema.index({ status: 1, creditedAt: 1 }); // sweeper query

export default mongoose.model<IOrder>('Order', OrderSchema);
