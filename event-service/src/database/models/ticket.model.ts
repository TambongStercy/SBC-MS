import mongoose, { Document, Schema, Types } from 'mongoose';

export enum TicketStatus {
    PENDING = 'PENDING',
    ISSUED = 'ISSUED',
    CHECKED_IN = 'CHECKED_IN',
    CANCELLED = 'CANCELLED',
    REFUNDED = 'REFUNDED',
    EXPIRED = 'EXPIRED',
}

export interface ITicket extends Document {
    _id: Types.ObjectId;
    orderId: Types.ObjectId;
    eventId: Types.ObjectId;
    ticketTypeId: Types.ObjectId;
    ownerUserId: Types.ObjectId;
    serial: string;
    /** Opaque HMAC-signed token; scanner posts this, server resolves the record. */
    qrToken: string | null;
    status: TicketStatus;
    holderName: string;
    holderPhone: string;
    holderEmail?: string;
    /** Points at the current active ResaleListing (if any). */
    resaleListingId?: Types.ObjectId;
    /** Chain link: when resold, the new ticket points at the old one for audit. */
    previousTicketId?: Types.ObjectId;
    issuedAt?: Date;
    checkedInAt?: Date;
    cancelledAt?: Date;
    refundedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const TicketSchema = new Schema<ITicket>({
    orderId: { type: Schema.Types.ObjectId, required: true, ref: 'Order', index: true },
    eventId: { type: Schema.Types.ObjectId, required: true, ref: 'Event', index: true },
    ticketTypeId: { type: Schema.Types.ObjectId, required: true, ref: 'TicketType' },
    ownerUserId: { type: Schema.Types.ObjectId, required: true, index: true },
    serial: { type: String, required: true, unique: true },
    // sparse+unique so nulled-out (invalidated) tickets don't collide.
    qrToken: { type: String, default: null, unique: true, sparse: true },
    status: { type: String, enum: Object.values(TicketStatus), default: TicketStatus.PENDING, index: true },
    holderName: { type: String, required: true, maxlength: 160 },
    holderPhone: { type: String, required: true, maxlength: 24 },
    holderEmail: { type: String, maxlength: 254 },
    resaleListingId: { type: Schema.Types.ObjectId, ref: 'ResaleListing' },
    previousTicketId: { type: Schema.Types.ObjectId, ref: 'Ticket' },
    issuedAt: { type: Date },
    checkedInAt: { type: Date },
    cancelledAt: { type: Date },
    refundedAt: { type: Date },
}, { timestamps: true });

TicketSchema.index({ ownerUserId: 1, status: 1 });
TicketSchema.index({ eventId: 1, status: 1 });

export default mongoose.model<ITicket>('Ticket', TicketSchema);
